//! WeCom AI bot long connection with acknowledged private-message replies.
use super::*;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;
pub fn event(v: &Value) -> Option<Inbound> {
    let m = &v["body"];
    if v["cmd"] != "aibot_msg_callback" || m["chattype"] != "single" || m["msgtype"] != "text" {
        return None;
    }
    let sender = m["from"]["userid"].as_str()?;
    Some(Inbound {
        platform: "wecom".into(),
        id: m["msgid"].as_str()?.into(),
        chat: sender.into(),
        sender: sender.into(),
        text: m["text"]["content"].as_str()?.into(),
        context: String::new(),
    })
}
pub async fn run(app: &App, cfg: &ChannelConfig) -> Result<()> {
    let (ws, _) = tokio_tungstenite::connect_async("wss://openws.work.weixin.qq.com").await?;
    serve(app, cfg, ws).await
}
pub async fn serve(
    app: &App,
    cfg: &ChannelConfig,
    mut ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<()> {
    let c = &app.channels;
    let subscribe = uuid::Uuid::new_v4().to_string();
    ws.send(Message::Text(json!({"cmd":"aibot_subscribe","headers":{"req_id":subscribe},"body":{"bot_id":cfg.app_id,"secret":cfg.secret}}).to_string().into())).await?;
    let mut outgoing = c.register("wecom", cfg);
    let mut pending: BTreeMap<
        String,
        (std::time::Instant, tokio::sync::oneshot::Sender<Result<()>>),
    > = BTreeMap::new();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(20));
    let mut last_ack = std::time::Instant::now();
    let mut ready = false;
    loop {
        tokio::select! {
            _=heartbeat.tick()=>{
                ensure!(last_ack.elapsed()<Duration::from_secs(60),"WeCom heartbeat timed out");
                let expired:Vec<_>=pending.iter().filter(|(_, (at,_))|at.elapsed()>Duration::from_secs(20)).map(|(id,_)|id.clone()).collect();
                for id in expired{if let Some((_,reply))=pending.remove(&id){let _=reply.send(Err(anyhow::anyhow!("WeCom delivery acknowledgement timed out")));}}
                ws.send(Message::Text(json!({"cmd":"ping","headers":{"req_id":format!("ping-{}",uuid::Uuid::new_v4())}}).to_string().into())).await?;
            }
            Some(request)=outgoing.recv()=>{
                if !ready{let _=request.reply.send(Err(anyhow::anyhow!("WeCom not subscribed")));continue;}
                let id=uuid::Uuid::new_v4().to_string();
                ws.send(Message::Text(json!({"cmd":"aibot_send_msg","headers":{"req_id":id},"body":request.body}).to_string().into())).await?;
                pending.insert(id,(std::time::Instant::now(),request.reply));
            }
            frame=ws.next()=>{
                let Some(frame)=frame else{return Ok(())};
                match frame?{
                    Message::Text(raw)=>{
                        ensure!(raw.len()<=2*1024*1024,"WeCom frame too large");
                        let v:Value=serde_json::from_str(&raw)?;
                        let id=v["headers"]["req_id"].as_str().unwrap_or_default();
                        if let Some(code)=v["errcode"].as_i64(){
                            if id==subscribe {ensure!(code==0,"WeCom rejected bot credentials");ready=true;c.set_state("wecom","connected");}
                            if id.starts_with("ping-")&&code==0{last_ack=std::time::Instant::now();}
                            if let Some((_,reply))=pending.remove(id){let _=reply.send(if code==0{Ok(())}else{Err(anyhow::anyhow!("WeCom rejected reply ({code})"))});}
                        }
                        if v["body"]["event"]["eventtype"]=="disconnected_event"{return Ok(());}
                        if ready && let Some(m)=event(&v){c.enqueue_current(m,cfg)?;}
                    }
                    Message::Ping(data)=>ws.send(Message::Pong(data)).await?,
                    Message::Close(_)=>return Ok(()),
                    _=>{}
                }
            }
        }
    }
}
