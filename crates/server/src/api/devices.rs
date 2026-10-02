//! `/api/devices`: paired AX runtimes, their capability catalogue and revocation.

use crate::{
    app::App,
    domain::device::Device,
    error::{Api, ApiError},
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
pub struct CapabilityQuery {
    cwd: Option<String>,
}

pub async fn devices(State(app): State<App>, headers: HeaderMap) -> Api<Vec<Device>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.devices()?))
}

pub async fn device(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Option<Device>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.device(&id)?))
}

/// Reads the read-only AX catalogues (models, skills, MCP servers, capabilities)
/// through a one-shot ACP request on the selected device.
pub async fn device_capabilities(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<CapabilityQuery>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.db
        .device(&id)?
        .ok_or_else(|| ApiError(anyhow::anyhow!("device not found")))?;
    let cwd = query.cwd.unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    let mut catalog = serde_json::Map::new();
    for (key, method) in [
        ("models", "_ax/models"),
        ("skills", "_ax/skills"),
        ("mcp", "_ax/mcp"),
        ("capabilities", "_ax/capabilities"),
    ] {
        catalog.insert(
            key.into(),
            app.router
                .inspect(&id, &cwd, None, None, method, json!({}))
                .await?
                .result,
        );
    }
    Ok(Json(Value::Object(catalog)))
}

#[derive(Deserialize)]
pub struct Rename {
    name: String,
}

pub async fn rename_device(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Rename>,
) -> Api<Option<Device>> {
    app.authorize(&headers)?;
    app.db.rename_device(&id, &body.name)?;
    Ok(Json(app.db.device(&id)?))
}

/// Revocation is a three-step business action: fail the device's active tasks,
/// remove its authorisation row and drop its live socket.
pub async fn revoke_device(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.scheduler.revoke_device(&id)?;
    app.db.revoke_device(&id)?;
    app.gateway.revoke(&id);
    Ok(Json(json!({"revoked":true})))
}
