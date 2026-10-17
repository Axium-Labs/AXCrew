//! Slack Socket Mode: private message events and bot replies.
use super::*;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;
async fn call(c: &Channels, token: &str, method: &str, body: Value) -> Result<Value> {
    let response = c
        .http
        .post(format!("https://slack.com/api/{method}"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Slack network error"))?;
    let value = response_json(response).await?;
    ensure!(value["ok"] == true, "Slack rejected operation");
    Ok(value)
}
pub fn event(value: &Value) -> Option<Inbound> {
    let payload = &value["payload"];
    let e = &payload["event"];
    if value["type"] != "events_api"
        || e["type"] != "message"
        || e["channel_type"] != "im"
        || !e["subtype"].is_null()
        || !e["bot_id"].is_null()
    {
        return None;
    }
    if payload["event_time"]
        .as_i64()
        .is_some_and(|t| t < unix_now() - 300)
    {
        return None;
    }
    Some(Inbound {
        platform: "slack".into(),
        id: payload["event_id"].as_str()?.into(),
        chat: e["channel"].as_str()?.into(),
        sender: e["user"].as_str()?.into(),
        text: e["text"].as_str()?.into(),
        context: String::new(),
    })
}
pub async fn run(app: &App, cfg: &ChannelConfig) -> Result<()> {
    let c = &app.channels;
    call(c, &cfg.secret, "auth.test", json!({})).await?;
    let discovery = call(c, &cfg.app_token, "apps.connections.open", json!({})).await?;
    let url = reqwest::Url::parse(discovery["url"].as_str().unwrap_or_default())?;
    ensure!(
        url.scheme() == "wss" && url.host_str().is_some_and(|h| h.ends_with(".slack.com")),
        "invalid Slack socket origin"
    );
    let (ws, _) = tokio_tungstenite::connect_async(url.as_str()).await?;
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
    while let Some(frame) = tokio::time::timeout(Duration::from_secs(90), ws.next()).await? {
        match frame? {
            Message::Text(raw) => {
                ensure!(raw.len() <= 2 * 1024 * 1024, "Slack frame too large");
                let v: Value = serde_json::from_str(&raw)?;
                if v["type"] == "hello" {
                    c.set_state("slack", "connected");
                }
                if v["type"] == "disconnect" {
                    return Ok(());
                }
                if let Some(message) = event(&v) {
                    c.enqueue_current(message, cfg)?;
                }
                if let Some(id) = v["envelope_id"].as_str() {
                    ws.send(Message::Text(json!({"envelope_id":id}).to_string().into()))
                        .await?;
                }
            }
            Message::Ping(data) => ws.send(Message::Pong(data)).await?,
            Message::Close(_) => return Ok(()),
            _ => {}
        }
    }
    Ok(())
}
pub async fn send(c: &Channels, cfg: &ChannelConfig, peer: &Peer, text: &str) -> Result<()> {
    call(c, &cfg.secret, "chat.postMessage", json!({"channel":peer.chat,"text":text,"mrkdwn":false,"unfurl_links":false,"unfurl_media":false})).await?;
    Ok(())
}
