//! A top-level child webview: remote pages never receive app capabilities.
use tauri::{
    webview::WebviewBuilder, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
};

pub(crate) fn allowed(url: &reqwest::Url, origin: &str) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && !matches!(url.host_str(), Some("tauri.localhost" | "asset.localhost"))
        && url.origin().ascii_serialization() != origin
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    viewport_width: f64,
    viewport_height: f64,
}

// Async is required by WebView2 when adding a child view on Windows.
#[tauri::command]
pub async fn preview_browser(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    action: String,
    url: Option<String>,
    bounds: Option<Bounds>,
    scope: Option<String>,
) -> Result<Option<String>, String> {
    if caller.label() != "main" || !id.starts_with("preview-") || id.len() > 80 {
        return Err("Invalid browser caller".into());
    }
    if action == "agent_tabs" {
        return Ok(Some(
            serde_json::to_string(&crate::agent_browser::tabs(
                &app,
                scope.as_deref().unwrap_or_default(),
            ))
            .map_err(|e| e.to_string())?,
        ));
    }
    if action == "bind" {
        // open_view installs a child at about:blank before its asynchronous
        // navigation commits. The serialized frontend open -> bind sequence
        // must not lose this Session binding during that short transition.
        for _ in 0..50 {
            let view = app.get_webview(&id).ok_or("Browser view closed")?;
            if view.url().map_err(|e| e.to_string())?.as_str() != "about:blank" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        crate::agent_browser::bind(
            &app,
            scope.as_deref().ok_or("Missing browser Session")?,
            &id,
        )?;
        return Ok(None);
    }
    // The native registry is authoritative: React may unmount before its
    // asynchronous Agent-adoption event arrives. Ordinary scoped user previews
    // must still close, while an in-flight/controlled Agent page stays alive.
    if action == "release" && !crate::agent_browser::is_controlled(&app, &id) {
        if let Some(view) = app.get_webview(&id) {
            view.close().map_err(|e| e.to_string())?;
        }
        crate::agent_browser::closed(&app, &id);
        return Ok(None);
    }
    let origin = caller
        .url()
        .map_err(|e| e.to_string())?
        .origin()
        .ascii_serialization();
    if action == "open" {
        let url =
            reqwest::Url::parse(url.as_deref().unwrap_or_default()).map_err(|e| e.to_string())?;
        if !allowed(&url, &origin) {
            return Err("Invalid browser URL".into());
        }
        open_view(caller.clone(), app.clone(), &id, url)?;
    }

    if let Some(view) = app.get_webview(&id) {
        match action.as_str() {
            "close" => {
                view.close().map_err(|e| e.to_string())?;
                crate::agent_browser::closed(&app, &id);
                return Ok(None);
            }
            "reload" => view.reload().map_err(|e| e.to_string())?,
            "hide" | "release" => view.hide().map_err(|e| e.to_string())?,
            "back" => view.eval("history.back()").map_err(|e| e.to_string())?,
            "forward" => view.eval("history.forward()").map_err(|e| e.to_string())?,
            "bounds" => {
                if let Some(b) = bounds {
                    if ![
                        b.x,
                        b.y,
                        b.width,
                        b.height,
                        b.viewport_width,
                        b.viewport_height,
                    ]
                    .iter()
                    .all(|v| v.is_finite())
                        || b.viewport_width <= 0.0
                        || b.viewport_height <= 0.0
                    {
                        return Err("Invalid browser bounds".into());
                    }
                    if b.visible && b.width > 1.0 && b.height > 1.0 {
                        // DOM rectangles are CSS pixels, not native logical pixels. Derive
                        // the physical ratio from the caller's viewport, covering Windows
                        // display scaling and WebView zoom without double-applying DPI.
                        let size = caller.size().map_err(|e| e.to_string())?;
                        let position = caller.position().map_err(|e| e.to_string())?;
                        let scale_x = f64::from(size.width) / b.viewport_width;
                        let scale_y = f64::from(size.height) / b.viewport_height;
                        let left = b.x.clamp(0.0, b.viewport_width);
                        let top = b.y.clamp(0.0, b.viewport_height);
                        let right = (b.x + b.width).clamp(left, b.viewport_width);
                        let bottom = (b.y + b.height).clamp(top, b.viewport_height);
                        view.set_bounds(tauri::Rect {
                            position: PhysicalPosition::new(
                                position.x + (left * scale_x).round() as i32,
                                position.y + (top * scale_y).round() as i32,
                            )
                            .into(),
                            size: PhysicalSize::new(
                                ((right - left) * scale_x).round() as u32,
                                ((bottom - top) * scale_y).round() as u32,
                            )
                            .into(),
                        })
                        .map_err(|e| e.to_string())?;
                        view.show().map_err(|e| e.to_string())?;
                    } else {
                        view.hide().map_err(|e| e.to_string())?;
                    }
                }
            }
            "open" | "state" => (),
            _ => return Err("Invalid browser action".into()),
        }
        return view
            .url()
            .map(|url| Some(url.to_string()))
            .map_err(|e| e.to_string());
    }
    Ok(None)
}

pub(crate) fn open_view(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    id: &str,
    url: reqwest::Url,
) -> Result<(), String> {
    let origin = caller
        .url()
        .map_err(|e| e.to_string())?
        .origin()
        .ascii_serialization();
    if let Some(view) = app.get_webview(id) {
        crate::agent_browser::update_origin(&app, id, &url);
        let installed = crate::agent_browser::install_guard(&app, id, &view)?;
        if view.url().ok().as_ref() != Some(&url) {
            crate::agent_browser::loaded(&app, id, false);
            view.navigate(url).map_err(|e| e.to_string())?;
        } else if installed {
            crate::agent_browser::loaded(&app, id, false);
            view.reload().map_err(|e| e.to_string())?;
        }
    } else {
        let navigation_app = app.clone();
        let navigation_id = id.to_owned();
        let popup_app = app.clone();
        let popup_guard_app = app.clone();
        let popup_guard_id = id.to_owned();
        let popup_id = id.to_owned();
        let popup_origin = origin.clone();
        let title_app = app.clone();
        let title_id = id.to_owned();
        let load_app = app.clone();
        let load_id = id.to_owned();
        let builder = WebviewBuilder::new(
            id,
            WebviewUrl::External(reqwest::Url::parse("about:blank").map_err(|e| e.to_string())?),
        )
        .focused(false)
        .on_navigation(move |url| {
            crate::agent_browser::navigation(&navigation_app, &navigation_id, url).map_or_else(
                || allowed(url, &origin),
                |permit| permit && allowed(url, &origin),
            )
        })
        .on_download(|_, _| false)
        .on_page_load(move |_, payload| {
            crate::agent_browser::loaded(
                &load_app,
                &load_id,
                matches!(payload.event(), tauri::webview::PageLoadEvent::Finished),
            )
        })
        .on_document_title_changed(move |_, title| {
            if crate::agent_browser::title_result(&title_app, &title_id, &title) {
                return;
            }
            let _ = title_app.emit_to(
                "main",
                "preview-browser-title",
                serde_json::json!({"id": title_id, "title": title}),
            );
        })
        .on_new_window(move |url, _| {
            // A website's new-window link becomes a separate browser tab.
            if allowed(&url, &popup_origin)
                && crate::agent_browser::popup_allowed(&popup_guard_app, &popup_guard_id, &url)
            {
                let _ = popup_app.emit_to(
                    "main",
                    "preview-browser-new-tab",
                    serde_json::json!({"source": popup_id, "url": url.as_str()}),
                );
            }
            tauri::webview::NewWindowResponse::Deny
        });
        let view = caller
            .window()
            .add_child(
                builder,
                PhysicalPosition::new(0, 0),
                PhysicalSize::new(1, 1),
            )
            .map_err(|e| e.to_string())?;
        view.hide().map_err(|e| e.to_string())?;
        view.set_auto_resize(false).map_err(|e| e.to_string())?;
        if let Err(error) = crate::agent_browser::install_guard(&app, id, &view) {
            let _ = view.close();
            return Err(error);
        }
        crate::agent_browser::loaded(&app, id, false);
        view.navigate(url).map_err(|e| e.to_string())?;
    }
    Ok(())
}
