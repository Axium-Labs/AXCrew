//! `/api/automations`: scheduled conversations.
//!
//! Validation runs through `crate::orchestration::scheduler::validate_automation`
//! and running one delegates to the scheduler, which owns the schedule cursor.

use crate::{
    app::App,
    domain::automation::{Automation, NewAutomation},
    error::Api,
    orchestration::scheduler::validate_automation,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};

pub async fn automations(State(app): State<App>, headers: HeaderMap) -> Api<Vec<Automation>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.automations()?))
}

pub async fn create_automation(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<NewAutomation>,
) -> Api<Automation> {
    app.authorize(&headers)?;
    validate_automation(&app.db, &body)?;
    Ok(Json(app.db.create_automation(body)?))
}

pub async fn update_automation(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<NewAutomation>,
) -> Api<Automation> {
    app.authorize(&headers)?;
    validate_automation(&app.db, &body)?;
    Ok(Json(app.db.update_automation(&id, body)?))
}

pub async fn delete_automation(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.db.delete_automation(&id)?;
    Ok(Json(json!({"deleted":true})))
}

/// Manual "run now": launches without moving the schedule forward.
pub async fn run_automation(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<crate::domain::task::Task> {
    app.authorize(&headers)?;
    Ok(Json(app.scheduler.launch(&id, false)?))
}

#[derive(Deserialize)]
pub struct ToggleRequest {
    enabled: bool,
}

pub async fn toggle_automation(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ToggleRequest>,
) -> Api<Automation> {
    app.authorize(&headers)?;
    Ok(Json(app.db.set_automation_enabled(&id, body.enabled)?))
}

#[derive(Deserialize)]
pub struct RunQuery {
    limit: Option<i64>,
}

pub async fn automation_runs(
    State(app): State<App>,
    headers: HeaderMap,
    Query(query): Query<RunQuery>,
) -> Api<Vec<Value>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.automation_runs(query.limit.unwrap_or(100))?))
}
