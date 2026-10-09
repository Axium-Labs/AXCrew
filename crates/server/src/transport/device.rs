//! The remote AX transport: ACP frames wrapped in the gateway's routed envelope
//! and carried over the outbound WebSocket a paired device opened.

use super::{RunControl, SteerReplies, Transport, TransportEvent, permission};
use crate::{
    domain::{crew::Member, task::Task},
    gateway::{Gateway, Link},
    orchestration::approval::ApprovalBroker,
};
use anyhow::{Result, anyhow};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::mpsc;

pub(super) struct RemoteTransport {
    pub gateway: Gateway,
    pub approvals: ApprovalBroker,
}

#[async_trait]
impl Transport for RemoteTransport {
    async fn execute(
        &self,
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
            let mut steer_replies=SteerReplies::default();let mut steering_open=true;
            let mut permissions=tokio::task::JoinSet::new();
            loop {
                let msg=tokio::select!{
                    biased;
                    changed=cancel.changed(),if !cancellation_sent=>{if changed.is_ok()&&*cancel.borrow(){remote_send(&link,&run,json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}})).await?;cancellation_sent=true;}continue;}
                    request=steering.recv(),if steering_open&&!cancellation_sent=>{
                        if let Some(request)=request {remote_send(&link,&run,steer_replies.frame(request,&session)).await?;}else{steering_open=false;}continue;
                    }
                    choice=permissions.join_next(),if !permissions.is_empty()=>{
                        let (id,choice)=choice.ok_or_else(||anyhow!("permission task missing"))??;
                        remote_send(&link,&run,json!({"jsonrpc":"2.0","id":id,"result":{"outcome":{"outcome":"selected","optionId":choice}}})).await?;continue;
                    }
                    msg=remote_next(&mut rx)=>msg?,
                };
                if steer_replies.receive(&msg){continue;}
                if msg["method"]=="session/request_permission" {
                    let approvals=self.approvals.clone();let events=events.clone();let mut cancel=cancel.clone();
                    permissions.spawn(async move {let choice=permission(&approvals,&msg,&events,&mut cancel).await;(msg["id"].clone(),choice)});
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

/// Sends an ACP frame inside the device envelope for one run.
pub(super) async fn remote_send(link: &Link, run: &str, payload: Value) -> Result<()> {
    link.send(json!({"type":"acp","run_id":run,"payload":payload}))
}

/// Returns the next ACP frame for a run, surfacing device errors as errors.
pub(super) async fn remote_next(rx: &mut mpsc::UnboundedReceiver<Value>) -> Result<Value> {
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

pub(super) async fn remote_call(
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
