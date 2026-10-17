//! Desktop-only management of outbound messaging integrations.
use crate::{
    app::App,
    error::{Api, ApiError},
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
fn admin(app: &App, headers: &HeaderMap) -> Result<(), ApiError> {
    if crate::auth::header_bearer(headers)
        .as_ref()
        .is_some_and(|token| app.admin_token.as_ref() == Some(token))
    {
        Ok(())
    } else {
        Err(ApiError(anyhow::anyhow!("Desktop administrator required")))
    }
}
pub async fn status(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    admin(&app, &headers)?;
    Ok(Json(app.channels.status()))
}
pub async fn update(
    State(app): State<App>,
    headers: HeaderMap,
    Path(platform): Path<String>,
    Json(body): Json<crate::channels::Update>,
) -> Api<Value> {
    admin(&app, &headers)?;
    app.channels.update(&platform, body)?;
    Ok(Json(app.channels.status()))
}
pub async fn disconnect(
    State(app): State<App>,
    headers: HeaderMap,
    Path(platform): Path<String>,
) -> Api<Value> {
    admin(&app, &headers)?;
    app.channels.disconnect(&platform)?;
    Ok(Json(app.channels.status()))
}
pub async fn pairing(
    State(app): State<App>,
    headers: HeaderMap,
    Path(platform): Path<String>,
) -> Api<Value> {
    admin(&app, &headers)?;
    Ok(Json(app.channels.pairing(&platform)?))
}
pub async fn approve(
    State(app): State<App>,
    headers: HeaderMap,
    Path((platform, id)): Path<(String, String)>,
) -> Api<Value> {
    admin(&app, &headers)?;
    app.channels.peer(&platform, &id, true)?;
    Ok(Json(app.channels.status()))
}
pub async fn revoke(
    State(app): State<App>,
    headers: HeaderMap,
    Path((platform, id)): Path<(String, String)>,
) -> Api<Value> {
    admin(&app, &headers)?;
    app.channels.peer(&platform, &id, false)?;
    Ok(Json(app.channels.status()))
}
pub async fn weixin_login(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    admin(&app, &headers)?;
    Ok(Json(crate::channels::weixin::begin(&app.channels).await?))
}
#[derive(Deserialize)]
pub struct LoginPoll {
    id: String,
    verify_code: Option<String>,
}
pub async fn weixin_poll(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<LoginPoll>,
) -> Api<Value> {
    admin(&app, &headers)?;
    Ok(Json(
        crate::channels::weixin::poll(&app.channels, &body.id, body.verify_code.as_deref()).await?,
    ))
}
pub async fn health(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    admin(&app, &headers)?;
    Ok(Json(json!({"platforms":crate::domain::channel::PLATFORMS})))
}

pub async fn install_whatsapp(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    admin(&app, &headers)?;
    crate::channels::local_bridge::install_whatsapp(&app.channels).await?;
    Ok(Json(json!({"installed":true})))
}

/// The only public chat ingress; Microsoft authentication replaces the desktop token here.
pub async fn teams_webhook(
    State(app): State<App>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let Some(token) = crate::auth::header_bearer(&headers) else {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    };
    match crate::channels::teams::receive(&app.channels, &token, &body).await {
        Ok(()) => axum::http::StatusCode::OK.into_response(),
        Err(_) => axum::http::StatusCode::UNAUTHORIZED.into_response(),
    }
}
