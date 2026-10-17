//! Personal Weixin via Tencent's published iLink bot protocol (text/private only).
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
const ORIGIN: &str = "https://ilinkai.weixin.qq.com";
#[derive(Clone)]
pub struct Login {
    pub id: String,
    pub qrcode: String,
    pub origin: String,
    pub expires: i64,
}
fn origin(value: &str) -> Result<String> {
    let url = reqwest::Url::parse(value)?;
    ensure!(
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|h| h == "ilinkai.weixin.qq.com" || h.ends_with(".weixin.qq.com"))
            && url.port_or_known_default() == Some(443)
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url.path() == "/",
        "untrusted Weixin API origin"
    );
    Ok(url.as_str().trim_end_matches('/').into())
}
fn request(channels: &Channels, url: String, token: Option<&str>) -> reqwest::RequestBuilder {
    let mut request = channels
        .http
        .post(url)
        .header("AuthorizationType", "ilink_bot_token")
        .header(
            "X-WECHAT-UIN",
            STANDARD.encode(rand::random::<u32>().to_string()),
        )
        .header("iLink-App-Id", "bot")
        .header("iLink-App-ClientVersion", "132106");
    if let Some(token) = token {
        request = request.bearer_auth(token)
    }
    request
}
async fn call(
    channels: &Channels,
    cfg: &ChannelConfig,
    path: &str,
    mut body: Value,
) -> Result<Value> {
    let host = origin(&cfg.origin)?;
    body["base_info"] = json!({"channel_version":"2.4.10","bot_agent":concat!("AXCrew/",env!("CARGO_PKG_VERSION"))});
    let response = request(
        channels,
        format!("{host}/ilink/bot/{path}"),
        Some(&cfg.secret),
    )
    .json(&body)
    .send()
    .await
    .map_err(|_| anyhow::anyhow!("Weixin network error"))?;
    response_json(response).await
}
pub async fn begin(channels: &Channels) -> Result<Value> {
    let revision = channels
        .changes
        .borrow()
        .get("weixin")
        .copied()
        .unwrap_or(0);
    let cfg = channels
        .store
        .snapshot()
        .configs
        .get("weixin")
        .cloned()
        .unwrap_or_default();
    ensure!(
        std::path::Path::new(&cfg.cwd).is_dir(),
        "请先保存存在的工作目录"
    );
    let id = uuid::Uuid::new_v4().to_string();
    {
        let mut login = channels.login.lock().unwrap();
        ensure!(
            channels
                .changes
                .borrow()
                .get("weixin")
                .copied()
                .unwrap_or(0)
                == revision,
            "configuration changed; start login again"
        );
        *login = Some(Login {
            id: id.clone(),
            qrcode: String::new(),
            origin: ORIGIN.into(),
            expires: unix_now() + 300,
        });
    }
    let response = request(
        channels,
        format!("{ORIGIN}/ilink/bot/get_bot_qrcode?bot_type=3"),
        None,
    )
    .json(&json!({"local_token_list":[]}))
    .send()
    .await
    .map_err(|_| anyhow::anyhow!("无法获取微信登录二维码"))?;
    let value = response_json(response).await?;
    let qrcode = value["qrcode"]
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 4096)
        .ok_or_else(|| anyhow::anyhow!("微信未返回二维码"))?
        .to_owned();
    let content = value["qrcode_img_content"]
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 8192)
        .ok_or_else(|| anyhow::anyhow!("微信未返回二维码内容"))?
        .to_owned();
    let mut login = channels.login.lock().unwrap();
    ensure!(
        login.as_ref().is_some_and(|l| l.id == id),
        "login was cancelled or replaced"
    );
    *login = Some(Login {
        id: id.clone(),
        qrcode,
        origin: ORIGIN.into(),
        expires: unix_now() + 300,
    });
    Ok(json!({"id":id,"content":content,"expires_at":unix_now()+300}))
}
pub async fn poll(channels: &Channels, id: &str, verify: Option<&str>) -> Result<Value> {
    let login = channels
        .login
        .lock()
        .unwrap()
        .clone()
        .filter(|l| l.id == id && l.expires > unix_now())
        .ok_or_else(|| anyhow::anyhow!("登录二维码已过期，请重新获取"))?;
    let mut url = reqwest::Url::parse(&format!("{}/ilink/bot/get_qrcode_status", login.origin))?;
    url.query_pairs_mut().append_pair("qrcode", &login.qrcode);
    if let Some(code) = verify {
        ensure!(
            code.len() <= 32 && code.is_ascii(),
            "invalid verification code"
        );
        url.query_pairs_mut().append_pair("verify_code", code);
    }
    let response = channels
        .http
        .get(url)
        .header("iLink-App-Id", "bot")
        .header("iLink-App-ClientVersion", "132106")
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("微信登录查询失败"))?;
    let value = response_json(response).await?;
    let mut current = channels.login.lock().unwrap();
    ensure!(
        current.as_ref().is_some_and(|l| l.id == id),
        "login was cancelled or replaced"
    );
    match value["status"].as_str().unwrap_or("wait") {
        "confirmed" => {
            let token = value["bot_token"]
                .as_str()
                .filter(|v| !v.is_empty() && v.len() <= 4096 && !v.contains(['\r', '\n']))
                .ok_or_else(|| anyhow::anyhow!("微信未返回登录凭据"))?;
            let host = origin(value["baseurl"].as_str().unwrap_or(ORIGIN))?;
            let account = value["ilink_bot_id"]
                .as_str()
                .filter(|v| !v.is_empty() && v.len() <= 512)
                .ok_or_else(|| anyhow::anyhow!("微信未返回账号"))?;
            channels.store.update(|state| {
                let cfg = state.configs.entry("weixin".into()).or_default();
                ensure!(std::path::Path::new(&cfg.cwd).is_dir(), "工作目录不可用");
                cfg.secret = token.into();
                cfg.account = account.into();
                cfg.origin = host;
                cfg.enabled = true;
                cfg.cursor.clear();
                cfg.peers.clear();
                state.inbox.retain(|m| m.platform != "weixin");
                Ok(())
            })?;
            *current = None;
            channels
                .changes
                .send_modify(|v| *v.entry("weixin".into()).or_default() += 1);
            Ok(json!({"status":"confirmed"}))
        }
        "scaned_but_redirect" => {
            let host = value["redirect_host"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("missing redirect host"))?;
            let host = if host.starts_with("https://") {
                host.to_string()
            } else {
                format!("https://{host}")
            };
            if let Some(current) = current.as_mut() {
                current.origin = origin(&host)?;
            }
            Ok(json!({"status":"wait"}))
        }
        "expired" | "verify_code_blocked" => {
            *current = None;
            Ok(json!({"status":"expired"}))
        }
        "need_verifycode" => Ok(json!({"status":"need_verifycode"})),
        "binded_redirect" => {
            *current = None;
            Ok(json!({"status":"already_bound"}))
        }
        "scaned" => Ok(json!({"status":"scaned"})),
        _ => Ok(json!({"status":"wait"})),
    }
}
pub async fn run(app: &App, cfg: &ChannelConfig) -> Result<()> {
    let mut cursor = cfg.cursor.clone();
    loop {
        let value = call(
            &app.channels,
            cfg,
            "getupdates",
            json!({"get_updates_buf":cursor}),
        )
        .await?;
        if value["ret"] == -14 || value["errcode"] == -14 {
            app.channels.set_state("weixin", "login_required");
            std::future::pending::<()>().await;
        }
        ensure!(
            value["ret"].as_i64().unwrap_or(0) == 0 && value["errcode"].as_i64().unwrap_or(0) == 0,
            "Weixin rejected update request"
        );
        app.channels.set_state("weixin", "connected");
        let messages = value["msgs"].as_array().cloned().unwrap_or_default();
        for message in &messages {
            if message["message_type"] != 1
                || message["message_state"].as_i64().unwrap_or(2) != 2
                || message["group_id"].as_str().is_some_and(|v| !v.is_empty())
            {
                continue;
            }
            if message["create_time_ms"]
                .as_i64()
                .is_some_and(|date| date / 1000 < unix_now() - 300)
            {
                continue;
            }
            let text = message["item_list"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|i| i["type"] == 1)
                .filter_map(|i| i["text_item"]["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n");
            let sender = message["from_user_id"].as_str().unwrap_or_default();
            let context = message["context_token"].as_str().unwrap_or_default();
            let id = message["message_id"]
                .as_i64()
                .map(|v| v.to_string())
                .or_else(|| message["client_id"].as_str().map(str::to_owned));
            if !sender.is_empty()
                && !text.is_empty()
                && !context.is_empty()
                && let Some(id) = id
            {
                app.channels.enqueue(Inbound {
                    platform: "weixin".into(),
                    id: format!("{}:{id}", cfg.account),
                    chat: sender.into(),
                    sender: sender.into(),
                    text,
                    context: context.into(),
                })?;
            }
        }
        if let Some(next) = value["get_updates_buf"].as_str().filter(|v| !v.is_empty()) {
            cursor = next.into();
            app.channels.cursor("weixin", cursor.clone(), &cfg.secret)?;
        }
        if messages.is_empty() {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
}
pub async fn send(channels: &Channels, cfg: &ChannelConfig, peer: &Peer, text: &str) -> Result<()> {
    ensure!(!peer.context.is_empty(), "Weixin reply context unavailable");
    let value=call(channels,cfg,"sendmessage",json!({"msg":{"from_user_id":"","to_user_id":peer.sender,"client_id":uuid::Uuid::new_v4().to_string(),"message_type":2,"message_state":2,"context_token":peer.context,"item_list":[{"type":1,"text_item":{"text":text}}]}})).await?;
    ensure!(
        value["ret"].as_i64().unwrap_or(0) == 0,
        "Weixin rejected reply"
    );
    Ok(())
}
