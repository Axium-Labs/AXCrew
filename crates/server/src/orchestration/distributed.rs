//! AXCrew alone assigns, renews, retries, cancels and fences distributed work.
use crate::{
    domain::{distributed::*, unix_now},
    storage::Db,
};
use anyhow::{Result, bail, ensure};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, time::Duration};
use uuid::Uuid;

pub const LEASE_SECONDS: i64 = 90;
pub const ONLINE_SECONDS: i64 = 30;

pub fn hash(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
pub fn authenticate(db: &Db, token: &str) -> Result<String> {
    let digest = hash(token.as_bytes());
    db.cluster_read()?
        .instances
        .values()
        .find(|i| i.enabled && i.credential_hash == digest)
        .map(|i| i.id.clone())
        .ok_or_else(|| anyhow::anyhow!("instance credential required"))
}
pub fn enroll(db: &Db, body: Enrollment) -> Result<(Instance, String)> {
    ensure!(
        !body.host_id.is_empty() && !body.name.is_empty() && !body.projects.is_empty(),
        "host, name and logical projects required"
    );
    ensure!((1..=128).contains(&body.max_executions), "invalid capacity");
    ensure!(
        body.projects.iter().all(|p| valid_identity(p)),
        "invalid project identity"
    );
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let mut instance = db.cluster_update(|state| {
        let host = state
            .hosts
            .entry(body.host_id.clone())
            .or_insert_with(|| Host {
                id: body.host_id.clone(),
                name: body.host_name.clone(),
                resources: body.resources.clone(),
                enabled: true,
                last_seen: 0,
                inventory: None,
                inventory_at: 0,
            });
        // A second instance does not duplicate or silently overwrite host capacity.
        ensure!(
            host.inventory.is_some()
                || body.resources == Resources::default()
                || host.resources == body.resources,
            "host resources differ; update the host explicitly"
        );
        let instance = Instance {
            id: Uuid::new_v4().to_string(),
            host_id: body.host_id,
            name: body.name,
            capabilities: body.capabilities,
            pending_capabilities: None,
            projects: body.projects,
            max_executions: body.max_executions,
            can_delegate: body.can_delegate,
            enabled: true,
            last_seen: 0,
            incarnation: String::new(),
            credential_hash: hash(token.as_bytes()),
        };
        state
            .instances
            .insert(instance.id.clone(), instance.clone());
        state.event(
            unix_now(),
            "instance.enrolled",
            None,
            Some(&instance.id),
            &instance.name,
        );
        Ok(instance)
    })?;
    instance.credential_hash.clear();
    Ok((instance, token))
}
fn valid_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}
pub fn submit(db: &Db, creator: &str, mut spec: Submit) -> Result<DistributedTask> {
    ensure!(
        !spec.request_id.is_empty()
            && spec.request_id.len() <= 128
            && !spec.title.trim().is_empty()
            && !spec.input.trim().is_empty(),
        "request_id, title and input required"
    );
    ensure!(
        spec.input.len() + spec.context_summary.len() <= 256 * 1024,
        "use artifacts for large context"
    );
    ensure!(
        valid_identity(&spec.project_id) && (1..=20).contains(&spec.max_attempts),
        "invalid project or retry budget"
    );
    if spec.requirements.resources.cpu == 0 {
        spec.requirements.resources.cpu = 1;
    }
    db.cluster_update(|state| {
        if creator != "admin" {
            let instance = state
                .instances
                .get(creator)
                .ok_or_else(|| anyhow::anyhow!("instance missing"))?;
            ensure!(
                instance.enabled
                    && instance.can_delegate
                    && instance.projects.contains(&spec.project_id),
                "delegation policy denied"
            );
        }
        if let Some(parent) = &spec.parent_id {
            let parent = state
                .tasks
                .get(parent)
                .ok_or_else(|| anyhow::anyhow!("parent missing"))?;
            ensure!(
                parent.spec.project_id == spec.project_id,
                "parent project differs"
            );
            if creator != "admin" {
                ensure!(
                    parent.status == "running"
                        && parent.owner.as_deref() == Some(creator)
                        && Some(parent.generation) == spec.parent_generation
                        && parent.lease_until > unix_now(),
                    "parent ownership expired"
                );
            }
            ensure!(
                spec.workflow_id.is_none() || spec.workflow_id == parent.spec.workflow_id,
                "parent workflow differs"
            );
            spec.workflow_id = parent.spec.workflow_id.clone();
        }
        if let Some(old) = state.tasks.values().find(|t| {
            t.spec.request_id == spec.request_id
                && if spec.parent_id.is_some() {
                    t.spec.parent_id == spec.parent_id
                } else {
                    t.creator == creator && t.spec.parent_id.is_none()
                }
        }) {
            let mut incoming = spec.clone();
            let mut original = old.spec.clone();
            // Generation fences mutation but is not the identity of a durable planned task.
            incoming.parent_generation = None;
            original.parent_generation = None;
            if incoming.workflow_id.is_none() {
                incoming.workflow_id = original.workflow_id.clone();
            }
            ensure!(
                serde_json::to_value(&original)? == serde_json::to_value(&incoming)?,
                "request_id reused with different task"
            );
            return Ok(old.clone());
        }
        if let Some(workflow_id) = &spec.workflow_id {
            let workflow = state
                .workflows
                .get(workflow_id)
                .ok_or_else(|| anyhow::anyhow!("workflow missing"))?;
            ensure!(
                workflow.project_id == spec.project_id && workflow.status != "cancelled",
                "workflow policy denied"
            );
        }
        // Only existing dependencies can be referenced, so submission cannot add a cycle.
        for dep in &spec.dependencies {
            let dep = state
                .tasks
                .get(dep)
                .ok_or_else(|| anyhow::anyhow!("dependency missing"))?;
            ensure!(
                dep.spec.project_id == spec.project_id,
                "dependency project differs"
            );
        }
        for id in &spec.artifacts {
            ensure_artifact_project(state, id, &spec.project_id)?;
        }
        let task_id = Uuid::new_v4().to_string();
        if spec.workflow_id.is_none() {
            let workflow_id = Uuid::new_v4().to_string();
            state.workflows.insert(
                workflow_id.clone(),
                Workflow {
                    id: workflow_id.clone(),
                    project_id: spec.project_id.clone(),
                    title: spec.title.clone(),
                    root_task_id: task_id.clone(),
                    status: "active".into(),
                    revision: 0,
                    state: serde_json::json!({}),
                    updated_at: unix_now(),
                },
            );
            spec.workflow_id = Some(workflow_id);
        }
        let task = DistributedTask {
            id: task_id,
            creator: creator.into(),
            spec,
            status: "pending".into(),
            owner: None,
            incarnation: None,
            generation: 0,
            lease_until: 0,
            result: None,
            failure: None,
            artifacts: vec![],
            attempts: vec![],
            retry_allowance: 0,
            created_at: unix_now(),
        };
        state.event(
            unix_now(),
            "task.created",
            Some(&task.id),
            None,
            &task.spec.title,
        );
        state.tasks.insert(task.id.clone(), task.clone());
        reconcile(state, unix_now());
        Ok(state.tasks[&task.id].clone())
    })
}
fn ensure_artifact_project(state: &Cluster, id: &str, project: &str) -> Result<()> {
    ensure!(
        state
            .artifacts
            .get(id)
            .is_some_and(|a| a.project_id == project),
        "artifact missing or project differs"
    );
    Ok(())
}
fn finish_attempt(task: &mut DistributedTask, now: i64, error: Option<&str>) {
    if let Some(attempt) = task.attempts.last_mut() {
        attempt.ended_at = Some(now);
        attempt.error = error.map(str::to_owned);
    }
    task.lease_until = 0;
}
fn lose(task: &mut DistributedTask, now: i64, reason: &str) {
    finish_attempt(task, now, Some(reason));
    task.failure = Some(reason.into());
    task.status = if task.attempts.len() < (task.spec.max_attempts + task.retry_allowance) as usize
    {
        "pending"
    } else {
        "failed"
    }
    .into();
    task.artifacts.clear();
    task.owner = None;
    task.incarnation = None;
}
pub fn reconcile(state: &mut Cluster, now: i64) {
    let mut notices = vec![];
    for task in state.tasks.values_mut().filter(|t| t.status == "running") {
        let live = task
            .owner
            .as_ref()
            .and_then(|id| state.instances.get(id))
            .is_some_and(|i| {
                i.enabled
                    && Some(&i.incarnation) == task.incarnation.as_ref()
                    && state.hosts.get(&i.host_id).is_some_and(|h| h.enabled)
            });
        if task.lease_until <= now || !live {
            lose(task, now, "execution lease lost");
            notices.push((
                task.id.clone(),
                "task.lease_lost",
                task.failure.clone().unwrap_or_default(),
            ));
        }
    }
    loop {
        let blocked: Vec<String> = state
            .tasks
            .values()
            .filter(|t| {
                t.status == "pending"
                    && t.spec.dependencies.iter().any(|id| {
                        state
                            .tasks
                            .get(id)
                            .is_some_and(|d| d.status == "failed" || d.status == "cancelled")
                    })
            })
            .map(|t| t.id.clone())
            .collect();
        if blocked.is_empty() {
            break;
        }
        for id in blocked {
            let task = state.tasks.get_mut(&id).unwrap();
            task.status = "failed".into();
            task.failure = Some("dependency failed or cancelled".into());
            notices.push((
                id,
                "task.dependency_failed",
                "dependency failed or cancelled".into(),
            ));
        }
    }
    let mut host_used: BTreeMap<String, Resources> = BTreeMap::new();
    let mut instance_used: BTreeMap<String, u32> = BTreeMap::new();
    for task in state.tasks.values().filter(|t| t.status == "running") {
        if let Some(owner) = task.owner.as_ref().and_then(|id| state.instances.get(id)) {
            host_used
                .entry(owner.host_id.clone())
                .or_default()
                .add(&task.spec.requirements.resources);
            *instance_used.entry(owner.id.clone()).or_default() += 1;
        }
    }
    let mut ready: Vec<_> = state
        .tasks
        .values()
        .filter(|t| {
            t.status == "pending"
                && t.spec
                    .dependencies
                    .iter()
                    .all(|id| state.tasks.get(id).is_some_and(|d| d.status == "completed"))
        })
        .map(|t| (t.created_at, t.id.clone()))
        .collect();
    ready.sort();
    for (_, id) in ready {
        let task = &state.tasks[&id];
        let mut candidates: Vec<_> = state
            .instances
            .values()
            .filter(|i| {
                i.enabled
                    && !i.incarnation.is_empty()
                    && i.last_seen > now - ONLINE_SECONDS
                    && i.projects.contains(&task.spec.project_id)
                    && task
                        .spec
                        .requirements
                        .instance_id
                        .as_ref()
                        .is_none_or(|wanted| wanted == &i.id)
                    && i.capabilities
                        .satisfies(&task.spec.requirements.capabilities)
                    && instance_used.get(&i.id).copied().unwrap_or(0) < i.max_executions
                    && state.hosts.get(&i.host_id).is_some_and(|host| {
                        host.enabled
                            && host.last_seen > now - ONLINE_SECONDS
                            && host.resources.fits(
                                host_used.get(&host.id).unwrap_or(&Resources::default()),
                                &task.spec.requirements.resources,
                            )
                    })
            })
            .map(|i| (instance_used.get(&i.id).copied().unwrap_or(0), i.id.clone()))
            .collect();
        candidates.sort();
        if let Some((_, owner)) = candidates.first() {
            let instance = &state.instances[owner];
            let task = state.tasks.get_mut(&id).unwrap();
            task.generation += 1;
            task.status = "running".into();
            task.failure = None;
            task.owner = Some(owner.clone());
            task.incarnation = Some(instance.incarnation.clone());
            task.lease_until = now + LEASE_SECONDS;
            task.attempts.push(Attempt {
                generation: task.generation,
                instance_id: owner.clone(),
                incarnation: instance.incarnation.clone(),
                started_at: now,
                ended_at: None,
                error: None,
            });
            host_used
                .entry(instance.host_id.clone())
                .or_default()
                .add(&task.spec.requirements.resources);
            *instance_used.entry(owner.clone()).or_default() += 1;
            notices.push((
                id,
                "task.assigned",
                format!("{owner} generation {}", task.generation),
            ));
        }
    }
    for (id, kind, detail) in notices {
        state.event(now, kind, Some(&id), None, &detail);
    }
    let mut workflow_events = vec![];
    for workflow in state.workflows.values_mut() {
        let tasks: Vec<_> = state
            .tasks
            .values()
            .filter(|t| t.spec.workflow_id.as_deref() == Some(&workflow.id))
            .collect();
        let status = if tasks.iter().any(|t| !t.terminal()) {
            "active"
        } else if state
            .tasks
            .get(&workflow.root_task_id)
            .is_some_and(|t| t.status == "completed")
        {
            "completed"
        } else if tasks.iter().any(|t| t.status == "cancelled") {
            "cancelled"
        } else {
            "blocked"
        };
        if workflow.status != status {
            workflow.status = status.into();
            workflow.revision += 1;
            workflow.updated_at = now;
            workflow_events.push((
                workflow.root_task_id.clone(),
                format!("{} {status}", workflow.id),
            ));
        }
    }
    for (task, detail) in workflow_events {
        state.event(now, "workflow.status", Some(&task), None, &detail);
    }
}
pub fn heartbeat(db: &Db, id: &str, body: Heartbeat) -> Result<Vec<Assignment>> {
    ensure!(valid_identity(&body.incarnation), "invalid incarnation");
    if let Some(info) = &body.host_inventory {
        ensure!(
            info.cpu > 0 && info.cpu <= 65536,
            "invalid detected CPU count"
        );
        ensure!(
            serde_json::to_vec(info)?.len() <= 16384,
            "host inventory too large"
        );
        ensure!(
            info.gpu.is_none_or(|count| count <= 4096),
            "invalid GPU count"
        );
    }
    if let Some(caps) = &body.capabilities {
        validate_capabilities(caps)?;
    }
    db.cluster_update(|state| {
        let now = unix_now();
        // Expired leases are never revived by a delayed heartbeat.
        reconcile(state, now);
        let instance = state
            .instances
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("instance missing"))?;
        ensure!(instance.enabled, "instance disabled");
        if !instance.incarnation.is_empty() && instance.incarnation != body.incarnation {
            bail!("incarnation differs; restart endpoint required");
        }
        instance.incarnation = body.incarnation.clone();
        instance.last_seen = now;
        let host_id = instance.host_id.clone();
        let changed = body
            .capabilities
            .as_ref()
            .is_some_and(|caps| *caps != instance.capabilities);
        if let Some(caps) = body.capabilities {
            if instance.pending_capabilities.as_ref() == Some(&caps) {
                instance.pending_capabilities = None;
            }
            instance.capabilities = caps;
        }
        let host = state.hosts.get_mut(&host_id).unwrap();
        host.last_seen = now;
        let inventory_changed = body
            .host_inventory
            .as_ref()
            .is_some_and(|info| host.inventory.as_ref() != Some(info));
        if let Some(info) = body.host_inventory {
            // Capacity is shared by every instance on this Host, never summed.
            host.resources = Resources {
                cpu: info.cpu,
                ram_mb: info.ram_mb.unwrap_or(0),
                gpu: info.gpu.unwrap_or(0),
            };
            host.inventory = Some(info);
            host.inventory_at = now;
        }
        if inventory_changed {
            state.event(now, "host.inventory", None, Some(id), &host_id);
        }
        if changed {
            state.event(
                now,
                "instance.capabilities",
                None,
                Some(id),
                "worker reported active capabilities",
            );
        }
        for active in &body.active {
            if let Some(task) = state.tasks.get_mut(&active.task_id)
                && task.status == "running"
                && task.owner.as_deref() == Some(id)
                && task.incarnation.as_deref() == Some(&body.incarnation)
                && task.generation == active.generation
                && task.lease_until > now
            {
                task.lease_until = now + LEASE_SECONDS;
            }
        }
        reconcile(state, now);
        Ok(state
            .tasks
            .values()
            .filter(|t| {
                t.status == "running"
                    && t.owner.as_deref() == Some(id)
                    && t.incarnation.as_deref() == Some(&body.incarnation)
            })
            .map(|t| Assignment {
                task: t.clone(),
                dependency_results: t
                    .spec
                    .dependencies
                    .iter()
                    .filter_map(|d| state.tasks.get(d).cloned())
                    .collect(),
                workflow: t
                    .spec
                    .workflow_id
                    .as_ref()
                    .and_then(|id| state.workflows.get(id))
                    .cloned(),
                workflow_tasks: state
                    .tasks
                    .values()
                    .filter(|other| other.spec.workflow_id == t.spec.workflow_id)
                    .cloned()
                    .collect(),
                observations: state
                    .events
                    .iter()
                    .filter(|e| {
                        e.kind == "task.observation"
                            && e.task_id
                                .as_ref()
                                .and_then(|id| state.tasks.get(id))
                                .is_some_and(|other| other.spec.workflow_id == t.spec.workflow_id)
                    })
                    .cloned()
                    .collect(),
            })
            .collect())
    })
}
fn validate_capabilities(caps: &Capabilities) -> Result<()> {
    ensure!(
        serde_json::to_vec(caps)?.len() <= 16384,
        "capabilities too large"
    );
    Ok(())
}
/// Stage desired metadata; only the worker's report promotes it to scheduling capability.
pub fn configure(db: &Db, id: &str, caps: Capabilities) -> Result<()> {
    validate_capabilities(&caps)?;
    db.cluster_update(|state| {
        let instance = state
            .instances
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("instance missing"))?;
        ensure!(
            instance.last_seen > 0,
            "connect the instance before configuring capabilities"
        );
        instance.pending_capabilities = Some(caps);
        state.event(
            unix_now(),
            "instance.configuration",
            None,
            Some(id),
            "awaiting local worker configuration and report",
        );
        Ok(())
    })
}
pub fn restart(db: &Db, id: &str, incarnation: &str) -> Result<()> {
    ensure!(valid_identity(incarnation), "invalid incarnation");
    db.cluster_update(|state| {
        let instance = state
            .instances
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("instance missing"))?;
        ensure!(instance.enabled, "instance disabled");
        // A duplicate start is idempotent. Normal heartbeats cannot change epochs.
        if instance.incarnation != incarnation {
            instance.incarnation = incarnation.into();
            instance.last_seen = 0;
            reconcile(state, unix_now());
            state.event(
                unix_now(),
                "instance.restarted",
                None,
                Some(id),
                incarnation,
            );
        }
        Ok(())
    })
}
pub fn validate_lease(state: &Cluster, id: &str, body: &Report) -> Result<()> {
    let task = state
        .tasks
        .get(&body.task_id)
        .ok_or_else(|| anyhow::anyhow!("task missing"))?;
    ensure!(
        task.status == "running"
            && task.owner.as_deref() == Some(id)
            && task.incarnation.as_deref() == Some(&body.incarnation)
            && task.generation == body.generation
            && task.lease_until > unix_now(),
        "stale execution fenced"
    );
    Ok(())
}
pub fn report(db: &Db, id: &str, body: Report) -> Result<()> {
    ensure!(
        body.text.len() <= 256 * 1024 && !body.message_id.is_empty(),
        "report too large or missing message_id"
    );
    ensure!(
        ["completed", "failed", "observation"].contains(&body.kind.as_str()),
        "invalid report kind"
    );
    db.cluster_update(|state| {
        let key = format!("{id}:{}", body.message_id);
        if let Some(receipt) = state.receipts.get(&key) {
            ensure!(
                serde_json::to_value(receipt)? == serde_json::to_value(&body)?,
                "message_id reused with different report"
            );
            return Ok(());
        }
        validate_lease(state, id, &body)?;
        let project = state.tasks[&body.task_id].spec.project_id.clone();
        for artifact in &body.artifacts {
            ensure_artifact_project(state, artifact, &project)?;
        }
        let task = state.tasks.get_mut(&body.task_id).unwrap();
        if body.kind != "observation" {
            task.status = body.kind.clone();
            for artifact in &body.artifacts {
                if !task.artifacts.contains(artifact) {
                    task.artifacts.push(artifact.clone());
                }
            }
            if body.kind == "completed" {
                task.result = Some(body.text.clone());
                finish_attempt(task, unix_now(), None);
            } else {
                task.failure = Some(body.text.clone());
                finish_attempt(task, unix_now(), Some(&body.text));
            }
        }
        state.event(
            unix_now(),
            &format!("task.{}", body.kind),
            Some(&body.task_id),
            Some(id),
            &body.text,
        );
        state.receipts.insert(key, body);
        reconcile(state, unix_now());
        Ok(())
    })
}
pub fn control(db: &Db, creator: &str, id: &str, action: &str) -> Result<()> {
    db.cluster_update(|state| {
        let source = state
            .tasks
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("task missing"))?;
        let inherited = source
            .spec
            .parent_id
            .as_ref()
            .and_then(|parent| state.tasks.get(parent))
            .is_some_and(|t| {
                t.status == "running"
                    && t.owner.as_deref() == Some(creator)
                    && t.lease_until > unix_now()
            });
        let task = state
            .tasks
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("task missing"))?;
        ensure!(
            creator == "admin" || task.creator == creator || inherited,
            "task control denied"
        );
        match action {
            "cancel" => {
                let mut ids = vec![id.to_owned()];
                let mut n = 0;
                while n < ids.len() {
                    let children: Vec<_> = state
                        .tasks
                        .values()
                        .filter(|t| t.spec.parent_id.as_deref() == Some(&ids[n]))
                        .map(|t| t.id.clone())
                        .collect();
                    ids.extend(children);
                    n += 1;
                }
                for id in ids {
                    let task = state.tasks.get_mut(&id).unwrap();
                    if !task.terminal() {
                        finish_attempt(task, unix_now(), Some("cancelled"));
                        task.status = "cancelled".into();
                        state.event(
                            unix_now(),
                            "task.cancelled",
                            Some(&id),
                            None,
                            "cancelled by creator",
                        );
                    }
                }
            }
            "retry" => {
                ensure!(task.status == "failed", "only failed tasks can retry");
                task.status = "pending".into();
                task.owner = None;
                task.incarnation = None;
                task.retry_allowance = task.attempts.len() as u32 + 3
                    - task.spec.max_attempts.min(task.attempts.len() as u32 + 3);
                task.failure = None;
                task.artifacts.clear();
                state.event(unix_now(), "task.retried", Some(id), None, "explicit retry");
            }
            _ => bail!("invalid control action"),
        }
        reconcile(state, unix_now());
        Ok(())
    })
}

