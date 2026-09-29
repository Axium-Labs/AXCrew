mod terminal;
mod ax;
mod ax_catalog;
mod ax_update;
mod proc;

use std::{fs, path::{Component, Path, PathBuf}, process::{Child, Stdio}, sync::{Mutex, atomic::{AtomicBool, Ordering}}};
use tauri::{Manager, menu::{Menu, MenuItem}, tray::TrayIconBuilder};

struct DesktopState {
    endpoint: String,
    token: String,
    ax: PathBuf,
    backend: Mutex<Child>,
    quitting: AtomicBool,
}

/// Gateway 启动配置（持久化到 app data 的 gateway.json）：端口 / Token / 监听地址
/// 首次启动生成并写入，之后每次启动自动读取，重启不变；局域网开发模式无需每次设置环境变量。
/// 环境变量 AX_CREW_LISTEN_ADDR / AX_CREW_FIXED_PORT / AX_CREW_ADMIN_TOKEN 仍可临时覆盖。
#[derive(serde::Serialize, serde::Deserialize, Default)]
struct GatewayConfig {
    #[serde(default)] listen_addr: Option<String>,
    #[serde(default)] port: Option<u16>,
    #[serde(default)] token: Option<String>,
}

#[tauri::command]
fn backend_connection(state: tauri::State<'_, DesktopState>) -> serde_json::Value {
    serde_json::json!({
        "endpoint": state.endpoint,
        "lan_url": lan_url(&state.endpoint),
        "token": state.token,
    })
}

/// 把 endpoint（形如 http://127.0.0.1:PORT）中的回环地址替换成本机局域网 IP，
/// 得到手机可直接访问的 Gateway 地址；拿不到局域网 IP 时回退到原地址。
fn lan_url(endpoint: &str) -> String {
    if let Some(ip) = local_lan_ip() {
        if let Some(scheme) = endpoint.find("://") {
            let after = &endpoint[scheme + 3..];
            if let Some(colon) = after.find(':') {
                return format!("http://{ip}{}", &after[colon..]);
            }
        }
    }
    endpoint.to_string()
}

/// 通过 UDP 套接字拿本机默认路由的对外 IP（不实际发包，仅触发选路）。
fn local_lan_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip())
}

#[derive(serde::Serialize)]
struct WorkspaceEntry {
    name: String,
    is_dir: bool,
    size: u64,
}

#[derive(serde::Serialize)]
struct WorkspaceListing {
    path: String,
    entries: Vec<WorkspaceEntry>,
}

/// Runs filesystem work on the blocking pool.
///
/// Tauri executes a non-`async` command on the main thread, so a directory
/// walk (the reference picker scans up to 10k files) or a file read froze the
/// whole window. Awaiting this keeps the UI thread free.
async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

fn validate_workspace_sync(path: &str) -> Result<String, String> {
    let directory = Path::new(path);
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(format!("工作目录不可用：{path}。请选择一个现有文件夹。"));
    }
    // Preserve the user's spelling, including UNC and Windows verbatim paths.
    Ok(path.to_owned())
}

#[tauri::command]
async fn validate_workspace(path: String) -> Result<String, String> {
    blocking(move || validate_workspace_sync(&path)).await
}

fn workspace_path(root: &str, relative: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(root).canonicalize().map_err(|error| error.to_string())?;
    let path = Path::new(relative);
    if path.components().any(|part| !matches!(part, Component::Normal(_) | Component::CurDir)) {
        return Err("Path must stay inside the workspace".into());
    }
    let resolved = base.join(path).canonicalize().map_err(|error| error.to_string())?;
    if !resolved.starts_with(&base) {
        return Err("Path must stay inside the workspace".into());
    }
    Ok(resolved)
}

#[tauri::command]
async fn list_workspace_files(root: String, relative: String) -> Result<WorkspaceListing, String> {
    blocking(move || list_workspace_files_sync(root, relative)).await
}

