//! `/api/tokens`: extra bearer tokens for the desktop and browser clients.
//!
//! Tokens are independent of the fixed `AX_CREW_ADMIN_TOKEN` and are persisted
//! next to the database, so a long-lived or permanent token survives a restart.

use crate::{app::App, auth::TokenRecord, error::Api};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
pub struct CreateTokenRequest {
    /// 有效期（秒）。省略或 0 / null = 永久。
    ttl_seconds: Option<u64>,
    label: Option<String>,
}

pub async fn create_token(
    State(app): State<App>,
    headers: HeaderMap,
    body: Option<Json<CreateTokenRequest>>,
) -> Api<Value> {
    app.authorize(&headers)?;
    let request = body.map(|Json(value)| value).unwrap_or(CreateTokenRequest {
        ttl_seconds: None,
        label: None,
    });
    let ttl = request.ttl_seconds.filter(|seconds| *seconds > 0);
    let now = crate::domain::unix_now() as u64;
    let value = uuid::Uuid::new_v4().simple().to_string();
    let record = TokenRecord {
        value: value.clone(),
        label: request.label.filter(|label| !label.trim().is_empty()),
        expires_at: ttl.map(|seconds| now + seconds),
        created_at: now,
    };
    {
        let mut store = app
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        store.records.push(record.clone());
        store.prune();
    }
    app.persist_tokens()?;
    Ok(Json(json!({
        "token": value,
        "label": record.label,
        "expires_at": record.expires_at,
        "created_at": record.created_at,
    })))
}

pub async fn list_tokens(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    app.authorize(&headers)?;
    let store = app
        .tokens
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(Json(json!({ "tokens": store.records })))
}

pub async fn revoke_token(
    State(app): State<App>,
    headers: HeaderMap,
    Path(value): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    {
        let mut store = app
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        store.records.retain(|record| record.value != value);
    }
    app.persist_tokens()?;
    Ok(Json(json!({ "revoked": value })))
}
