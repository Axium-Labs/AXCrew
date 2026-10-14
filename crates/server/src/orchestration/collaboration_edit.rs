//! Operator edits preserve submission identity and execution history.
use super::distributed::reconcile;
use crate::{domain::unix_now, storage::Db};
use anyhow::{Result, ensure};
use serde::Deserialize;

/// Remove inventory only after all enrollment and live placement references are gone.
pub fn remove_host(db: &Db, id: &str) -> Result<()> {
    db.cluster_update(|state| {
        if !state.hosts.contains_key(id) && state.removed_hosts.contains_key(id) {
            return Ok(());
        }
        ensure!(state.hosts.contains_key(id), "host missing");
        ensure!(
            !state.instances.values().any(|i| i.host_id == id),
            "Host still has AX instances; delete their connections first"
        );
        ensure!(
            !state.tasks.values().any(|t| !t.removed
                && !t.terminal()
                && t.spec.requirements.host_id.as_deref() == Some(id)),
            "Host has unfinished pinned tasks; reassign or cancel them first"
        );
        let mut host = state.hosts.remove(id).expect("checked host");
        host.enabled = false;
        let name = host.name.clone();
        state.removed_hosts.insert(id.to_owned(), host);
        state.event(
            unix_now(),
            "host.removed",
            None,
            None,
            &format!("{id}: {name}"),
        );
        Ok(())
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkflowRemoval {
    pub expected_revision: u64,
}

/// One transaction removes a whole task graph, fences execution and keeps history.
pub fn remove_workflow(db: &Db, id: &str, body: WorkflowRemoval) -> Result<()> {
    db.cluster_update(|state| {
        let w = state
            .workflows
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("workflow missing"))?;
        if w.removed {
            return Ok(());
        }
        ensure!(
            w.revision == body.expected_revision,
            "collaboration changed; review before removing"
        );
        let ids: std::collections::BTreeSet<_> = state
            .tasks
            .values()
            .filter(|t| t.spec.workflow_id.as_deref() == Some(id) || t.id == w.root_task_id)
            .map(|t| t.id.clone())
            .collect();
        let blockers: Vec<_> = state
            .tasks
            .values()
            .filter(|t| {
                !t.removed
                    && !ids.contains(&t.id)
                    && (t.spec.dependencies.iter().any(|dep| ids.contains(dep))
                        || t.spec
                            .parent_id
                            .as_ref()
                            .is_some_and(|parent| ids.contains(parent)))
            })
            .map(|t| t.spec.title.clone())
            .collect();
        ensure!(
            blockers.is_empty(),
            "other collaborations depend on this work: {}",
            blockers.join(", ")
        );
        let now = unix_now();
        for t in state.tasks.values_mut().filter(|t| ids.contains(&t.id)) {
            if !t.terminal() {
                if t.status == "running"
                    && let Some(attempt) = t.attempts.last_mut()
                {
                    attempt.ended_at = Some(now);
                    attempt.error = Some("collaboration removed by operator".into());
                }
                t.status = "cancelled".into();
            }
            t.removed = true;
            t.owner = None;
            t.incarnation = None;
            t.lease_until = 0;
        }
        let w = state.workflows.get_mut(id).unwrap();
        w.removed = true;
        w.status = "cancelled".into();
        w.collaboration.paused = false;
        w.revision += 1;
        w.updated_at = now;
        let root = w.root_task_id.clone();
        state.event(
            now,
            "workflow.removed",
            Some(&root),
            None,
            "collaboration removed; execution history and checkpoints retained",
        );
        reconcile(state, now);
        Ok(())
    })
}

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
            let blockers: Vec<_> = state
                .tasks
                .values()
                .filter(|other| {
                    !other.removed
                        && other.id != id
                        && (other.spec.dependencies.iter().any(|dep| dep == id)
                            || other.spec.parent_id.as_deref() == Some(id))
                })
                .map(|other| other.spec.title.clone())
                .collect();
            ensure!(
                blockers.is_empty(),
                format!(
                    "dependent tasks must be removed first: {}",
                    blockers.join(", ")
                )
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
