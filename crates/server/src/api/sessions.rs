//! `/api/sessions`: conversations. A session is an AX session plus the Crew tasks
//! that drive it, so every endpoint here maps between the two.
//!
//! `POST /api/sessions` creates and starts the first turn; `/message` appends a
//! turn to the same AX session; `/history` and `/resume` are read-only ACP calls;
//! `/attach` adopts a conversation that already exists in local AX.

use crate::{
    api::composer::{
        ComposerFile, ComposerImage, ConversationContext, conversation_input, session_input,
    },
    app::App,
    ax,
    domain::{
        session::SessionView,
        task::{NewTask, Task},
    },
    error::{Api, ApiError},
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
pub struct NewSession {
    member_id: Option<String>,
    cwd: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    title: Option<String>,
    text: String,
    permission_profile: Option<String>,
    #[serde(default)]
    images: Vec<ComposerImage>,
    #[serde(default)]
    files: Vec<ComposerFile>,
    #[serde(default)]
    context: Vec<ConversationContext>,
}

#[derive(Deserialize)]
pub struct NewSessionMessage {
    text: String,
    permission_profile: Option<String>,
    #[serde(default)]
    images: Vec<ComposerImage>,
    #[serde(default)]
    files: Vec<ComposerFile>,
    #[serde(default)]
    context: Vec<ConversationContext>,
}

#[derive(Deserialize)]
pub struct AttachRequest {
    ax_session_id: String,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

/// Every conversation Crew knows about, newest AX activity last, hidden turns
/// (silent automations) excluded.
pub async fn sessions(State(app): State<App>, headers: HeaderMap) -> Api<Vec<SessionView>> {
    app.authorize(&headers)?;
    let tasks = app.db.tasks()?;
    Ok(Json(
        tasks
            .into_iter()
            .filter(|task| task.input.get("hidden").and_then(Value::as_bool) != Some(true))
            .filter_map(|task| {
                app.db
                    .binding(&task.id)
                    .ok()
                    .flatten()
                    .map(|ax_session_id| SessionView {
                        ax_session_id,
                        device_id: task.assigned_device.clone(),
                        member_id: task.assigned_member.clone(),
                        task_id: task.id.clone(),
                    })
            })
            .collect(),
    ))
}

pub async fn session(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Option<SessionView>> {
    app.authorize(&headers)?;
    let task = app.db.task(&id)?;
    Ok(Json(task.and_then(|task| {
        let binding = app.db.binding(&task.id).ok().flatten();
        binding.map(|ax_session_id| SessionView {
            ax_session_id,
            device_id: task.assigned_device,
            member_id: task.assigned_member,
            task_id: task.id,
        })
    })))
}

/// Adopts a conversation that already exists in local AX so Crew can keep
/// talking to it. Nothing is copied: Crew only records the session binding.
pub async fn attach_session(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<AttachRequest>,
) -> Api<Task> {
    app.authorize(&headers)?;
    for task in app.db.tasks()? {
        if app.db.binding(&task.id)?.as_deref() == Some(body.ax_session_id.as_str()) {
            return Ok(Json(task));
        }
    }
    let project = ax::project_of(&body.ax_session_id);
    let cwd = body
        .cwd
        .filter(|value| !value.trim().is_empty())
        .or_else(|| project.as_ref().map(|project| project.root.clone()))
        .or_else(|| {
            app.db
                .default_session_member()
                .ok()
                .flatten()
                .map(|member| member.cwd)
        })
        .ok_or_else(|| ApiError(anyhow::anyhow!("workspace not configured")))?;
    let member = app.db.ensure_local_session_member(&cwd, None, None)?;
    let title = body
        .title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "本地 AX 会话".into());
    let task = app.db.create_task(NewTask {
        crew_id: member.crew_id.clone(),
        title: title.chars().take(80).collect(),
        description: "导入的本地 AX 会话".into(),
        assigned_member: member.id,
        parent_id: None,
        dependencies: vec![],
        priority: 0,
        input: json!({"imported":true,"ax_session_id":body.ax_session_id}),
    })?;
    app.db.bind(&task, &body.ax_session_id)?;
    app.db.set_status(
        &task.id,
        "completed",
        Some(json!({"text":"","imported":true})),
    )?;
    Ok(Json(app.db.task(&task.id)?.ok_or_else(|| {
        ApiError(anyhow::anyhow!("imported session missing"))
    })?))
}

/// Creates the first turn of a new conversation and starts it immediately.
///
/// The execution environment is resolved here: an explicit `member_id` wins,
/// otherwise a workspace/provider/model combination selects or creates the local
/// environment, otherwise the default local environment is used.
pub async fn create_session(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<NewSession>,
) -> Api<Task> {
    app.authorize(&headers)?;
    if body.text.trim().is_empty() && body.images.is_empty() && body.files.is_empty() {
        return Err(ApiError(anyhow::anyhow!("message required")));
    }
    let member = if let Some(ref id) = body.member_id {
        if body.cwd.is_some() || body.provider.is_some() || body.model.is_some() {
            return Err(ApiError(anyhow::anyhow!(
                "member_id cannot be combined with workspace or model"
            )));
        }
        app.db
            .member(id)?
            .ok_or_else(|| ApiError(anyhow::anyhow!("execution environment not found")))?
    } else if body.cwd.is_some() || body.provider.is_some() || body.model.is_some() {
        let cwd = body
            .cwd
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .or_else(|| {
                app.db
                    .default_session_member()
                    .ok()
                    .flatten()
                    .map(|member| member.cwd)
            })
            .ok_or_else(|| ApiError(anyhow::anyhow!("workspace not configured")))?;
        app.db
            .ensure_local_session_member(&cwd, body.provider.as_deref(), body.model.as_deref())?
    } else {
        app.db
            .default_session_member()?
            .ok_or_else(|| ApiError(anyhow::anyhow!("no execution environment configured")))?
    };
    if member.device_id != "local" && (!body.images.is_empty() || !body.files.is_empty()) {
        return Err(ApiError(anyhow::anyhow!(
            "attachments currently require the Gateway local device"
        )));
    }
    let task = app.db.create_task(NewTask {
        crew_id: member.crew_id,
        title: body
            .title
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                if body.text.trim().is_empty() {
                    "图片".into()
                } else {
                    body.text.chars().take(60).collect()
                }
            }),
        description: String::new(),
        assigned_member: member.id,
        parent_id: None,
        dependencies: vec![],
        priority: 0,
        input: conversation_input(
            session_input(
                body.text,
                body.permission_profile,
                body.reasoning_effort.as_deref(),
                body.images,
                body.files,
                &member.cwd,
            )?,
            body.context,
        )?,
    })?;
    Ok(Json(app.scheduler.start(&task.id)?))
}

