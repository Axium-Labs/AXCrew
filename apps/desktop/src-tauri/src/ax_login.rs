//! UI for AX-owned OAuth: this module never reads or stores provider tokens.
use std::{collections::HashMap, io::{BufRead, BufReader}, process::{Child, Stdio}, sync::{Arc, Mutex, OnceLock}, time::{Duration, Instant}};
use serde::Serialize;
use tauri::{Emitter, State};
use crate::{DesktopState, proc::command};

type Logins = HashMap<String, Arc<Mutex<Child>>>;
fn logins() -> &'static Mutex<Logins> {
    static LOGINS: OnceLock<Mutex<Logins>> = OnceLock::new();
    LOGINS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone, Serialize)]
struct LoginEvent { id: String, message: String, url: Option<String>, code: Option<String>, done: bool, success: bool }

fn login_url(value: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(value.trim()).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() { return None; }
    if !matches!(url.host_str()?, "www.workbuddy.ai" | "copilot.tencent.com" | "auth.openai.com" | "chatgpt.com") { return None; }
    Some(url)
}

#[tauri::command]
pub fn ax_begin_login(desktop: State<'_, DesktopState>, app: tauri::AppHandle, provider: String) -> Result<String, String> {
    if !["workbuddy", "workbuddy-cn", "openai-codex"].contains(&provider.as_str()) { return Err("Native account login is not available for this provider".into()); }
    let mut registry = logins().lock().map_err(|error| error.to_string())?;
    if !registry.is_empty() { return Err("Another account login is in progress".into()); }
    let mut child = command(&desktop.ax).args(["auth", "login", &provider]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|error| error.to_string())?;
    let stderr = child.stderr.take().ok_or("Missing AX login output")?;
    let child = Arc::new(Mutex::new(child));
    let id = uuid::Uuid::new_v4().to_string();
    registry.insert(id.clone(), child.clone());
    drop(registry);
    let output_id = id.clone();
    let output_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let url = line.split_whitespace().find_map(|part| login_url(part).map(|url| url.to_string()));
            let trimmed = line.trim();
            let code = if trimmed.len() == 9 && trimmed.as_bytes()[4] == b'-' && trimmed.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') { Some(trimmed.to_owned()) } else { None };
            let _ = output_app.emit("ax-login", LoginEvent { id: output_id.clone(), message: line, url, code, done: false, success: false });
        }
    });
    let worker_id = id.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        let success = loop {
            let mut process = child.lock().unwrap();
            match process.try_wait() {
                Ok(Some(status)) => break status.success(),
                Err(_) => { let _ = process.kill(); let _ = process.wait(); break false; },
                Ok(None) => {}
            }
            if started.elapsed() >= Duration::from_secs(15 * 60) { let _ = process.kill(); let _ = process.wait(); break false; }
            drop(process);
            std::thread::sleep(Duration::from_millis(100));
        };
        logins().lock().unwrap().remove(&worker_id);
        let _ = app.emit("ax-login", LoginEvent { id: worker_id, message: String::new(), url: None, code: None, done: true, success });
    });
    Ok(id)
}

#[tauri::command]
pub fn ax_cancel_login(id: String) -> Result<(), String> {
    if let Some(child) = logins().lock().map_err(|error| error.to_string())?.get(&id) {
        let mut child = child.lock().map_err(|error| error.to_string())?;
        if child.try_wait().map_err(|error| error.to_string())?.is_none() { child.kill().map_err(|error| error.to_string())?; }
    }
    Ok(())
}

/// Called only by the user's explicit click on the displayed link.
#[tauri::command]
pub fn ax_open_login_url(url: String) -> Result<(), String> {
    let url = login_url(&url).ok_or("Invalid authorization URL")?;
    #[cfg(windows)]
    let mut browser = { let mut browser = command("rundll32.exe"); browser.arg("url.dll,FileProtocolHandler"); browser };
    #[cfg(target_os = "macos")]
    let mut browser = command("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut browser = command("xdg-open");
    browser.arg(url.as_str()).spawn().map_err(|error| error.to_string())?;
    Ok(())
}


pub(crate) fn cancel_all() {
    for child in logins().lock().unwrap().values() { let _ = child.lock().unwrap().kill(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authorization_links_are_https_and_allowlisted() {
        assert!(login_url("https://www.workbuddy.ai/login?state=random").is_some());
        assert!(login_url("https://copilot.tencent.com/login?state=random").is_some());
        assert!(login_url("https://auth.openai.com/codex/device").is_some());
        for value in ["http://www.workbuddy.ai/login", "https://evil.test/login", "https://user@www.workbuddy.ai/login", "file:///C:/file"] { assert!(login_url(value).is_none()); }
    }
}
