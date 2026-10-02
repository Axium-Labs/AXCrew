//! Service metadata and shared desktop/phone settings.

use crate::{app::App, error::Api};
use axum::{Json, extract::State, http::HeaderMap};
use serde::Deserialize;
use serde_json::{Value, json};

/// Unauthenticated liveness probe; the clients use it to find the gateway.
pub async fn health() -> Json<Value> {
    Json(json!({"status":"ok","version":env!("CARGO_PKG_VERSION")}))
}

/// The authenticated handshake: what version is running, which workspace new
/// conversations default to, and which optional features this build supports.
pub async fn settings(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    app.authorize(&headers)?;
    Ok(Json(
        json!({"version":env!("CARGO_PKG_VERSION"),"default_cwd":app.db.default_session_member()?.map(|member| member.cwd).unwrap_or_else(|| std::env::current_dir().unwrap_or_default().to_string_lossy().into_owned()),"protocol_version":1,"session_files":true}),
    ))
}

#[derive(Deserialize)]
pub struct XfyBody {
    appid: String,
    api_key: String,
    api_secret: String,
}

/// 讯飞语音识别配置：手机端读取（用于按住说话 / 语音通话识别）。
pub async fn xfy_get(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    app.authorize(&headers)?;
    Ok(Json(
        app.db
            .xfy_config()?
            .unwrap_or_else(|| json!({"configured": false})),
    ))
}

/// 桌面端保存讯飞语音识别密钥。
pub async fn xfy_set(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<XfyBody>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.db
        .set_xfy_config(&body.appid, &body.api_key, &body.api_secret)?;
    Ok(Json(json!({"configured": true})))
}
