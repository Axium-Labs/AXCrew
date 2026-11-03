//! Authenticated, loopback-only control of the actual sidebar child WebViews.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};

const RESULT_HOST: &str = "ax-browser-result.invalid";
#[derive(Clone)]
struct Tab {
    id: String,
    scope: String,
    name: String,
    origin: Arc<Mutex<String>>,
    blocked: Arc<Mutex<Option<String>>>,
    network: Arc<Mutex<Option<String>>>,
    guarded: Arc<AtomicBool>,
    ready: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
}
struct NetworkLease(Arc<Mutex<Option<String>>>);
impl Drop for NetworkLease {
    fn drop(&mut self) {
        if let Ok(mut origin) = self.0.lock() {
            *origin = None;
        }
    }
}
#[derive(Default)]
pub struct State {
    tabs: Mutex<HashMap<(String, String), Tab>>,
    active: Mutex<HashMap<String, String>>,
    pending: Mutex<HashMap<String, (String, mpsc::SyncSender<Value>)>>,
}

pub fn start(app: tauri::AppHandle) -> Result<(String, String), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let endpoint = format!(
        "http://{}/browser",
        listener.local_addr().map_err(|e| e.to_string())?
    );
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let secret = token.clone();
    app.manage(State::default());
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let token = secret.clone();
            std::thread::spawn(move || serve(&app, stream, &token));
        }
    });
    Ok((endpoint, token))
}

fn serve(app: &tauri::AppHandle, mut stream: TcpStream, token: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    let result = read_request(&mut stream, token).and_then(|value| dispatch(app, value));
    let value = result.unwrap_or_else(|error| json!({"error":error}));
    let body = value.to_string();
    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
}

fn read_request(stream: &mut TcpStream, token: &str) -> Result<Value, String> {
    let mut bytes = Vec::new();
    loop {
        let mut chunk = [0u8; 4096];
        let count = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if count == 0 {
            return Err("Incomplete browser request".into());
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.len() > 1024 * 1024 {
            return Err("Browser request exceeds limit".into());
        }
        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let headers = std::str::from_utf8(&bytes[..end]).map_err(|e| e.to_string())?;
            if headers.lines().next() != Some("POST /browser HTTP/1.1") {
                return Err("Invalid browser route".into());
            }
            let header = |key: &str| {
                headers
                    .lines()
                    .filter_map(|line| line.split_once(':'))
                    .find(|(name, _)| name.eq_ignore_ascii_case(key))
                    .map(|(_, value)| value.trim())
            };
            if header("authorization") != Some(format!("Bearer {token}").as_str())
                || header("origin").is_some()
            {
                return Err("Browser bridge authorization required".into());
            }
            let size = header("content-length")
                .and_then(|s| s.parse::<usize>().ok())
                .filter(|size| *size <= 1024 * 1024)
                .ok_or("Invalid browser body length")?;
            if bytes.len() >= end + 4 + size {
                return serde_json::from_slice(&bytes[end + 4..end + 4 + size])
                    .map_err(|e| e.to_string());
            }
        }
    }
}

pub fn bind(app: &tauri::AppHandle, scope: &str, id: &str) -> Result<(), String> {
    if scope.is_empty() || scope.len() > 256 {
        return Err("Invalid browser Session".into());
    }
    let view = app.get_webview(id).ok_or("Browser view closed")?;
    let url = view.url().map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Invalid browser URL".into());
    }
    let state = app.state::<State>();
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    // One view belongs to one AX Session. Selecting another conversation cannot
    // transfer a live page (including its cookies/forms) between Sessions.
    if tabs.values().any(|tab| tab.id == id && tab.scope != scope) {
        return Err("Browser belongs to another Session".into());
    }
    let existing = tabs.values().find(|tab| tab.id == id).cloned();
    if existing.is_none()
        && (tabs.len() >= 64 || tabs.values().filter(|tab| tab.scope == scope).count() >= 16)
    {
        return Err("Built-in browser tab limit reached; close unused tabs".into());
    }
    let tab = existing.unwrap_or_else(|| Tab {
        id: id.into(),
        scope: scope.into(),
        name: id.into(),
        origin: Arc::new(Mutex::new(url.origin().ascii_serialization())),
        blocked: Arc::default(),
        network: Arc::default(),
        guarded: Arc::default(),
        ready: Arc::new(AtomicBool::new(true)),
        generation: Arc::default(),
    });
    state
        .active
        .lock()
        .map_err(|e| e.to_string())?
        .insert(scope.into(), tab.name.clone());
    tabs.insert((scope.into(), tab.name.clone()), tab);
    Ok(())
}

