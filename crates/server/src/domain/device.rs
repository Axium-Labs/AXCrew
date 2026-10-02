//! Devices: AX runtimes paired with this control plane, plus the phone control
//! clients that authenticate against it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub platform: String,
    pub arch: String,
    pub ax_version: String,
    pub protocol_version: i64,
    pub capabilities: Value,
    pub status: String,
    pub last_seen: i64,
    pub public_key: Option<String>,
}

/// 手机客户端的配对信息。code 用于二维码/手动输入（一次性、5 分钟），short_code 仅用于展示。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientPairingInfo {
    pub code: String,
    pub short_code: String,
    pub expires_at: i64,
}

/// 手机 redeem 配对码后的返回：待桌面确认。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientRedeem {
    pub status: String,
    pub device_id: String,
}

/// 已授权 / 待确认的手机设备（桌面端设备管理用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizedClient {
    pub device_id: String,
    pub name: String,
    pub platform: String,
    pub status: String, // pending / authorized
    pub created_at: i64,
    pub last_active: i64,
}

/// A remote AX runtime asking to be paired (`POST /api/pairing/redeem`).
#[derive(Debug, Deserialize)]
pub struct PairingRequest {
    pub code: String,
    pub public_key: String,
    pub name: String,
    pub hostname: String,
    pub platform: String,
    pub arch: String,
    pub ax_version: String,
}
