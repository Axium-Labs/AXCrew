//! Crews and their members. A member is one execution environment: a device
//! plus the workspace, provider, model, skills and permission profile it runs
//! with.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Crew {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub id: String,
    pub crew_id: String,
    pub name: String,
    pub role: String,
    pub device_id: String,
    pub cwd: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub skills: Value,
    pub mcp_servers: Value,
    pub permission_profile: String,
    pub max_concurrency: i64,
}

#[derive(Debug, Deserialize)]
pub struct NewCrew {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct NewMember {
    pub name: String,
    pub role: String,
    pub device_id: String,
    pub cwd: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    #[serde(default = "empty_array")]
    pub skills: Value,
    #[serde(default = "empty_array")]
    pub mcp_servers: Value,
    #[serde(default = "default_permission")]
    pub permission_profile: String,
    #[serde(default = "one")]
    pub max_concurrency: i64,
}

/// The crew id the gateway reuses for the execution environment it creates
/// implicitly when the desktop composer targets a local workspace.
pub const LOCAL_CREW_ID: &str = "ax-local";

fn empty_array() -> Value {
    json!([])
}
fn default_permission() -> String {
    "ask".into()
}
fn one() -> i64 {
    1
}
