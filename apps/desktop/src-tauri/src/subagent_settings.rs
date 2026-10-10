//! Delegation limits are read and persisted by AX, never independently by Crew.
use crate::{ax, proc::command, DesktopState};
use serde::{Deserialize, Serialize};
use std::{path::Path, process::Command};
use tauri::State;

#[derive(Clone, Deserialize, Serialize)]
pub struct SubagentSettings {
    max_depth: u64,
    max_concurrent: u64,
}

#[derive(Deserialize)]
pub struct SubagentUpdate {
    max_depth: Option<u64>,
    max_concurrent: Option<u64>,
}

fn settings_command(
    active: &Path,
    home: &Path,
    cwd: &str,
    scope: &str,
    settings: Option<&SubagentUpdate>,
    reset: bool,
) -> Result<Command, String> {
    if !["global", "project"].contains(&scope) {
        return Err("Invalid settings scope".into());
    }
    crate::validate_workspace_sync(cwd)?;
    if let Some(value) = settings {
        if value
            .max_depth
            .is_some_and(|depth| depth > 9_007_199_254_740_991)
            || value
                .max_concurrent
                .is_some_and(|count| !(1..=64).contains(&count))
        {
            return Err("Invalid subagent limits".into());
        }
    }
    if reset && settings.is_some() {
        return Err("Reset cannot include settings".into());
    }
    let mut process = command(active);
    process
        .env("AX_HOME", home)
        .current_dir(cwd)
        .args(["settings", "--scope", scope]);
    if let Some(value) = settings {
        if let Some(depth) = value.max_depth {
            process.arg("--max-depth").arg(depth.to_string());
        }
        if let Some(count) = value.max_concurrent {
            process.arg("--max-concurrent").arg(count.to_string());
        }
    }
    if reset {
        process.arg("--reset");
    }
    Ok(process)
}

#[tauri::command]
pub async fn ax_subagent_settings(
    desktop: State<'_, DesktopState>,
    cwd: String,
    scope: String,
    settings: Option<SubagentUpdate>,
    reset: Option<bool>,
) -> Result<SubagentSettings, String> {
    let active = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Validate before starting AX: spawning in a removed folder otherwise
        // returns a misleading Windows process error instead of a workspace error.
        let mut process = settings_command(
            &active,
            &ax::ax_home(),
            &cwd,
            &scope,
            settings.as_ref(),
            reset.unwrap_or(false),
        )?;
        let output = process.output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "无法读写子智能体设置。{}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let result: SubagentSettings = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Invalid AX settings response: {error}"))?;
        if result.max_depth > 9_007_199_254_740_991 || !(1..=64).contains(&result.max_concurrent) {
            return Err("Invalid AX subagent limits".into());
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
#[path = "../../../../tests/desktop/subagent_settings.rs"]
mod tests;
