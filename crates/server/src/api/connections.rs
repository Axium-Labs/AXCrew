//! Connections/projects REST boundary; execution and workspace validation live in orchestration.
use crate::{
    app::App,
    domain::connections::{NewProject, Project, SshConnection},
    error::{Api, ApiError},
    orchestration::connections as service,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
pub struct ModelChoice {
    provider: String,
    model: String,
}
pub async fn select_model(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ModelChoice>,
) -> Api<crate::domain::crew::Member> {
    app.authorize(&headers)?;
    Ok(Json(service::select_model(
        &app,
        &id,
        &body.provider,
        &body.model,
    )?))
}

pub async fn ssh(State(app): State<App>, headers: HeaderMap) -> Api<Vec<SshConnection>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.ssh_connections()?))
}
pub async fn discover(State(app): State<App>, headers: HeaderMap) -> Api<Vec<SshConnection>> {
    app.authorize(&headers)?;
    Ok(Json(service::discover_ssh()))
}
pub async fn add_ssh(
    State(app): State<App>,
    headers: HeaderMap,
    Json(mut body): Json<SshConnection>,
) -> Api<SshConnection> {
    app.authorize(&headers)?;
    body.host = body.host.trim().into();
    body.name = body.name.trim().into();
    service::validate_ssh(&body)?;
    body.id = format!("ssh:{}", uuid::Uuid::new_v4());
    app.db.save_ssh(&body)?;
    Ok(Json(body))
}
pub async fn connect(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    Ok(Json(service::connect(&app, &id).await?))
}
#[derive(Deserialize)]
pub struct WorkspaceQuery {
    cwd: Option<String>,
}
pub async fn workspace(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<WorkspaceQuery>,
) -> Api<Value> {
    app.authorize(&headers)?;
    Ok(Json(
        service::workspace(&app, &id, query.cwd.as_deref()).await?,
    ))
}
pub async fn projects(State(app): State<App>, headers: HeaderMap) -> Api<Vec<Project>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.projects()?))
}
pub async fn create_project(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<NewProject>,
) -> Api<Project> {
    app.authorize(&headers)?;
    Ok(Json(service::create_project(&app, body).await?))
}
pub async fn remove_project(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.db.remove_project(&id).map_err(ApiError)?;
    Ok(Json(json!({"removed":true})))
}