pub fn closed(app: &tauri::AppHandle, id: &str) {
    let state = app.state::<State>();
    if let Ok(mut tabs) = state.tabs.lock() {
        tabs.retain(|_, tab| tab.id != id);
    }
    if let Ok(mut pending) = state.pending.lock() {
        pending.retain(|_, (view, sender)| {
            if view == id {
                let _ = sender.send(json!({"error":"Browser tab closed"}));
                false
            } else {
                true
            }
        });
    };
}

pub fn is_controlled(app: &tauri::AppHandle, id: &str) -> bool {
    app.state::<State>().tabs.lock().is_ok_and(|tabs| {
        tabs.values().any(|tab| {
            tab.id == id
                && (tab.guarded.load(Ordering::Acquire)
                    || tab.network.lock().is_ok_and(|origin| origin.is_some()))
        })
    })
}

pub fn update_origin(app: &tauri::AppHandle, id: &str, url: &reqwest::Url) {
    let state = app.state::<State>();
    if let Ok(tabs) = state.tabs.lock() {
        for tab in tabs.values().filter(|tab| tab.id == id) {
            if let Ok(mut origin) = tab.origin.lock() {
                *origin = url.origin().ascii_serialization();
            }
            if let Ok(mut network) = tab.network.lock() {
                if network.is_some() || tab.guarded.load(Ordering::Acquire) {
                    *network = Some(url.origin().ascii_serialization());
                }
            }
        }
    };
}

pub fn loaded(app: &tauri::AppHandle, id: &str, ready: bool) {
    if let Ok(tabs) = app.state::<State>().tabs.lock() {
        for tab in tabs.values().filter(|tab| tab.id == id) {
            tab.ready.store(ready, Ordering::Release);
            if !ready {
                tab.generation.fetch_add(1, Ordering::AcqRel);
            }
        }
    };
}

