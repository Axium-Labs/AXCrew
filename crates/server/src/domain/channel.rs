//! Chat platform configuration and isolated peer conversation state.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

pub const PLATFORMS: [&str; 10] = [
    "slack", "discord", "telegram", "webex", "wecom", "feishu", "teams", "weixin", "imessage",
    "whatsapp",
];

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ChannelConfig {
    pub enabled: bool,
    pub generation: String,
    pub app_id: String,
    pub secret: String,
    pub cwd: String,
    pub account: String,
    pub origin: String,
    pub cursor: String,
    pub app_token: String,
    pub tenant_id: String,
    pub public_url: String,
    pub bridge_path: String,
    pub database_path: String,
    pub bridge_auth: serde_json::Value,
    pub peers: Vec<Peer>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Peer {
    pub id: String,
    pub chat: String,
    pub sender: String,
    pub approved: bool,
    pub expires: i64,
    pub task: Option<String>,
    pub context: String,
    pub notified: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Inbound {
    pub platform: String,
    pub id: String,
    pub chat: String,
    pub sender: String,
    pub text: String,
    #[serde(default)]
    pub context: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ChannelState {
    pub configs: BTreeMap<String, ChannelConfig>,
    pub inbox: VecDeque<Inbound>,
    pub seen: VecDeque<String>,
}
