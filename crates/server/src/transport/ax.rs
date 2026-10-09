//! The local AX transport: line-delimited JSON-RPC 2.0 over the stdio of an
//! `ax acp` child process, started in the member's workspace.

use super::{RunControl, SteerReplies, Transport, TransportEvent, permission};
use crate::domain::{crew::Member, task::Task};
use crate::orchestration::approval::ApprovalBroker;
use anyhow::{Result, anyhow};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::PathBuf;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{ChildStdin, ChildStdout, Command},
    sync::mpsc,
};

#[derive(Clone)]
pub struct LocalTransport {
    pub ax: PathBuf,
    pub approvals: ApprovalBroker,
}

impl LocalTransport {
    pub(super) fn command_for(&self, task: &Task, member: &Member) -> Command {
        let mut cmd = Command::new(&self.ax);
        cmd.env_remove("AX_SSH_CONTEXT")
            .env_remove("AX_SSH_CONTEXT_FILE");
        if let Some(home) = crate::ax::ax_home() {
            cmd.env("AX_HOME", home);
        }
        cmd.arg("acp")
            .current_dir(&member.cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);
        if let Some(provider) = &member.provider {
            cmd.arg("--provider").arg(provider);
        }
        if let Some(model) = &member.model {
            cmd.arg("--model").arg(model);
        }
        if let Some(effort) = task.input.get("reasoning_effort").and_then(Value::as_str) {
            cmd.arg("--reasoning-effort").arg(effort);
        }
        cmd
    }
}

#[async_trait]
impl Transport for LocalTransport {
    async fn execute(
        &self,
        task: &Task,
        member: &Member,
        session: Option<String>,
        control: RunControl,
        events: mpsc::UnboundedSender<TransportEvent>,
    ) -> Result<Value> {
        let cmd = self.command_for(task, member);
        execute_process(cmd, &self.approvals, task, member, session, control, events).await
    }
}

/// Shared ACP execution lifecycle for local AX, including SSH-configured runtimes.
pub(super) async fn execute_process(
    mut cmd: Command,
    approvals: &ApprovalBroker,
    task: &Task,
    member: &Member,
    session: Option<String>,
    control: RunControl,
    events: mpsc::UnboundedSender<TransportEvent>,
) -> Result<Value> {
    let RunControl {
        mut cancel,
        mut steering,
    } = control;
    let mut child = cmd.spawn()?;
    let mut input = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("AX stdin unavailable"))?;
    let mut reader = BufReader::new(
        child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("AX stdout unavailable"))?,
    )
    .lines();
    call(&mut input,&mut reader,1,"initialize",json!({"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"AX Crew","version":env!("CARGO_PKG_VERSION")}})).await?;
    let session = if let Some(id) = session {
        call(
                &mut input,
                &mut reader,
                2,
                "session/resume",
                json!({"sessionId":id,"cwd":member.cwd,"mcpServers":[],"_ax":{"skills":member.skills,"mcpServers":member.mcp_servers,"permissionProfile":member.permission_profile}}),
            )
            .await?;
        id
    } else {
        let value = call(
                &mut input,
                &mut reader,
                2,
                "session/new",
                json!({"cwd":member.cwd,"mcpServers":[],"_ax":{"skills":member.skills,"mcpServers":member.mcp_servers,"permissionProfile":member.permission_profile}}),
            )
            .await?;
        value["sessionId"]
            .as_str()
            .ok_or_else(|| anyhow!("AX omitted sessionId"))?
            .to_owned()
    };
    events.send(TransportEvent::Bound(session.clone())).ok();
    let prompt = task
        .input
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| task.input.to_string());
    send(&mut input,&json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":session,"prompt":[{"type":"text","text":prompt}]}})).await?;
    let mut output = String::new();
    let mut cancellation_sent = false;
    let mut steer_replies = SteerReplies::default();
    let mut steering_open = true;
    let mut permissions = tokio::task::JoinSet::new();
    loop {
        let msg = tokio::select! {
            biased;
            changed=cancel.changed(), if !cancellation_sent => {
                if changed.is_ok() && *cancel.borrow() {
                    send(&mut input,&json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}})).await?;
                    cancellation_sent=true;
                }
                continue;
            }
            request=steering.recv(), if steering_open && !cancellation_sent => {
                if let Some(request)=request { send(&mut input,&steer_replies.frame(request,&session)).await?; }
                else { steering_open=false; }
                continue;
            }
            choice=permissions.join_next(), if !permissions.is_empty() => {
                let (id,choice)=choice.ok_or_else(||anyhow!("permission task missing"))??;
                send(&mut input,&json!({"jsonrpc":"2.0","id":id,"result":{"outcome":{"outcome":"selected","optionId":choice}}})).await?;
                continue;
            }
            msg=next(&mut reader)=>msg?,
        };
        if steer_replies.receive(&msg) {
            continue;
        }
        if msg["method"] == "session/request_permission" {
            let approvals = approvals.clone();
            let events = events.clone();
            let mut cancel = cancel.clone();
            permissions.spawn(async move {
                let choice = permission(&approvals, &msg, &events, &mut cancel).await;
                (msg["id"].clone(), choice)
            });
        } else if msg["method"] == "session/update" {
            let update = &msg["params"]["update"];
            if update["sessionUpdate"] == "agent_message_chunk"
                && let Some(text) = update["content"]["text"].as_str()
            {
                output.push_str(text);
            }
            events.send(TransportEvent::Update(update.clone())).ok();
        } else if msg["id"] == 3 {
            if !msg["error"].is_null() {
                return Err(anyhow!("AX prompt failed: {}", msg["error"]));
            }
            if msg["result"]["stopReason"] == "cancelled" {
                return Err(anyhow!("task cancelled"));
            }
            return Ok(json!({"text":output,"session_id":session}));
        }
    }
}

/// Writes one JSON-RPC frame to the child's stdin.
pub(super) async fn send(input: &mut ChildStdin, value: &Value) -> Result<()> {
    input
        .write_all(serde_json::to_string(value)?.as_bytes())
        .await?;
    input.write_all(b"\n").await?;
    input.flush().await?;
    Ok(())
}

/// Reads the next JSON-RPC frame from the child's stdout.
pub(super) async fn next(reader: &mut Lines<BufReader<ChildStdout>>) -> Result<Value> {
    let line = reader
        .next_line()
        .await?
        .ok_or_else(|| anyhow!("AX ACP process closed"))?;
    Ok(serde_json::from_str(&line)?)
}

pub(super) async fn call(
    input: &mut ChildStdin,
    reader: &mut Lines<BufReader<ChildStdout>>,
    id: i64,
    method: &str,
    params: Value,
) -> Result<Value> {
    send(
        input,
        &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
    )
    .await?;
    loop {
        let msg = next(reader).await?;
        if msg["id"] == id {
            if !msg["error"].is_null() {
                return Err(anyhow!("AX ACP {method}: {}", msg["error"]));
            }
            return Ok(msg["result"].clone());
        }
    }
}
