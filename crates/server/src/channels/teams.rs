//! Teams Bot Framework HTTPS ingress, with Microsoft JWT verification.
use super::*;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
pub fn validate_config(cfg: &ChannelConfig) -> Result<()> {
    uuid::Uuid::parse_str(&cfg.app_id)
        .map_err(|_| anyhow::anyhow!("Teams App ID must be a UUID"))?;
    uuid::Uuid::parse_str(&cfg.tenant_id)
        .map_err(|_| anyhow::anyhow!("Teams requires a single-tenant directory UUID"))?;
    let url = reqwest::Url::parse(&cfg.public_url)?;
    ensure!(
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|h| h != "localhost" && h.parse::<std::net::IpAddr>().is_err())
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none(),
        "Teams requires a public HTTPS callback URL"
    );
    Ok(())
}
fn service_url(value: &str) -> Result<reqwest::Url> {
    let url = reqwest::Url::parse(value)?;
    ensure!(
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443)
            && url.query().is_none()
            && url.fragment().is_none()
            && url
                .host_str()
                .is_some_and(|h| h == "smba.trafficmanager.net"
                    || h.ends_with(".botframework.com")
                    || h == "smba.infra.teams.microsoft.com"),
        "untrusted Teams service URL"
    );
    Ok(url)
}
pub fn event(v: &Value, tenant: &str) -> Option<Inbound> {
    if v["type"] != "message"
        || v["channelId"] != "msteams"
        || v["conversation"]["conversationType"] != "personal"
        || v["channelData"]["tenant"]["id"] != tenant
    {
        return None;
    }
    Some(Inbound {
        platform: "teams".into(),
        id: v["id"].as_str()?.into(),
        chat: v["conversation"]["id"].as_str()?.into(),
        sender: v["from"]["id"].as_str()?.into(),
        text: v["text"].as_str()?.into(),
        context: v["serviceUrl"].as_str()?.into(),
    })
}
pub async fn receive(c: &Channels, token: &str, v: &Value) -> Result<()> {
    ensure!(token.len() <= 16384, "invalid Teams token");
    let cfg = c
        .store
        .snapshot()
        .configs
        .get("teams")
        .filter(|c| c.enabled)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Teams disabled"))?;
    let header = decode_header(token)?;
    ensure!(header.alg == Algorithm::RS256, "Teams requires RS256");
    let kid = header
        .kid
        .ok_or_else(|| anyhow::anyhow!("missing Teams signing key"))?;
    let mut cache = c.teams_keys.lock().await;
    if cache
        .as_ref()
        .is_none_or(|(at, _)| at.elapsed() > Duration::from_secs(3600))
    {
        let response = c
            .http
            .get("https://login.botframework.com/v1/.well-known/keys")
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("Microsoft signing key request failed"))?;
        let value = response_json(response).await?;
        *cache = Some((std::time::Instant::now(), value));
    }
    let value = cache.as_ref().unwrap().1.clone();
    drop(cache);
    let raw_key = value["keys"]
        .as_array()
        .and_then(|keys| keys.iter().find(|key| key["kid"] == kid))
        .ok_or_else(|| anyhow::anyhow!("unknown Teams signing key"))?;
    if let Some(endorsements) = raw_key["endorsements"].as_array() {
        ensure!(
            endorsements.is_empty() || endorsements.iter().any(|e| e == "msteams"),
            "Teams key endorsement mismatch"
        );
    }
    let keys: JwkSet = serde_json::from_value(value)?;
    let key = keys
        .find(&kid)
        .ok_or_else(|| anyhow::anyhow!("unknown Teams signing key"))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[&cfg.app_id]);
    validation.set_issuer(&["https://api.botframework.com"]);
    validation.validate_nbf = true;
    validation.set_required_spec_claims(&["exp", "nbf", "iss", "aud"]);
    let claims = decode::<Value>(token, &DecodingKey::from_jwk(key)?, &validation)?.claims;
    let service = v["serviceUrl"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Teams service URL missing"))?;
    service_url(service)?;
    let bound = claims["serviceurl"]
        .as_str()
        .or_else(|| claims["serviceUrl"].as_str())
        .ok_or_else(|| anyhow::anyhow!("Teams service URL claim missing"))?;
    ensure!(
        bound.trim_end_matches('/') == service.trim_end_matches('/'),
        "Teams service URL claim mismatch"
    );
    if let Some(m) = event(v, &cfg.tenant_id) {
        c.enqueue_current(m, &cfg)?;
        c.set_state("teams", "connected");
    }
    Ok(())
}
async fn token(c: &Channels, cfg: &ChannelConfig) -> Result<String> {
    validate_config(cfg)?;
    let r = c
        .http
        .post(format!(
            "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
            cfg.tenant_id
        ))
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", cfg.app_id.as_str()),
            ("client_secret", cfg.secret.as_str()),
            ("scope", "https://api.botframework.com/.default"),
        ])
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Teams token request failed"))?;
    response_json(r).await?["access_token"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| anyhow::anyhow!("Teams token missing"))
}
pub async fn run(app: &App, cfg: &ChannelConfig) -> Result<()> {
    token(&app.channels, cfg).await?;
    app.channels.set_state("teams", "waiting_webhook");
    loop {
        tokio::time::sleep(Duration::from_secs(1800)).await;
        token(&app.channels, cfg).await?;
    }
}
pub async fn send(c: &Channels, cfg: &ChannelConfig, peer: &Peer, text: &str) -> Result<()> {
    let mut url = service_url(&peer.context)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("invalid Teams URL"))?
        .pop_if_empty()
        .push("v3")
        .push("conversations")
        .push(&peer.chat)
        .push("activities");
    let r = c
        .http
        .post(url)
        .bearer_auth(token(c, cfg).await?)
        .json(&json!({"type":"message","text":text,"textFormat":"plain"}))
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Teams reply failed"))?;
    response_json(r).await?;
    Ok(())
}
