//! Telegram Bot API: private messages over outbound HTTPS long polling.
use super::*;
async fn call(
    channels: &Channels,
    cfg: &ChannelConfig,
    method: &str,
    body: Value,
) -> Result<Value> {
    ensure!(
        cfg.secret.contains(':') && cfg.secret.is_ascii() && !cfg.secret.contains(['/', '?', '#']),
        "invalid Telegram bot token"
    );
    let response = channels
        .http
        .post(format!(
            "https://api.telegram.org/bot{}/{method}",
            cfg.secret
        ))
        .json(&body)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Telegram network error"))?;
    let value = response_json(response).await?;
    ensure!(value["ok"] == true, "Telegram rejected operation");
    Ok(value["result"].clone())
}
pub async fn run(app: &App, cfg: &ChannelConfig) -> Result<()> {
    call(&app.channels, cfg, "getMe", json!({})).await?;
    let webhook = call(&app.channels, cfg, "getWebhookInfo", json!({})).await?;
    ensure!(
        webhook["url"].as_str().unwrap_or_default().is_empty(),
        "Telegram bot already uses a webhook"
    );
    let mut offset = cfg.cursor.parse::<i64>().ok();
    if offset.is_none() {
        let backlog = call(
            &app.channels,
            cfg,
            "getUpdates",
            json!({"offset":-1,"timeout":0,"allowed_updates":["message"]}),
        )
        .await?;
        offset = Some(
            backlog
                .as_array()
                .and_then(|a| a.last())
                .and_then(|m| m["update_id"].as_i64())
                .unwrap_or(-1)
                + 1,
        );
        app.channels
            .cursor("telegram", offset.unwrap().to_string(), &cfg.secret)?;
    }
    app.channels.set_state("telegram", "connected");
    loop {
        let result = call(
            &app.channels,
            cfg,
            "getUpdates",
            json!({"offset":offset,"timeout":25,"limit":50,"allowed_updates":["message"]}),
        )
        .await?;
        let updates = result
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("invalid Telegram updates"))?;
        for update in updates {
            let Some(id) = update["update_id"].as_i64() else {
                continue;
            };
            let message = &update["message"];
            if message["chat"]["type"] == "private"
                && message["from"]["is_bot"] == false
                && message["date"]
                    .as_i64()
                    .is_some_and(|date| date >= unix_now() - 300)
                && let (Some(text), Some(chat), Some(sender)) = (
                    message["text"].as_str(),
                    message["chat"]["id"].as_i64(),
                    message["from"]["id"].as_i64(),
                )
            {
                app.channels.enqueue(Inbound {
                    platform: "telegram".into(),
                    id: id.to_string(),
                    chat: chat.to_string(),
                    sender: sender.to_string(),
                    text: text.into(),
                    context: String::new(),
                })?;
            }
            offset = Some(offset.unwrap_or(0).max(id + 1));
            app.channels
                .cursor("telegram", offset.unwrap().to_string(), &cfg.secret)?;
        }
        if updates.is_empty() {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}
pub async fn send(channels: &Channels, cfg: &ChannelConfig, peer: &Peer, text: &str) -> Result<()> {
    call(
        channels,
        cfg,
        "sendMessage",
        json!({"chat_id":peer.chat,"text":text,"link_preview_options":{"is_disabled":true}}),
    )
    .await?;
    Ok(())
}
