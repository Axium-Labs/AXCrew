//! Workbench policy and execution inbox over the existing durable cluster aggregate.
use super::distributed::{configure, reconcile, validate_lease};
use crate::{
    domain::{distributed::*, unix_now},
    storage::Db,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub expected_revision: u64,
    pub kind: String,
    pub participants: std::collections::BTreeMap<String, String>,
    pub requirements: Capabilities,
}
pub fn settings(db: &Db, id: &str, body: Settings) -> Result<Workflow> {
    ensure!(
        ["goal", "task"].contains(&body.kind.as_str()),
        "invalid collaboration kind"
    );
    ensure!(
        serde_json::to_vec(&body.requirements)?.len() <= 16384,
        "requirements too large"
    );
    db.cluster_update(|state| {
        let w = state
            .workflows
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("workflow missing"))?;
        ensure!(
            w.revision == body.expected_revision,
            "workflow revision conflict; refresh before saving"
        );
        for (instance, role) in &body.participants {
            ensure!(role.len() <= 128, "role too long");
            ensure!(
                state
                    .instances
                    .get(instance)
                    .is_some_and(|i| i.projects.contains(&w.project_id)),
                "AX instance is not approved for this project"
            );
        }
        // Changing policy never revokes an in-flight lease or mutates AX global config.
        let w = state.workflows.get_mut(id).unwrap();
        w.collaboration.kind = body.kind;
        w.collaboration.participants = body.participants;
        w.collaboration.requirements = body.requirements;
        w.revision += 1;
        w.updated_at = unix_now();
        let root = w.root_task_id.clone();
        state.event(
            unix_now(),
            "workflow.configuration",
            Some(&root),
            None,
            "Goal-scoped placement policy updated; running execution settings retained",
        );
        reconcile(state, unix_now());
        Ok(state.workflows[id].clone())
    })
}
pub fn control(db: &Db, id: &str, action: &str) -> Result<()> {
    ensure!(
        ["pause", "resume", "cancel", "retry"].contains(&action),
        "invalid Goal control"
    );
    db.cluster_update(|state| {
        let w = state
            .workflows
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("workflow missing"))?;
        match action {
            "pause" => {
                ensure!(
                    w.status == "active" || w.status == "paused",
                    "only active Goals can pause"
                );
                w.collaboration.paused = true;
            }
            "resume" => {
                ensure!(w.collaboration.paused, "Goal is not paused");
                w.collaboration.paused = false;
            }
            "cancel" => {
                w.collaboration.paused = false;
            }
            _ => {
                ensure!(!w.collaboration.paused, "resume Goal before retrying");
            }
        }
        w.revision += 1;
        w.updated_at = unix_now();
        let root = w.root_task_id.clone();
        for t in state
            .tasks
            .values_mut()
            .filter(|t| t.spec.workflow_id.as_deref() == Some(id))
        {
            let change = match action {
                "pause" => !t.terminal(),
                "resume" => t.status == "paused",
                "cancel" => !t.terminal(),
                _ => t.status == "failed",
            };
            if !change {
                continue;
            }
            if t.status == "running"
                && let Some(a) = t.attempts.last_mut()
            {
                a.ended_at = Some(unix_now());
                a.error = Some(format!("operator {action}"));
            }
            t.status = match action {
                "pause" => "paused",
                "cancel" => "cancelled",
                _ => "pending",
            }
            .into();
            t.owner = None;
            t.incarnation = None;
            t.lease_until = 0;
            if action == "resume" || action == "retry" {
                t.retry_allowance = t.retry_allowance.saturating_add(3);
            }
        }
        state.event(
            unix_now(),
            &format!("workflow.{action}"),
            Some(&root),
            None,
            "operator control; runtime checkpoints and cumulative budgets retained",
        );
        reconcile(state, unix_now());
        Ok(())
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Placement {
    pub generation: u64,
    pub instance_id: Option<String>,
}
pub fn reassign(db: &Db, id: &str, body: Placement) -> Result<()> {
    db.cluster_update(|state| {
        let t = state.tasks.get(id).ok_or_else(|| anyhow::anyhow!("task missing"))?;
        ensure!(t.generation == body.generation && !t.terminal(), "execution changed or task is terminal");
        if let Some(instance) = &body.instance_id {
            let i = state.instances.get(instance).ok_or_else(|| anyhow::anyhow!("instance missing"))?;
            ensure!(i.projects.contains(&t.spec.project_id), "project policy denied");
            if let Some(w) = t.spec.workflow_id.as_ref().and_then(|id| state.workflows.get(id)) {
                ensure!(w.collaboration.participants.is_empty() || w.collaboration.participants.contains_key(instance), "AX is outside Goal participants");
            }
        }
        let t = state.tasks.get_mut(id).unwrap();
        if t.status == "running" && let Some(a) = t.attempts.last_mut() { a.ended_at = Some(unix_now()); a.error = Some("reassigned by operator".into()); }
        t.spec.requirements.instance_id = body.instance_id;
        if t.status != "paused" { t.status = "pending".into(); }
        t.owner = None; t.incarnation = None; t.lease_until = 0;
        t.retry_allowance = t.retry_allowance.saturating_add(1);
        state.event(unix_now(), "task.reassigned", Some(id), None, "previous execution fenced; placement will respect capabilities, shared Host capacity and checkpoint recovery");
        reconcile(state, unix_now());
        Ok(())
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandInput {
    pub generation: u64,
    pub session_id: String,
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub request_id: Option<String>,
}
pub fn command(db: &Db, task: &str, body: CommandInput) -> Result<ExecutionCommand> {
    ensure!(
        [
            "prompt",
            "answer",
            "permission",
            "project_read",
            "project_history",
            "project_import",
            "project_config",
            "rotate"
        ]
        .contains(&body.kind.as_str()),
        "invalid Session command"
    );
    ensure!(body.text.len() <= 65536, "Session input too large");
    ensure!(
        body.request_id
            .as_ref()
            .is_none_or(|id| !id.is_empty() && id.len() <= 128),
        "invalid permission request identity"
    );
    if body.kind == "prompt" {
        ensure!(!body.text.trim().is_empty(), "Session prompt is empty");
    }
    if body.kind == "answer" {
        let value: serde_json::Value = serde_json::from_str(&body.text)?;
        ensure!(
            value.is_object()
                && value["question_id"]
                    .as_str()
                    .is_some_and(|id| !id.is_empty())
                && (value["text"].as_str().is_some_and(|v| !v.trim().is_empty())
                    || value["option_id"].as_str().is_some_and(|v| !v.is_empty())),
            "answer requires a question identity and text or option"
        );
    }
    if body.kind == "permission" {
        ensure!(
            body.request_id.is_some()
                && ["allow_once", "reject_once"].contains(&body.text.as_str()),
            "only identified one-request permission decisions are supported"
        );
    }
    if body.kind == "project_config" {
        ensure!(
            serde_json::from_str::<serde_json::Value>(&body.text)?.is_object(),
            "project config must be JSON object"
        );
    }
    db.cluster_update(|state| {
        let t = state
            .tasks
            .get(task)
            .ok_or_else(|| anyhow::anyhow!("task missing"))?;
        ensure!(
            t.status == "running" && t.generation == body.generation && t.lease_until > unix_now(),
            "execution is no longer active"
        );
        ensure!(
            t.attempts
                .last()
                .is_some_and(|a| a.sessions.contains(&body.session_id)),
            "Session does not belong to this execution"
        );
        ensure!(
            state
                .commands
                .values()
                .filter(|c| c.task_id == task
                    && c.generation == t.generation
                    && c.status == "pending")
                .count()
                < 32,
            "Session inbox is full"
        );
        let c = ExecutionCommand {
            id: Uuid::new_v4().to_string(),
            task_id: task.into(),
            generation: body.generation,
            session_id: body.session_id,
            kind: body.kind,
            request_id: body.request_id,
            text: body.text,
            status: "pending".into(),
            result: None,
            created_at: unix_now(),
        };
        state.commands.insert(c.id.clone(), c.clone());
        state.event(
            unix_now(),
            "session.command",
            Some(task),
            t.owner.clone().as_deref(),
            &c.id,
        );
        Ok(c)
    })
}
pub fn inbox(db: &Db, worker: &str, source: &Report) -> Result<Vec<ExecutionCommand>> {
    let state = db.cluster_read()?;
    validate_lease(&state, worker, source)?;
    let mut commands: Vec<_> = state
        .commands
        .values()
        .filter(|c| {
            c.task_id == source.task_id
                && c.generation == source.generation
                && c.status == "pending"
        })
        .cloned()
        .collect();
    commands.sort_by_key(|c| (c.created_at, c.id.clone()));
    Ok(commands)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Acknowledge {
    pub source: Report,
    pub status: String,
    pub result: String,
}
pub fn acknowledge(db: &Db, worker: &str, id: &str, body: Acknowledge) -> Result<()> {
    ensure!(
        ["completed", "failed", "executing"].contains(&body.status.as_str())
            && body.result.len() <= 65536,
        "invalid command outcome"
    );
    db.cluster_update(|state| {
        validate_lease(state, worker, &body.source)?;
        let c = state
            .commands
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("command missing"))?;
        ensure!(
            c.task_id == body.source.task_id && c.generation == body.source.generation,
            "command execution differs"
        );
        ensure!(
            c.status == "pending" || c.status == "executing",
            "command already acknowledged"
        );
        c.status = body.status;
        c.result = Some(body.result);
        state.event(
            unix_now(),
            "session.command_result",
            Some(&body.source.task_id),
            Some(worker),
            id,
        );
        Ok(())
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub instance_ids: Vec<String>,
    pub capabilities: Option<Capabilities>,
    pub enabled: Option<bool>,
    pub confirm_instance_scope: bool,
}
#[derive(Serialize)]
pub struct BatchResult {
    pub instance_id: String,
    pub accepted: bool,
    pub error: Option<String>,
}
pub fn batch(db: &Db, body: Batch) -> Result<Vec<BatchResult>> {
    ensure!(
        body.confirm_instance_scope,
        "confirm AX Instance scope: this affects every Goal using the selected AX"
    );
    ensure!(
        !body.instance_ids.is_empty()
            && body.instance_ids.len() <= 128
            && (body.capabilities.is_some() ^ body.enabled.is_some()),
        "choose one batch operation and 1-128 AX instances"
    );
    let mut result = vec![];
    let ids: std::collections::BTreeSet<_> = body.instance_ids.into_iter().collect();
    for id in ids {
        let outcome = if let Some(caps) = &body.capabilities {
            configure(db, &id, caps.clone())
        } else {
            super::distributed::enable(db, "instances", &id, body.enabled.unwrap())
        };
        result.push(BatchResult {
            instance_id: id,
            accepted: outcome.is_ok(),
            error: outcome.err().map(|e| e.to_string()),
        });
    }
    Ok(result)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManageInput {
    pub action: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub input: serde_json::Value,
    pub confirm_instance_scope: bool,
}
pub fn manage(db: &Db, id: &str, body: ManageInput) -> Result<InstanceCommand> {
    ensure!(
        [
            "settings.read",
            "settings.write",
            "goal.read",
            "goal.write",
            "personalize.read",
            "personalize.write",
            "plugins.list",
            "plugins.enable",
            "plugins.disable",
            "plugins.import"
        ]
        .contains(&body.action.as_str()),
        "unsupported native setting action"
    );
    ensure!(
        ["global", "project"].contains(&body.scope.as_str()),
        "invalid native setting scope"
    );
    ensure!(
        body.action.ends_with("read")
            || body.action.ends_with("list")
            || body.confirm_instance_scope,
        "confirm instance-wide impact before native configuration writes"
    );
    ensure!(
        body.input.to_string().len() <= 65536,
        "native configuration too large"
    );
    db.cluster_update(|state| {
        let i = state
            .instances
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("instance missing"))?;
        ensure!(
            i.enabled && i.remote_management && i.last_seen > unix_now() - 30,
            "target AX has not enabled remote management or is offline"
        );
        if body.scope == "project" {
            ensure!(
                body.project_id
                    .as_ref()
                    .is_some_and(|p| i.projects.contains(p)),
                "unapproved project scope"
            );
        }
        ensure!(
            state
                .instance_commands
                .values()
                .filter(|c| c.instance_id == id
                    && ["pending", "executing"].contains(&c.status.as_str()))
                .count()
                < 16,
            "instance configuration inbox full"
        );
        let c = InstanceCommand {
            id: Uuid::new_v4().to_string(),
            instance_id: id.into(),
            incarnation: i.incarnation.clone(),
            action: body.action,
            scope: body.scope,
            project_id: body.project_id,
            input: body.input,
            status: "pending".into(),
            result: None,
        };
        state.instance_commands.insert(c.id.clone(), c.clone());
        state.event(unix_now(), "instance.management", None, Some(id), &c.id);
        Ok(c)
    })
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagePoll {
    pub incarnation: String,
    pub enabled: bool,
    #[serde(default)]
    pub completed: Vec<ManageResult>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManageResult {
    pub id: String,
    pub status: String,
    pub result: serde_json::Value,
}
pub fn management_poll(db: &Db, id: &str, body: ManagePoll) -> Result<Vec<InstanceCommand>> {
    db.cluster_update(|state| {
        let i = state.instances.get_mut(id).ok_or_else(|| anyhow::anyhow!("instance missing"))?;
        ensure!(i.enabled && i.incarnation == body.incarnation, "instance management incarnation fenced");
        i.remote_management = body.enabled;
        for result in body.completed {
            ensure!(["completed", "failed"].contains(&result.status.as_str()) && result.result.to_string().len() <= 65536, "invalid native result");
            let c = state.instance_commands.get_mut(&result.id).ok_or_else(|| anyhow::anyhow!("native command missing"))?;
            ensure!(c.instance_id == id && c.incarnation == body.incarnation, "native command owner differs");
            ensure!(["executing", "completed", "failed"].contains(&c.status.as_str()), "native command was not claimed");
            if c.status != "executing" { ensure!(c.status == result.status && c.result.as_ref() == Some(&result.result), "native outcome already recorded"); continue; }
            c.status = result.status; c.result = Some(result.result);
            state.event(unix_now(), "instance.management_result", None, Some(id), &result.id);
        }
        let mut pending = vec![];
        for c in state.instance_commands.values_mut().filter(|c| c.instance_id == id && ["pending", "executing"].contains(&c.status.as_str())) {
            if c.incarnation != body.incarnation || !body.enabled { c.status = "failed".into(); c.result = Some(serde_json::json!({"error":"AX restarted or remote management disabled; inspect local settings before retry"})); }
            else if c.status == "pending" {
                if !c.action.ends_with("read") && !c.action.ends_with("list") && state.tasks.values().any(|t| t.status == "running" && t.owner.as_deref() == Some(id)) {
                    c.status = "failed".into(); c.result = Some(serde_json::json!({"error":"AX has active executions; pause or finish tasks before changing instance settings"}));
                } else { c.status = "executing".into(); pending.push(c.clone()); }
            }
        }
        Ok(pending)
    })
}
