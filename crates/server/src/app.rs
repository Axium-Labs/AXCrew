//! Application state and the authentication checks that need it.
//!
//! [`App`] is the one object every handler receives: it owns the storage facade,
//! the scheduler, the device gateway, the transport router, the approval broker
//! and the token store. Building it is the whole of startup's work; `main.rs`
//! only spawns the scheduler loops, mounts the router and serves.

use crate::{
    auth::{TokenStore, header_bearer},
    config::Args,
    error::ApiError,
    gateway::Gateway,
    orchestration::{approval::ApprovalBroker, scheduler::Scheduler},
    storage::Db,
    transport::{DeviceRouter, LocalTransport},
};
use anyhow::Result;
use axum::http::HeaderMap;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct App {
    pub db: Db,
    pub scheduler: Scheduler,
    pub gateway: Gateway,
    pub router: Arc<DeviceRouter>,
    pub approvals: ApprovalBroker,
    pub events: broadcast::Sender<Value>,
    pub admin_token: Option<String>,
    pub tokens: Arc<Mutex<TokenStore>>,
    pub token_path: PathBuf,
}

impl App {
    /// Opens the database, registers this machine's `local` device, ensures a
    /// default workspace exists, and wires the scheduler, gateway and transports
    /// together. Everything that must happen before the first request lives here.
    pub fn build(args: &Args) -> Result<Self> {
        let db = Db::open(&args.database)?;
        let admin_token = args.admin_token()?;
        db.bootstrap_local(
            &std::env::var("COMPUTERNAME")
                .or_else(|_| std::env::var("HOSTNAME"))
                .unwrap_or_else(|_| "local".into()),
            "0.1.0",
        )?;
        if db.default_session_member()?.is_none() {
            let workspace = std::env::var("AX_CREW_WORKSPACE")
                .map(PathBuf::from)
                .unwrap_or(std::env::current_dir()?);
            std::fs::create_dir_all(&workspace)?;
            db.ensure_local_session_member(&workspace.to_string_lossy(), None, None)?;
        }
        let (events, _) = broadcast::channel(2048);
        let gateway = Gateway::new(db.clone(), events.clone());
        let approvals = ApprovalBroker::default();
        let router = Arc::new(DeviceRouter {
            db: db.clone(),
            local: LocalTransport {
                ax: args.ax.clone(),
                approvals: approvals.clone(),
            },
            gateway: gateway.clone(),
            approvals: approvals.clone(),
        });
        let scheduler =
            Scheduler::new(db.clone(), router.clone(), events.clone(), args.concurrency);
        // 加载持久化 Token（长效 / 永久 Token 重启后依然有效），清理已过期的临时 Token。
        let token_path = args.token_path();
        let mut token_store: TokenStore = fs::read(&token_path)
            .ok()
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or_default();
        token_store.prune();
        if !token_store.records.is_empty() {
            fs::write(&token_path, serde_json::to_vec(&token_store)?)?;
        }
        let tokens = Arc::new(Mutex::new(token_store));
        Ok(Self {
            db,
            scheduler,
            gateway,
            router,
            approvals,
            events,
            admin_token,
            tokens,
            token_path,
        })
    }

    /// Rejects the request unless it carries a valid bearer token.
    ///
    /// An unconfigured gateway (no admin token, no issued token, no authorised
    /// phone) stays open so a fresh install is reachable from its own machine.
    pub fn authorize(&self, headers: &HeaderMap) -> std::result::Result<(), ApiError> {
        let configured = self.admin_token.is_some()
            || !self
                .tokens
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .records
                .is_empty()
            || self.db.has_client_authorization();
        if configured {
            if header_bearer(headers).is_some_and(|given| self.token_matches(&given)) {
                return Ok(());
            }
            return Err(ApiError(anyhow::anyhow!("admin token required")));
        }
        Ok(())
    }

    /// The WebSocket variant: the token may also arrive as `?token=`.
    ///
    /// Authentication happens once during the handshake; a long-lived socket is
    /// not re-checked, so a token expiring mid-connection does not drop it.
    pub fn authorize_ws(
        &self,
        headers: &HeaderMap,
        query: &HashMap<String, String>,
    ) -> std::result::Result<(), ApiError> {
        if header_bearer(headers)
            .or_else(|| query.get("token").cloned())
            .is_some_and(|given| self.token_matches(&given))
        {
            return Ok(());
        }
        if self.admin_token.is_none()
            && self
                .tokens
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .records
                .is_empty()
            && !self.db.has_client_authorization()
        {
            return Ok(());
        }
        Err(ApiError(anyhow::anyhow!("admin token required")))
    }

    fn token_matches(&self, given: &str) -> bool {
        if self
            .admin_token
            .as_ref()
            .is_some_and(|admin| admin == given)
        {
            return true;
        }
        if self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .valid(given)
        {
            return true;
        }
        // 已授权手机设备：长期设备凭证（可撤销），命中即视为有效并记录活跃时间。
        if let Some(device_id) = self.db.credential_device(given) {
            self.db.touch_client(&device_id);
            return true;
        }
        false
    }

    /// Writes the issued-token store back to disk.
    pub fn persist_tokens(&self) -> std::result::Result<(), ApiError> {
        let store = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        fs::write(&self.token_path, serde_json::to_vec(&*store)?)?;
        Ok(())
    }
}
