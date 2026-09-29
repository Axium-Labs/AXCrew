use std::{collections::HashMap, ffi::OsStr, fs, io::{BufRead, BufReader, Write}, path::{Path, PathBuf}, process::Stdio, sync::{mpsc, Mutex, OnceLock}, time::{Duration, Instant}};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::State;

use crate::{DesktopState, proc::command};

#[derive(Clone, Deserialize, Serialize)]
pub struct AxModel { pub provider: String, pub id: String, pub display_name: String }
/// Outcome of the model discovery run that follows storing a credential.
#[derive(Serialize)]
pub struct AxDiscovery { pub provider: String, pub models: usize, pub warning: Option<String> }
#[derive(Deserialize, Serialize)]
pub struct AxProvider { pub id: String, pub name: String, pub configured: bool, pub source: Option<String>, pub supported: bool, pub unsupported_reason: Option<String>, pub models: Vec<AxModel>, pub model_source: String }
#[derive(Serialize)]
pub struct AxLocalState {
    pub installed_path: Option<String>, pub installed_version: Option<String>, pub installed_compatible: bool,
    pub active_path: String, pub active_version: Option<String>, pub home: String,
    pub selected_model: Option<AxModel>, pub providers: Vec<AxProvider>,
    /// Only set by `ax_store_api_key`, so the UI can say whether the new
    /// credential actually produced models instead of silently showing none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discovery: Option<AxDiscovery>,
}

pub fn executable_name() -> &'static str {
    if cfg!(windows) { "ax.exe" } else { "ax" }
}

/// 官方安装脚本使用的安装目录：Windows 是 `%LOCALAPPDATA%\Programs\AX\bin`，
/// 其他平台是 `~/.local/bin`。设置页的「下载 AX」装到这里，所以这里也用它兜底。
pub fn install_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default().join("Programs").join("AX").join("bin")
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".local").join("bin")
    }
}

pub fn installed_ax() -> Option<PathBuf> {
    let filename = executable_name();
    let on_path = std::env::var_os("PATH").and_then(|path| std::env::split_paths(&path).map(|part| part.join(filename)).find(|candidate| candidate.is_file()));
    // 安装脚本会把 AX 装进固定目录并写进用户 PATH，但当前进程继承的是启动时的
    // PATH：刚装好时在标准目录兜一手，设置页不用重启就能看到它。
    on_path.or_else(|| Some(install_dir().join(filename)).filter(|candidate| candidate.is_file()))
}

/// 丢弃某个 AX 路径的探测缓存（版本 / ACP 支持）。
///
/// 这两项进程内缓存的前提是「二进制不会在本次运行中改变」，而更新恰好打破这个
/// 前提：不清理的话，设置页更新完还会一直报替换前的版本号。
pub fn forget_probes(path: &Path) {
    version_cache().lock().unwrap().remove(path);
    acp_cache().lock().unwrap().remove(path);
}

/// Cached `ax` probes, keyed by binary path.
///
/// `version` / `supports_acp` each spawn a process, and the settings page asks
/// for the local AX state every time it mounts. A binary's version and ACP
/// support cannot change while this process runs, so probing once is enough —
/// this alone removes several process spawns per page load.
fn version_cache() -> &'static Mutex<HashMap<PathBuf, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn acp_cache() -> &'static Mutex<HashMap<PathBuf, bool>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, bool>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn version(path: &Path) -> Option<String> {
    if let Some(hit) = version_cache().lock().unwrap().get(path) { return hit.clone(); }
    let probed = command(path).arg("--version").output().ok().filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned());
    version_cache().lock().unwrap().insert(path.to_path_buf(), probed.clone());
    probed
}

pub fn supports_acp(path: &Path) -> bool {
    if let Some(hit) = acp_cache().lock().unwrap().get(path) { return *hit; }
    let probed = command(path).args(["acp", "--help"]).output().is_ok_and(|output| output.status.success());
    acp_cache().lock().unwrap().insert(path.to_path_buf(), probed);
    probed
}

fn ax_home() -> PathBuf {
    std::env::var_os("AX_HOME").map(PathBuf::from).unwrap_or_else(|| {
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(PathBuf::from).unwrap_or_default().join(".ax")
    })
}

fn read_json(path: &Path) -> Result<Value, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| format!("{}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(error) => Err(error.to_string()),
    }
}

