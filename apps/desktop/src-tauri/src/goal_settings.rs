//! Goal policy remains owned, validated and persisted by AX.
use crate::{ax, proc::command, DesktopState};
use serde_json::Value;
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
use tauri::State;

fn settings_command(
    active: &Path,
    home: &Path,
    cwd: Option<&str>,
    scope: &str,
    settings: Option<&Value>,
    reset: bool,
) -> Result<Command, String> {
    if !["global", "project"].contains(&scope) {
        return Err("Invalid Goal settings scope".into());
    }
    if reset && settings.is_some() {
        return Err("Reset cannot include settings".into());
    }
    if scope == "project" {
        crate::validate_workspace_sync(cwd.ok_or("Select a workspace for project Goal settings")?)?;
    }
    let mut process = command(active);
    process
        .env("AX_HOME", home)
        .args(["goal-settings", "--scope", scope]);
    if scope == "project" {
        process.current_dir(cwd.expect("validated workspace"));
    } else {
        process.current_dir(home.parent().unwrap_or(home));
    }
    if settings.is_some() {
        process.arg("--json-stdin").stdin(Stdio::piped());
    } else {
        process.stdin(Stdio::null());
    }
    if reset {
        process.arg("--reset");
    }
    process.stdout(Stdio::piped()).stderr(Stdio::piped());
    Ok(process)
}

#[tauri::command]
pub async fn ax_goal_settings(
    desktop: State<'_, DesktopState>,
    cwd: Option<String>,
    scope: String,
    settings: Option<Value>,
    reset: Option<bool>,
) -> Result<Value, String> {
    let active = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut process = settings_command(
            &active,
            &ax::ax_home(),
            cwd.as_deref(),
            &scope,
            settings.as_ref(),
            reset.unwrap_or(false),
        )?;
        let bytes = settings
            .as_ref()
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|e| e.to_string())?;
        if bytes.as_ref().is_some_and(|b| b.len() > 1_048_576) {
            return Err("Goal template exceeds 1 MiB".into());
        }
        let mut child = process.spawn().map_err(|e| e.to_string())?;
        if let Some(bytes) = bytes {
            let mut stdin = child.stdin.take().ok_or("AX settings stdin unavailable")?;
            // Drain output concurrently with the request to avoid pipe deadlocks.
            let writer = std::thread::spawn(move || stdin.write_all(&bytes));
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            writer
                .join()
                .map_err(|_| "AX settings writer failed")?
                .map_err(|e| e.to_string())?;
            return decode(output);
        }
        decode(child.wait_with_output().map_err(|e| e.to_string())?)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn decode(output: std::process::Output) -> Result<Value, String> {
    if !output.status.success() {
        return Err(format!(
            "AX Goal settings: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let result: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Invalid AX Goal settings response: {e}"))?;
    if !result.is_object()
        || !result["enabled"].is_boolean()
        || !result["validators"].is_array()
        || !matches!(
            result["mode"].as_str(),
            Some("off" | "deterministic" | "model")
        )
    {
        return Err("AX build does not support the Goal settings contract; update AX".into());
    }
    Ok(result)
}