/// Resolves the task, its member and its bound AX session for the turn endpoints.
async fn session_context(
    app: &App,
    id: &str,
) -> std::result::Result<(Task, crate::domain::crew::Member, String), ApiError> {
    let task = app
        .db
        .task(id)?
        .ok_or_else(|| ApiError(anyhow::anyhow!("task not found")))?;
    let member = app
        .db
        .member(&task.assigned_member)?
        .ok_or_else(|| ApiError(anyhow::anyhow!("member not found")))?;
    let ax_id = app
        .db
        .binding(id)?
        .ok_or_else(|| ApiError(anyhow::anyhow!("AX session not bound yet")))?;
    Ok((task, member, ax_id))
}

/// Deletes a whole conversation: the AX session on the device first, then Crew's
/// task group. The AX deletion must be confirmed before local rows are removed.
pub async fn delete_session(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    let (task, member, ax_id) = session_context(&app, &id).await?;
    app.db.session_tasks(&task.assigned_device, &ax_id)?;
    let inspected = app
        .router
        .inspect(
            &task.assigned_device,
            &member.cwd,
            member.provider.as_deref(),
            member.model.as_deref(),
            "session/delete",
            json!({"sessionId":ax_id,"cwd":member.cwd}),
        )
        .await?;
    if inspected.result["deleted"] != true
        && (task.assigned_device != "local" || ax::project_of(&ax_id).is_some())
    {
        return Err(ApiError(anyhow::anyhow!(
            "AX session was not deleted; update AX and verify its workspace"
        )));
    }
    app.db.delete_session_tasks(&task.assigned_device, &ax_id)?;
    Ok(Json(json!({"deleted":true})))
}

