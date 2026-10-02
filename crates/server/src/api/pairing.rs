//! `/api/pairing` and `/api/authorizations`: device onboarding.
//!
//! Two flows:
//! * AX runtimes redeem a one-time code and then authenticate with Ed25519 over
//!   the gateway socket. Redeeming is public — the code is the credential.
//! * Phone control clients redeem a short-lived code, wait for a desktop
//!   confirmation, then poll for a long-lived credential. The polling endpoints
//!   are public for the same reason.

use crate::{
    app::App,
    domain::device::{AuthorizedClient, Device},
    error::{Api, ApiError},
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};

pub async fn issue_pairing(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    app.authorize(&headers)?;
    let code = app.db.issue_pairing()?;
    Ok(Json(json!({"code":code,"expires_in_seconds":600})))
}

/// Validates the submitted public key before the pairing code is consumed, so a
/// malformed key never burns a valid code.
pub async fn redeem_pairing(
    State(app): State<App>,
    Json(body): Json<crate::domain::device::PairingRequest>,
) -> Api<Device> {
    let bytes = STANDARD
        .decode(&body.public_key)
        .map_err(|e| ApiError(e.into()))?;
    let array: [u8; 32] = bytes
        .try_into()
        .map_err(|_| ApiError(anyhow::anyhow!("invalid public key")))?;
    ed25519_dalek::VerifyingKey::from_bytes(&array).map_err(|e| ApiError(e.into()))?;
    Ok(Json(app.db.redeem_pairing(&body)?))
}

#[derive(Deserialize)]
pub struct ClientRedeemRequest {
    code: String,
    name: String,
    platform: String,
}

#[derive(Deserialize)]
pub struct ClientCodeRequest {
    code: String,
}

/// 桌面端生成一次性配对码（5 分钟，二维码/手动）。要求已授权或 admin 鉴权。
pub async fn issue_client_pairing(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    app.authorize(&headers)?;
    let info = app.db.issue_client_pairing()?;
    Ok(Json(json!({
        "code": info.code,
        "short_code": info.short_code,
        "expires_at": info.expires_at,
        "expires_in_seconds": (info.expires_at - crate::domain::unix_now()).max(0),
    })))
}

/// 手机提交配对码 → 待桌面确认（配对码一次性使用）。
pub async fn redeem_client_pairing(
    State(app): State<App>,
    Json(body): Json<ClientRedeemRequest>,
) -> Api<Value> {
    let redeemed = app.db.redeem_client_pairing(
        &body.code,
        &body.name.chars().take(80).collect::<String>(),
        &body.platform.chars().take(40).collect::<String>(),
    )?;
    Ok(Json(json!({
        "status": redeemed.status,
        "device_id": redeemed.device_id,
        "awaiting_confirmation": true,
    })))
}

/// 手机轮询：pending → 继续等；confirmed → 返回一次性设备凭证；denied/过期 → 错误。
pub async fn claim_client_credential(
    State(app): State<App>,
    Json(body): Json<ClientCodeRequest>,
) -> Api<Value> {
    match app.db.claim_client_credential(&body.code)? {
        Some(credential) => Ok(Json(json!({"status":"confirmed","credential":credential}))),
        None => Ok(Json(json!({"status":"pending"}))),
    }
}

pub async fn list_client_authorizations(State(app): State<App>, headers: HeaderMap) -> Api<Value> {
    app.authorize(&headers)?;
    Ok(Json(json!({
        "pending": app.db.pending_client_authorizations()?,
        "authorized": app.db.client_authorizations()?,
    })))
}

pub async fn pending_client_authorizations(
    State(app): State<App>,
    headers: HeaderMap,
) -> Api<Vec<AuthorizedClient>> {
    app.authorize(&headers)?;
    Ok(Json(app.db.pending_client_authorizations()?))
}

pub async fn confirm_client_device(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.db.confirm_client_device(&id)?;
    Ok(Json(json!({"confirmed": true, "device_id": id})))
}

pub async fn deny_client_device(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.db.deny_client_device(&id)?;
    Ok(Json(json!({"denied": true, "device_id": id})))
}

pub async fn revoke_client_authorization(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Api<Value> {
    app.authorize(&headers)?;
    app.db.revoke_client_authorization(&id)?;
    Ok(Json(json!({"revoked": true, "device_id": id})))
}