fn write_private_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|error| error.to_string())?;
        file.write_all(serde_json::to_string_pretty(value).map_err(|error| error.to_string())?.as_bytes()).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        #[cfg(windows)] {
            let user = std::env::var("USERNAME").map_err(|error| error.to_string())?;
            let output = command("icacls").arg(&temporary).arg("/inheritance:r").arg("/grant:r").arg(format!("{user}:F"))
                .output().map_err(|error| error.to_string())?;
            if !output.status.success() { return Err("Could not restrict AX credential file permissions".into()); }
        }
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}



/// One bounded `ax acp` exchange: writes `requests`, returns the replies whose
/// `id` is in `wanted`.
///
/// Runs inside Tauri commands, so it is time-bounded: a silent AX yields an
/// empty map instead of hanging. The child is always killed — `ax acp` is a
/// long-lived server, not a one-shot command. `cwd` matters for the catalog
/// extensions: project skills live in `<project root>/skills` and the MCP
/// config in `<project root>/.ax/mcp.toml`, both resolved from AX's cwd.
pub fn acp_replies(ax: &Path, cwd: Option<&Path>, requests: &str, wanted: &[i64], deadline: Duration) -> HashMap<i64, Value> {
    let mut command = command(ax);
    command.arg("acp").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Some(cwd) = cwd { command.current_dir(cwd); }
    let Ok(mut child) = command.spawn() else { return HashMap::new() };
    if child.stdin.as_mut().is_none_or(|stdin| stdin.write_all(requests.as_bytes()).is_err()) {
        let _ = child.kill();
        return HashMap::new();
    }
    let Some(stdout) = child.stdout.take() else { let _ = child.kill(); return HashMap::new() };
    let (sender, receiver) = mpsc::channel();
    // Each request gets one reply and AX may interleave notifications, so the
    // read is bounded by the number of answers we wait for rather than by a
    // fixed line count.
    let lines = wanted.len().max(1) * 8 + 8;
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().take(lines) {
            match line {
                Ok(line) => if sender.send(line).is_err() { break },
                Err(_) => break,
            }
        }
    });
    let stop = Instant::now() + deadline;
    let mut replies = HashMap::new();
    while Instant::now() < stop && replies.len() < wanted.len() {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(line) => {
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                let Some(id) = message.get("id").and_then(Value::as_i64) else { continue };
                if wanted.contains(&id) { replies.insert(id, message); }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = child.kill();
    replies
}

fn acp_exchange(ax: &Path, requests: &str, wanted: i64, deadline: Duration) -> Option<Value> {
    acp_replies(ax, None, requests, &[wanted], deadline).remove(&wanted)
}

/// Providers AX itself reports as undriveable, mapped to the reason.
///
/// Crew's own provider list is a copy, so without this it treats "a credential
/// file has an entry" as "this works" and shows providers as connected that AX
/// has no adapter for. The list comes from AX over ACP rather than being
/// re-derived here, so the two can never disagree.
fn provider_catalog(ax: &Path) -> Result<Vec<AxProvider>, String> {
    let requests = format!("{}\n{}\n",
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
        json!({"jsonrpc":"2.0","id":2,"method":"_ax/models"}));
    let message = acp_exchange(ax, &requests, 2, Duration::from_secs(8))
        .ok_or("AX 未响应模型目录请求")?;
    let catalog = message.pointer("/result/catalog")
        .ok_or("当前 AX 不支持统一模型目录，请更新 AX 后重试")?;
    serde_json::from_value(catalog.clone()).map_err(|error| format!("AX 模型目录格式错误：{error}"))
}

/// Asks AX to run live discovery for one provider and write its model cache.
///
/// Crew writes `~/.ax/auth.json` itself, so AX never learns that a credential
/// appeared — `~/.ax/models/<provider>.json` stayed missing (and the model
/// list empty) until someone opened the TUI model picker. This is the write
/// side: AX discovers, caches, and reports why the list is empty when it is.
///
/// Returns the number of cached models, or the reason discovery failed.
fn discover_models(ax: &Path, provider: &str) -> Result<usize, String> {
    let requests = format!(
        "{}\n{}\n",
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
        json!({"jsonrpc":"2.0","id":2,"method":"_ax/refresh-models","params":{"provider":provider}}),
    );
    let Some(message) = acp_exchange(ax, &requests, 2, Duration::from_secs(30)) else {
        return Err("AX 未响应模型发现请求，请确认本机 ax 支持 Crew（ax acp）".to_owned());
    };
    if let Some(error) = message.get("error") {
        return Err(error.get("message").and_then(Value::as_str).unwrap_or("模型发现失败").to_owned());
    }
    let models = message.pointer("/result/models").and_then(Value::as_array).map_or(0, Vec::len);
    if let Some(warning) = message.pointer("/result/warning").and_then(Value::as_str) {
        return Err(format!("{warning}（本地目录仍可选择；不代表在线验证成功）"));
    }
    if models == 0 {
        let warning = message.pointer("/result/warning").and_then(Value::as_str).unwrap_or("厂商没有返回可用模型");
        return Err(warning.to_owned());
    }
    Ok(models)
}

fn state(active: &Path) -> Result<AxLocalState, String> {
    let home = ax_home();
    let config = read_json(&home.join("config.json"))?;
    let installed = installed_ax();
    let selected = config.get("model").and_then(|model| Some(AxModel {
        provider: model.get("provider")?.as_str()?.to_owned(),
        id: model.get("model")?.as_str()?.to_owned(),
        display_name: model.get("model")?.as_str()?.to_owned(),
    }));
    let providers = provider_catalog(active)?;
    Ok(AxLocalState {
        installed_path: installed.as_ref().map(|path| path.to_string_lossy().into_owned()),
        installed_version: installed.as_deref().and_then(version),
        installed_compatible: installed.as_deref().is_some_and(supports_acp),
        active_path: active.to_string_lossy().into_owned(), active_version: version(active),
        home: home.to_string_lossy().into_owned(), selected_model: selected, providers, discovery: None,
    })
}

#[tauri::command]
pub async fn ax_local_state(desktop: State<'_, DesktopState>) -> Result<AxLocalState, String> {
    // Off the main thread: this spawns `ax` probes and reads the AX home
    // directory. As a synchronous command it ran on the UI thread, so opening
    // Settings froze the window for as long as the probes took.
    let ax = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || state(&ax)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn ax_store_api_key(desktop: State<'_, DesktopState>, provider: String, key: String) -> Result<AxLocalState, String> {
    if provider == "openai-codex" { return Err("Provider does not support API key login".into()); }
    if key.trim().is_empty() { return Err("API key is required".into()); }
    let ax = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = provider_catalog(&ax)?;
        let selected = catalog.iter().find(|item| item.id == provider).ok_or("Unknown provider")?;
        if !selected.supported { return Err(selected.unsupported_reason.clone().unwrap_or("Unsupported provider".into())); }
        let path = ax_home().join("auth.json");
        let mut auth = read_json(&path)?;
        auth.as_object_mut().ok_or("Invalid AX auth.json")?.insert(provider.clone(), json!({"type":"api_key","key":key.trim()}));
        write_private_json(&path, &auth)?;
        // Discover right away so `~/.ax/models/<provider>.json` exists. Without
        // this the credential was stored but AX never learned about it, and the
        // model list stayed empty until someone ran the TUI picker.
        let mut next = match state(&ax) { Ok(state) => state, Err(error) => return Err(error) };
        next.discovery = Some(match discover_models(&ax, &provider) {
            Ok(models) => AxDiscovery { provider: provider.clone(), models, warning: None },
            Err(warning) => AxDiscovery { provider: provider.clone(), models: 0, warning: Some(warning) },
        });
        // Re-read so the reported state already carries the fresh cache.
        if let Ok(fresh) = state(&ax) { next.providers = fresh.providers; next.selected_model = fresh.selected_model; }
        Ok(next)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn ax_remove_credential(desktop: State<'_, DesktopState>, provider: String) -> Result<AxLocalState, String> {
    let ax = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = ax_home().join("auth.json");
        let mut auth = read_json(&path)?;
        if auth.as_object_mut().ok_or("Invalid AX auth.json")?.remove(&provider).is_some() { write_private_json(&path, &auth)?; }
        state(&ax)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn ax_select_model(desktop: State<'_, DesktopState>, provider: String, model: String) -> Result<AxLocalState, String> {
    let ax = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let current = state(&ax)?;
        if !current.providers.iter().any(|item| item.id == provider && item.configured && item.supported && item.models.iter().any(|available| available.id == model)) {
            return Err("Select a model from a configured AX provider".into());
        }
        let path = ax_home().join("config.json");
        let mut config = read_json(&path)?;
        config.as_object_mut().ok_or("Invalid AX config.json")?.insert("model".into(), json!({"provider":provider,"model":model}));
        write_private_json(&path, &config)?;
        state(&ax)
    }).await.map_err(|error| error.to_string())?
}

/// Runs live discovery and refreshes the local state.
///
/// Settings' "refresh model list" used to only re-read `~/.ax/models/*.json`,
/// so a provider whose cache was missing stayed missing no matter how often
/// the button was pressed. With no `provider` given this fills in the
/// all configured, supported providers, even when they already have a cache.
#[tauri::command]
pub async fn ax_refresh_models(desktop: State<'_, DesktopState>, provider: Option<String>) -> Result<AxLocalState, String> {
    let ax = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut next = state(&ax)?;
        let label = provider.clone().unwrap_or_else(|| "所有已配置的提供商".to_owned());
        let targets: Vec<String> = match provider {
            Some(one) => vec![one],
            None => next.providers.iter().filter(|item| item.configured && item.supported).map(|item| item.id.clone()).collect(),
        };
        if targets.is_empty() {
            next.discovery = Some(AxDiscovery { provider: label, models: 0, warning: Some("没有已配置且受支持的提供商".to_owned()) });
            return Ok(next);
        }
        let mut failures = Vec::new();
        let mut discovered = 0;
        for id in targets {
            match discover_models(&ax, &id) {
                Ok(models) => discovered += models,
                Err(reason) => failures.push(format!("{id}：{reason}")),
            }
        }
        if let Ok(fresh) = state(&ax) { next.providers = fresh.providers; next.selected_model = fresh.selected_model; }
        next.discovery = Some(AxDiscovery { provider: label, models: discovered, warning: (!failures.is_empty()).then(|| failures.join("；")) });
        Ok(next)
    }).await.map_err(|error| error.to_string())?
}

