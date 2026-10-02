//! `/api/crews`: crews and their members (execution environments).
//!
//! Input validation runs through `crate::orchestration::crew` before storage is
//! touched; storage keeps only the checks that must read other rows.

use crate::{
    app::App,
    domain::crew::{Crew, Member, NewCrew, NewMember},
    error::{Api, ApiError},
    orchestration::crew,
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};

pub async fn crews(State(app): State<App>, headers: HeaderMap) -> Api<Vec<Crew>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.crews()?))
}

pub async fn crew(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Option<Crew>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.crew(&id)?))
}

pub async fn create_crew(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<NewCrew>,
) -> Api<Crew> {
    app.authorize(&headers)?;
    crew::validate_new_crew(&body)?;
    Ok(Json(app.db.create_crew(body)?))
}

pub async fn members(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Vec<Member>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.members(&id)?))
}

pub async fn create_member(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<NewMember>,
) -> Api<Member> {
    app.authorize(&headers)?;
    crew::validate_new_member(&body)?;
    Ok(Json(app.db.create_member(&id, body)?))
}

/// Edits a member. The crew check runs first so a request that names the wrong
/// crew still reports that, exactly as before the validation moved out of storage.
pub async fn update_member(
    State(app): State<App>,
    headers: HeaderMap,
    Path((crew_id, id)): Path<(String, String)>,
    Json(body): Json<NewMember>,
) -> Api<Member> {
    app.authorize(&headers)?;
    let current = app
        .db
        .member(&id)?
        .ok_or_else(|| ApiError(anyhow::anyhow!("member not found")))?;
    if current.crew_id != crew_id {
        return Err(ApiError(anyhow::anyhow!("member belongs to another crew")));
    }
    crew::validate_member_update(&body)?;
    Ok(Json(app.db.update_member(&id, body)?))
}
