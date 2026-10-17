//! Discord bot gateway, DIRECT_MESSAGES intent only.
use super::*;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;
pub fn event(v: &Value) -> Option<Inbound> {
    let m = &v["d"];
    if v["t"] != "MESSAGE_CREATE"
        || !m["guild_id"].is_null()
        || m["author"]["bot"] == true
        || !m["webhook_id"].is_null()
    {
        return None;
    }
    Some(Inbound {
        platform: "discord".into(),
        id: m["id"].as_str()?.into(),
        chat: m["channel_id"].as_str()?.into(),
        sender: m["author"]["id"].as_str()?.into(),
        text: m["content"].as_str()?.into(),
        context: String::new(),
    })
}
pub async fn run(app: &App, cfg: &ChannelConfig) -> Result<()> {
    let (ws, _) =
        tokio_tungstenite::connect_async("wss://gateway.discord.gg/?v=10&encoding=json").await?;
    serve(app, cfg, ws).await
}
pub async fn serve(
    app: &App,
    cfg: &ChannelConfig,
    mut ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<()> {
    let hello = tokio::time::timeout(Duration::from_secs(30), ws.next())
        .await?
        .ok_or_else(|| anyhow::anyhow!("Discord closed"))??;
    let hello: Value = serde_json::from_str(hello.to_text()?)?;
    ensure!(hello["op"] == 10, "Discord hello missing");
    let interval = hello["d"]["heartbeat_interval"]
        .as_u64()
        .unwrap_or(45000)
        .clamp(1000, 90000);
    ws.send(Message::Text(json!({"op":2,"d":{"token":cfg.secret,"intents":4096,"properties":{"os":std::env::consts::OS,"browser":"AXCrew","device":"AXCrew"}}}).to_string().into())).await?;
    let mut heartbeat = tokio::time::interval(Duration::from_millis(interval));
    let mut seq = Value::Null;
    let mut acknowledged = true;
    loop {
        tokio::select! {
                   _ = heartbeat.tick() => { ensure!(acknowledged, "Discord heartbeat timed out"); acknowledged=false; ws.send(Message::Text(json!({"op":1,"d":seq}).to_string().into())).await?; }
                   frame = ws.next() => {
                       let Some(frame)=frame else {return Ok(())};
                       match frame? {
                           Message::Text(raw) => {
                               ensure!(raw.len()<=2*1024*1024,"Discord frame too large");
                               let v:Value=serde_json::from_str(&raw)?;
                               if !v["s"].is_null(){seq=v["s"].clone();}
                               match v["op"].as_u64() {
                                   Some(11)=>acknowledged=true,
                                   Some(1)=>ws.send(Message::Text(json!({"op":1,"d":seq}).to_string().into())).await?,
                                   Some(7|9)=>return Ok(()),
                                   Some(0)=>{if v["t"]=="READY"{app.channels.set_state("discord","connected");}
        if let Some(m)=event(&v){app.channels.enqueue_current(m,cfg)?;}},
                                   _=>{}
                               }
                           }
                           Message::Ping(data)=>ws.send(Message::Pong(data)).await?,
                           Message::Close(_)=>return Ok(()),
                           _=>{}
                       }
                   }
               }
    }
}
pub async fn send(c: &Channels, cfg: &ChannelConfig, peer: &Peer, text: &str) -> Result<()> {
    ensure!(
        peer.chat.bytes().all(|b| b.is_ascii_digit()),
        "invalid Discord channel"
    );
    let response = c
        .http
        .post(format!(
            "https://discord.com/api/v10/channels/{}/messages",
            peer.chat
        ))
        .header("Authorization", format!("Bot {}", cfg.secret))
        .json(&json!({"content":text,"allowed_mentions":{"parse":[]}}))
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Discord network error"))?;
    response_json(response).await?;
    Ok(())
}
