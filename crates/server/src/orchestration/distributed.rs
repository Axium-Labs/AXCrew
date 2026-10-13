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
            remote_management: false,
            model_catalog: None,
            model_catalog_at: 0,
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
        let task = submit_in_cluster(state, creator, spec)?;
        reconcile(state, unix_now());
        Ok(state.tasks[&task.id].clone())
    })
}
pub(super) fn submit_in_cluster(
    state: &mut Cluster,
    creator: &str,
    mut spec: Submit,
) -> Result<DistributedTask> {
    ensure!(
        !spec.request_id.is_empty()
            && spec.request_id.len() <= 128
            && !spec.title.trim().is_empty()
            && !spec.input.trim().is_empty(),
        "request_id, title and input required"
    );
    ensure!(
        spec.input.len() + spec.context_summary.len() <= 256 * 1024
            && valid_identity(&spec.project_id)
            && (1..=20).contains(&spec.max_attempts),
        "invalid task input, project or retry budget"
    );
    validate_capabilities(&spec.requirements.capabilities)?;
    if let Some(model) = &spec.requirements.model {
        ensure!(
            !model.provider.is_empty()
                && !model.model.is_empty()
                && model.provider.len() <= 128
                && model.model.len() <= 512,
            "invalid execution model"
        );
    }
    ensure!(spec.requirements.duty.len() <= 2048, "work duty too long");
    ensure!(
        spec.requirements.resource_limits.is_none(),
        "system resource limits are not implemented; use scheduling minimums"
    );
    if spec.requirements.resources.cpu == 0 {
        spec.requirements.resources.cpu = 1;
    }
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
        ensure!(
            spec.collaboration.is_none(),
            "only admin can set Goal policy"
        );
    }
    if let Some(policy) = &spec.collaboration {
        ensure!(
            spec.workflow_id.is_none()
                && spec.parent_id.is_none()
                && !policy.paused
                && ["goal", "task"].contains(&policy.kind.as_str()),
            "invalid root Goal policy"
        );
        validate_capabilities(&policy.requirements)?;
        ensure!(
            policy
                .member_models
                .keys()
                .all(|id| policy.participants.contains_key(id)),
            "model settings require a selected member"
        );
        for (id, role) in &policy.participants {
            ensure!(
                role.len() <= 128
                    && state
                        .instances
                        .get(id)
                        .is_some_and(|i| i.projects.contains(&spec.project_id)),
                "invalid Goal participant or project policy"
            );
        }
    }
    if let Some(parent) = &spec.parent_id {
        let parent = state
            .tasks
            .get(parent)
            .ok_or_else(|| anyhow::anyhow!("parent missing"))?;
        ensure!(
            !parent.removed && parent.spec.project_id == spec.project_id,
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
            if old.submission_digest.is_empty() {
                serde_json::to_value(&original)? == serde_json::to_value(&incoming)?
            } else {
                hash(&serde_json::to_vec(&incoming)?) == old.submission_digest
            },
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
            !dep.removed && dep.spec.project_id == spec.project_id,
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
                objective: None,
                id: workflow_id.clone(),
                project_id: spec.project_id.clone(),
                title: spec.title.clone(),
                root_task_id: task_id.clone(),
                status: "active".into(),
                revision: 0,
                state: serde_json::json!({}),
                updated_at: unix_now(),
                collaboration: spec.collaboration.clone().unwrap_or_default(),
            },
        );
        spec.workflow_id = Some(workflow_id);
    }
    let mut identity = spec.clone();
    identity.parent_generation = None;
    let task = DistributedTask {
        removed: false,
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
        submission_digest: hash(&serde_json::to_vec(&identity)?),
        placement: vec![],
    };
    state.event(
        unix_now(),
        "task.created",
        Some(&task.id),
        None,
        &task.spec.title,
    );
    state.tasks.insert(task.id.clone(), task.clone());
    Ok(state.tasks[&task.id].clone())
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
pub(super) fn execution_model<'a>(
    need: &'a Requirements,
    policy: Option<&'a Collaboration>,
    i: &'a Instance,
) -> Option<&'a ExecutionModel> {
    need.model
        .as_ref()
        .or_else(|| policy.and_then(|p| p.member_models.get(&i.id)))
        .or_else(|| i.model_catalog.as_ref().and_then(|c| c.current.as_ref()))
}
#[derive(Default)]
struct PlacementLoad {
    hosts: BTreeMap<String, Resources>,
    instances: BTreeMap<String, usize>,
}
impl PlacementLoad {
    fn read(state: &Cluster) -> Self {
        let mut load = Self::default();
        for t in state.tasks.values().filter(|t| t.status == "running") {
            if let Some(i) = t.owner.as_ref().and_then(|id| state.instances.get(id)) {
                load.reserve(i, &t.spec.requirements.resources);
            }
        }
        load
    }
    fn reserve(&mut self, i: &Instance, need: &Resources) {
        self.hosts.entry(i.host_id.clone()).or_default().add(need);
        *self.instances.entry(i.id.clone()).or_default() += 1;
    }
}
/// The scheduler and preview share this predicate and the same running reservations.
pub fn placement(
    state: &Cluster,
    project: &str,
    need: &Requirements,
    policy: Option<&Collaboration>,
    now: i64,
) -> Vec<PlacementMatch> {
    placement_with_load(
        state,
        project,
        need,
        policy,
        now,
        &PlacementLoad::read(state),
    )
}
fn placement_with_load(
    state: &Cluster,
    project: &str,
    need: &Requirements,
    policy: Option<&Collaboration>,
    now: i64,
    load: &PlacementLoad,
) -> Vec<PlacementMatch> {
    state
        .instances
        .values()
        .map(|i| {
            let mut reasons = vec![];
            let mut reject = |ok: bool, message: &str| {
                if !ok {
                    reasons.push(message.to_owned());
                }
            };
            reject(
                i.enabled && !i.incarnation.is_empty() && i.last_seen > now - ONLINE_SECONDS,
                "AX offline or disabled",
            );
            reject(
                i.projects.iter().any(|p| p == project),
                "project not approved",
            );
            reject(
                need.instance_id.as_ref().is_none_or(|id| id == &i.id),
                "different AX requested",
            );
            reject(
                need.host_id.as_ref().is_none_or(|id| id == &i.host_id),
                "different Host requested",
            );
            reject(
                i.capabilities.satisfies(&need.capabilities),
                "task capabilities unavailable",
            );
            if let Some(catalog) = &i.model_catalog {
                reject(
                    i.model_catalog_at > now - 180 && catalog.error.is_none(),
                    "execution model unavailable or catalog stale",
                );
                reject(
                    execution_model(need, policy, i).is_some(),
                    "AX default model not configured",
                );
            }
            if let Some(p) = policy {
                reject(!p.paused, "collaboration paused");
                reject(
                    (p.participants.is_empty() || p.participants.contains_key(&i.id))
                        && !p.excluded_instances.contains(&i.id),
                    "outside collaboration members",
                );
                reject(
                    i.capabilities.satisfies(&p.requirements),
                    "collaboration capabilities unavailable",
                );
            }
            reject(
                need.resource_limits.is_none(),
                "system resource limits unsupported",
            );
            if let Some(selected) = need
                .model
                .as_ref()
                .or_else(|| policy.and_then(|p| p.member_models.get(&i.id)))
            {
                reject(
                    i.model_catalog_at > now - 180
                        && i.model_catalog.as_ref().is_some_and(|c| {
                            c.error.is_none()
                                && c.models.iter().any(|m| {
                                    m.provider == selected.provider && m.model == selected.model
                                })
                        }),
                    "execution model unavailable or catalog stale",
                );
            }
            reject(
                load.instances.get(&i.id).copied().unwrap_or(0) < i.max_executions as usize,
                "AX execution slots full",
            );
            reject(
                !state.instance_commands.values().any(|c| {
                    c.instance_id == i.id
                        && c.status == "executing"
                        && !c.action.ends_with("read")
                        && !c.action.ends_with("list")
                }),
                "instance configuration executing",
            );
            if let Some(host) = state.hosts.get(&i.host_id) {
                reject(
                    host.enabled && host.last_seen > now - ONLINE_SECONDS,
                    "Host offline or disabled",
                );
                let mut resources = need.resources.clone();
                resources.cpu = resources.cpu.max(1);
                reject(
                    host.resources.fits(
                        load.hosts.get(&host.id).unwrap_or(&Resources::default()),
                        &resources,
                    ),
                    "Host scheduling capacity insufficient or unknown",
                );
            } else {
                reject(false, "Host missing");
            }
            PlacementMatch {
                instance_id: i.id.clone(),
                reasons,
            }
        })
        .collect()
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
    let mut load = PlacementLoad::read(state);
    let mut ready: Vec<_> = state
        .tasks
        .values()
        .filter(|t| {
            t.status == "pending"
                && t.spec
                    .workflow_id
                    .as_ref()
                    .and_then(|id| state.workflows.get(id))
                    .is_none_or(|w| !w.collaboration.paused)
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
        let policy = task
            .spec
            .workflow_id
            .as_ref()
            .and_then(|id| state.workflows.get(id))
            .map(|w| &w.collaboration);
        let matches = placement_with_load(
            state,
            &task.spec.project_id,
            &task.spec.requirements,
            policy,
            now,
            &load,
        );
        let mut candidates: Vec<_> = matches
            .iter()
            .filter(|m| m.reasons.is_empty())
            .map(|m| {
                (
                    load.instances.get(&m.instance_id).copied().unwrap_or(0),
                    m.instance_id.clone(),
                )
            })
            .collect();
        state.tasks.get_mut(&id).unwrap().placement = matches;
        candidates.sort();
        if let Some((_, owner)) = candidates.first() {
            let instance = &state.instances[owner];
            let task = &state.tasks[&id];
            let policy = task
                .spec
                .workflow_id
                .as_ref()
                .and_then(|id| state.workflows.get(id))
                .map(|w| &w.collaboration);
            let model = execution_model(&task.spec.requirements, policy, instance).cloned();
            let duty = if task.spec.requirements.duty.is_empty() {
                policy
                    .and_then(|p| p.participants.get(owner))
                    .cloned()
                    .unwrap_or_default()
            } else {
                task.spec.requirements.duty.clone()
            };
            let task = state.tasks.get_mut(&id).unwrap();
            task.placement.clear();
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
                sessions: vec![],
                model,
                duty,
            });
            load.reserve(instance, &task.spec.requirements.resources);
            notices.push((
                id,
                "task.assigned",
                format!("{owner} generation {}", task.generation),
            ));
        }
    }
    let pending: Vec<_> = state
        .tasks
        .values()
        .filter(|t| t.status == "pending")
        .map(|t| {
            let policy = t
                .spec
                .workflow_id
                .as_ref()
                .and_then(|id| state.workflows.get(id))
                .map(|w| &w.collaboration);
            let mut matches = placement_with_load(
                state,
                &t.spec.project_id,
                &t.spec.requirements,
                policy,
                now,
                &load,
            );
            if t.spec
                .dependencies
                .iter()
                .any(|id| state.tasks.get(id).is_none_or(|d| d.status != "completed"))
            {
                for m in &mut matches {
                    m.reasons.push("dependencies unfinished".into());
                }
            }
            (t.id.clone(), matches)
        })
        .collect();
    for (id, matches) in pending {
        state.tasks.get_mut(&id).unwrap().placement = matches;
    }
    for (id, kind, detail) in notices {
        state.event(now, kind, Some(&id), None, &detail);
    }
    let mut workflow_events = vec![];
    for workflow in state.workflows.values_mut() {
        let tasks: Vec<_> = state
            .tasks
            .values()
            .filter(|t| !t.removed && t.spec.workflow_id.as_deref() == Some(&workflow.id))
            .collect();
        let status = if tasks.is_empty() {
            "cancelled"
        } else if workflow.collaboration.paused {
            "paused"
        } else if tasks.iter().any(|t| !t.terminal()) {
            "active"
        } else if tasks.iter().any(|t| t.status == "failed") {
            "blocked"
        } else if state
            .tasks
            .get(&workflow.root_task_id)
            .is_some_and(|t| !t.removed && t.status == "completed")
            || tasks.iter().all(|t| t.status == "completed")
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
    let mut expired_management = vec![];
    for command in state
        .instance_commands
        .values_mut()
        .filter(|c| ["pending", "executing"].contains(&c.status.as_str()))
    {
        if !state.instances.get(&command.instance_id).is_some_and(|i| {
            i.enabled
                && i.remote_management
                && i.incarnation == command.incarnation
                && i.last_seen > now - 30
        }) {
            command.status = "failed".into();
            command.result = Some(
                serde_json::json!({"error":"AX management ownership lost or offline; inspect local settings before retrying uncertain writes"}),
            );
            expired_management.push((command.instance_id.clone(), command.id.clone()));
        }
    }
    for (instance, id) in expired_management {
        state.event(
            now,
            "instance.management_result",
            None,
            Some(&instance),
            &id,
        );
    }
    for command in state
        .commands
        .values_mut()
        .filter(|c| c.status == "pending" || c.status == "executing")
    {
        if !state.tasks.get(&command.task_id).is_some_and(|t| {
            t.status == "running"
                && t.generation == command.generation
                && t.lease_until > now
                && (command.status == "executing"
                    || t.attempts
                        .last()
                        .and_then(|a| a.sessions.last())
                        .is_some_and(|s| s == &command.session_id))
        }) {
            command.status = "failed".into();
            command.result =
                Some("execution ended or ownership changed; command was not replayed".into());
        }
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
    if let Some(catalog) = &body.model_catalog {
        ensure!(
            serde_json::to_vec(catalog)?.len() <= 1024 * 1024 && catalog.models.len() <= 5000,
            "model catalog too large"
        );
        for model in &catalog.models {
            ensure!(
                !model.provider.is_empty()
                    && !model.model.is_empty()
                    && model.provider.len() <= 128
                    && model.model.len() <= 512,
                "invalid model selection"
            );
        }
    }
    db.cluster_update(|state| {
        let now = unix_now();
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
            if instance
                .pending_capabilities
                .as_ref()
                .is_some_and(|pending| {
                    let mut reported = caps.clone();
                    reported.models = pending.models.clone();
                    reported == *pending
                        && pending
                            .models
                            .iter()
                            .all(|model| caps.models.contains(model))
                })
            {
                instance.pending_capabilities = None;
            }
            instance.capabilities = caps;
        }
        if let Some(catalog) = body.model_catalog {
            instance.model_catalog = Some(catalog);
            instance.model_catalog_at = now;
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
        // Apply the current report before placement, but fence expired leases
        // before renewal. A capability refresh must not assign stale models.
        reconcile(state, now);
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
    // Model discovery can legitimately return hundreds of IDs. Preserve the
    // existing small policy bound for other tags, without dropping worker leases.
    let mut policy = caps.clone();
    policy.models.clear();
    ensure!(
        serde_json::to_vec(&policy)?.len() <= 16384
            && serde_json::to_vec(&caps.models)?.len() <= 512 * 1024
            && caps.models.len() <= 5000,
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
            instance.model_catalog_at = 0;
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
        ["completed", "failed", "observation", "session", "activity"].contains(&body.kind.as_str()),
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
        if body.kind == "session" {
            let value: serde_json::Value = serde_json::from_str(&body.text)?;
            let session = value["session_id"]
                .as_str()
                .filter(|s| valid_identity(s))
                .ok_or_else(|| anyhow::anyhow!("invalid AX Session identity"))?;
            if let Some(model) = value.get("model").filter(|m| !m.is_null()) {
                let actual: ExecutionModel = serde_json::from_value(model.clone())?;
                let attempt = task
                    .attempts
                    .last_mut()
                    .ok_or_else(|| anyhow::anyhow!("attempt missing"))?;
                ensure!(
                    attempt.model.as_ref().is_none_or(|m| m == &actual),
                    "AX execution model differs from assigned model"
                );
                attempt.model = Some(actual);
            }
            let sessions = &mut task
                .attempts
                .last_mut()
                .ok_or_else(|| anyhow::anyhow!("attempt missing"))?
                .sessions;
            if !sessions.iter().any(|s| s == session) {
                sessions.push(session.to_owned());
            }
        }
        if ["completed", "failed"].contains(&body.kind.as_str()) {
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
        ensure!(!task.removed, "removed task cannot be controlled");
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
            "pause" => {
                ensure!(!task.terminal(), "terminal task cannot pause");
                if task.status == "running" {
                    finish_attempt(task, unix_now(), Some("paused by operator"));
                }
                task.status = "paused".into();
                task.owner = None;
                task.incarnation = None;
                state.event(
                    unix_now(),
                    "task.paused",
                    Some(id),
                    None,
                    "operator paused placement and fenced execution; latest checkpoint retained",
                );
            }
            "resume" => {
                ensure!(task.status == "paused", "only paused tasks can resume");
                task.status = "pending".into();
                // Operator controls do not consume the failure retry allowance.
                task.retry_allowance = task.retry_allowance.saturating_add(1);
                state.event(
                    unix_now(),
                    "task.resumed",
                    Some(id),
                    None,
                    "explicit resume from retained checkpoint",
                );
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
pub fn remove_instance(db: &Db, id: &str) -> Result<()> {
    db.cluster_update(|state| {
        if state.removed_instances.contains_key(id) {
            return Ok(());
        }
        ensure!(state.instances.contains_key(id), "instance missing");
        ensure!(
            !state.tasks.values().any(|t| !t.terminal()
                && (t.owner.as_deref() == Some(id)
                    || t.spec.requirements.instance_id.as_deref() == Some(id))),
            "AX has unfinished assigned tasks; reassign or cancel them before deletion"
        );
        ensure!(
            !state.workflows.values().any(|w|
                !matches!(w.status.as_str(), "completed" | "cancelled")
                    && w.collaboration.participants.contains_key(id)),
            "AX is a selected member of an unfinished collaboration; remove it from participants first"
        );
        ensure!(
            !state.instance_commands.values().any(|c|
                c.instance_id == id && c.status == "executing"),
            "AX native management is executing; wait for its outcome before deletion"
        );
        let mut instance = state.instances.remove(id).expect("checked instance");
        instance.enabled = false;
        instance.remote_management = false;
        instance.credential_hash.clear();
        instance.incarnation.clear();
        for command in state.commands.values_mut().filter(|c| {
            matches!(c.status.as_str(), "pending" | "executing")
                && state.tasks.get(&c.task_id).is_some_and(|t| {
                    t.owner.as_deref() == Some(id)
                        || t.attempts.last().is_some_and(|a| a.instance_id == id)
                })
        }) {
            command.status = "failed".into();
            command.result = Some("AX instance deleted; execution command cannot be delivered".into());
        }
        for command in state.instance_commands.values_mut().filter(|c|
            c.instance_id == id && c.status == "pending")
        {
            command.status = "failed".into();
            command.result = Some(serde_json::json!({"error":"AX instance deleted before command execution"}));
        }
        let name = instance.name.clone();
        state.removed_instances.insert(id.to_owned(), instance);
        state.event(unix_now(), "instance.removed", None, Some(id), &name);
        Ok(())
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
