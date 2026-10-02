//! Sessions: the binding between a Crew task and the AX session it drives.
//!
//! AXCrew never stores conversation content — the binding is the whole domain
//! model, because AX's own project store stays the source of truth for history.

use serde::Serialize;

/// The API shape the desktop and Android clients read for a conversation.
///
/// Field order is deliberate: `json!({...})` emits object keys in sorted order
/// (serde_json's map is a BTreeMap), so declaring the fields alphabetically keeps
/// the serialized response byte-for-byte identical to the previous inline JSON.
#[derive(Debug, Clone, Serialize)]
pub struct SessionView {
    pub ax_session_id: String,
    pub device_id: String,
    pub member_id: String,
    pub task_id: String,
}
