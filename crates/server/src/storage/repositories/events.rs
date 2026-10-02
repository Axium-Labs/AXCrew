//! `events`: the durable, redacted index of what happened.
//!
//! The live bus carries full content; this table deliberately stores only the
//! shape of an event, so AX messages, tool arguments and permission inputs are
//! never copied into Crew's database.

use crate::{domain::task::Task, domain::unix_now, storage::Db};
use anyhow::Result;
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};
use uuid::Uuid;

impl Db {
    pub fn events(&self, limit: i64, offset: i64) -> Result<Vec<Value>> {
        let db = self.0.lock().unwrap();
        let mut stmt=db.prepare("SELECT id,timestamp,kind,crew_id,member_id,device_id,task_id,session_id,payload_json FROM events ORDER BY timestamp DESC,rowid DESC LIMIT ?1 OFFSET ?2")?;
        let rows=stmt.query_map(params![limit.clamp(1,500),offset.max(0)],|r|Ok(json!({"event_id":r.get::<_,String>(0)?,"timestamp":r.get::<_,i64>(1)?,"kind":r.get::<_,String>(2)?,"crew_id":r.get::<_,Option<String>>(3)?,"member_id":r.get::<_,Option<String>>(4)?,"device_id":r.get::<_,Option<String>>(5)?,"task_id":r.get::<_,Option<String>>(6)?,"session_id":r.get::<_,Option<String>>(7)?,"payload":serde_json::from_str::<Value>(&r.get::<_,String>(8)?).unwrap_or(json!({}))})))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }
    /// Persists the redacted form of an event and returns the full event for the
    /// live bus.
    pub fn event(&self, kind: &str, task: Option<&Task>, payload: &Value) -> Result<Value> {
        let db = self.0.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let (crew, member, assigned_device, task_id) = task.map_or((None, None, None, None), |t| {
            (
                Some(t.crew_id.as_str()),
                Some(t.assigned_member.as_str()),
                Some(t.assigned_device.as_str()),
                Some(t.id.as_str()),
            )
        });
        let device = assigned_device.or_else(|| payload["device_id"].as_str());
        let session = task_id.and_then(|t| {
            db.query_row(
                "SELECT ax_session_id FROM session_bindings WHERE task_id=?1",
                [t],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
        });
        // The live bus carries content; the durable event index never copies AX messages,
        // tool arguments, permission inputs, or the final assistant response.
        let stored_payload = match kind {
            "agent.message.delta" | "agent.message.completed" => {
                json!({"text_bytes":payload["content"]["text"].as_str().map_or(0,str::len)})
            }
            "permission.requested" => {
                json!({"request_id":payload["request_id"],"tool":payload["request"]["toolCall"]["title"]})
            }
            "tool.started" | "tool.completed" | "tool.failed" => {
                json!({"tool_call_id":payload["toolCallId"],"status":payload["status"]})
            }
            "task.completed" => json!({"completed":true}),
            _ => payload.clone(),
        };
        db.execute("INSERT INTO events(id,kind,crew_id,member_id,device_id,task_id,session_id,payload_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![id,kind,crew,member,device,task_id,session,stored_payload.to_string()])?;
        Ok(
            json!({"event_id":id,"timestamp":unix_now(),"kind":kind,"crew_id":crew,"member_id":member,"device_id":device,"task_id":task_id,"session_id":session,"payload":payload}),
        )
    }
}
