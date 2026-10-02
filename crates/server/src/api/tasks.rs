//! `/api/tasks`: the scheduled work items, their lifecycle and the deterministic
//! dependency graph. Start/cancel/retry delegate to the scheduler, which owns the
//! task state machine.

use crate::{
    app::App,
    domain::task::{NewTask, Task, TaskEdit},
    error::{Api, ApiError},
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};

pub async fn tasks(State(app): State<App>, headers: HeaderMap) -> Api<Vec<Task>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.tasks()?))
}

pub async fn task(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Option<Task>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.task(&id)?))
}

pub async fn create_task(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<NewTask>,
) -> Api<Task> {
    app.authorize(&headers)?;
    Ok(Json(app.db.create_task(body)?))
}

pub async fn edit_task(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<TaskEdit>,
) -> Api<Task> {
    app.authorize(&headers)?;
    Ok(Json(app.db.update_task(&id, body)?))
}

pub async fn delete_task(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.db.delete_task(&id)?;
    Ok(Json(json!({"deleted":true})))
}

#[derive(Deserialize)]
pub struct Reassign {
    member_id: String,
}

/// Moves a task to another member by reading the current row and re-submitting it
/// as a full edit, so the graph rules apply unchanged.
pub async fn reassign_task(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Reassign>,
) -> Api<Task> {
    app.authorize(&headers)?;
    let task = app
        .db
        .task(&id)?
        .ok_or_else(|| ApiError(anyhow::anyhow!("task not found")))?;
    Ok(Json(app.db.update_task(
        &id,
        TaskEdit {
            title: task.title,
            description: task.description,
            assigned_member: body.member_id,
            parent_id: task.parent_id,
            dependencies: task.dependencies,
            priority: task.priority,
            input: task.input,
        },
    )?))
}

pub async fn start_task(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Task> {
    app.authorize(&headers)?;
    Ok(Json(app.scheduler.start(&id)?))
}

pub async fn cancel_task(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Task> {
    app.authorize(&headers)?;
    Ok(Json(app.scheduler.cancel(&id)?))
}

pub async fn retry_task(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Task> {
    app.authorize(&headers)?;
    Ok(Json(app.scheduler.retry(&id)?))
}
