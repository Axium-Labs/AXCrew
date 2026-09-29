use crate::db::Db;
use anyhow::{Result, anyhow};
use axum::extract::ws::{Message, WebSocket};
use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::{Notify, mpsc};
use uuid::Uuid;

pub struct Link {
    outbound: mpsc::UnboundedSender<Value>,
    runs: Mutex<HashMap<String, mpsc::UnboundedSender<Value>>>,
    shutdown: Notify,
}
impl Link {
    pub fn send(&self, value: Value) -> Result<()> {
        self.outbound
            .send(value)
            .map_err(|_| anyhow!("remote device disconnected"))
    }
    pub fn open_run(&self) -> (String, mpsc::UnboundedReceiver<Value>) {
        let id = Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::unbounded_channel();
        self.runs.lock().unwrap().insert(id.clone(), tx);
        (id, rx)
    }
    pub fn close_run(&self, id: &str) {
        self.runs.lock().unwrap().remove(id);
    }
    fn dispatch(&self, value: Value) {
        if let Some(id) = value.get("run_id").and_then(Value::as_str)
            && let Some(tx) = self.runs.lock().unwrap().get(id)
        {
            tx.send(value).ok();
        }
    }
}

#[derive(Clone)]
pub struct Gateway {
    pub db: Db,
    pub links: Arc<Mutex<HashMap<String, Arc<Link>>>>,
    pub events: tokio::sync::broadcast::Sender<Value>,
}
impl Gateway {
    pub fn new(db: Db, events: tokio::sync::broadcast::Sender<Value>) -> Self {
        Self {
            db,
            links: Arc::new(Mutex::new(HashMap::new())),
            events,
        }
    }
    pub fn link(&self, id: &str) -> Option<Arc<Link>> {
        self.links.lock().unwrap().get(id).cloned()
    }
    pub fn revoke(&self, id: &str) {
        if let Some(link) = self.links.lock().unwrap().remove(id) {
            link.shutdown.notify_one();
        }
    }
    pub async fn accept(&self, mut socket: WebSocket) -> Result<()> {
        let mut nonce = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let challenge = STANDARD.encode(nonce);
        socket
            .send(Message::Text(
                json!({"type":"challenge","nonce":challenge})
                    .to_string()
                    .into(),
            ))
            .await?;
        let response = tokio::time::timeout(std::time::Duration::from_secs(10), socket.next())
            .await?
            .ok_or_else(|| anyhow!("device closed before authentication"))??;
        let auth: Value = serde_json::from_str(response.to_text()?)?;
        let id = auth["device_id"]
            .as_str()
            .ok_or_else(|| anyhow!("device_id required"))?;
        let device = self
            .db
            .device(id)?
            .ok_or_else(|| anyhow!("unknown or revoked device"))?;
        let bytes = STANDARD.decode(
            device
                .public_key
                .ok_or_else(|| anyhow!("device has no key"))?,
        )?;
        let key = VerifyingKey::from_bytes(
            &bytes
                .try_into()
                .map_err(|_| anyhow!("invalid public key"))?,
        )?;
        let sig_bytes = STANDARD.decode(
            auth["signature"]
                .as_str()
                .ok_or_else(|| anyhow!("signature required"))?,
        )?;
        let signature = Signature::from_slice(&sig_bytes)?;
        key.verify(&nonce, &signature)?;
        let id = id.to_owned();
        socket
            .send(Message::Text(
                json!({"type":"authenticated","device_id":id})
                    .to_string()
                    .into(),
            ))
            .await?;
        let (mut sender, mut receiver) = socket.split();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
        let link = Arc::new(Link {
            outbound: out_tx,
            runs: Mutex::new(HashMap::new()),
            shutdown: Notify::new(),
        });
        self.links.lock().unwrap().insert(id.clone(), link.clone());
        self.db.set_device_status(&id, "connecting")?;
        let mut announced = false;
        let write = tokio::spawn(async move {
            while let Some(value) = out_rx.recv().await {
                if sender
                    .send(Message::Text(value.to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        loop {
            let incoming = tokio::select! {
                _=link.shutdown.notified()=>break,
                incoming=tokio::time::timeout(std::time::Duration::from_secs(20),receiver.next())=>incoming,
            };
            let message = match incoming {
                Ok(Some(Ok(message))) => message,
                _ => break,
            };
            if let Message::Text(text) = message {
                let value: Value = match serde_json::from_str(&text) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                if value["type"] == "heartbeat" {
                    if self.db.device(&id)?.is_none() {
                        break;
                    }
                    if value["protocol_version"] != 1 {
                        self.db.set_device_status(&id, "error")?;
                        break;
                    }
                    self.db.heartbeat(&id, &value)?;
                    if !announced {
                        announced = true;
                        if let Ok(event) =
                            self.db
                                .event("device.connected", None, &json!({"device_id":id}))
                        {
                            self.events.send(event).ok();
                        }
                    }
                } else {
                    link.dispatch(value);
                }
            }
        }
        write.abort();
        link.runs.lock().unwrap().clear();
        let is_current = self
            .links
            .lock()
            .unwrap()
            .get(&id)
            .is_some_and(|item| Arc::ptr_eq(item, &link));
        if is_current {
            self.links.lock().unwrap().remove(&id);
            if self
                .db
                .device(&id)?
                .is_some_and(|device| device.status != "error")
            {
                self.db.set_device_status(&id, "offline")?;
            }
        }
        if is_current
            && announced
            && let Ok(event) = self
                .db
                .event("device.disconnected", None, &json!({"device_id":id}))
        {
            self.events.send(event).ok();
        }
        Ok(())
    }
}
