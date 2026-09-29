use crate::approval::ApprovalBroker;
use crate::db::{Member, Task};
use crate::gateway::{Gateway, Link};
use anyhow::{Result, anyhow};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::PathBuf;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{ChildStdin, ChildStdout, Command},
    sync::{mpsc, watch},
};

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
pub struct LocalTransport {
    pub ax: PathBuf,
    pub approvals: ApprovalBroker,
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
            let mut reader = BufReader::new(
                child
                    .stdout
                    .take()
                    .ok_or_else(|| anyhow!("AX stdout unavailable"))?,
            )
            .lines();
            call(
                &mut input,
                &mut reader,
                1,
                "initialize",
                json!({"protocolVersion":1}),
            )
            .await?;
            send(
                &mut input,
                &json!({"jsonrpc":"2.0","id":2,"method":method,"params":params}),
            )
            .await?;
            loop {
                let msg = next(&mut reader).await?;
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
            remote_call(
                &link,
                &run,
                &mut rx,
                1,
                "initialize",
                json!({"protocolVersion":1}),
            )
            .await?;
            remote_send(
                &link,
                &run,
                json!({"jsonrpc":"2.0","id":2,"method":method,"params":params}),
            )
            .await?;
            loop {
                let msg = remote_next(&mut rx).await?;
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
            RemoteTransport {
                gateway: self.gateway.clone(),
                approvals: self.approvals.clone(),
            }
            .execute(task, member, session, cancel, events)
            .await
        }
    }
}

