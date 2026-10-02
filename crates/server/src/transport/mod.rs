//! The transport boundary: everything that knows *how* work reaches an AX
//! runtime, and nothing about *why* it was scheduled.
//!
//! `DeviceRouter` is the single entry point the orchestration layer uses. It
//! picks the local ACP subprocess ([`ax::LocalTransport`]) or the outbound
//! gateway link ([`device::RemoteTransport`]) from the task's assigned device, so
//! scheduling code never learns which connection type is in play.

mod ax;
mod device;

pub use ax::LocalTransport;

use crate::{
    domain::{crew::Member, task::Task},
    gateway::Gateway,
    orchestration::approval::ApprovalBroker,
};
use anyhow::{Result, anyhow};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

#[derive(Debug)]
pub enum TransportEvent {
    Bound(String),
    Update(Value),
}

#[async_trait]
pub trait Transport: Send + Sync {
    async fn execute(
        &self,
        task: &Task,
        member: &Member,
        session: Option<String>,
        cancel: watch::Receiver<bool>,
        events: mpsc::UnboundedSender<TransportEvent>,
    ) -> Result<Value>;
}

#[derive(Clone)]
pub struct DeviceRouter {
    pub local: LocalTransport,
    pub gateway: Gateway,
    pub approvals: ApprovalBroker,
}

pub struct Inspection {
    pub result: Value,
    pub updates: Vec<Value>,
}

impl DeviceRouter {
    pub async fn inspect(
        &self,
        device: &str,
        cwd: &str,
        provider: Option<&str>,
        model: Option<&str>,
        method: &str,
        params: Value,
    ) -> Result<Inspection> {
        tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.inspect_inner(device, cwd, provider, model, method, params),
        )
        .await?
    }
    /// A one-shot ACP request that opens, asks, and closes. Used by the read-only
    /// catalogue and session-management endpoints.
    async fn inspect_inner(
        &self,
        device: &str,
        cwd: &str,
        provider: Option<&str>,
        model: Option<&str>,
        method: &str,
        params: Value,
    ) -> Result<Inspection> {
        let mut updates = Vec::new();
        if device == "local" {
            let mut cmd = Command::new(&self.local.ax);
            if let Some(home) = crate::ax::ax_home() {
                cmd.env("AX_HOME", home);
            }
            cmd.arg("acp")
                .current_dir(cwd)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::inherit())
                .kill_on_drop(true);
            if let Some(p) = provider {
                cmd.arg("--provider").arg(p);
            }
            if let Some(m) = model {
                cmd.arg("--model").arg(m);
            }
            let mut child = cmd.spawn()?;
            let mut input = child
                .stdin
                .take()
                .ok_or_else(|| anyhow!("AX stdin unavailable"))?;
            let mut reader = tokio::io::BufReader::new(
                child
                    .stdout
                    .take()
                    .ok_or_else(|| anyhow!("AX stdout unavailable"))?,
            )
            .lines();
            ax::call(
                &mut input,
                &mut reader,
                1,
                "initialize",
                json!({"protocolVersion":1}),
            )
            .await?;
            ax::send(
                &mut input,
                &json!({"jsonrpc":"2.0","id":2,"method":method,"params":params}),
            )
            .await?;
            loop {
                let msg = ax::next(&mut reader).await?;
                if msg["id"] == 2 {
                    if !msg["error"].is_null() {
                        return Err(anyhow!("AX ACP {method}: {}", msg["error"]));
                    }
                    return Ok(Inspection {
                        result: msg["result"].clone(),
                        updates,
                    });
                }
                if msg["method"] == "session/update" {
                    updates.push(msg["params"].clone());
                }
            }
        }
        let link = self
            .gateway
            .link(device)
            .ok_or_else(|| anyhow!("remote device offline"))?;
        let (run, mut rx) = link.open_run();
        let result = async {
            link.send(
                json!({"type":"open","run_id":run,"cwd":cwd,"provider":provider,"model":model}),
            )?;
            loop {
                let msg = rx
                    .recv()
                    .await
                    .ok_or_else(|| anyhow!("remote device disconnected"))?;
                if msg["type"] == "opened" {
                    break;
                }
                if msg["type"] == "error" {
                    return Err(anyhow!("remote open: {}", msg["error"]));
                }
            }
            device::remote_call(
                &link,
                &run,
                &mut rx,
                1,
                "initialize",
                json!({"protocolVersion":1}),
            )
            .await?;
            device::remote_send(
                &link,
                &run,
                json!({"jsonrpc":"2.0","id":2,"method":method,"params":params}),
            )
            .await?;
            loop {
                let msg = device::remote_next(&mut rx).await?;
                if msg["id"] == 2 {
                    if !msg["error"].is_null() {
                        return Err(anyhow!("remote ACP {method}: {}", msg["error"]));
                    }
                    return Ok(Inspection {
                        result: msg["result"].clone(),
                        updates,
                    });
                }
                if msg["method"] == "session/update" {
                    updates.push(msg["params"].clone());
                }
            }
        }
        .await;
        link.send(json!({"type":"close","run_id":run})).ok();
        link.close_run(&run);
        result
    }
}

#[async_trait]
impl Transport for DeviceRouter {
    async fn execute(
        &self,
        task: &Task,
        member: &Member,
        session: Option<String>,
        cancel: watch::Receiver<bool>,
        events: mpsc::UnboundedSender<TransportEvent>,
    ) -> Result<Value> {
        if task.assigned_device == "local" {
            self.local
                .execute(task, member, session, cancel, events)
                .await
        } else {
            device::RemoteTransport {
                gateway: self.gateway.clone(),
                approvals: self.approvals.clone(),
            }
            .execute(task, member, session, cancel, events)
            .await
        }
    }
}

/// The permission round-trip both transports share: register the request, tell
/// the clients, and wait for an answer (a cancel or a five-minute timeout denies).
pub(crate) async fn permission(
    approvals: &ApprovalBroker,
    request: &Value,
    events: &mpsc::UnboundedSender<TransportEvent>,
    cancel: &mut watch::Receiver<bool>,
) -> String {
    let Some(id) = request["id"].as_str().map(str::to_owned) else {
        return "reject_once".into();
    };
    let receiver = approvals.register(id.clone(), request["params"].clone());
    events
        .send(TransportEvent::Update(
            json!({"kind":"permission.requested","request_id":id,"request":request["params"]}),
        ))
        .ok();
    let choice = tokio::select! {
        result=tokio::time::timeout(std::time::Duration::from_secs(300),receiver)=>result.ok().and_then(Result::ok).unwrap_or_else(||"reject_once".into()),
        _=cancel.changed()=>"reject_once".into(),
    };
    approvals.forget(&id);
    events
        .send(TransportEvent::Update(
            json!({"kind":"permission.resolved","request_id":id,"choice":choice}),
        ))
        .ok();
    choice
}
