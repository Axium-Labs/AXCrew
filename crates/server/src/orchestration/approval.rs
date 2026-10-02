//! Tool-approval brokering.
//!
//! A transport registers a pending `session/request_permission`, the clients see
//! it through the event stream and answer over `POST /api/permissions/{id}/resolve`,
//! and the waiting transport is released. This is orchestration state: it is not
//! persisted, because an unanswered request is denied when it times out or the
//! process exits.

use anyhow::{Result, anyhow};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;

type Pending = HashMap<String, (oneshot::Sender<String>, Value)>;
#[derive(Clone, Default)]
pub struct ApprovalBroker(Arc<Mutex<Pending>>);
impl ApprovalBroker {
    pub fn register(&self, id: String, request: Value) -> oneshot::Receiver<String> {
        let (tx, rx) = oneshot::channel();
        self.0.lock().unwrap().insert(id, (tx, request));
        rx
    }
    pub fn pending(&self) -> Vec<Value> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(|(id, (_, request))| serde_json::json!({"request_id":id,"request":request}))
            .collect()
    }
    pub fn resolve(&self, id: &str, choice: &str) -> Result<()> {
        if !matches!(choice, "allow_once" | "allow_session" | "reject_once") {
            return Err(anyhow!("invalid permission choice"));
        }
        let (tx, _) = self
            .0
            .lock()
            .unwrap()
            .remove(id)
            .ok_or_else(|| anyhow!("permission request not found"))?;
        tx.send(choice.to_owned())
            .map_err(|_| anyhow!("permission request no longer active"))
    }
    pub fn forget(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
}
