//! Additive distributed REST boundary. Worker credentials never authorize legacy/admin APIs.
use crate::{
    app::App, auth::header_bearer, domain::distributed::*, error::Api,
    orchestration::distributed as service,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};

fn check(condition: bool, message: &str) -> anyhow::Result<()> {
    anyhow::ensure!(condition, "{message}");
    Ok(())
}

fn worker(app: &App, headers: &HeaderMap) -> anyhow::Result<String> {
    service::authenticate(&app.db, &header_bearer(headers).unwrap_or_default())
}
fn actor(app: &App, headers: &HeaderMap) -> anyhow::Result<String> {
    if let Ok(id) = worker(app, headers) {
        return Ok(id);
    }
    app.authorize(headers).map_err(|e| e.0)?;
    Ok("admin".into())
}
pub async fn state(State(app): State<App>, headers: HeaderMap) -> Api<Cluster> {
    let actor = actor(&app, &headers)?;
    let mut state = app.db.cluster_read()?.public();
    state.server_time = crate::domain::unix_now();
    if actor != "admin" {
        let projects = state.instances[&actor].projects.clone();
        state
            .tasks
            .retain(|_, t| projects.contains(&t.spec.project_id));
        state
            .artifacts
            .retain(|_, a| projects.contains(&a.project_id));
        state.events.retain(|e| {
            e.task_id
                .as_ref()
                .is_some_and(|id| state.tasks.contains_key(id))
        });
        state
            .workflows
            .retain(|_, w| projects.contains(&w.project_id));
    }
    Ok(Json(state))
}
fn project_access(state: &Cluster, actor: &str, project: &str) -> anyhow::Result<()> {
    check(
        actor == "admin"
            || state
                .instances
                .get(actor)
                .is_some_and(|i| i.projects.iter().any(|p| p == project)),
        "project policy denied",
    )
}
#[derive(Deserialize, Default)]
pub struct Cursor {
    #[serde(default)]
    after_sequence: u64,
    limit: Option<usize>,
}
pub async fn catalog(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    actor(&app, &headers)?;
    let state = app.db.cluster_read()?.public();
    Ok(Json(
        json!({"revision":state.revision,"server_time":crate::domain::unix_now(),"hosts":state.hosts,"instances":state.instances}),
    ))
}
pub async fn task(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(cursor): Query<Cursor>,
) -> Api<Value> {
    let actor = actor(&app, &headers)?;
    let state = app.db.cluster_read()?;
    let task = state
        .tasks
        .get(&id)
        .ok_or_else(|| anyhow::anyhow!("task missing"))?;
    project_access(&state, &actor, &task.spec.project_id)?;
    let events: Vec<_> = state
        .events
        .iter()
        .filter(|e| e.task_id.as_deref() == Some(&id) && e.sequence > cursor.after_sequence)
        .take(cursor.limit.unwrap_or(256).min(1000))
        .collect();
    let next = events.last().map_or(state.revision, |e| e.sequence);
    Ok(Json(
        json!({"task":task,"workflow":task.spec.workflow_id.as_ref().and_then(|id|state.workflows.get(id)),"observations":events,"cursor":next}),
    ))
}
pub async fn workflow(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    let actor = actor(&app, &headers)?;
    let state = app.db.cluster_read()?;
    let workflow = state
        .workflows
        .get(&id)
        .ok_or_else(|| anyhow::anyhow!("workflow missing"))?;
    project_access(&state, &actor, &workflow.project_id)?;
    let tasks: Vec<_> = state
        .tasks
        .values()
        .filter(|t| t.spec.workflow_id.as_deref() == Some(&id))
        .collect();
    Ok(Json(
        json!({"workflow":workflow,"tasks":tasks,"revision":state.revision}),
    ))
}
pub async fn events(
    State(app): State<App>,
    headers: HeaderMap,
    Query(cursor): Query<Cursor>,
) -> Api<Value> {
    let actor = actor(&app, &headers)?;
    let state = app.db.cluster_read()?;
    let events: Vec<_> = state
        .events
        .iter()
        .filter(|e| {
            e.sequence > cursor.after_sequence
                && (actor == "admin"
                    || e.task_id
                        .as_ref()
                        .and_then(|id| state.tasks.get(id))
                        .is_some_and(|t| {
                            project_access(&state, &actor, &t.spec.project_id).is_ok()
                        }))
        })
        .take(cursor.limit.unwrap_or(256).min(1000))
        .collect();
    let next = events.last().map_or(state.revision, |e| e.sequence);
    Ok(Json(json!({"events":events,"cursor":next})))
}

