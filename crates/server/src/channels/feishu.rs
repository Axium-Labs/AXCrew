//! Feishu official outbound WebSocket framing and private text events.
//! Wire schema/reference: larksuite/oapi-sdk-python, lark_oapi/ws (MIT).
use super::*;
use futures_util::{SinkExt, StreamExt};
use prost::Message as ProtoMessage;
use std::{collections::HashMap, time::Instant};
use tokio_tungstenite::tungstenite::Message;

#[derive(Clone, PartialEq, prost::Message)]
pub struct Header {
    #[prost(string, required, tag = "1")]
    pub key: String,
    #[prost(string, required, tag = "2")]
    pub value: String,
}
#[derive(Clone, PartialEq, prost::Message)]
pub struct Frame {
    #[prost(uint64, required, tag = "1")]
    pub seq: u64,
    #[prost(uint64, required, tag = "2")]
    pub log: u64,
    #[prost(int32, required, tag = "3")]
    pub service: i32,
    #[prost(int32, required, tag = "4")]
    pub method: i32,
    #[prost(message, repeated, tag = "5")]
    pub headers: Vec<Header>,
    #[prost(string, optional, tag = "6")]
    pub encoding: Option<String>,
    #[prost(string, optional, tag = "7")]
    pub payload_type: Option<String>,
    #[prost(bytes = "vec", optional, tag = "8")]
    pub payload: Option<Vec<u8>>,
    #[prost(string, optional, tag = "9")]
    pub log_new: Option<String>,
}
impl Frame {
    fn header(&self, key: &str) -> &str {
        self.headers
            .iter()
            .find(|h| h.key == key)
            .map(|h| h.value.as_str())
            .unwrap_or_default()
    }
}
pub fn event(value: &Value, app_id: &str) -> Option<Inbound> {
    if value["header"]["event_type"] != "im.message.receive_v1" {
        return None;
    }
    let event = &value["event"];
    let message = &event["message"];
    if event["sender"]["sender_type"] != "user"
        || message["chat_type"] != "p2p"
        || message["message_type"] != "text"
    {
        return None;
    }
    if message["create_time"]
        .as_str()
        .and_then(|v| v.parse::<i64>().ok())
        .is_some_and(|date| date / 1000 < unix_now() - 300)
    {
        return None;
    }
    let content: Value = serde_json::from_str(message["content"].as_str()?).ok()?;
    Some(Inbound {
        platform: "feishu".into(),
        id: format!("{app_id}:{}", message["message_id"].as_str()?),
        chat: message["chat_id"].as_str()?.into(),
        sender: event["sender"]["sender_id"]["open_id"].as_str()?.into(),
        text: content["text"].as_str()?.into(),
        context: String::new(),
    })
}
pub async fn run(app: &App, cfg: &ChannelConfig) -> Result<()> {
    let response = app
        .channels
        .http
        .post("https://open.feishu.cn/callback/ws/endpoint")
        .header("locale", "zh")
        .json(&json!({"AppID":cfg.app_id,"AppSecret":cfg.secret}))
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Feishu discovery network error"))?;
    let value = response_json(response).await?;
    ensure!(value["code"] == 0, "Feishu rejected app credentials");
    let url = reqwest::Url::parse(
        value["data"]["URL"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing Feishu WebSocket"))?,
    )?;
    ensure!(
        url.scheme() == "wss"
            && url.host_str().is_some_and(|h| h.ends_with(".feishu.cn")
                || h.ends_with(".larksuite.com")
                || h.ends_with(".larkoffice.com"))
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443),
        "untrusted Feishu WebSocket"
    );
    let service = url
        .query_pairs()
        .find(|(key, _)| key == "service_id")
        .ok_or_else(|| anyhow::anyhow!("missing Feishu service ID"))?
        .1
        .parse::<i32>()?;
    let socket_config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
        .max_message_size(Some(2 * 1024 * 1024))
        .max_frame_size(Some(2 * 1024 * 1024));
    let (mut socket, _) =
        tokio_tungstenite::connect_async_with_config(url.as_str(), Some(socket_config), false)
            .await
            .map_err(|_| anyhow::anyhow!("Feishu WebSocket connection failed"))?;
    let seconds = value["data"]["ClientConfig"]["PingInterval"]
        .as_u64()
        .unwrap_or(120)
        .clamp(10, 300);
    let mut ping = tokio::time::interval(Duration::from_secs(seconds));
    type Fragments = HashMap<String, (Instant, Vec<Option<Vec<u8>>>)>;
    let mut fragments: Fragments = HashMap::new();
    app.channels.set_state("feishu", "connected");
    loop {
        tokio::select! {
            _=ping.tick()=>{
                let frame=Frame{seq:0,log:0,service,method:0,headers:vec![Header{key:"type".into(),value:"ping".into()}],encoding:None,payload_type:None,payload:None,log_new:None};
                socket.send(Message::Binary(frame.encode_to_vec().into())).await.map_err(|_|anyhow::anyhow!("Feishu ping failed"))?;
            }
            incoming=socket.next()=>{
                let frame=match incoming {
                    Some(Ok(Message::Binary(bytes)))=>Frame::decode(bytes).map_err(|_|anyhow::anyhow!("invalid Feishu frame"))?,
                    Some(Ok(Message::Ping(data)))=>{socket.send(Message::Pong(data)).await.map_err(|_|anyhow::anyhow!("Feishu pong failed"))?;continue},
                    Some(Ok(Message::Pong(_)))=>continue,
                    _=>anyhow::bail!("Feishu connection closed"),
                };
                if frame.method==0 {
                    if frame.header("type")=="pong"&&let Some(payload)=&frame.payload&&let Ok(config)=serde_json::from_slice::<Value>(payload)&&let Some(interval)=config["PingInterval"].as_u64() {ping=tokio::time::interval(Duration::from_secs(interval.clamp(10,300)));}
                    continue
                }
                if frame.method!=1||frame.header("type")!="event" {continue}
                ensure!(frame.encoding.as_deref().is_none_or(|e|e.is_empty()||e=="json"),"unsupported Feishu payload encoding");
                let count=frame.header("sum").parse::<usize>().unwrap_or(1);let index=frame.header("seq").parse::<usize>().unwrap_or(0);
                ensure!((1..=32).contains(&count)&&index<count,"invalid Feishu fragment count");
                let mut response=frame.clone();let mut payload=frame.payload.clone().unwrap_or_default();
                if count>1 {
                    fragments.retain(|_,(time,_)|time.elapsed()<Duration::from_secs(5));
                    let id=frame.header("message_id").to_string();ensure!(!id.is_empty()&&id.len()<=512,"invalid Feishu message ID");
                    ensure!(fragments.contains_key(&id)||fragments.len()<16,"Feishu fragment limit");
                    let (_,parts)=fragments.entry(id.clone()).or_insert_with(||(Instant::now(),vec![None;count]));
                    ensure!(parts.len()==count,"Feishu fragment count changed");parts[index]=Some(payload);
                    ensure!(parts.iter().flatten().map(Vec::len).sum::<usize>()<=2*1024*1024,"Feishu message too large");
                    if parts.iter().any(Option::is_none){continue}
                    payload=parts.iter().flatten().flatten().copied().collect();fragments.remove(&id);
                }
                let value:Value=serde_json::from_slice(&payload).map_err(|_|anyhow::anyhow!("invalid Feishu event"))?;
                if let Some(message)=event(&value,&cfg.app_id){app.channels.enqueue(message)?;}
                response.payload=Some(br#"{"code":200}"#.to_vec());
                socket.send(Message::Binary(response.encode_to_vec().into())).await.map_err(|_|anyhow::anyhow!("Feishu acknowledgment failed"))?;
            }
        }
    }
}
pub async fn send(channels: &Channels, cfg: &ChannelConfig, peer: &Peer, text: &str) -> Result<()> {
    let cached =
        channels
            .feishu_token
            .lock()
            .unwrap()
            .clone()
            .filter(|(id, secret, _, expires)| {
                id == &cfg.app_id && secret == &cfg.secret && *expires > unix_now() + 60
            });
    let token = if let Some((_, _, token, _)) = cached {
        token
    } else {
        let response = channels
            .http
            .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
            .json(&json!({"app_id":cfg.app_id,"app_secret":cfg.secret}))
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("Feishu token network error"))?;
        let value = response_json(response).await?;
        ensure!(value["code"] == 0, "Feishu token rejected");
        let token = value["tenant_access_token"]
            .as_str()
            .filter(|s| s.len() <= 8192 && !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("missing Feishu tenant token"))?
            .to_string();
        *channels.feishu_token.lock().unwrap() = Some((
            cfg.app_id.clone(),
            cfg.secret.clone(),
            token.clone(),
            unix_now() + value["expire"].as_i64().unwrap_or(300).clamp(60, 7200),
        ));
        token
    };
    let response=channels.http.post("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id").bearer_auth(token).json(&json!({"receive_id":peer.chat,"msg_type":"text","content":json!({"text":text}).to_string(),"uuid":uuid::Uuid::new_v4().simple().to_string()})).send().await.map_err(|_|anyhow::anyhow!("Feishu reply network error"))?;
    let value = response_json(response).await?;
    ensure!(value["code"] == 0, "Feishu rejected reply");
    Ok(())
}
