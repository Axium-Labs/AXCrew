//! Collaboration metadata only; AX's sessions, memory and reasoning stay local.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Resources {
    pub cpu: u32,
    pub ram_mb: u64,
    pub gpu: u32,
}
impl Resources {
    pub fn fits(&self, used: &Self, need: &Self) -> bool {
        self.cpu.saturating_sub(used.cpu) >= need.cpu
            && self.ram_mb.saturating_sub(used.ram_mb) >= need.ram_mb
            && self.gpu.saturating_sub(used.gpu) >= need.gpu
    }
    pub fn add(&mut self, other: &Self) {
        self.cpu = self.cpu.saturating_add(other.cpu);
        self.ram_mb = self.ram_mb.saturating_add(other.ram_mb);
        self.gpu = self.gpu.saturating_add(other.gpu);
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Capabilities {
    pub roles: Vec<String>,
    pub skills: Vec<String>,
    pub mcp: Vec<String>,
    pub tools: Vec<String>,
    pub models: Vec<String>,
    pub permissions: Vec<String>,
    pub environments: Vec<String>,
}
impl Capabilities {
    pub fn satisfies(&self, required: &Self) -> bool {
        [
            (&self.roles, &required.roles),
            (&self.skills, &required.skills),
            (&self.mcp, &required.mcp),
            (&self.tools, &required.tools),
            (&self.models, &required.models),
            (&self.permissions, &required.permissions),
            (&self.environments, &required.environments),
        ]
        .iter()
        .all(|(actual, wanted)| wanted.iter().all(|item| actual.contains(item)))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Host {
    pub id: String,
    pub name: String,
    pub resources: Resources,
    pub last_seen: i64,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub host_id: String,
    pub name: String,
    pub capabilities: Capabilities,
    pub projects: Vec<String>,
    pub max_executions: u32,
    pub can_delegate: bool,
    pub enabled: bool,
    pub last_seen: i64,
    pub incarnation: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub credential_hash: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Requirements {
    pub capabilities: Capabilities,
    pub resources: Resources,
    pub instance_id: Option<String>,
}
fn default_attempts() -> u32 {
    3
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Submit {
    pub request_id: String,
    pub title: String,
    pub input: String,
    pub project_id: String,
    #[serde(default)]
    pub workspace_revision: Option<String>,
    #[serde(default)]
    pub workflow_id: Option<String>,
    #[serde(default)]
    pub context_summary: String,
    #[serde(default)]
    pub requirements: Requirements,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub artifacts: Vec<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub parent_generation: Option<u64>,
    #[serde(default = "default_attempts")]
    pub max_attempts: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attempt {
    pub generation: u64,
    pub instance_id: String,
    pub incarnation: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DistributedTask {
    pub id: String,
    pub creator: String,
    pub spec: Submit,
    pub status: String,
    pub owner: Option<String>,
    pub incarnation: Option<String>,
    pub generation: u64,
    pub lease_until: i64,
    pub result: Option<String>,
    pub failure: Option<String>,
    pub artifacts: Vec<String>,
    pub attempts: Vec<Attempt>,
    #[serde(default)]
    pub retry_allowance: u32,
    pub created_at: i64,
}
impl DistributedTask {
    pub fn terminal(&self) -> bool {
        matches!(self.status.as_str(), "completed" | "failed" | "cancelled")
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Artifact {
    pub id: String,
    pub task_id: String,
    pub generation: u64,
    pub project_id: String,
    pub kind: String,
    pub name: String,
    pub sha256: String,
    pub size: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClusterEvent {
    pub sequence: u64,
    pub timestamp: i64,
    pub kind: String,
    pub task_id: Option<String>,
    pub instance_id: Option<String>,
    pub detail: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Cluster {
    #[serde(default)]
    pub server_time: i64,
    pub revision: u64,
    pub hosts: BTreeMap<String, Host>,
    pub instances: BTreeMap<String, Instance>,
    pub tasks: BTreeMap<String, DistributedTask>,
    pub artifacts: BTreeMap<String, Artifact>,
    pub events: Vec<ClusterEvent>,
    #[serde(default)]
    pub workflows: BTreeMap<String, Workflow>,
    #[serde(default)]
    pub receipts: BTreeMap<String, Report>,
}
impl Cluster {
    pub fn event(
        &mut self,
        now: i64,
        kind: &str,
        task: Option<&str>,
        instance: Option<&str>,
        detail: &str,
    ) {
        self.revision += 1;
        self.events.push(ClusterEvent {
            sequence: self.revision,
            timestamp: now,
            kind: kind.into(),
            task_id: task.map(str::to_owned),
            instance_id: instance.map(str::to_owned),
            detail: detail.into(),
        });
    }
    pub fn public(&self) -> Self {
        let mut copy = self.clone();
        for instance in copy.instances.values_mut() {
            instance.credential_hash.clear();
        }
        copy.receipts.clear();
        copy
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Enrollment {
    pub host_id: String,
    pub host_name: String,
    pub resources: Resources,
    pub name: String,
    #[serde(default)]
    pub capabilities: Capabilities,
    pub projects: Vec<String>,
    pub max_executions: u32,
    #[serde(default)]
    pub can_delegate: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LeaseIdentity {
    pub task_id: String,
    pub generation: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Heartbeat {
    pub incarnation: String,
    #[serde(default)]
    pub active: Vec<LeaseIdentity>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Report {
    pub incarnation: String,
    pub task_id: String,
    pub generation: u64,
    pub message_id: String,
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub artifacts: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Assignment {
    pub task: DistributedTask,
    pub dependency_results: Vec<DistributedTask>,
    pub workflow: Option<Workflow>,
    pub workflow_tasks: Vec<DistributedTask>,
    pub observations: Vec<ClusterEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub root_task_id: String,
    pub status: String,
    pub revision: u64,
    /// Necessary planner checkpoints only, never full AX sessions or memory.
    pub state: serde_json::Value,
    pub updated_at: i64,
}

#[derive(Deserialize)]
pub struct Upload {
    pub incarnation: String,
    pub task_id: String,
    pub generation: u64,
    pub kind: String,
    pub name: String,
    pub content_base64: String,
}
