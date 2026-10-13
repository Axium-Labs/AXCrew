//! Workbench policy and execution inbox over the existing durable cluster aggregate.
use super::distributed::{configure, reconcile, submit_in_cluster, validate_lease};
use crate::{
    domain::{distributed::*, unix_now},
    storage::Db,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub tasks: Vec<PlannedTask>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlannedTask {
    pub spec: Submit,
    #[serde(default)]
    pub depends_on: Vec<usize>,
}
/// Atomic organization of existing durable Tasks. No second execution mechanism.
pub fn plan(db: &Db, body: Plan) -> Result<Vec<DistributedTask>> {
    ensure!(
        !body.tasks.is_empty() && body.tasks.len() <= 64,
        "a plan requires 1-64 tasks"
    );
    db.cluster_update(|state| {
        let mut created: Vec<DistributedTask> = vec![];
        let mut flow = None;
        let mut keys = std::collections::BTreeSet::new();
        for (index, entry) in body.tasks.into_iter().enumerate() {
            let mut spec = entry.spec;
            ensure!(
                keys.insert(spec.request_id.clone()),
                "duplicate plan task identity"
            );
            ensure!(
                entry.depends_on.iter().all(|d| *d < index),
                "dependencies must reference earlier plan tasks"
            );
            ensure!(spec.parent_id.is_none(), "plan tasks cannot set a parent");
            if index > 0 {
                ensure!(
                    spec.workflow_id.is_none() || spec.workflow_id == flow,
                    "plan workflow differs"
                );
                ensure!(
                    spec.collaboration.is_none(),
                    "only the first plan task defines collaboration policy"
                );
                spec.workflow_id = flow.clone();
            }
            for d in entry.depends_on {
                spec.dependencies.push(created[d].id.clone());
            }
            let t = submit_in_cluster(state, "admin", spec)?;
            flow = t.spec.workflow_id.clone();
            created.push(t);
        }
        reconcile(state, unix_now());
        Ok(created.iter().map(|t| state.tasks[&t.id].clone()).collect())
    })
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preview {
    pub project_id: String,
    pub requirements: Requirements,
    #[serde(default)]
    pub collaboration: Option<Collaboration>,
    #[serde(default)]
    pub workflow_id: Option<String>,
}
pub fn preview(db: &Db, body: Preview) -> Result<Vec<PlacementMatch>> {
    let state = db.cluster_read()?;
    let policy = if let Some(id) = body.workflow_id.as_ref() {
        let w = state
            .workflows
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("workflow missing"))?;
        ensure!(w.project_id == body.project_id, "project policy denied");
        Some(&w.collaboration)
    } else {
        body.collaboration.as_ref()
    };
    Ok(super::distributed::placement(
        &state,
        &body.project_id,
        &body.requirements,
        policy,
        unix_now(),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub objective: Option<String>,
    pub expected_revision: u64,
    pub kind: String,
    pub participants: std::collections::BTreeMap<String, String>,
    pub requirements: Capabilities,
    #[serde(default)]
    pub member_models: std::collections::BTreeMap<String, ExecutionModel>,
    #[serde(default)]
    pub excluded_instances: Vec<String>,
    #[serde(default)]
    pub new_tasks: Vec<Submit>,
}
pub fn settings(db: &Db, id: &str, body: Settings) -> Result<Workflow> {
    if let Some(title) = &body.title {
        ensure!(
            !title.trim().is_empty() && title.len() <= 512,
            "invalid collaboration title"
        );
    }
    if let Some(objective) = &body.objective {
        ensure!(objective.len() <= 256 * 1024, "objective too large");
    }
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
        ensure!(body.new_tasks.len() <= 64, "too many new work tasks");
        let project = w.project_id.clone();
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
        ensure!(body.member_models.keys().all(|id| body.participants.contains_key(id)), "model settings require a selected member");
        let removed: Vec<_> = w.collaboration.participants.keys().filter(|id| !body.participants.contains_key(*id)).cloned().collect();
        let mut excluded = body.excluded_instances;
        excluded.extend(removed.iter().cloned());
        excluded.retain(|id| !body.participants.contains_key(id));
        excluded.sort(); excluded.dedup();
        // Member removal is a fenced transfer in this Workflow only.
        for t in state.tasks.values_mut().filter(|t| t.spec.workflow_id.as_deref() == Some(id) && !t.terminal()) {
            if t.spec.requirements.instance_id.as_ref().is_some_and(|i| excluded.contains(i) || (!body.participants.is_empty() && !body.participants.contains_key(i))) {
                t.spec.requirements.instance_id = None;
            }
            if t.owner.as_ref().is_some_and(|i| excluded.contains(i) || (!body.participants.is_empty() && !body.participants.contains_key(i))) {
                if let Some(a) = t.attempts.last_mut() { a.ended_at = Some(unix_now()); a.error = Some("collaboration member removed".into()); }
                t.owner = None; t.incarnation = None; t.lease_until = 0;
                if t.status != "paused" { t.status = "pending".into(); }
                t.retry_allowance = t.retry_allowance.saturating_add(1);
            }
        }
        let w = state.workflows.get_mut(id).unwrap();
        if let Some(title) = body.title { w.title = title.trim().into(); }
        if let Some(objective) = body.objective { w.objective = Some(objective); }
        w.collaboration.kind = body.kind;
        w.collaboration.participants = body.participants;
        w.collaboration.requirements = body.requirements;
        w.collaboration.member_models = body.member_models;
        w.collaboration.excluded_instances = excluded;
        w.revision += 1;
        w.updated_at = unix_now();
        let root = w.root_task_id.clone();
        state.event(
            unix_now(),
            "workflow.configuration",
            Some(&root),
            None,
            "Goal-scoped policy updated; removed owners fenced; retained owners keep execution settings",
        );
        for mut spec in body.new_tasks {
            ensure!(spec.project_id == project && spec.parent_id.is_none() && spec.collaboration.is_none() && spec.workflow_id.as_deref().is_none_or(|flow| flow == id), "new member task scope differs");
            spec.workflow_id = Some(id.to_owned());
            submit_in_cluster(state, "admin", spec)?;
        }
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
            .filter(|t| !t.removed && t.spec.workflow_id.as_deref() == Some(id))
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
    #[serde(default)]
    pub model: Option<ExecutionModel>,
    #[serde(default)]
    pub duty: Option<String>,
    #[serde(default)]
    pub dependencies: Option<Vec<String>>,
    #[serde(default)]
    pub host_id: Option<String>,
    #[serde(default)]
    pub clear_host: bool,
    #[serde(default)]
    pub resources: Option<Resources>,
}
pub fn reassign(db: &Db, id: &str, body: Placement) -> Result<()> {
    db.cluster_update(|state| {
        let t = state.tasks.get(id).ok_or_else(|| anyhow::anyhow!("task missing"))?;
        ensure!(t.generation == body.generation && !t.terminal(), "execution changed or task is terminal");
        if let Some(dependencies) = &body.dependencies {
            ensure!(dependencies.len() <= 64, "too many dependencies");
            for dep in dependencies {
                let dependency = state.tasks.get(dep).ok_or_else(|| anyhow::anyhow!("dependency missing"))?;
                ensure!(!dependency.removed && dependency.spec.workflow_id == t.spec.workflow_id && dependency.spec.project_id == t.spec.project_id, "dependency collaboration differs");
                let mut visit = vec![dep.clone()];
                let mut seen = std::collections::BTreeSet::new();
                while let Some(next) = visit.pop() {
                    ensure!(next != id, "task dependency cycle");
                    if seen.insert(next.clone()) && let Some(task) = state.tasks.get(&next) { visit.extend(task.spec.dependencies.iter().cloned()); }
                }
            }
        }
        if let Some(instance) = &body.instance_id {
            let i = state.instances.get(instance).ok_or_else(|| anyhow::anyhow!("instance missing"))?;
            ensure!(i.projects.contains(&t.spec.project_id), "project policy denied");
            if let Some(w) = t.spec.workflow_id.as_ref().and_then(|id| state.workflows.get(id)) {
                ensure!((w.collaboration.participants.is_empty() || w.collaboration.participants.contains_key(instance)) && !w.collaboration.excluded_instances.contains(instance), "AX is outside Goal participants");
            }
        }
        let t = state.tasks.get_mut(id).unwrap();
        if t.status == "running" && let Some(a) = t.attempts.last_mut() { a.ended_at = Some(unix_now()); a.error = Some("reassigned by operator".into()); }
        t.spec.requirements.instance_id = body.instance_id;
        if body.clear_host { t.spec.requirements.host_id = None; }
        else if let Some(host) = body.host_id { t.spec.requirements.host_id = Some(host); }
        if let Some(mut resources) = body.resources { resources.cpu = resources.cpu.max(1); t.spec.requirements.resources = resources; }
        // Explicit null means inherit the new owner's model, not the previous owner's model.
        t.spec.requirements.model = body.model;
        if let Some(dependencies) = body.dependencies { t.spec.dependencies = dependencies; }
        if let Some(duty) = body.duty { ensure!(duty.len() <= 2048, "work duty too long"); t.spec.requirements.duty = duty; }
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
                .and_then(|a| a.sessions.last())
                .is_some_and(|s| s == &body.session_id),
            "Session is historical or does not belong to the active execution"
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
