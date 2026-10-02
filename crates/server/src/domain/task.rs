//! Tasks: the unit of scheduled work, its dependency edges and its run records.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub crew_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub description: String,
    pub assigned_member: String,
    pub assigned_device: String,
    pub dependencies: Vec<String>,
    pub priority: i64,
    pub status: String,
    pub input: Value,
    pub output: Option<Value>,
    pub retry_count: i64,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct NewTask {
    pub crew_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub assigned_member: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub priority: i64,
    pub input: Value,
}

#[derive(Debug, Deserialize)]
pub struct TaskEdit {
    pub title: String,
    pub description: String,
    pub assigned_member: String,
    pub parent_id: Option<String>,
    pub dependencies: Vec<String>,
    pub priority: i64,
    pub input: Value,
}

/// Column order of the `tasks` projection shared by the row mapper.
pub type TaskRow = (
    String,
    String,
    Option<String>,
    String,
    String,
    String,
    String,
    i64,
    String,
    String,
    Option<String>,
    i64,
    i64,
    Option<i64>,
    Option<i64>,
);
