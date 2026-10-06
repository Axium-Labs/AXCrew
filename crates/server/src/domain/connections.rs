//! Host connections and named source workspaces. Private keys stay on disk.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnection {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub device_id: String,
    pub cwd: String,
    pub member_id: String,
}

#[derive(Deserialize)]
pub struct NewProject {
    pub name: String,
    pub device_id: String,
    pub cwd: String,
}