pub fn checkpoint(
    db: &Db,
    actor: &str,
    workflow_id: &str,
    expected_revision: u64,
    value: serde_json::Value,
    source: Option<Report>,
) -> Result<Workflow> {
    ensure!(
        value.is_object() && value.to_string().len() <= 256 * 1024,
        "workflow state must be a bounded metadata object"
    );
    db.cluster_update(|state| {
        if actor != "admin" {
            let source =
                source.ok_or_else(|| anyhow::anyhow!("checkpoint source execution required"))?;
            validate_lease(state, actor, &source)?;
            ensure!(
                state.tasks[&source.task_id].spec.workflow_id.as_deref() == Some(workflow_id),
                "checkpoint workflow differs"
            );
        }
        let workflow = state
            .workflows
            .get_mut(workflow_id)
            .ok_or_else(|| anyhow::anyhow!("workflow missing"))?;
        ensure!(
            workflow.revision == expected_revision,
            "workflow revision conflict; read latest state before replanning"
        );
        workflow.state = value;
        workflow.revision += 1;
        workflow.updated_at = unix_now();
        let result = workflow.clone();
        state.event(
            unix_now(),
            "workflow.checkpoint",
            Some(&result.root_task_id),
            None,
            &format!("{} revision {}", result.id, result.revision),
        );
        Ok(result)
    })
}
pub fn enable(db: &Db, kind: &str, id: &str, enabled: bool) -> Result<()> {
    db.cluster_update(|state| {
        match kind {
            "hosts" => {
                state
                    .hosts
                    .get_mut(id)
                    .ok_or_else(|| anyhow::anyhow!("host missing"))?
                    .enabled = enabled
            }
            "instances" => {
                state
                    .instances
                    .get_mut(id)
                    .ok_or_else(|| anyhow::anyhow!("instance missing"))?
                    .enabled = enabled
            }
            _ => bail!("unknown cluster object"),
        }
        reconcile(state, unix_now());
        state.event(
            unix_now(),
            "policy.updated",
            None,
            Some(id),
            if enabled { "enabled" } else { "disabled" },
        );
        Ok(())
    })
}
pub async fn run(db: Db) {
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    loop {
        tick.tick().await;
        if let Err(error) = db.cluster_update(|state| {
            reconcile(state, unix_now());
            Ok(())
        }) {
            eprintln!("distributed reconciliation: {error}");
        }
    }
}

