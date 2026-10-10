//! AX-owned host access settings; independent of selected workspaces and gateway state.
use crate::{ax, proc::command, DesktopState};
use serde::Deserialize;
use serde_json::Value;
use tauri::State;
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Changes {
    surface: Option<String>,
    target: Option<String>,
    decision: Option<String>,
    remove: Option<bool>,
    browser_enabled: Option<bool>,
}
#[tauri::command]
pub async fn ax_host_permissions(
    desktop: State<'_, DesktopState>,
    changes: Option<Changes>,
) -> Result<Value, String> {
    let active = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut process = command(&active);
        process
            .env("AX_HOME", ax::ax_home())
            .arg("host-permissions");
        let changes = changes.unwrap_or_default();
        if let Some(surface) = changes.surface {
            process.args(["--surface", &surface]);
        }
        if let Some(target) = changes.target {
            process.args(["--target", &target]);
        }
        if let Some(decision) = changes.decision {
            process.args(["--decision", &decision]);
        }
        if changes.remove == Some(true) {
            process.arg("--remove");
        }
        if let Some(enabled) = changes.browser_enabled {
            process.args(["--browser-enabled", &enabled.to_string()]);
        }
        let output = process.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Invalid host permissions response: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
