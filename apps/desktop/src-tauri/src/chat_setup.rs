//! User-clicked platform documentation links; no arbitrary URL/shell execution.
#[tauri::command]
pub fn open_chat_setup(url: String) -> Result<(), String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "Invalid setup URL")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
        || !matches!(
            url.host_str(),
            Some(
                "docs.slack.dev"
                    | "discord.com"
                    | "core.telegram.org"
                    | "developer.webex.com"
                    | "github.com"
                    | "open.feishu.cn"
                    | "learn.microsoft.com"
            )
        )
    {
        return Err("Invalid setup URL".into());
    }
    #[cfg(windows)]
    let mut browser = {
        let mut command = crate::proc::command("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(target_os = "macos")]
    let mut browser = crate::proc::command("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut browser = crate::proc::command("xdg-open");
    browser
        .arg(url.as_str())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
