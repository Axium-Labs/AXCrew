//! `/api/permissions`: the tool-approval inbox.
//!
//! The pending requests live in `crate::orchestration::approval`, not in the
//! database — an unanswered request is denied when it times out.

use crate::{app::App, error::Api};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
pub struct PermissionChoice {
    option_id: String,
}

pub async fn resolve_permission(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PermissionChoice>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.approvals.resolve(&id, &body.option_id)?;
    Ok(Json(json!({"resolved":true})))
}

pub async fn pending_permissions(State(app): State<App>, headers: HeaderMap) -> Api<Vec<Value>> {
    app.authorize(&headers)?;
    Ok(Json(app.approvals.pending()))
}
