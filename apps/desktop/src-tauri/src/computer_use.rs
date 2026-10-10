//! Typed host settings bridge. No workspace or model runtime is needed.
use crate::{ax, proc::command, DesktopState};
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Changes {
    enabled: Option<bool>,
    include_screenshot: Option<bool>,
    max_nodes: Option<usize>,
    screenshot_width: Option<u32>,
}

#[tauri::command]
pub async fn ax_computer_use(
    desktop: State<'_, DesktopState>,
    settings: Option<Changes>,
) -> Result<Value, String> {
    let active = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut process = command(&active);
        process.env("AX_HOME", ax::ax_home()).arg("computer-use");
        let settings = settings.unwrap_or_default();
        if let Some(value) = settings.enabled {
            process.args(["--enabled", &value.to_string()]);
        }
        if let Some(value) = settings.include_screenshot {
            process.args(["--include-screenshot", &value.to_string()]);
        }
        if let Some(value) = settings.max_nodes {
            process.args(["--max-nodes", &value.to_string()]);
        }
        if let Some(value) = settings.screenshot_width {
            process.args(["--screenshot-width", &value.to_string()]);
        }
        let output = process.output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Invalid Computer Use settings response: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}
