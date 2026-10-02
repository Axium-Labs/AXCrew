//! `/api/ax/local` and `/api/usage`: read-only views over the AX installations
//! found on this machine, so the desktop can list and adopt conversations the
//! user already has, and report token usage.

use crate::{
    app::App,
    ax,
    error::{Api, ApiError},
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde_json::{Value, json};
use std::collections::HashMap;

/// Local AX stores discovered on this machine, newest session first.
pub async fn local_ax_overview(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    app.authorize(&headers)?;
    let adopted = app
        .db
        .tasks()?
        .into_iter()
        .filter_map(|task| {
            app.db
                .binding(&task.id)
                .ok()
                .flatten()
                .map(|session| (session, task.id))
        })
        .collect::<std::collections::HashMap<_, _>>();
    let mut projects = Vec::new();
    for project in ax::projects() {
        match ax::sessions(&project) {
            Ok(sessions) if sessions.is_empty() => continue,
            Ok(sessions) => projects.push(json!({
                "id":project.id,
                "root":project.root,
                "sessions":sessions.into_iter().map(|mut session|{
                    session["task_id"]=session["id"].as_str().and_then(|id| adopted.get(id)).map_or(Value::Null,|id| json!(id));
                    session
                }).collect::<Vec<_>>(),
            })),
            Err(error) => projects.push(json!({"id":project.id,"root":project.root,"sessions":[],"error":error.to_string()})),
        }
    }
    Ok(Json(json!({
        "available":ax::ax_home().is_some(),
        "home":ax::ax_home().map(|home| home.to_string_lossy().into_owned()),
        "projects":projects,
    })))
}

pub async fn local_ax_session(
    State(app): State<App>,
    headers: HeaderMap,
    Path(session): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    Ok(Json(ax::transcript(&session)?))
}

/// Deletes one local AX session: AX must confirm the deletion before Crew removes
/// the tasks that were bound to it.
pub async fn delete_local_session(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    uuid::Uuid::parse_str(&id).map_err(|e| ApiError(e.into()))?;
    app.db.session_tasks("local", &id)?;
    let project =
        ax::project_of(&id).ok_or_else(|| ApiError(anyhow::anyhow!("local session not found")))?;
    let inspected = app
        .router
        .inspect(
            "local",
            &project.root,
            None,
            None,
            "session/delete",
            json!({"sessionId":id,"cwd":project.root}),
        )
        .await?;
    if inspected.result["deleted"] != true {
        return Err(ApiError(anyhow::anyhow!(
            "AX session was not deleted; update AX and verify its workspace"
        )));
    }
    app.db.delete_session_tasks("local", &id)?;
    Ok(Json(json!({"deleted":true})))
}

/// Aggregated token usage over local AX history. The scan is blocking file I/O,
/// so it runs off the async runtime.
pub async fn usage(
    State(app): State<App>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Api<Value> {
    app.authorize(&headers)?;
    let days = query
        .get("days")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(7)
        .clamp(1, 30);
    let offset = query
        .get("offset")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0)
        .clamp(-840, 840);
    let mut crew = std::collections::HashSet::new();
    for task in app.db.tasks()? {
        if task.assigned_device == "local"
            && let Some(id) = app.db.binding(&task.id)?
        {
            crew.insert(id);
        }
    }
    Ok(Json(
        tokio::task::spawn_blocking(move || ax::usage::usage(days, offset, &crew))
            .await
            .map_err(|e| ApiError(e.into()))??,
    ))
}
