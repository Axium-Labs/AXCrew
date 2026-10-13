//! Operator edits preserve submission identity and execution history.
use super::distributed::reconcile;
use crate::{domain::unix_now, storage::Db};
use anyhow::{Result, ensure};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskEdit {
    pub generation: u64,
    pub expected_title: String,
    pub expected_input: String,
    pub title: String,
    pub input: String,
    #[serde(default)]
    pub remove: bool,
}

pub fn edit_task(db: &Db, id: &str, body: TaskEdit) -> Result<()> {
    ensure!(
        !body.title.trim().is_empty() && body.title.len() <= 512,
        "invalid task title"
    );
    db.cluster_update(|state| {
        let t = state
            .tasks
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("task missing"))?;
        ensure!(
            !t.removed
                && t.generation == body.generation
                && t.spec.title == body.expected_title
                && t.spec.input == body.expected_input,
            "task changed; reopen before saving"
        );
        ensure!(
            !body.input.trim().is_empty()
                && body.input.len() + t.spec.context_summary.len() <= 256 * 1024,
            "invalid task input"
        );
        ensure!(
            body.input == t.spec.input || (t.attempts.is_empty() && !t.terminal()),
            "execution already started; send guidance to the AX Session or add a replacement task"
        );
        if body.remove {
            ensure!(
                !state.tasks.values().any(|other| !other.removed
                    && other.id != id
                    && (other.spec.dependencies.iter().any(|dep| dep == id)
                        || other.spec.parent_id.as_deref() == Some(id))),
                "remove dependent tasks or change their dependencies first"
            );
        }
        let t = state.tasks.get_mut(id).unwrap();
        t.spec.title = body.title.trim().into();
        t.spec.input = body.input;
        if body.remove {
            if !t.terminal() {
                if t.status == "running"
                    && let Some(attempt) = t.attempts.last_mut()
                {
                    attempt.ended_at = Some(unix_now());
                    attempt.error = Some("removed by operator".into());
                }
                t.status = "cancelled".into();
            }
            t.removed = true;
            t.owner = None;
            t.incarnation = None;
            t.lease_until = 0;
        }
        if let Some(w) = t
            .spec
            .workflow_id
            .as_ref()
            .and_then(|flow| state.workflows.get_mut(flow))
        {
            w.revision += 1;
            w.updated_at = unix_now();
        }
        state.event(
            unix_now(),
            if body.remove {
                "task.removed"
            } else {
                "task.edited"
            },
            Some(id),
            None,
            "operator edit; submission identity and execution history retained",
        );
        reconcile(state, unix_now());
        Ok(())
    })
}