struct RemoteTransport {
    gateway: Gateway,
    approvals: ApprovalBroker,
}
async fn permission(
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
async fn remote_send(link: &Link, run: &str, payload: Value) -> Result<()> {
    link.send(json!({"type":"acp","run_id":run,"payload":payload}))
}
async fn remote_next(rx: &mut mpsc::UnboundedReceiver<Value>) -> Result<Value> {
    loop {
        let msg = rx
            .recv()
            .await
            .ok_or_else(|| anyhow!("remote device disconnected"))?;
        if msg["type"] == "error" {
            return Err(anyhow!("remote AX: {}", msg["error"]));
        }
        if msg["type"] == "acp" {
            return Ok(msg["payload"].clone());
        }
    }
}
async fn remote_call(
    link: &Link,
    run: &str,
    rx: &mut mpsc::UnboundedReceiver<Value>,
    id: i64,
    method: &str,
    params: Value,
) -> Result<Value> {
    remote_send(
        link,
        run,
        json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
    )
    .await?;
    loop {
        let msg = remote_next(rx).await?;
        if msg["id"] == id {
            if !msg["error"].is_null() {
                return Err(anyhow!("remote ACP {method}: {}", msg["error"]));
            }
            return Ok(msg["result"].clone());
        }
    }
}
#[async_trait]
impl Transport for RemoteTransport {
    async fn execute(
        &self,
        task: &Task,
        member: &Member,
        session: Option<String>,
        mut cancel: watch::Receiver<bool>,
        events: mpsc::UnboundedSender<TransportEvent>,
    ) -> Result<Value> {
        let link = self
            .gateway
            .link(&task.assigned_device)
            .ok_or_else(|| anyhow!("remote device offline"))?;
        let (run, mut rx) = link.open_run();
        let result=async {
            let mut open = json!({"type":"open","run_id":run,"cwd":member.cwd,"provider":member.provider,"model":member.model});
            if let Some(effort) = task.input.get("reasoning_effort").and_then(Value::as_str) {
                open["reasoning_effort"] = Value::String(effort.to_owned());
            }
            link.send(open)?;
            loop {let msg=rx.recv().await.ok_or_else(||anyhow!("remote device disconnected"))?;
                if msg["type"]=="opened" {break;}
                if msg["type"]=="error" {return Err(anyhow!("remote open: {}",msg["error"]));}
            }
            remote_call(&link,&run,&mut rx,1,"initialize",json!({"protocolVersion":1,"clientCapabilities":{}})).await?;
            let session=if let Some(id)=session {
                remote_call(&link,&run,&mut rx,2,"session/resume",json!({"sessionId":id,"cwd":member.cwd,"mcpServers":[],"_ax":{"skills":member.skills,"mcpServers":member.mcp_servers,"permissionProfile":member.permission_profile}})).await?;id
            }else{
                let value=remote_call(&link,&run,&mut rx,2,"session/new",json!({"cwd":member.cwd,"mcpServers":[],"_ax":{"skills":member.skills,"mcpServers":member.mcp_servers,"permissionProfile":member.permission_profile}})).await?;
                value["sessionId"].as_str().ok_or_else(||anyhow!("AX omitted sessionId"))?.to_owned()
            };
            events.send(TransportEvent::Bound(session.clone())).ok();
            let prompt=task.input.as_str().map(str::to_owned).unwrap_or_else(||task.input.to_string());
            remote_send(&link,&run,json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":session,"prompt":[{"type":"text","text":prompt}]}})).await?;
            let mut output=String::new();let mut cancellation_sent=false;
            loop {
                let msg=tokio::select!{
                    biased;
                    changed=cancel.changed(),if !cancellation_sent=>{if changed.is_ok()&&*cancel.borrow(){remote_send(&link,&run,json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}})).await?;cancellation_sent=true;}continue;}
                    msg=remote_next(&mut rx)=>msg?,
                };
                if msg["method"]=="session/request_permission" {
                    let choice=permission(&self.approvals,&msg,&events,&mut cancel).await;
                    remote_send(&link,&run,json!({"jsonrpc":"2.0","id":msg["id"],"result":{"outcome":{"outcome":"selected","optionId":choice}}})).await?;
                    if *cancel.borrow()&&!cancellation_sent {remote_send(&link,&run,json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}})).await?;cancellation_sent=true;}
                }else if msg["method"]=="session/update" {
                    let update=&msg["params"]["update"];
                    if update["sessionUpdate"]=="agent_message_chunk"&&let Some(text)=update["content"]["text"].as_str(){output.push_str(text);}
                    events.send(TransportEvent::Update(update.clone())).ok();
                }else if msg["id"]==3 {
                    if !msg["error"].is_null(){return Err(anyhow!("remote prompt failed: {}",msg["error"]));}
                    if msg["result"]["stopReason"]=="cancelled" {return Err(anyhow!("task cancelled"));}
                    return Ok(json!({"text":output,"session_id":session}));
                }
            }
        }.await;
        link.send(json!({"type":"close","run_id":run})).ok();
        link.close_run(&run);
        result
    }
}

async fn send(input: &mut ChildStdin, value: &Value) -> Result<()> {
    input
        .write_all(serde_json::to_string(value)?.as_bytes())
        .await?;
    input.write_all(b"\n").await?;
    input.flush().await?;
    Ok(())
}
async fn next(reader: &mut Lines<BufReader<ChildStdout>>) -> Result<Value> {
    let line = reader
        .next_line()
        .await?
        .ok_or_else(|| anyhow!("AX ACP process closed"))?;
    Ok(serde_json::from_str(&line)?)
}
async fn call(
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

#[async_trait]
impl Transport for LocalTransport {
    async fn execute(
        &self,
        task: &Task,
        member: &Member,
        session: Option<String>,
        mut cancel: watch::Receiver<bool>,
        events: mpsc::UnboundedSender<TransportEvent>,
    ) -> Result<Value> {
        let mut cmd = Command::new(&self.ax);
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
                msg=next(&mut reader)=>msg?,
            };
            if msg["method"] == "session/request_permission" {
                let choice = permission(&self.approvals, &msg, &events, &mut cancel).await;
                send(&mut input,&json!({"jsonrpc":"2.0","id":msg["id"],"result":{"outcome":{"outcome":"selected","optionId":choice}}})).await?;
                if *cancel.borrow() && !cancellation_sent {
                    send(&mut input,&json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}})).await?;
                    cancellation_sent = true;
                }
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
}
