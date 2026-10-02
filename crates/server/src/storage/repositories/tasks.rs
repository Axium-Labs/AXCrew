//! `tasks`, `task_dependencies` and `task_runs`.
//!
//! The dependency graph is validated here rather than in the API layer because
//! the checks must read the graph inside the same transaction that writes it.

use crate::{
    domain::task::{NewTask, Task, TaskEdit, TaskRow},
    storage::Db,
    storage::repositories::crews::member,
};
use anyhow::{Result, anyhow};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use uuid::Uuid;

impl Db {
    pub fn create_task(&self, body: NewTask) -> Result<Task> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let assigned =
            member(&tx, &body.assigned_member)?.ok_or_else(|| anyhow!("member not found"))?;
        if assigned.crew_id != body.crew_id {
            return Err(anyhow!("member belongs to another crew"));
        }
        for dep in &body.dependencies {
            let d = task(&tx, dep)?.ok_or_else(|| anyhow!("dependency {dep} not found"))?;
            if d.crew_id != body.crew_id {
                return Err(anyhow!("dependency belongs to another crew"));
            }
        }
        if body.title.trim().is_empty() {
            return Err(anyhow!("task title required"));
        }
        if let Some(parent) = &body.parent_id {
            let found = task(&tx, parent)?.ok_or_else(|| anyhow!("parent task not found"))?;
            if found.crew_id != body.crew_id {
                return Err(anyhow!("parent task belongs to another crew"));
            }
        }
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO tasks(id,crew_id,parent_id,title,description,assigned_member,assigned_device,priority,status,input_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'pending',?9)",params![id,body.crew_id,body.parent_id,body.title,body.description,body.assigned_member,assigned.device_id,body.priority,body.input.to_string()])?;
        for dep in &body.dependencies {
            tx.execute(
                "INSERT INTO task_dependencies(task_id,depends_on_id) VALUES(?1,?2)",
                params![id, dep],
            )?;
        }
        let result = task(&tx, &id)?.ok_or_else(|| anyhow!("task missing"))?;
        tx.commit()?;
        Ok(result)
    }
    pub fn tasks(&self) -> Result<Vec<Task>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT id FROM tasks ORDER BY created_at,id")?;
        let ids = s
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.into_iter()
            .map(|id| task(&db, &id)?.ok_or_else(|| anyhow!("task missing")))
            .collect()
    }
    pub fn task(&self, id: &str) -> Result<Option<Task>> {
        task(&self.0.lock().unwrap(), id)
    }
    pub fn update_task(&self, id: &str, body: TaskEdit) -> Result<Task> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let current = task(&tx, id)?.ok_or_else(|| anyhow!("task not found"))?;
        if !matches!(current.status.as_str(), "pending" | "failed" | "cancelled") {
            return Err(anyhow!(
                "only pending, failed, or cancelled tasks can be edited"
            ));
        }
        if body.title.trim().is_empty() {
            return Err(anyhow!("task title required"));
        }
        let assigned =
            member(&tx, &body.assigned_member)?.ok_or_else(|| anyhow!("member not found"))?;
        if assigned.crew_id != current.crew_id {
            return Err(anyhow!("member belongs to another crew"));
        }
        if let Some(parent) = &body.parent_id
            && (parent == id || task(&tx, parent)?.is_none_or(|t| t.crew_id != current.crew_id))
        {
            return Err(anyhow!("invalid parent task"));
        }
        fn reaches(
            db: &Connection,
            start: &str,
            target: &str,
            seen: &mut std::collections::HashSet<String>,
        ) -> Result<bool> {
            if start == target {
                return Ok(true);
            }
            if !seen.insert(start.to_owned()) {
                return Ok(false);
            }
            if let Some(node) = task(db, start)? {
                for dep in node.dependencies {
                    if reaches(db, &dep, target, seen)? {
                        return Ok(true);
                    }
                }
            }
            Ok(false)
        }
        for dep in &body.dependencies {
            let found = task(&tx, dep)?.ok_or_else(|| anyhow!("dependency not found"))?;
            if found.crew_id != current.crew_id
                || reaches(&tx, dep, id, &mut std::collections::HashSet::new())?
            {
                return Err(anyhow!("invalid or cyclic dependency"));
            }
        }
        tx.execute("UPDATE tasks SET title=?2,description=?3,assigned_member=?4,assigned_device=?5,parent_id=?6,priority=?7,input_json=?8 WHERE id=?1",params![id,body.title,body.description,body.assigned_member,assigned.device_id,body.parent_id,body.priority,body.input.to_string()])?;
        tx.execute("DELETE FROM task_dependencies WHERE task_id=?1", [id])?;
        for dep in body.dependencies {
            tx.execute(
                "INSERT INTO task_dependencies(task_id,depends_on_id) VALUES(?1,?2)",
                params![id, dep],
            )?;
        }
        if assigned.device_id != current.assigned_device || assigned.id != current.assigned_member {
            tx.execute("DELETE FROM session_bindings WHERE task_id=?1", [id])?;
        }
        let updated = task(&tx, id)?.ok_or_else(|| anyhow!("task missing"))?;
        tx.commit()?;
        Ok(updated)
    }
    pub fn delete_task(&self, id: &str) -> Result<()> {
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let current = task(&tx, id)?.ok_or_else(|| anyhow!("task not found"))?;
        if matches!(
            current.status.as_str(),
            "running" | "ready" | "waiting_permission" | "waiting_user"
        ) {
            return Err(anyhow!("active task cannot be deleted"));
        }
        let references:i64=tx.query_row("SELECT (SELECT COUNT(*) FROM task_dependencies WHERE depends_on_id=?1)+(SELECT COUNT(*) FROM tasks WHERE parent_id=?1)",[id],|r|r.get(0))?;
        if references > 0 {
            return Err(anyhow!("task has dependents or children"));
        }
        tx.execute("DELETE FROM events WHERE task_id=?1", [id])?;
        tx.execute("DELETE FROM session_bindings WHERE task_id=?1", [id])?;
        tx.execute("DELETE FROM task_runs WHERE task_id=?1", [id])?;
        tx.execute("DELETE FROM task_dependencies WHERE task_id=?1", [id])?;
        tx.execute("DELETE FROM tasks WHERE id=?1", [id])?;
        tx.commit()?;
        Ok(())
    }
    pub fn set_status(&self, id: &str, status: &str, output: Option<Value>) -> Result<()> {
        let db = self.0.lock().unwrap();
        let changed=db.execute("UPDATE tasks SET status=?2,output_json=?3,started_at=CASE WHEN ?2='running' THEN unixepoch() ELSE started_at END,finished_at=CASE WHEN ?2 IN ('completed','failed','cancelled') THEN unixepoch() ELSE NULL END WHERE id=?1",params![id,status,output.map(|v|v.to_string())])?;
        if changed == 0 {
            return Err(anyhow!("task not found"));
        }
        Ok(())
    }
    pub fn retry(&self, id: &str) -> Result<()> {
        let db = self.0.lock().unwrap();
        let changed=db.execute("UPDATE tasks SET status='pending',retry_count=retry_count+1,output_json=NULL,started_at=NULL,finished_at=NULL WHERE id=?1 AND status IN ('failed','cancelled')",[id])?;
        if changed == 0 {
            return Err(anyhow!("task cannot be retried"));
        }
        Ok(())
    }
    pub fn start_run(&self, task: &Task) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        self.0.lock().unwrap().execute("INSERT INTO task_runs(id,task_id,attempt,status,started_at) VALUES(?1,?2,?3,'running',unixepoch())",params![id,task.id,task.retry_count+1])?;
        Ok(id)
    }
    pub fn finish_run(&self, task_id: &str, status: &str, error: Option<&str>) -> Result<()> {
        self.0.lock().unwrap().execute("UPDATE task_runs SET status=?2,finished_at=unixepoch(),error=?3 WHERE id=(SELECT id FROM task_runs WHERE task_id=?1 AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1)",params![task_id,status,error])?;
        Ok(())
    }
}

/// Row mapper shared with the session repository.
pub(crate) fn task(db: &Connection, id: &str) -> Result<Option<Task>> {
    let base:Option<TaskRow>=db.query_row("SELECT id,crew_id,parent_id,title,description,assigned_member,assigned_device,priority,status,input_json,output_json,retry_count,created_at,started_at,finished_at FROM tasks WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get(11)?,r.get(12)?,r.get(13)?,r.get(14)?))).optional()?;
    let Some((
        id,
        crew_id,
        parent_id,
        title,
        description,
        assigned_member,
        assigned_device,
        priority,
        status,
        input,
        output,
        retry_count,
        created_at,
        started_at,
        finished_at,
    )) = base
    else {
        return Ok(None);
    };
    let mut s = db.prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id=?1")?;
    let dependencies = s
        .query_map([&id], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(Task {
        id,
        crew_id,
        parent_id,
        title,
        description,
        assigned_member,
        assigned_device,
        dependencies,
        priority,
        status,
        input: serde_json::from_str(&input)?,
        output: output.map(|v| serde_json::from_str(&v)).transpose()?,
        retry_count,
        created_at,
        started_at,
        finished_at,
    }))
}