#[derive(Deserialize)]
pub struct Checkpoint {
    expected_revision: u64,
    state: Value,
    #[serde(default)]
    source: Option<Report>,
}
pub async fn checkpoint(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Checkpoint>,
) -> Api<Workflow> {
    let actor = actor(&app, &headers)?;
    Ok(Json(service::checkpoint(
        &app.db,
        &actor,
        &id,
        body.expected_revision,
        body.state,
        body.source,
    )?))
}
pub async fn enroll(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<Enrollment>,
) -> Api<Value> {
    app.authorize(&headers)?;
    let (instance, token) = service::enroll(&app.db, body)?;
    Ok(Json(json!({"instance":instance,"token":token})))
}
pub async fn submit(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<Submit>,
) -> Api<DistributedTask> {
    let actor = actor(&app, &headers)?;
    Ok(Json(service::submit(&app.db, &actor, body)?))
}
pub async fn heartbeat(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<Heartbeat>,
) -> Api<Value> {
    let id = worker(&app, &headers)?;
    let active = body.active.clone();
    let assignments = service::heartbeat(&app.db, &id, body)?;
    let leases:Vec<_>=assignments.iter().map(|a|json!({"task_id":a.task.id,"generation":a.task.generation,"lease_until":a.task.lease_until})).collect();
    let new_assignments: Vec<_> = assignments
        .into_iter()
        .filter(|a| {
            !active
                .iter()
                .any(|known| known.task_id == a.task.id && known.generation == a.task.generation)
        })
        .collect();
    Ok(Json(
        json!({"assignments":new_assignments,"leases":leases,"server_time":crate::domain::unix_now()}),
    ))
}
#[derive(Deserialize)]
pub struct Start {
    incarnation: String,
}
pub async fn identity(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    let id = worker(&app, &headers)?;
    Ok(Json(json!({"instance_id":id})))
}
pub async fn start(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<Start>,
) -> Api<Value> {
    let id = worker(&app, &headers)?;
    service::restart(&app.db, &id, &body.incarnation)?;
    Ok(Json(json!({"started":true,"instance_id":id})))
}
pub async fn report(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<Report>,
) -> Api<Value> {
    let id = worker(&app, &headers)?;
    service::report(&app.db, &id, body)?;
    Ok(Json(json!({"accepted":true})))
}
pub async fn control(
    State(app): State<App>,
    headers: HeaderMap,
    Path((id, action)): Path<(String, String)>,
) -> Api<Value> {
    let actor = actor(&app, &headers)?;
    service::control(&app.db, &actor, &id, &action)?;
    Ok(Json(json!({"accepted":true})))
}
#[derive(Deserialize)]
pub struct Enabled {
    enabled: bool,
}
pub async fn enable(
    State(app): State<App>,
    headers: HeaderMap,
    Path((kind, id)): Path<(String, String)>,
    Json(body): Json<Enabled>,
) -> Api<Value> {
    app.authorize(&headers)?;
    service::enable(&app.db, &kind, &id, body.enabled)?;
    Ok(Json(json!({"accepted":true})))
}
pub async fn resources(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Resources>,
) -> Api<Value> {
    app.authorize(&headers)?;
    service::resources(&app.db, &id, body)?;
    Ok(Json(json!({"accepted":true})))
}
pub async fn upload(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<Upload>,
) -> Api<Artifact> {
    let id = worker(&app, &headers)?;
    check(
        body.content_base64.len() <= 12 * 1024 * 1024,
        "artifact too large (8 MiB limit)",
    )?;
    let bytes = STANDARD.decode(&body.content_base64)?;
    check(
        bytes.len() <= 8 * 1024 * 1024 && body.name.len() <= 256 && body.kind.len() <= 64,
        "artifact metadata/size exceeds limit",
    )?;
    let artifact = service::upload(&app.db, &id, body, &bytes)?;
    Ok(Json(artifact))
}
pub async fn download(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    let actor = actor(&app, &headers)?;
    let state = app.db.cluster_read()?;
    let artifact = state
        .artifacts
        .get(&id)
        .ok_or_else(|| anyhow::anyhow!("artifact missing"))?;
    check(
        actor == "admin"
            || state.instances[&actor]
                .projects
                .contains(&artifact.project_id),
        "artifact policy denied",
    )?;
    Ok(Json(
        json!({"artifact":artifact,"content_base64":STANDARD.encode(app.db.cluster_blob_get(&artifact.sha256)?)}),
    ))
}