pub fn install_guard(
    app: &tauri::AppHandle,
    id: &str,
    view: &tauri::Webview,
) -> Result<bool, String> {
    let tab = app
        .state::<State>()
        .tabs
        .lock()
        .map_err(|e| e.to_string())?
        .values()
        .find(|tab| tab.id == id)
        .cloned();
    if let Some(tab) = tab {
        if tab.network.lock().map_err(|e| e.to_string())?.is_some()
            && !tab.guarded.load(Ordering::Acquire)
        {
            crate::browser_network_guard::install(view, tab.network.clone())?;
            tab.guarded.store(true, Ordering::Release);
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn navigation(app: &tauri::AppHandle, id: &str, url: &reqwest::Url) -> Option<bool> {
    let state = app.state::<State>();
    if url.host_str() == Some(RESULT_HOST) {
        let nonce = url.path().trim_start_matches('/');
        if let Ok(mut pending) = state.pending.lock() {
            if pending.get(nonce).is_some_and(|(view, _)| view == id) {
                if let Some((_, sender)) = pending.remove(nonce) {
                    let value = url
                        .query_pairs()
                        .find(|(key, _)| key == "result")
                        .and_then(|(_, value)| {
                            (value.len() < 256_000)
                                .then(|| serde_json::from_str::<Value>(&value).ok())
                                .flatten()
                        })
                        .unwrap_or_else(|| json!({"error":"Invalid browser result"}));
                    let _ = sender.send(value);
                }
            }
        }
        return Some(false);
    }
    state.tabs.lock().ok().and_then(|tabs| {
        tabs.values()
            .find(|tab| {
                tab.id == id
                    && (tab.guarded.load(Ordering::Acquire)
                        || tab.network.lock().is_ok_and(|origin| origin.is_some()))
            })
            .map(|tab| {
                let permit = tab
                    .origin
                    .lock()
                    .is_ok_and(|origin| *origin == url.origin().ascii_serialization());
                if !permit {
                    if let Ok(mut blocked) = tab.blocked.lock() {
                        *blocked = Some(url.as_str().chars().take(8192).collect());
                    }
                }
                permit
            })
    })
}

pub fn title_result(app: &tauri::AppHandle, id: &str, title: &str) -> bool {
    let Some(result) = title.strip_prefix("ax-browser-result:") else {
        return false;
    };
    let Some((nonce, encoded)) = result.split_once(':') else {
        return true;
    };
    let state = app.state::<State>();
    if let Ok(mut pending) = state.pending.lock() {
        if pending.get(nonce).is_some_and(|(view, _)| view == id) {
            if let Some((_, sender)) = pending.remove(nonce) {
                let value =
                    reqwest::Url::parse(&format!("https://{RESULT_HOST}/?result={encoded}"))
                        .ok()
                        .and_then(|url| {
                            url.query_pairs()
                                .find(|(key, _)| key == "result")
                                .map(|(_, value)| value.into_owned())
                        })
                        .filter(|value| value.len() < 256_000)
                        .and_then(|value| serde_json::from_str::<Value>(&value).ok())
                        .unwrap_or_else(|| json!({"error":"Invalid browser result"}));
                let _ = sender.send(value);
            }
        }
    }
    true
}

pub fn popup_allowed(app: &tauri::AppHandle, id: &str, url: &reqwest::Url) -> bool {
    let state = app.state::<State>();
    if let Ok(tabs) = state.tabs.lock() {
        if let Some(tab) = tabs
            .values()
            .find(|tab| tab.id == id && tab.guarded.load(Ordering::Acquire))
        {
            if let Ok(mut blocked) = tab.blocked.lock() {
                *blocked = Some(url.as_str().chars().take(8192).collect());
            }
            return false;
        }
    }
    true
}

pub fn tabs(app: &tauri::AppHandle, scope: &str) -> Vec<Value> {
    app.state::<State>().tabs.lock().map(|tabs| tabs.values().filter(|tab| tab.scope == scope).filter_map(|tab| {
        let view = app.get_webview(&tab.id)?;
        Some(json!({"id":tab.id,"scope":tab.scope,"session":tab.name,"url":view.url().ok()?.as_str()}))
    }).collect()).unwrap_or_default()
}

fn dispatch(app: &tauri::AppHandle, request: Value) -> Result<Value, String> {
    let scope = request["scope"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 256)
        .ok_or("Invalid browser Session")?;
    let input = &request["input"];
    let action = input["action"].as_str().ok_or("Missing browser action")?;
    if action == "screenshot" {
        return Err("Embedded browser screenshots are unavailable; use snapshot or the desktop screenshot tool".into());
    }
    let name = input["session"].as_str().unwrap_or("main");
    if name.is_empty()
        || name.len() > 64
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid browser tab name".into());
    }
    if app.get_webview("main").is_none() {
        return Err("AXCrew window closed".into());
    }
    if action == "list_sessions" {
        return Ok(json!({"sessions":tabs(app, scope),"transport":"axcrew_builtin"}));
    }
    let state = app.state::<State>();
    let selected = if name == "main" {
        state
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .get(scope)
            .cloned()
            .unwrap_or_else(|| name.into())
    } else {
        name.into()
    };
    let name = selected.as_str();
    let key = (scope.to_owned(), name.to_owned());
    let mut tab = state
        .tabs
        .lock()
        .map_err(|e| e.to_string())?
        .get(&key)
        .cloned()
        .filter(|tab| app.get_webview(&tab.id).is_some());
    if action == "close" {
        if let Some(tab) = state.tabs.lock().map_err(|e| e.to_string())?.remove(&key) {
            if let Some(view) = app.get_webview(&tab.id) {
                view.close().map_err(|e| e.to_string())?;
            }
            let _ = app.emit_to(
                "main",
                "agent-browser-tab",
                json!({"id":tab.id,"scope":scope,"closed":true}),
            );
        }
        return Ok(json!({"status":"closed"}));
    }
    if action == "probe" {
        let tab = tab.ok_or("No built-in browser tab; open a URL first")?;
        return Ok(
            json!({"url":app.get_webview(&tab.id).ok_or("Browser view closed")?.url().map_err(|e| e.to_string())?.as_str()}),
        );
    }
    let authorized = request["origin"]
        .as_str()
        .ok_or("Missing authorized website origin")?;
    let origin = reqwest::Url::parse(authorized).map_err(|e| e.to_string())?;
    if !matches!(origin.scheme(), "http" | "https")
        || origin.origin().ascii_serialization() != authorized
        || !origin.username().is_empty()
        || origin.password().is_some()
    {
        return Err("Invalid authorized origin".into());
    }
    let mut network_lease = None;
    if matches!(action, "open" | "goto") {
        if tab.is_none() {
            let tabs = state.tabs.lock().map_err(|e| e.to_string())?;
            if tabs.len() >= 64 || tabs.values().filter(|tab| tab.scope == scope).count() >= 16 {
                return Err("Built-in browser tab limit reached; close unused tabs".into());
            }
        }
        let url = reqwest::Url::parse(input["url"].as_str().ok_or("Missing browser URL")?)
            .map_err(|e| e.to_string())?;
        let main = app.get_webview("main").ok_or("AXCrew window closed")?;
        let app_origin = main
            .url()
            .map_err(|e| e.to_string())?
            .origin()
            .ascii_serialization();
        if !crate::preview_browser::allowed(&url, &app_origin)
            || url.origin().ascii_serialization() != authorized
        {
            return Err("Browser URL differs from authorized origin".into());
        }
        let item = tab.get_or_insert_with(|| Tab {
            id: format!("preview-agent-{}", uuid::Uuid::new_v4().simple()),
            scope: scope.into(),
            name: name.into(),
            origin: Arc::new(Mutex::new(authorized.into())),
            blocked: Arc::default(),
            network: Arc::new(Mutex::new(Some(authorized.into()))),
            guarded: Arc::default(),
            ready: Arc::default(),
            generation: Arc::default(),
        });
        *item.origin.lock().map_err(|e| e.to_string())? = authorized.into();
        *item.network.lock().map_err(|e| e.to_string())? = Some(authorized.into());
        network_lease = Some(NetworkLease(item.network.clone()));
        state
            .tabs
            .lock()
            .map_err(|e| e.to_string())?
            .insert(key.clone(), item.clone());
        crate::preview_browser::open_view(main, app.clone(), &item.id, url)?;
        let _ = app.emit_to(
            "main",
            "agent-browser-tab",
            json!({"id":item.id,"scope":scope,"url":input["url"]}),
        );
    }
    let tab = tab.ok_or("No built-in browser tab; open a URL first")?;
    let view = app.get_webview(&tab.id).ok_or("Browser view closed")?;
    if network_lease.is_none() {
        *tab.network.lock().map_err(|e| e.to_string())? = Some(authorized.into());
        network_lease = Some(NetworkLease(tab.network.clone()));
    }
    if !tab.guarded.load(Ordering::Acquire) {
        *tab.network.lock().map_err(|e| e.to_string())? = Some(authorized.into());
        install_guard(app, &tab.id, &view)?;
        tab.ready.store(false, Ordering::Release);
        view.reload().map_err(|e| e.to_string())?;
        let _ = app.emit_to(
            "main",
            "agent-browser-tab",
            json!({"id":tab.id,"scope":scope,"url":view.url().map_err(|e|e.to_string())?.as_str()}),
        );
        if matches!(action, "click" | "fill" | "type" | "press") {
            return Err("Attached the existing built-in tab with network protection and reloaded it; call snapshot before interacting".into());
        }
    }
    let _active_network_lease = network_lease;
    if matches!(
        action,
        "open" | "goto" | "click" | "press" | "go_back" | "go_forward" | "reload"
    ) {
        *tab.blocked.lock().map_err(|e| e.to_string())? = None;
    }
    let current = view.url().map_err(|e| e.to_string())?;
    if current.origin().ascii_serialization() != authorized && !matches!(action, "open" | "goto") {
        return Err("Browser origin changed; request access again".into());
    }
    if matches!(action, "go_back" | "go_forward" | "reload") {
        tab.ready.store(false, Ordering::Release);
        view.eval(match action {
            "go_back" => "history.back()",
            "go_forward" => "history.forward()",
            _ => "location.reload()",
        })
        .map_err(|e| e.to_string())?;
    }
    if !matches!(
        action,
        "open"
            | "goto"
            | "snapshot"
            | "click"
            | "fill"
            | "type"
            | "press"
            | "go_back"
            | "go_forward"
            | "reload"
    ) {
        return Err("Unsupported embedded browser action".into());
    }
    for _ in 0..100 {
        if tab.ready.load(Ordering::Acquire) {
            break;
        }
        if app.get_webview(&tab.id).is_none() {
            return Err("Browser view closed".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if !tab.ready.load(Ordering::Acquire) {
        return Err("Built-in browser document is still loading; retry snapshot".into());
    }
    // Wait for a navigated document, then evaluate only our fixed DOM operations.
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let (sender, receiver) = mpsc::sync_channel(1);
    state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .insert(nonce.clone(), (tab.id.clone(), sender));
    let script = format!(
        "{}({}, {}, {});",
        include_str!("agent_browser.js"),
        input,
        json!(authorized),
        json!(format!("ax-browser-result:{nonce}:"))
    );
    let generation = tab.generation.load(Ordering::Acquire);
    let result = (|| {
        // Navigation can replace a document while eval is in flight. Retry only
        // read operations, never repeat click/fill/press after uncertain effects.
        let read_only = matches!(
            action,
            "open" | "goto" | "snapshot" | "reload" | "go_back" | "go_forward"
        );
        for _ in 0..if read_only { 3 } else { 1 } {
            view.eval(&script).map_err(|e| e.to_string())?;
            match receiver.recv_timeout(Duration::from_secs(3)) {
                Ok(mut value) => {
                    if value["navigation_expected"] == true {
                        for _ in 0..100 {
                            if tab.generation.load(Ordering::Acquire) > generation && tab.ready.load(Ordering::Acquire) { break; }
                            if tab.blocked.lock().map_err(|e|e.to_string())?.is_some() { break; }
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        if (tab.generation.load(Ordering::Acquire) <= generation || !tab.ready.load(Ordering::Acquire))
                            && tab.blocked.lock().map_err(|e|e.to_string())?.is_none() {
                            return Err("Browser navigation did not finish; call snapshot before retrying the action".into());
                        }
                        value["url"] = json!(view.url().map_err(|e|e.to_string())?.as_str());
                        value["snapshot_pending"] = json!(true);
                        if let Some(object) = value.as_object_mut() { object.remove("snapshot"); object.remove("targets"); }
                    }
                    if value["status"] == "navigation_blocked" {
                        if let Some(url) = value["blocked_url"].as_str() { *tab.blocked.lock().map_err(|e| e.to_string())? = Some(url.to_owned()); }
                    }
                    if let Some(blocked) = tab.blocked.lock().map_err(|e| e.to_string())?.as_ref() {
                        value["status"] = json!("navigation_blocked");
                        value["blocked_url"] = json!(blocked);
                        value["reason"] = json!("Call goto with this URL to request authorization for its origin");
                    }
                    return Ok(value);
                }
                Err(mpsc::RecvTimeoutError::Timeout) if read_only && app.get_webview(&tab.id).is_some() => (),
                _ => return Err("Built-in browser operation timed out or tab closed; inspect page before retrying".into()),
            }
        }
        Err("Built-in browser document did not respond".into())
    })();
    state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&nonce);
    result
}
