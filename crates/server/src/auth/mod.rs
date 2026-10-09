//! Authentication primitives.
//!
//! The gateway has one permission model: a bearer token. Three things can satisfy
//! it — the fixed `AX_CREW_ADMIN_TOKEN`, a token previously issued into
//! `gateway.tokens.json` next to the database (issuing them through the API was
//! removed; existing unexpired records remain valid), or a phone device credential
//! granted through the pairing flow. This module owns the token store and the
//! header parsing; the checks that need database access live on `crate::app::App`.

use axum::http::HeaderMap;
use serde::{Deserialize, Serialize};

/// 可额外签发的连接 Token：每个带可选过期时间（None = 永久），
/// 独立于固定的 admin_token。持久化到数据库旁的 gateway.tokens.json，
/// 重启后长效 / 永久 Token 依然有效。
#[derive(Clone, Serialize, Deserialize)]
pub struct TokenRecord {
    pub value: String,
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>, // epoch 秒；None = 永久
    pub created_at: u64,
}

#[derive(Default, Serialize, Deserialize)]
pub struct TokenStore {
    pub records: Vec<TokenRecord>,
}

impl TokenStore {
    pub fn valid(&self, value: &str) -> bool {
        let now = crate::domain::unix_now() as u64;
        self.records.iter().any(|record| {
            record.value == value && record.expires_at.map(|end| end > now).unwrap_or(true)
        })
    }
    pub fn prune(&mut self) {
        let now = crate::domain::unix_now() as u64;
        self.records
            .retain(|record| record.expires_at.map(|end| end > now).unwrap_or(true));
    }
}

/// Extracts the token from `Authorization: Bearer <token>`.
pub fn header_bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|token| token.trim().to_string())
}
