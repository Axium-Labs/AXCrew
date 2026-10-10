//! AX personalization settings: memory, custom instructions, writing style.
use crate::{ax, proc::command, DesktopState};
use tauri::State;

#[tauri::command]
pub async fn ax_tui_command(
    desktop: State<'_, DesktopState>,
    cwd: String,
    args: Vec<String>,
) -> Result<String, String> {
    let active = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !std::path::Path::new(&cwd).is_absolute() || !std::path::Path::new(&cwd).is_dir() {
            return Err("Choose an existing workspace directory".into());
        }
        let mut process = command(&active);
        process
            .env("AX_HOME", ax::ax_home())
            .current_dir(&cwd);
        for arg in args {
            process.arg(arg);
        }
        let output = process.output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            let message = if stderr.is_empty() { stdout } else { stderr };
            return Err(message);
        }
        String::from_utf8(output.stdout)
            .map(|s| s.trim().to_owned())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