/// Replays one conversation. An adopted local AX session can be replayed straight
/// from its own transcript when the ACP store is not reachable, so earlier
/// messages stay readable instead of failing the whole view.
pub async fn session_history(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    let (task, member, ax_id) = session_context(&app, &id).await?;
    let inspected = app
        .router
        .inspect(
            &task.assigned_device,
            &member.cwd,
            member.provider.as_deref(),
            member.model.as_deref(),
            "session/load",
            json!({"sessionId":ax_id,"cwd":member.cwd,"mcpServers":[]}),
        )
        .await;
    match inspected {
        Ok(inspected) => Ok(Json(
            json!({"task_id":id,"ax_session_id":ax_id,"updates":inspected.updates}),
        )),
        Err(error) => match ax::transcript(&ax_id) {
            Ok(mut local) => {
                local["task_id"] = json!(id);
                Ok(Json(local))
            }
            Err(_) => Err(ApiError(error)),
        },
    }
}

pub async fn resume_session(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    let (task, member, ax_id) = session_context(&app, &id).await?;
    app.router.inspect(&task.assigned_device,&member.cwd,member.provider.as_deref(),member.model.as_deref(),"session/resume",json!({"sessionId":ax_id,"cwd":member.cwd,"mcpServers":[],"_ax":{"skills":member.skills,"mcpServers":member.mcp_servers,"permissionProfile":member.permission_profile}})).await?;
    Ok(Json(json!({"resumed":true,"ax_session_id":ax_id})))
}

/// Appends a turn to an existing conversation: a new task bound to the same AX
/// session, rejected while the previous turn is still active.
pub async fn session_message(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<NewSessionMessage>,
) -> Api<Task> {
    app.authorize(&headers)?;
    if body.text.trim().is_empty() && body.images.is_empty() && body.files.is_empty() {
        return Err(ApiError(anyhow::anyhow!("message required")));
    }
    let (parent, member, ax_id) = session_context(&app, &id).await?;
    if matches!(
        parent.status.as_str(),
        "running" | "waiting_permission" | "ready"
    ) {
        return Err(ApiError(anyhow::anyhow!("session already has active work")));
    }
    if member.device_id != "local" && (!body.images.is_empty() || !body.files.is_empty()) {
        return Err(ApiError(anyhow::anyhow!(
            "attachments currently require the Gateway local device"
        )));
    }
    let followup = app.db.create_task(NewTask {
        crew_id: parent.crew_id,
        title: if body.text.trim().is_empty() {
            "图片".into()
        } else {
            body.text.chars().take(60).collect()
        },
        description: String::new(),
        assigned_member: parent.assigned_member,
        parent_id: Some(id),
        dependencies: vec![],
        priority: parent.priority,
        input: conversation_input(
            session_input(
                body.text,
                body.permission_profile,
                None,
                body.images,
                body.files,
                &member.cwd,
            )?,
            body.context,
        )?,
    })?;
    app.db.bind(&followup, &ax_id)?;
    Ok(Json(app.scheduler.start(&followup.id)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::composer::session_input;

    #[test]
    fn legacy_session_payload_remains_compatible() {
        let request: NewSession = serde_json::from_value(json!({"text":"hello"})).unwrap();
        assert!(request.files.is_empty());
        assert!(request.images.is_empty());
        assert_eq!(
            session_input(request.text, None, None, vec![], vec![], "unused")
                .map_err(|e| e.0)
                .unwrap(),
            json!("hello")
        );
    }
}