fn list_workspace_files_sync(root: String, relative: String) -> Result<WorkspaceListing, String> {
    let path = workspace_path(&root, &relative)?;
    if !path.is_dir() { return Err("Not a directory".into()); }
    let mut entries = Vec::new();
    for item in fs::read_dir(path).map_err(|error| error.to_string())? {
        if entries.len() >= 500 { break; }
        let item = item.map_err(|error| error.to_string())?;
        let kind = item.file_type().map_err(|error| error.to_string())?;
        if kind.is_symlink() { continue; }
        let metadata = item.metadata().map_err(|error| error.to_string())?;
        entries.push(WorkspaceEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            is_dir: kind.is_dir(),
            size: metadata.len(),
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(WorkspaceListing { path: relative, entries })
}

#[tauri::command]
async fn read_workspace_file(root: String, relative: String) -> Result<String, String> {
    blocking(move || read_workspace_file_sync(root, relative)).await
}

fn read_workspace_file_sync(root: String, relative: String) -> Result<String, String> {
    let path = workspace_path(&root, &relative)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() { return Err("Not a file".into()); }
    if metadata.len() > 256 * 1024 { return Err("File is too large to preview".into()); }
    String::from_utf8(fs::read(path).map_err(|error| error.to_string())?).map_err(|_| "Only UTF-8 text files can be previewed".into())
}

#[tauri::command]
fn workspace_file_exists(root: String, relative: String) -> Result<bool, String> {
    let base = PathBuf::from(root).canonicalize().map_err(|error| error.to_string())?;
    let path = Path::new(&relative);
    if path.components().any(|part| !matches!(part, Component::Normal(_) | Component::CurDir)) {
        return Err("Path must stay inside the workspace".into());
    }
    Ok(base.join(path).exists())
}

#[tauri::command]
async fn search_workspace_files(root: String, query: String) -> Result<Vec<String>, String> {
    blocking(move || search_workspace_files_sync(root, query)).await
}

fn search_workspace_files_sync(root: String, query: String) -> Result<Vec<String>, String> {
    let base = PathBuf::from(root).canonicalize().map_err(|error| error.to_string())?;
    if !base.is_dir() { return Err("Workspace is not a directory".into()); }
    let mut pending = std::collections::VecDeque::from([base.clone()]);
    let mut found = Vec::new();
    while let Some(directory) = pending.pop_front() {
        if found.len() >= 10_000 || pending.len() >= 10_000 { break; }
        let Ok(entries) = fs::read_dir(directory) else { continue };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() { continue; }
            let name = entry.file_name().to_string_lossy().into_owned();
            if kind.is_dir() {
                if !matches!(name.as_str(), ".git" | ".ax" | "target" | "node_modules" | ".venv") { pending.push_back(entry.path()); }
            } else if kind.is_file() {
                if let Ok(relative) = entry.path().strip_prefix(&base) { found.push(relative.to_string_lossy().replace('\\', "/")); }
            }
        }
    }
    let needle = query.to_lowercase();
    found.retain(|path| path.to_lowercase().contains(&needle));
    found.sort_by_key(|path| (if path.rsplit('/').next().unwrap_or(path).to_lowercase().starts_with(&needle) {0} else {1}, path.len(), path.clone()));
    found.truncate(8);
    Ok(found)
}

#[cfg(test)]
mod workspace_tests {
    #[test]
    fn send_workspace_requires_an_existing_absolute_directory() {
        let cwd = std::env::current_dir().unwrap();
        assert!(super::validate_workspace_sync(&cwd.to_string_lossy()).is_ok());
        assert!(super::validate_workspace_sync(".").is_err());
        assert!(super::validate_workspace_sync(&cwd.join("missing-directory-for-validation").to_string_lossy()).is_err());
        assert!(super::validate_workspace_sync(&cwd.join("Cargo.toml").to_string_lossy()).is_err());
    }

    use super::{list_workspace_files_sync, read_workspace_file_sync, workspace_file_exists};

    #[test]
    fn file_preview_stays_inside_workspace() {
        let root = std::env::temp_dir().join(format!("ax-crew-workspace-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("note.txt"), "hello").unwrap();
        let path = root.to_string_lossy().into_owned();

        assert_eq!(read_workspace_file_sync(path.clone(), "note.txt".into()).unwrap(), "hello");
        assert_eq!(list_workspace_files_sync(path.clone(), "".into()).unwrap().entries.len(), 1);
        assert!(read_workspace_file_sync(path.clone(), "../outside.txt".into()).is_err());
        assert!(list_workspace_files_sync(path, "C:\\Windows".into()).is_err());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stop_file_probe_only_reports_workspace_paths() {
        let root = std::env::temp_dir().join(format!("ax-crew-stop-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join(".ax")).unwrap();
        let path = root.to_string_lossy().into_owned();

        assert!(!workspace_file_exists(path.clone(), ".ax/crew-stop".into()).unwrap());
        std::fs::write(root.join(".ax").join("crew-stop"), "").unwrap();
        assert!(workspace_file_exists(path.clone(), ".ax/crew-stop".into()).unwrap());
        assert!(workspace_file_exists(path, "../escape".into()).is_err());

        std::fs::remove_dir_all(root).unwrap();
    }
}

fn executable(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_owned() }
}

fn binary(app: &tauri::App, name: &str, override_var: &str, development: PathBuf) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(path)=std::env::var(override_var) { return Ok(PathBuf::from(path)); }
    if cfg!(debug_assertions) && development.exists() { return Ok(development); }
    let resource=app.path().resource_dir()?.join("bin").join(executable(name));
    if resource.exists() {return Ok(resource);}
    if development.exists() {return Ok(development);}
    Err(format!("{name} binary not found; build AX and Crew or set {override_var}").into())
}

fn ax_binary(app: &tauri::App, development: PathBuf) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(path) = std::env::var("AX_CREW_AX") { return Ok(PathBuf::from(path)); }
    // 优先使用「通过 GitHub 安装的 AX」：AX 官方安装脚本（scripts/install.ps1 /
    // install.sh）会把二进制装进固定目录（Windows 为 %LOCALAPPDATA%\Programs\AX\bin）
    // 并写入 PATH，设置页的「AX 更新」也更新这一份。优先用它，保证在设置页里
    // 检测并更新 AX 后，Crew 立刻运行的就是新版本。
    if let Some(installed) = ax::installed_ax().filter(|path| ax::supports_acp(path)) { return Ok(installed); }
    let bundled = app.path().resource_dir()?.join("bin").join(executable("ax"));
    // 开发构建：直接用工作区里编译的 ax。
    if cfg!(debug_assertions) && development.exists() { return Ok(development); }
    // 兜底：随包捆绑的 AX（便携包里没有这一份，只有开发产物里才可能残留）。
    if bundled.exists() { return Ok(bundled); }
    if development.exists() { return Ok(development); }
    Err("No AX executable with Crew ACP support was found".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app=tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_| {
            if let Some(window)=app.get_webview_window("main") {window.show().ok();window.set_focus().ok();}
        }))
        .plugin(tauri_plugin_window_state::Builder::default()
            .with_state_flags(tauri_plugin_window_state::StateFlags::all()
                & !tauri_plugin_window_state::StateFlags::DECORATIONS)
            .build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![backend_connection, validate_workspace, list_workspace_files, read_workspace_file, workspace_file_exists, search_workspace_files, terminal::terminal_create, terminal::terminal_write, terminal::terminal_resize, terminal::terminal_close, ax::ax_local_state, ax::ax_store_api_key, ax::ax_refresh_models, ax::ax_remove_credential, ax::ax_select_model, ax::ax_export, ax::ax_import, ax_update::ax_check_update, ax_update::ax_apply_update, ax_catalog::ax_catalog])
        .setup(|app| {
            let root=PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let backend=binary(app,"ax-crew","AX_CREW_BACKEND",root.join("../../target/debug").join(executable("ax-crew")))?;
            let ax=ax_binary(app,root.join("../../../ax/target/debug").join(executable("ax")))?;
            let data=app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let workspace=data.join("workspace");
            std::fs::create_dir_all(&workspace)?;
            // 局域网开发模式（写进代码，启动即用）：把监听地址、端口、Token 持久化到 gateway.json。
            // 首次启动生成并写入，之后每次启动自动读取，重启不变，无需每次设置环境变量。
            // 默认监听 0.0.0.0，手机可从局域网直连；环境变量仍可临时覆盖。
            let config_path = data.join("gateway.json");
            let mut cfg: GatewayConfig = fs::read(&config_path)
                .ok()
                .and_then(|raw| serde_json::from_slice(&raw).ok())
                .unwrap_or_default();

            let listen_addr = std::env::var("AX_CREW_LISTEN_ADDR").unwrap_or_else(|_| {
                cfg.listen_addr.clone().unwrap_or_else(|| "0.0.0.0".into())
            });
            cfg.listen_addr = Some(listen_addr.clone());

            let port = match std::env::var("AX_CREW_FIXED_PORT") {
                Ok(fixed) => {
                    let port: u16 = fixed.trim().parse().map_err(|_| {
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidInput,
                            "AX_CREW_FIXED_PORT must be a port number (1-65535)",
                        )
                    })?;
                    // 端口必须空闲，否则明确报错，避免手机/代理静默指向变化的端口
                    std::net::TcpListener::bind(("127.0.0.1", port)).map_err(|_| {
                        std::io::Error::new(
                            std::io::ErrorKind::AddrInUse,
                            format!("AX_CREW_FIXED_PORT {port} is already in use"),
                        )
                    })?;
                    port
                }
                Err(_) => match cfg.port {
                    Some(port) => {
                        std::net::TcpListener::bind(("127.0.0.1", port)).map_err(|_| {
                            std::io::Error::new(
                                std::io::ErrorKind::AddrInUse,
                                format!("Gateway 端口 {port} 已被占用，请释放后重试，或删除 {config_path:?} 以更换端口"),
                            )
                        })?;
                        port
                    }
                    None => std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port(),
                },
            };
            cfg.port = Some(port);

            let token = std::env::var("AX_CREW_ADMIN_TOKEN")
                .ok()
                .filter(|value| !value.is_empty())
                .or_else(|| cfg.token.clone().filter(|value| !value.is_empty()))
                .unwrap_or_else(|| {
                    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
                });
            cfg.token = Some(token.clone());

            fs::write(&config_path, serde_json::to_string_pretty(&cfg)?)?;
            let child=proc::command(backend).arg("--listen").arg(format!("{listen_addr}:{port}"))
                .arg("--database").arg(data.join("crew.sqlite3"))
                .arg("--ax").arg(&ax)
                .env("AX_CREW_ADMIN_TOKEN",&token)
                .env("AX_CREW_WORKSPACE",&workspace)
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()?;
            app.manage(DesktopState{endpoint:format!("http://127.0.0.1:{port}"),token,ax,backend:Mutex::new(child),quitting:AtomicBool::new(false)});
            app.manage(terminal::TerminalState::default());
            let show=MenuItem::with_id(app,"show","Show AX Crew",true,None::<&str>)?;
            let quit=MenuItem::with_id(app,"quit","Quit AX Crew",true,None::<&str>)?;
            let menu=Menu::with_items(app,&[&show,&quit])?;
            TrayIconBuilder::new().icon(app.default_window_icon().ok_or("default icon missing")?.clone()).menu(&menu)
                .on_menu_event(|app,event|match event.id.as_ref(){
                    "show"=>{if let Some(w)=app.get_webview_window("main"){w.show().ok();w.set_focus().ok();}},
                    "quit"=>{app.state::<DesktopState>().quitting.store(true,Ordering::SeqCst);app.exit(0);},
                    _=>{},
                }).build(app)?;
            Ok(())
        })
        .on_window_event(|window,event| {
            if let tauri::WindowEvent::CloseRequested{api,..}=event {
                if !window.app_handle().state::<DesktopState>().quitting.load(Ordering::SeqCst){window.hide().ok();api.prevent_close();}
            }
        })
        .build(tauri::generate_context!()).expect("failed to build AX Crew desktop");
    app.run(|app,event| {
        if let tauri::RunEvent::Exit=event {
            if let Some(state)=app.try_state::<terminal::TerminalState>(){state.close_all();}
            if let Some(state)=app.try_state::<DesktopState>(){state.backend.lock().unwrap().kill().ok();}
        }
    });
}
