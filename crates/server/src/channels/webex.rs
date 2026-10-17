//! Webex bot REST polling. Only direct rooms and messages newer than activation.
use super::*;
async fn get(
    c: &Channels,
    cfg: &ChannelConfig,
    path: &str,
    params: &[(&str, &str)],
) -> Result<Value> {
    let r = c
        .http
        .get(format!("https://webexapis.com/v1/{path}"))
        .bearer_auth(&cfg.secret)
        .query(params)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Webex network error"))?;
    response_json(r).await
}
pub fn event(m: &Value, own: &str, after: &str) -> Option<Inbound> {
    if m["roomType"] != "direct" || m["personId"].as_str()? == own || m["created"].as_str()? < after
    {
        return None;
    }
    Some(Inbound {
        platform: "webex".into(),
        id: m["id"].as_str()?.into(),
        chat: m["roomId"].as_str()?.into(),
        sender: m["personId"].as_str()?.into(),
        text: m["text"].as_str()?.into(),
        context: String::new(),
    })
}
pub async fn run(app: &App, cfg: &ChannelConfig) -> Result<()> {
    let c = &app.channels;
    let me = get(c, cfg, "people/me", &[]).await?;
    let own = me["id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Webex identity missing"))?;
    let mut cursors:Value=serde_json::from_str(&cfg.cursor).unwrap_or_else(|_|json!({"start":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"rooms":{}}));
    let baseline = cursors["start"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("invalid Webex cursor"))?
        .to_owned();
    c.cursor("webex", cursors.to_string(), &cfg.secret)?;
    c.set_state("webex", "connected");
    loop {
        let rooms = get(
            c,
            cfg,
            "rooms",
            &[
                ("type", "direct"),
                ("sortBy", "lastactivity"),
                ("max", "100"),
            ],
        )
        .await?;
        let rooms = rooms["items"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("invalid Webex rooms"))?;
        ensure!(
            rooms.len() < 100,
            "Webex polling supports fewer than 100 direct rooms"
        );
        for room in rooms {
            if room["type"] != "direct" {
                continue;
            }
            let id = room["id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("Webex room ID missing"))?;
            let after = cursors["rooms"][id]
                .as_str()
                .unwrap_or(&baseline)
                .to_owned();
            let result = get(c, cfg, "messages", &[("roomId", id), ("max", "100")]).await?;
            let messages = result["items"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("invalid Webex messages"))?;
            ensure!(
                messages.len() < 100
                    || messages
                        .last()
                        .and_then(|m| m["created"].as_str())
                        .is_some_and(|t| t <= after.as_str()),
                "Webex catchup exceeds 100 messages in one room"
            );
            let mut next = after.clone();
            for m in messages.iter().rev() {
                if let Some(message) = event(m, own, &after) {
                    c.enqueue_current(message, cfg)?;
                }
                if let Some(t) = m["created"].as_str()
                    && t > next.as_str()
                {
                    next = t.into();
                }
            }
            cursors["rooms"][id] = json!(next);
        }
        c.cursor("webex", cursors.to_string(), &cfg.secret)?;
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

pub async fn send(c: &Channels, cfg: &ChannelConfig, peer: &Peer, text: &str) -> Result<()> {
    let r = c
        .http
        .post("https://webexapis.com/v1/messages")
        .bearer_auth(&cfg.secret)
        .json(&json!({"roomId":peer.chat,"text":text}))
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Webex network error"))?;
    response_json(r).await?;
    Ok(())
}
