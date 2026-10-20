//! Opt-in chat connections. Teams uses a signed callback; other adapters are outbound/local.
mod conversations;
pub mod discord;
mod dispatch;
pub mod feishu;
mod live;
pub mod local_bridge;
mod navigation;
pub mod slack;
pub mod teams;
mod telegram;
pub mod webex;
pub mod wecom;
pub mod weixin;
use crate::{
    app::App,
    config::Args,
    domain::{channel::*, unix_now},
    storage::channels::ChannelStore,
};
use anyhow::{Result, ensure};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::watch;

pub struct Channels {
    pub store: ChannelStore,
    pub runtime_dir: std::path::PathBuf,
    live: Mutex<BTreeMap<String, (String, tokio::sync::mpsc::Sender<live::Request>)>>,
    pub qr: Mutex<Option<String>>,
    pub install: tokio::sync::Mutex<()>,
    menus: Mutex<BTreeMap<(String, String), navigation::Menu>>,
    pub teams_keys: tokio::sync::Mutex<Option<(std::time::Instant, Value)>>,
    pub http: reqwest::Client,
    changes: watch::Sender<BTreeMap<String, u64>>,
    states: Mutex<BTreeMap<String, String>>,
    codes: Mutex<BTreeMap<String, (String, i64)>>,
    pub login: Mutex<Option<weixin::Login>>,
    feishu_token: Mutex<Option<(String, String, String, i64)>>,
}
#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Update {
    pub enabled: bool,
    pub cwd: String,
    pub app_id: Option<String>,
    pub secret: Option<String>,
    pub app_token: Option<String>,
    pub tenant_id: Option<String>,
    pub public_url: Option<String>,
    pub bridge_path: Option<String>,
    pub database_path: Option<String>,
}
fn validate_default_workspace(cwd: &str) -> Result<()> {
    let path = std::path::Path::new(cwd);
    ensure!(
        cwd.is_empty() || (path.is_absolute() && path.is_dir()),
        "默认项目目录不存在，请选择现有绝对路径或留空后在聊天中选择项目"
    );
    Ok(())
}
impl Channels {
    pub fn load(args: &Args) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            runtime_dir: args.database.with_file_name("chat-runtime"),
            live: Mutex::default(),
            qr: Mutex::default(),
            install: tokio::sync::Mutex::new(()),
            menus: Mutex::default(),
            teams_keys: tokio::sync::Mutex::new(None),
            store: ChannelStore::load(args.database.with_file_name("chat-channels.dat"))?,
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(45))
                .build()?,
            changes: watch::channel(BTreeMap::new()).0,
            states: Mutex::default(),
            codes: Mutex::default(),
            login: Mutex::new(None),
            feishu_token: Mutex::new(None),
        }))
    }
    pub fn status(&self) -> Value {
        let snapshot = self.store.snapshot();
        let states = self.states.lock().unwrap();
        json!(PLATFORMS.iter().map(|platform| {
            let cfg = snapshot.configs.get(*platform).cloned().unwrap_or_default();
            json!({"platform":platform,"enabled":cfg.enabled,"configured":!cfg.secret.is_empty(),"app_id":cfg.app_id,"cwd":cfg.cwd,"account":cfg.account,"app_token_configured":!cfg.app_token.is_empty(),"tenant_id":cfg.tenant_id,"public_url":cfg.public_url,"bridge_path":cfg.bridge_path,"database_path":cfg.database_path,"available":*platform!="imessage"||cfg!(target_os="macos"),"qr":if *platform=="whatsapp" {self.qr.lock().unwrap().clone()}else{None},
                "state":if !cfg.enabled {"disabled"} else {states.get(*platform).map(String::as_str).unwrap_or("connecting")},
                "peers":cfg.peers.iter().filter(|p|p.approved||p.expires>unix_now()).map(|p|json!({"id":p.id,"sender":p.sender,"approved":p.approved})).collect::<Vec<_>>()})
        }).collect::<Vec<_>>())
    }
    pub fn set_state(&self, platform: &str, state: &str) {
        self.states
            .lock()
            .unwrap()
            .insert(platform.into(), state.into());
    }
    pub fn update(&self, platform: &str, body: Update) -> Result<()> {
        ensure!(PLATFORMS.contains(&platform), "unknown chat platform");
        ensure!(body.cwd.len() <= 4096, "workspace path too long");
        if body.enabled {
            ensure!(
                platform != "imessage" || cfg!(target_os = "macos"),
                "iMessage 需要 macOS 与已登录的 Messages"
            );
            validate_default_workspace(&body.cwd)?;
        }
        // Serialize Weixin configuration changes with QR completion.
        let mut login_guard = if platform == "weixin" {
            Some(self.login.lock().unwrap())
        } else {
            None
        };
        self.store.update(|state| {
            let cfg = state.configs.entry(platform.into()).or_default();
            let mut changed = false;
            if let Some(id) = body.app_id {
                ensure!(
                    id.len() <= 256 && !id.contains(['\r', '\n']),
                    "invalid app ID"
                );
                changed |= cfg.app_id != id;
                cfg.app_id = id;
            }
            if let Some(secret) = body.secret.filter(|s| !s.is_empty()) {
                ensure!(
                    secret.len() <= 4096 && !secret.contains(['\r', '\n']),
                    "invalid credential"
                );
                changed |= cfg.secret != secret;
                cfg.secret = secret;
            }
            if let Some(token) = body.app_token.filter(|v| !v.is_empty()) {
                ensure!(
                    token.len() <= 4096 && !token.contains(['\r', '\n']),
                    "invalid app token"
                );
                changed |= cfg.app_token != token;
                cfg.app_token = token;
            }
            for (target, value) in [
                (&mut cfg.tenant_id, body.tenant_id),
                (&mut cfg.public_url, body.public_url),
                (&mut cfg.bridge_path, body.bridge_path),
                (&mut cfg.database_path, body.database_path),
            ] {
                if let Some(value) = value {
                    ensure!(
                        value.len() <= 4096 && !value.contains(['\r', '\n']),
                        "invalid platform setting"
                    );
                    changed |= *target != value;
                    *target = value;
                }
            }
            if cfg.secret.is_empty() && matches!(platform, "imessage" | "whatsapp") {
                cfg.secret = uuid::Uuid::new_v4().to_string();
            }
            if changed {
                cfg.peers.clear();
                cfg.cursor.clear();
                cfg.bridge_auth = Value::Null;
                cfg.account.clear();
                state.inbox.retain(|m| m.platform != platform);
                state
                    .seen
                    .retain(|id| !id.starts_with(&format!("{platform}:")));
            }
            cfg.generation = uuid::Uuid::new_v4().to_string();
            cfg.cwd = body.cwd;
            cfg.enabled = body.enabled;
            if !cfg.enabled {
                state.inbox.retain(|m| m.platform != platform);
            }
            if cfg.enabled {
                ensure!(!cfg.secret.is_empty(), "请先填写平台凭据或完成微信扫码");
                ensure!(
                    !matches!(platform, "feishu" | "wecom" | "teams") || !cfg.app_id.is_empty(),
                    "请填写平台应用或机器人 ID"
                );
                ensure!(
                    platform != "slack" || !cfg.app_token.is_empty(),
                    "请填写 Slack App Token"
                );
                if platform == "teams" {
                    teams::validate_config(cfg)?;
                }
            }
            Ok(())
        })?;
        self.live.lock().unwrap().remove(platform);
        if platform == "whatsapp" {
            *self.qr.lock().unwrap() = None;
        }
        self.codes.lock().unwrap().remove(platform);
        if let Some(login) = login_guard.as_mut() {
            **login = None;
        }
        self.set_state(
            platform,
            if body.enabled {
                "connecting"
            } else {
                "disabled"
            },
        );
        self.changes
            .send_modify(|v| *v.entry(platform.into()).or_default() += 1);
        Ok(())
    }
    pub fn disconnect(&self, platform: &str) -> Result<()> {
        ensure!(PLATFORMS.contains(&platform), "unknown chat platform");
        let mut login_guard = if platform == "weixin" {
            Some(self.login.lock().unwrap())
        } else {
            None
        };
        self.store.update(|state| {
            state.configs.remove(platform);
            state.inbox.retain(|m| m.platform != platform);
            Ok(())
        })?;
        self.live.lock().unwrap().remove(platform);
        if platform == "whatsapp" {
            *self.qr.lock().unwrap() = None;
        }
        self.codes.lock().unwrap().remove(platform);
        if let Some(login) = login_guard.as_mut() {
            **login = None;
        }
        self.changes
            .send_modify(|v| *v.entry(platform.into()).or_default() += 1);
        Ok(())
    }
    pub fn pairing(&self, platform: &str) -> Result<Value> {
        let cfg = self
            .store
            .snapshot()
            .configs
            .get(platform)
            .cloned()
            .unwrap_or_default();
        ensure!(cfg.enabled, "请先启用此聊天渠道");
        let code = uuid::Uuid::new_v4().simple().to_string();
        let expires = unix_now() + 300;
        self.codes
            .lock()
            .unwrap()
            .insert(platform.into(), (code.clone(), expires));
        Ok(json!({"command":format!("/pair {code}"),"expires_at":expires}))
    }
    pub fn accept_pairing(&self, message: &Inbound) -> Result<bool> {
        let Some(code) = message.text.trim().strip_prefix("/pair ") else {
            return Ok(false);
        };
        let mut codes = self.codes.lock().unwrap();
        if !codes
            .get(&message.platform)
            .is_some_and(|(v, t)| *t > unix_now() && v == code.trim())
        {
            return Ok(false);
        }
        self.store.update(|state| {
            let cfg = state
                .configs
                .get_mut(&message.platform)
                .ok_or_else(|| anyhow::anyhow!("channel disabled"))?;
            ensure!(cfg.enabled, "channel disabled");
            cfg.peers.retain(|p| p.approved || p.expires > unix_now());
            ensure!(cfg.peers.len() < 64, "peer limit reached");
            if !cfg
                .peers
                .iter()
                .any(|p| p.chat == message.chat && p.sender == message.sender)
            {
                cfg.peers.push(Peer {
                    id: uuid::Uuid::new_v4().to_string(),
                    chat: message.chat.clone(),
                    sender: message.sender.clone(),
                    context: message.context.clone(),
                    expires: unix_now() + 300,
                    ..Peer::default()
                });
            }
            Ok(())
        })?;
        codes.remove(&message.platform);
        Ok(true)
    }
    pub fn peer(&self, platform: &str, id: &str, allow: bool) -> Result<()> {
        self.store.update(|state| {
            let cfg = state
                .configs
                .get_mut(platform)
                .ok_or_else(|| anyhow::anyhow!("channel not configured"))?;
            if allow {
                let peer = cfg
                    .peers
                    .iter_mut()
                    .find(|p| p.id == id)
                    .ok_or_else(|| anyhow::anyhow!("account not found"))?;
                ensure!(peer.approved || peer.expires > unix_now(), "授权请求已过期");
                if !peer.approved {
                    peer.welcome_pending = true;
                }
                peer.approved = true;
            } else {
                let removed = cfg
                    .peers
                    .iter()
                    .find(|p| p.id == id)
                    .map(|p| (p.chat.clone(), p.sender.clone()));
                cfg.peers.retain(|p| p.id != id);
                if let Some((chat, sender)) = removed {
                    state
                        .inbox
                        .retain(|m| m.platform != platform || m.chat != chat || m.sender != sender);
                }
            }
            Ok(())
        })
    }
    pub fn enqueue(&self, message: Inbound) -> Result<()> {
        self.admit(message, None)
    }
    pub fn enqueue_current(&self, message: Inbound, cfg: &ChannelConfig) -> Result<()> {
        self.admit(message, Some(&cfg.generation))
    }
    fn admit(&self, mut message: Inbound, generation: Option<&str>) -> Result<()> {
        if message.id.is_empty()
            || message.chat.is_empty()
            || message.sender.is_empty()
            || message.id.len() > 512
            || message.chat.len() > 512
            || message.sender.len() > 512
            || message.context.len() > 16384
        {
            return Ok(());
        }
        // Do not execute truncated text or permanently poison a provider's update cursor.
        if message.text.len() > 16000 {
            message.text = "/axcrew_message_too_large".into();
        }
        let key = format!("{}:{}", message.platform, message.id);
        let snap = self.store.snapshot();
        let Some(cfg) = snap.configs.get(&message.platform).filter(|c| c.enabled) else {
            return Ok(());
        };
        if generation.is_some_and(|g| g != cfg.generation) {
            return Ok(());
        }
        let trusted = cfg
            .peers
            .iter()
            .any(|p| p.approved && p.chat == message.chat && p.sender == message.sender);
        let pairing = message
            .text
            .trim()
            .strip_prefix("/pair ")
            .is_some_and(|code| {
                self.codes
                    .lock()
                    .unwrap()
                    .get(&message.platform)
                    .is_some_and(|(expected, expires)| {
                        *expires > unix_now() && expected == code.trim()
                    })
            });
        if snap.seen.contains(&key) || (!trusted && !pairing) {
            return Ok(());
        }
        self.store.update(|state| {
            let Some(current) = state
                .configs
                .get(&message.platform)
                .filter(|cfg| cfg.enabled && generation.is_none_or(|g| g == cfg.generation))
            else {
                return Ok(());
            };
            if !current
                .peers
                .iter()
                .any(|p| p.approved && p.chat == message.chat && p.sender == message.sender)
                && !pairing
            {
                return Ok(());
            }
            if state.seen.contains(&key) {
                return Ok(());
            }
            ensure!(state.inbox.len() < 128, "chat inbox full");
            state.seen.push_back(key);
            while state.seen.len() > 4096 {
                state.seen.pop_front();
            }
            state.inbox.push_back(message);
            Ok(())
        })
    }
    pub fn cursor(&self, platform: &str, cursor: String, expected_secret: &str) -> Result<()> {
        ensure!(cursor.len() <= 65536, "cursor too large");
        self.store.update(|state| {
            if let Some(cfg) = state
                .configs
                .get_mut(platform)
                .filter(|cfg| cfg.secret == expected_secret)
            {
                cfg.cursor = cursor;
            }
            Ok(())
        })
    }
    pub async fn send(
        &self,
        platform: &str,
        cfg: &ChannelConfig,
        peer: &Peer,
        text: &str,
    ) -> Result<()> {
        for chunk in chunks(text) {
            ensure!(
                self.store
                    .snapshot()
                    .configs
                    .get(platform)
                    .is_some_and(|current| current.enabled
                        && current.secret == cfg.secret
                        && current.generation == cfg.generation
                        && current
                            .peers
                            .iter()
                            .any(|p| p.id == peer.id && (p.approved || p.expires > unix_now()))),
                "account or channel revoked"
            );
            match platform {
                "slack" => slack::send(self, cfg, peer, &chunk).await?,
                "discord" => discord::send(self, cfg, peer, &chunk).await?,
                "webex" => webex::send(self, cfg, peer, &chunk).await?,
                "teams" => teams::send(self, cfg, peer, &chunk).await?,
                "wecom" => self.send_live(platform, cfg, json!({"chatid":peer.sender,"chat_type":1,"msgtype":"markdown","markdown":{"content":chunk}})).await?,
                "imessage" => self.send_live(platform, cfg, json!({"to":peer.sender,"text":chunk,"service":"imessage","allow_sms_fallback":false})).await?,
                "whatsapp" => self.send_live(platform, cfg, json!({"chat":peer.chat,"text":chunk})).await?,
                "telegram" => telegram::send(self, cfg, peer, &chunk).await?,
                "feishu" => feishu::send(self, cfg, peer, &chunk).await?,
                "weixin" => weixin::send(self, cfg, peer, &chunk).await?,
                _ => anyhow::bail!("unknown platform"),
            }
        }
        Ok(())
    }
}
pub async fn response_json(mut response: reqwest::Response) -> Result<Value> {
    ensure!(
        response.status().is_success(),
        "chat platform HTTP error ({})",
        response.status().as_u16()
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::anyhow!("platform response interrupted"))?
    {
        ensure!(
            bytes.len() + chunk.len() <= 2 * 1024 * 1024,
            "platform response too large"
        );
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("invalid platform JSON"))
}
fn chunks(text: &str) -> Vec<String> {
    let chars: Vec<_> = text.chars().take(12000).collect();
    let mut chunks: Vec<String> = chars.chunks(1500).map(|c| c.iter().collect()).collect();
    if text.chars().count() > 12000
        && let Some(last) = chunks.last_mut()
    {
        last.push_str("\n内容较长，请在电脑端查看完整回复。");
    }
    if chunks.is_empty() {
        chunks.push("任务结束，未返回文本。".into());
    }
    chunks
}
async fn worker(app: App, platform: &'static str) {
    let channels = &app.channels;
    let mut changes = channels.changes.subscribe();
    let mut delay = 1;
    loop {
        let revision = changes
            .borrow_and_update()
            .get(platform)
            .copied()
            .unwrap_or(0);
        let cfg = channels
            .store
            .snapshot()
            .configs
            .get(platform)
            .cloned()
            .unwrap_or_default();
        if !cfg.enabled {
            channels.set_state(platform, "disabled");
            if changes.changed().await.is_err() {
                return;
            }
            continue;
        }
        channels.set_state(platform, "connecting");
        let connection = async {
            match platform {
                "telegram" => telegram::run(&app, &cfg).await,
                "feishu" => feishu::run(&app, &cfg).await,
                "weixin" => weixin::run(&app, &cfg).await,
                "slack" => slack::run(&app, &cfg).await,
                "discord" => discord::run(&app, &cfg).await,
                "webex" => webex::run(&app, &cfg).await,
                "wecom" => wecom::run(&app, &cfg).await,
                "teams" => teams::run(&app, &cfg).await,
                "imessage" | "whatsapp" => local_bridge::run(&app, platform, &cfg).await,
                _ => anyhow::bail!("unknown platform"),
            }
        };
        tokio::select! {_=changes.wait_for(|v|v.get(platform).copied().unwrap_or(0)!=revision)=>{delay=1;continue},result=connection=>{channels.set_state(platform,if result.is_err(){"connection_error"}else{"disconnected"});}}
        tokio::select! {_=changes.wait_for(|v|v.get(platform).copied().unwrap_or(0)!=revision)=>{delay=1},_=tokio::time::sleep(Duration::from_secs(delay))=>{delay=(delay*2).min(60)}}
    }
}
pub async fn run(app: App) {
    let mut tasks = tokio::task::JoinSet::new();
    for platform in PLATFORMS {
        tasks.spawn(worker(app.clone(), platform));
        tasks.spawn(dispatch::run(app.clone(), platform));
    }
    while tasks.join_next().await.is_some() {}
}