fn workspace_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || !path.is_dir() { return Err("Choose an existing workspace directory".into()); }
    Ok(path)
}

fn backup_command(ax: &Path, cwd: &str, arguments: &[&OsStr]) -> Result<String, String> {
    let output = command(ax).args(arguments).current_dir(workspace_path(cwd)?).output().map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if output.status.success() { Ok(stdout) } else { Err(if stderr.is_empty() { stdout } else { stderr }) }
}

#[tauri::command]
pub async fn ax_export(desktop: State<'_, DesktopState>, cwd: String, path: String, scope: String) -> Result<String, String> {
    let ax = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || ax_export_sync(&ax, cwd, path, scope)).await.map_err(|error| error.to_string())?
}

fn ax_export_sync(ax: &Path, cwd: String, path: String, scope: String) -> Result<String, String> {
    let destination = PathBuf::from(&path);
    if !destination.is_absolute() || destination.extension().and_then(OsStr::to_str) != Some("axpack") { return Err("Choose an absolute .axpack destination".into()); }
    if destination.exists() { return Err("AX export never overwrites an existing archive".into()); }
    let mut args = vec![OsStr::new("export"), destination.as_os_str()];
    match scope.as_str() { "memory" => args.push(OsStr::new("--memory")), "sessions" => args.push(OsStr::new("--sessions")), "all" => (), _ => return Err("Invalid export scope".into()) }
    backup_command(ax, &cwd, &args)
}

#[tauri::command]
pub async fn ax_import(desktop: State<'_, DesktopState>, cwd: String, path: String, dry_run: bool) -> Result<String, String> {
    let ax = desktop.ax.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let archive = PathBuf::from(&path);
        if !archive.is_absolute() || !archive.is_file() { return Err("Choose an existing AX archive".into()); }
        let mut args = vec![OsStr::new("import"), archive.as_os_str()];
        if dry_run { args.push(OsStr::new("--dry-run")); }
        backup_command(&ax, &cwd, &args)
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn updates_existing_ax_json_without_touching_user_data() {
        let root = std::env::temp_dir().join(format!("ax-crew-auth-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("auth.json");
        write_private_json(&path, &json!({"deepseek":{"type":"api_key","key":"first"}})).unwrap();
        write_private_json(&path, &json!({"deepseek":{"type":"api_key","key":"second"}})).unwrap();
        assert_eq!(read_json(&path).unwrap()["deepseek"]["key"], "second");
        fs::remove_dir_all(root).unwrap();
    }
}
