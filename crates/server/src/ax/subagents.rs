//! Read-only subagent projections from AX's parent-owned history records.
//!
//! Store locations are accepted only from a saved parent system record. Clients
//! continue to select a bound parent session, never a child path.

use super::{to_update, tool_starts};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs::File,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
};

const PREFIX: &str = "[ax-subagent]\n";

pub(super) struct ReplayBudget {
    seen: HashSet<String>,
    bytes: usize,
    updates: usize,
}

impl Default for ReplayBudget {
    fn default() -> Self {
        Self {
            seen: HashSet::new(),
            bytes: 32 * 1024 * 1024,
            updates: 20_000,
        }
    }
}

fn record(content: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(content.strip_prefix(PREFIX)?).ok()?;
    (value["sessionUpdate"] == "subagent" && value["agentId"].is_string()).then_some(value)
}

/// The runtime's store locator is private and must never reach a client.
pub(super) fn saved_update(content: &str) -> Option<Value> {
    let mut value = record(content)?;
    value.as_object_mut()?.remove("run");
    Some(value)
}

pub(super) fn replay_children(
    parent_session: &str,
    child_root: &Path,
    message: &Value,
    parent_agent: Option<&Value>,
    budget: &mut ReplayBudget,
    updates: &mut Vec<Value>,
) {
    if message["role"] != "system" {
        return;
    }
    let Some(content) = message["content"].as_str() else {
        return;
    };
    let Some(saved) = record(content) else {
        return;
    };
    let Some(child_session) = saved["run"]["session_id"].as_str() else {
        return;
    };
    if uuid::Uuid::parse_str(child_session).is_err()
        || saved["childSessionId"].as_str() != Some(child_session)
        || budget.seen.contains(child_session)
    {
        return;
    }
    if budget.seen.len() >= 256 || budget.bytes == 0 || budget.updates == 0 {
        if let Some(mut envelope) = saved_update(content) {
            if envelope["parentAgentId"].is_null()
                && let Some(parent) = parent_agent
            {
                envelope["parentAgentId"] = parent["agentId"].clone();
            }
            envelope["historyTruncated"] = json!(true);
            updates.push(json!({"sessionId":parent_session,"update":envelope}));
        }
        return;
    }
    budget.seen.insert(child_session.to_owned());
    let Some(path) = child_path(child_root, &saved["run"], child_session) else {
        return;
    };
    let Ok(file) = File::open(path) else {
        // Retained lifecycle metadata remains useful after a child store was
        // removed or when an older AX version did not persist child history.
        return;
    };
    let Some(mut envelope) = saved_update(content) else {
        return;
    };
    if envelope["parentAgentId"].is_null()
        && let Some(parent) = parent_agent
    {
        envelope["parentAgentId"] = parent["agentId"].clone();
    }
    let file_bytes = file.metadata().map_or(0, |metadata| metadata.len());
    let mut consumed = 0;
    let mut reader = BufReader::new(file);
    let mut truncated = false;
    while budget.bytes > 0 && budget.updates > 0 {
        let mut line = String::new();
        let Ok(count) = Read::take(&mut reader, budget.bytes as u64).read_line(&mut line) else {
            break;
        };
        if count == 0 {
            break;
        }
        consumed += count as u64;
        budget.bytes -= count;
        let Ok(child_message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if child_message["role"] == "system"
            && let Some(result) = child_message["content"]
                .as_str()
                .and_then(|content| content.strip_prefix("[ax-child-outcome]\n"))
                .and_then(|content| serde_json::from_str::<Value>(content).ok())
        {
            let mut outcome = envelope.clone();
            outcome["status"] = json!(match result["status"].as_str() {
                Some("completed") => "completed",
                Some("cancelled") => "cancelled",
                _ => "failed",
            });
            outcome["summary"] = result["summary"].clone();
            outcome["error"] = result["failure_reason"].clone();
            outcome["_ax"] = json!({"createdAt":child_message["created_at"]});
            budget.updates -= 1;
            updates.push(json!({"sessionId":parent_session,"update":outcome}));
            continue;
        }
        let mut child_updates = to_update(child_session, &child_message)
            .into_iter()
            .collect::<Vec<_>>();
        child_updates.extend(tool_starts(child_session, &child_message));
        for child in child_updates {
            if budget.updates == 0 {
                truncated = true;
                break;
            }
            let mut update = child["update"].clone();
            if update["sessionUpdate"] == "user_message_chunk" {
                continue;
            }
            if update["sessionUpdate"] != "subagent" {
                let mut wrapper = envelope.clone();
                if let Some(time) = update.get("_ax") {
                    wrapper["_ax"] = time.clone();
                }
                wrapper["update"] = update;
                update = wrapper;
            } else if update["parentAgentId"].is_null() {
                update["parentAgentId"] = envelope["agentId"].clone();
            }
            budget.updates -= 1;
            updates.push(json!({"sessionId":parent_session,"update":update}));
        }
        replay_children(
            parent_session,
            child_root,
            &child_message,
            Some(&envelope),
            budget,
            updates,
        );
    }
    if truncated || consumed < file_bytes {
        envelope["historyTruncated"] = json!(true);
        updates.push(json!({"sessionId":parent_session,"update":envelope}));
    }
}

fn child_path(root: &Path, run: &Value, session: &str) -> Option<PathBuf> {
    let root = root.canonicalize().ok()?;
    let state = PathBuf::from(run["state_dir"].as_str()?)
        .canonicalize()
        .ok()?;
    if !state.starts_with(&root) || state.file_name()? != "state" {
        return None;
    }
    let path = state
        .join("sessions")
        .join(format!("{session}.jsonl"))
        .canonicalize()
        .ok()?;
    (path.starts_with(&state) && path.is_file()).then_some(path)
}