pub fn resources(db: &Db, id: &str, body: Resources) -> Result<()> {
    ensure!(body.cpu > 0, "invalid host resources");
    db.cluster_update(|state| {
        state
            .hosts
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("host missing"))?
            .resources = body;
        state.event(crate::domain::unix_now(), "host.resources", None, None, id);
        reconcile(state, crate::domain::unix_now());
        Ok(())
    })?;
    Ok(())
}

pub fn upload(db: &Db, id: &str, body: Upload, bytes: &[u8]) -> Result<Artifact> {
    let source = Report {
        incarnation: body.incarnation.clone(),
        task_id: body.task_id.clone(),
        generation: body.generation,
        message_id: String::new(),
        kind: String::new(),
        text: String::new(),
        artifacts: vec![],
    };
    validate_lease(&db.cluster_read()?, id, &source)?;
    let digest = hash(bytes);
    // Content is immutable and addressed by digest; an interrupted upload can leave an unreferenced blob.
    db.cluster_blob_put(&digest, bytes)?;
    db.cluster_update(|state| {
        validate_lease(state, id, &source)?;
        let artifact_id = hash(
            format!(
                "{}:{}:{}:{}:{}",
                body.task_id, body.generation, digest, body.kind, body.name
            )
            .as_bytes(),
        );
        if let Some(old) = state.artifacts.get(&artifact_id) {
            return Ok(old.clone());
        }
        let artifact = Artifact {
            id: artifact_id,
            task_id: body.task_id.clone(),
            generation: body.generation,
            project_id: state.tasks[&body.task_id].spec.project_id.clone(),
            kind: body.kind,
            name: body.name,
            sha256: digest,
            size: bytes.len(),
        };
        state
            .artifacts
            .insert(artifact.id.clone(), artifact.clone());
        state
            .tasks
            .get_mut(&body.task_id)
            .unwrap()
            .artifacts
            .push(artifact.id.clone());
        state.event(
            crate::domain::unix_now(),
            "artifact.created",
            Some(&body.task_id),
            Some(id),
            &artifact.id,
        );
        Ok(artifact)
    })
}
