//! `session_bindings`: which AX session each Crew task drives, plus the
//! transactional rules for deleting a whole conversation.

use crate::{domain::task::Task, storage::Db};
use anyhow::{Result, anyhow};
use rusqlite::{OptionalExtension, params};

impl Db {
    /// Read-only membership; unlike deletion validation this permits active work.
    pub fn conversation_tasks(&self, device: &str, session: &str) -> Result<Vec<Task>> {
        let mut group = Vec::new();
        for task in self.tasks()? {
            if task.assigned_device == device && self.binding(&task.id)?.as_deref() == Some(session)
            {
                group.push(task);
            }
        }
        Ok(group)
    }
    /// The tasks of one AX session, rejecting the group while any turn is still
    /// active or while another task depends on it.
    pub fn session_tasks(&self, device: &str, session: &str) -> Result<Vec<Task>> {
        let tasks = self.tasks()?;
        let group = self.conversation_tasks(device, session)?;
        if group.iter().any(|t| {
            matches!(
                t.status.as_str(),
                "pending" | "ready" | "running" | "waiting_permission" | "waiting_user"
            )
        }) {
            return Err(anyhow!("active session cannot be deleted"));
        }
        let ids = group
            .iter()
            .map(|t| t.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        if tasks.iter().any(|t| {
            !ids.contains(t.id.as_str())
                && (t.parent_id.as_deref().is_some_and(|p| ids.contains(p))
                    || t.dependencies.iter().any(|d| ids.contains(d.as_str())))
        }) {
            return Err(anyhow!("session has external dependent tasks"));
        }
        Ok(group)
    }
    pub fn delete_session_tasks(&self, device: &str, session: &str) -> Result<()> {
        let group = self.session_tasks(device, session)?;
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        for task in &group {
            let status: String =
                tx.query_row("SELECT status FROM tasks WHERE id=?1", [&task.id], |r| {
                    r.get(0)
                })?;
            if matches!(
                status.as_str(),
                "pending" | "ready" | "running" | "waiting_permission" | "waiting_user"
            ) {
                return Err(anyhow!("active session cannot be deleted"));
            }
            tx.execute("DELETE FROM events WHERE task_id=?1", [&task.id])?;
            tx.execute("DELETE FROM session_bindings WHERE task_id=?1", [&task.id])?;
            tx.execute("DELETE FROM task_runs WHERE task_id=?1", [&task.id])?;
            tx.execute(
                "DELETE FROM task_dependencies WHERE task_id=?1 OR depends_on_id=?1",
                [&task.id],
            )?;
            tx.execute(
                "UPDATE automation_runs SET task_id=NULL WHERE task_id=?1",
                [&task.id],
            )?;
        }
        tx.execute(
            "DELETE FROM events WHERE session_id=?1 AND device_id=?2",
            params![session, device],
        )?;
        // Parent references are cleared together before removing the whole conversation.
        for task in &group {
            tx.execute("UPDATE tasks SET parent_id=NULL WHERE id=?1", [&task.id])?;
        }
        for task in &group {
            tx.execute("DELETE FROM tasks WHERE id=?1", [&task.id])?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn binding(&self, id: &str) -> Result<Option<String>> {
        let db = self.0.lock().unwrap();
        Ok(db
            .query_row(
                "SELECT ax_session_id FROM session_bindings WHERE task_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?)
    }
    pub fn bind(&self, task: &Task, session: &str) -> Result<()> {
        self.0.lock().unwrap().execute("INSERT INTO session_bindings(task_id,member_id,device_id,ax_session_id) VALUES(?1,?2,?3,?4) ON CONFLICT(task_id) DO UPDATE SET ax_session_id=excluded.ax_session_id",params![task.id,task.assigned_member,task.assigned_device,session])?;
        Ok(())
    }
}

#[cfg(test)]
mod workspace_tests {
    use crate::domain::task::NewTask;
    use crate::storage::memory_db;
    use serde_json::json;

    #[test]
    fn permanent_session_deletion_removes_all_turns_and_rejects_active_or_external_dependents() {
        let db = memory_db();
        db.bootstrap_local("test", "test").unwrap();
        let cwd = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let member = db.ensure_local_session_member(&cwd, None, None).unwrap();
        let make = |parent: Option<String>| {
            db.create_task(NewTask {
                crew_id: member.crew_id.clone(),
                title: "turn".into(),
                description: String::new(),
                assigned_member: member.id.clone(),
                parent_id: parent,
                dependencies: vec![],
                priority: 0,
                input: json!({}),
            })
            .unwrap()
        };
        let first = make(None);
        db.bind(&first, "session").unwrap();
        assert_eq!(db.conversation_tasks("local", "session").unwrap().len(), 1);
        assert!(db.delete_session_tasks("local", "session").is_err());
        db.set_status(&first.id, "completed", None).unwrap();
        let child = make(Some(first.id.clone()));
        db.bind(&child, "session").unwrap();
        db.set_status(&child.id, "completed", None).unwrap();
        let external = make(Some(child.id.clone()));
        db.set_status(&external.id, "completed", None).unwrap();
        assert!(db.delete_session_tasks("local", "session").is_err());
        assert!(db.task(&first.id).unwrap().is_some());
        db.delete_task(&external.id).unwrap();
        db.delete_session_tasks("local", "session").unwrap();
        assert!(db.task(&first.id).unwrap().is_none());
        assert!(db.task(&child.id).unwrap().is_none());
        assert!(db.binding(&first.id).unwrap().is_none());
    }
}
