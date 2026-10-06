//! Validates connections and resolves workspaces on the host that owns them.
use crate::{
    app::App,
    domain::connections::{NewProject, Project, SshConnection},
};
use anyhow::{Result, bail};
use serde_json::{Value, json};

pub fn validate_ssh(config: &SshConnection) -> Result<()> {
    let host = config.host.trim();
    if config.name.trim().is_empty()
        || host.is_empty()
        || host.starts_with('-')
        || !host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-@:[ ]".contains(&c) && c != b' ')
        || host
            .split('@')
            .any(|part| part.is_empty() || part.starts_with('-'))
        || host.matches('@').count() > 1
    {
        bail!("valid SSH name and host (host or user@host) required");
    }
    if config.port == Some(0) {
        bail!("SSH port must be between 1 and 65535");
    }
    if config
        .identity_file
        .as_deref()
        .is_some_and(|p| p.contains(['\n', '\r', '\0']))
    {
        bail!("invalid identity file path");
    }
    Ok(())
}

/// OpenSSH resolves aliases and their options itself, including Include/Match.
/// Discovery only lists concrete Host aliases in the primary user config.
pub fn discover_ssh() -> Vec<SshConnection> {
    let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) else {
        return vec![];
    };
    let raw = std::fs::read_to_string(std::path::PathBuf::from(home).join(".ssh/config"))
        .unwrap_or_default();
    let mut result = Vec::new();
    for line in raw.lines() {
        let mut parts = line.split('#').next().unwrap_or("").split_whitespace();
        if parts
            .next()
            .is_some_and(|key| key.eq_ignore_ascii_case("host"))
        {
            for alias in parts {
                let config = SshConnection {
                    id: String::new(),
                    name: alias.into(),
                    host: alias.into(),
                    port: None,
                    identity_file: None,
                };
                if validate_ssh(&config).is_ok()
                    && !result.iter().any(|c: &SshConnection| c.host == alias)
                {
                    result.push(config);
                }
            }
        }
    }
    result
}

pub async fn workspace(app: &App, device: &str, cwd: Option<&str>) -> Result<Value> {
    let info = app
        .db
        .device(device)?
        .ok_or_else(|| anyhow::anyhow!("device not found"))?;
    // Paired AX only allows already registered roots. Discovery must not launch
    // a bridge in an arbitrary gateway-local path, or weaken that host policy.
    if device != "local" && !device.starts_with("ssh:") {
        if !matches!(info.status.as_str(), "online" | "busy") {
            bail!("remote device offline");
        }
        let mut roots = info.capabilities["workspaces"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if roots.is_empty() {
            for crew in app.db.crews()? {
                for member in app.db.members(&crew.id)? {
                    if member.device_id == device && !roots.iter().any(|r| r["path"] == member.cwd)
                    {
                        roots.push(json!({"name":member.name,"path":member.cwd}));
                    }
                }
            }
        }
        if let Some(cwd) = cwd.filter(|p| !p.is_empty()) {
            let same = |a: &str, b: &str| {
                if info.platform == "windows" {
                    a.trim_start_matches("\\\\?\\")
                        .replace('\\', "/")
                        .eq_ignore_ascii_case(&b.trim_start_matches("\\\\?\\").replace('\\', "/"))
                } else {
                    a == b
                }
            };
            let root=roots.iter().find_map(|r|r["path"].as_str().filter(|p|same(p,cwd))).ok_or_else(||anyhow::anyhow!("folder is not a registered AX workspace; open it with AX on the remote device first"))?;
            let mut result = app
                .router
                .inspect(
                    device,
                    root,
                    None,
                    None,
                    "_ax/workspace",
                    json!({"cwd":root}),
                )
                .await?
                .result;
            result["parent"] = Value::Null;
            result["directories"] = json!([]);
            return Ok(result);
        }
        return Ok(
            json!({"cwd":"","parent":null,"directories":roots,"hint":"registered_workspaces"}),
        );
    }
    let launch = if device == "local" {
        app.db
            .default_session_member()?
            .map(|m| m.cwd)
            .unwrap_or_else(|| ".".into())
    } else {
        ".".into()
    };
    Ok(app
        .router
        .inspect(
            device,
            &launch,
            None,
            None,
            "_ax/workspace",
            json!({"cwd":cwd}),
        )
        .await?
        .result)
}

pub async fn connect(app: &App, id: &str) -> Result<Value> {
    if app.db.ssh_connection(id)?.is_none() {
        bail!("SSH connection not found");
    }
    let result = workspace(app, id, None).await;
    app.db
        .set_device_status(id, if result.is_ok() { "online" } else { "offline" })?;
    result
}

pub async fn create_project(app: &App, body: NewProject) -> Result<Project> {
    if body.name.trim().is_empty() || body.cwd.trim().is_empty() {
        bail!("project name and source folder required");
    }
    let verified = workspace(app, &body.device_id, Some(&body.cwd)).await?;
    let cwd = verified["cwd"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("AX did not return workspace"))?;
    let member = if body.device_id == "local" {
        app.db.ensure_local_session_member(cwd, None, None)?
    } else {
        app.db.ensure_remote_session_member(&body.device_id, cwd)?
    };
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name: body.name.trim().into(),
        device_id: body.device_id,
        cwd: cwd.into(),
        member_id: member.id,
    };
    app.db.save_project(&project)?;
    Ok(project)
}

/// A model choice creates/reuses another immutable environment; bound sessions
/// keep the member they started with.
pub fn select_model(
    app: &App,
    id: &str,
    provider: &str,
    model: &str,
) -> Result<crate::domain::crew::Member> {
    if provider.trim().is_empty() || model.trim().is_empty() {
        bail!("provider and model required");
    }
    let member = app
        .db
        .member(id)?
        .ok_or_else(|| anyhow::anyhow!("execution environment not found"))?;
    if let Some(existing) = app.db.members(&member.crew_id)?.into_iter().find(|m| {
        m.device_id == member.device_id
            && m.cwd == member.cwd
            && m.provider.as_deref() == Some(provider)
            && m.model.as_deref() == Some(model)
            && m.skills == member.skills
            && m.mcp_servers == member.mcp_servers
            && m.permission_profile == member.permission_profile
            && m.max_concurrency == member.max_concurrency
    }) {
        return Ok(existing);
    }
    app.db.create_member(
        &member.crew_id,
        crate::domain::crew::NewMember {
            name: member.name,
            role: member.role,
            device_id: member.device_id,
            cwd: member.cwd,
            provider: Some(provider.into()),
            model: Some(model.into()),
            skills: member.skills,
            mcp_servers: member.mcp_servers,
            permission_profile: member.permission_profile,
            max_concurrency: member.max_concurrency,
        },
    )
}
