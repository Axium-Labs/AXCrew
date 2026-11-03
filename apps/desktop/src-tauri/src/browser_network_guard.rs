//! Native request boundary for an Agent-owned WebView. Install before navigation.
//! A never-bound preview has no guard. An installed guard with no active origin
//! denies network traffic, including background requests after a tool returns.
use std::sync::{Arc, Mutex};

pub type Origin = Arc<Mutex<Option<String>>>;

fn permitted(origin: &Origin, request: &str) -> bool {
    let Ok(origin) = origin.lock() else {
        return false;
    };
    let Some(origin) = origin.as_deref() else {
        return false;
    };
    let Ok(url) = reqwest::Url::parse(request) else {
        return false;
    };
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.origin().ascii_serialization() == origin
}

#[cfg(not(windows))]
pub fn install(_: &tauri::Webview, origin: Origin) -> Result<(), String> {
    if origin
        .lock()
        .map_err(|_| "Browser origin unavailable")?
        .is_none()
    {
        return Ok(());
    }
    Err("Built-in Agent browser network isolation is unavailable on this platform".into())
}

/// Must be called off the UI thread: WebView2 installs callbacks on its UI thread
/// and acknowledges DevTools configuration asynchronously before we return.
#[cfg(windows)]
pub fn install(view: &tauri::Webview, origin: Origin) -> Result<(), String> {
    if origin
        .lock()
        .map_err(|_| "Browser origin unavailable")?
        .is_none()
    {
        return Ok(());
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    view.with_webview(move |platform| {
        let result = windows_guard::install(platform, origin, sender.clone());
        if let Err(error) = result {
            let _ = sender.send(Err(error.to_string()));
        }
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| {
            "Built-in browser network guard did not initialize; no navigation allowed".to_string()
        })?
}

#[cfg(windows)]
mod windows_guard {
    use super::{permitted, Origin};
    use base64::Engine;
    use serde_json::{json, Value};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::SyncSender,
        Arc,
    };
    use webview2_com::{
        take_pwstr, CallDevToolsProtocolMethodCompletedHandler,
        DevToolsProtocolEventReceivedEventHandler,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2, ICoreWebView2_22, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
        },
        WebResourceRequestedEventHandler,
    };
    use windows::core::{w, Interface, HSTRING, PWSTR};

    fn protocol_reply_ok(reply: &str) -> bool {
        serde_json::from_str::<Value>(reply)
            .is_ok_and(|reply| reply.is_object() && reply.get("error").is_none())
    }

    pub(super) fn install(
        platform: tauri::webview::PlatformWebview,
        origin: Origin,
        sender: SyncSender<Result<(), String>>,
    ) -> windows::core::Result<()> {
        // Every COM object and callback is created/used on the WebView UI thread.
        unsafe {
            let core = platform.controller().CoreWebView2()?;
            let environment = platform.environment();
            let receiver = core.GetDevToolsProtocolEventReceiver(w!("Fetch.requestPaused"))?;
            let receiver_lifetime = receiver.clone();
            let healthy = Arc::new(AtomicBool::new(true));
            let guard = core.cast::<ICoreWebView2_22>()?;
            // Include dedicated/shared/service workers, not just document requests.
            guard.AddWebResourceRequestedFilterWithRequestSourceKinds(
                w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )?;
            let denied = environment.CreateWebResourceResponse(
                None,
                403,
                w!("Blocked by AXCrew browser permissions"),
                w!("Content-Length: 0\r\nCache-Control: no-store\r\n"),
            )?;
            let native_origin = origin.clone();
            let native_health = healthy.clone();
            let emergency_stop = core.clone();
            let mut token = 0;
            core.add_WebResourceRequested(
                &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    // Keep the DevTools event source alive for this WebView;
                    // dropping the local receiver can disable Fetch callbacks.
                    let _receiver_lifetime = &receiver_lifetime;
                    let Some(args) = args else { return Ok(()) };
                    let mut uri = PWSTR::null();
                    let result = args.Request().and_then(|request| request.Uri(&mut uri));
                    let uri = take_pwstr(uri);
                    let allowed = native_health.load(Ordering::Acquire)
                        && result.is_ok()
                        && permitted(&native_origin, &uri);
                    if !allowed {
                        if let Err(error) = args.SetResponse(&denied) {
                            native_health.store(false, Ordering::Release);
                            let _ = emergency_stop.Stop();
                            return Err(error);
                        }
                    }
                    Ok(())
                })),
                &mut token,
            )?;

            // Fetch pauses each request, including every HTTP redirect hop,
            // before it is sent. It complements the native worker-aware filter.
            let fetch_core = core.clone();
            let fetch_health = healthy.clone();
            receiver.add_DevToolsProtocolEventReceived(
                &DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut json = PWSTR::null();
                    let result = args.ParameterObjectAsJson(&mut json);
                    let json = take_pwstr(json);
                    if result.is_err() {
                        fetch_health.store(false, Ordering::Release);
                        let _ = fetch_core.Stop();
                        return result;
                    }
                    let value: Value = match serde_json::from_str(&json) {
                        Ok(value) => value,
                        Err(_) => { fetch_health.store(false, Ordering::Release); let _ = fetch_core.Stop(); return Ok(()) },
                    };
                    let Some(id) = value["requestId"].as_str() else {
                        fetch_health.store(false, Ordering::Release); let _ = fetch_core.Stop(); return Ok(())
                    };
                    let allowed = fetch_health.load(Ordering::Acquire)
                        && value.pointer("/request/url").and_then(Value::as_str).is_some_and(|url| permitted(&origin, url));
                    let (method, params) = if allowed && value.get("responseStatusCode").is_some() {
                        if value["resourceType"] == "Document" && !value["responseStatusCode"].as_u64().is_some_and(|code| (300..400).contains(&code)) {
                            // Network.setBlockedURLs does not stop WebSocket handshakes
                            // in WebView2. An additional response CSP is enforced by the
                            // renderer before page scripts, including nested documents.
                            // An explicit HTTP(S) connect source does not authorize WS(S).
                            let mut headers = value["responseHeaders"].as_array().cloned().unwrap_or_default();
                            let active = origin.lock().ok().and_then(|value| value.clone()).unwrap_or_default();
                            headers.push(json!({"name":"Content-Security-Policy", "value":format!("connect-src {active}; worker-src 'none'; object-src 'none'")}));
                            return fulfill_document(fetch_core.clone(), fetch_health.clone(), id.to_owned(), value["responseStatusCode"].clone(), headers);
                        } else {
                            ("Fetch.continueResponse", json!({"requestId":id}))
                        }
                    } else if allowed {
                        ("Fetch.continueRequest", json!({"requestId":id,"interceptResponse":true}))
                    } else {
                        ("Fetch.failRequest", json!({"requestId":id,"errorReason":"BlockedByClient"}))
                    };
                    let health = fetch_health.clone();
                    let result = fetch_core.CallDevToolsProtocolMethod(
                        &HSTRING::from(method), &HSTRING::from(params.to_string()),
                        &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, reply| {
                            if result.is_err() || !protocol_reply_ok(&reply) { health.store(false, Ordering::Release); }
                            Ok(())
                        })),
                    );
                    if result.is_err() {
                        fetch_health.store(false, Ordering::Release);
                        let _ = fetch_core.Stop();
                    }
                    result
                })), &mut token,
            )?;
            configure(core, healthy, sender, 0)
        }
    }

    /// WebView2 can acknowledge continueResponse without applying changed
    /// headers. Fulfill a paused document using its browser-fetched body, so
    /// the added CSP is part of the renderer's actual response. Browser cookies
    /// and authentication are preserved; no separate HTTP client is involved.
    unsafe fn fulfill_document(
        core: ICoreWebView2,
        healthy: Arc<AtomicBool>,
        id: String,
        status: Value,
        mut headers: Vec<Value>,
    ) -> windows::core::Result<()> {
        let immediate_health = healthy.clone();
        let next_core = core.clone();
        let result = core.CallDevToolsProtocolMethod(
            w!("Fetch.getResponseBody"),
            &HSTRING::from(json!({"requestId":id}).to_string()),
            &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, reply| {
                let value = serde_json::from_str::<Value>(&reply).unwrap_or(Value::Null);
                let body = value["body"].as_str();
                if result.is_err() || value.get("error").is_some() || body.is_none_or(|body| body.len() > 16 * 1024 * 1024) {
                    healthy.store(false, Ordering::Release);
                    let _ = next_core.Stop();
                    return Ok(());
                }
                let body = body.unwrap_or_default();
                let encoded = if value["base64Encoded"] == true { body.to_owned() }
                    else { base64::engine::general_purpose::STANDARD.encode(body.as_bytes()) };
                headers.retain(|header| header["name"].as_str().is_some_and(|name| !["content-length", "content-encoding", "transfer-encoding"].iter().any(|blocked| name.eq_ignore_ascii_case(blocked))));
                let health = healthy.clone();
                let stop_core = next_core.clone();
                let result = next_core.CallDevToolsProtocolMethod(
                    w!("Fetch.fulfillRequest"),
                    &HSTRING::from(json!({"requestId":id,"responseCode":status,"responseHeaders":headers,"body":encoded}).to_string()),
                    &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, reply| {
                        let failed = result.is_err() || !protocol_reply_ok(&reply);
                        if failed { health.store(false, Ordering::Release); let _ = stop_core.Stop(); }
                        Ok(())
                    })),
                );
                if result.is_err() { healthy.store(false, Ordering::Release); let _ = next_core.Stop(); }
                result
            })),
        );
        if result.is_err() {
            immediate_health.store(false, Ordering::Release);
            let _ = core.Stop();
        }
        result
    }

    unsafe fn configure(
        core: ICoreWebView2,
        healthy: Arc<AtomicBool>,
        sender: SyncSender<Result<(), String>>,
        step: usize,
    ) -> windows::core::Result<()> {
        // Network blocking supplements the response CSP: WebView2 does not
        // reliably intercept WebSockets with Fetch or WebResourceRequested.
        let commands = [
            ("Network.enable", "{}"),
            ("Network.setBlockedURLs", r#"{"urls":["ws://*","wss://*"]}"#),
            ("Network.setCacheDisabled", r#"{"cacheDisabled":true}"#),
            ("Network.setBypassServiceWorker", r#"{"bypass":true}"#),
            (
                "Fetch.enable",
                r#"{"patterns":[{"urlPattern":"*","requestStage":"Request"}]}"#,
            ),
        ];
        let (method, params) = commands[step];
        let next_core = core.clone();
        core.CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(params),
            &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, reply| {
                if let Err(error) = result {
                    healthy.store(false, Ordering::Release);
                    let _ = next_core.Stop();
                    let _ = sender.send(Err(format!("Browser network isolation failed: {error}")));
                } else if !protocol_reply_ok(&reply) {
                    healthy.store(false, Ordering::Release);
                    let _ = next_core.Stop();
                    let _ = sender.send(Err(
                        "Browser network isolation returned an invalid protocol reply".into(),
                    ));
                } else if step + 1 == commands.len() {
                    let _ = sender.send(Ok(()));
                } else if let Err(error) =
                    configure(next_core.clone(), healthy.clone(), sender.clone(), step + 1)
                {
                    healthy.store(false, Ordering::Release);
                    let _ = next_core.Stop();
                    let _ = sender.send(Err(error.to_string()));
                }
                Ok(())
            })),
        )
    }
}
