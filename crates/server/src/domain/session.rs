//! Sessions: the binding between a Crew task and the AX session it drives.
//!
//! AX remains the source of truth for conversation history. Crew retains the
//! binding and transient question/answer admission state on the existing task.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// A planning answer is separate from tool permission approval.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionAnswer {
    pub question_id: String,
    pub option_id: Option<String>,
    pub text: Option<String>,
}

impl SessionAnswer {
    pub fn payload(&self, question: &Value) -> Result<Value> {
        if question["id"].as_str() != Some(self.question_id.as_str()) {
            bail!("question changed; reload the conversation before answering");
        }
        match (&self.option_id, &self.text) {
            (Some(id), None) if !id.trim().is_empty() => {
                if !question["options"]
                    .as_array()
                    .is_some_and(|options| options.iter().any(|o| o["id"] == *id))
                {
                    bail!("unknown answer option");
                }
                Ok(json!({"question_id":self.question_id,"option_id":id,"prompt":id}))
            }
            (None, Some(text)) if !text.trim().is_empty() => {
                let text = text.trim();
                let options = question["options"].as_array();
                let selected = options.and_then(|options| {
                    options
                        .iter()
                        .find(|o| {
                            o["id"]
                                .as_str()
                                .is_some_and(|id| id.eq_ignore_ascii_case(text))
                        })
                        .or_else(|| {
                            text.parse::<usize>()
                                .ok()
                                .and_then(|n| n.checked_sub(1))
                                .and_then(|n| options.get(n))
                        })
                        .or_else(|| {
                            options.iter().find(|o| {
                                o["label"]
                                    .as_str()
                                    .is_some_and(|label| label.eq_ignore_ascii_case(text))
                            })
                        })
                });
                if let Some(option) = selected {
                    return Ok(
                        json!({"question_id":self.question_id,"option_id":option["id"],"prompt":option["id"]}),
                    );
                }
                if question["allowFreeText"] != true && question["allow_free_text"] != true {
                    bail!("choose one of the offered options");
                }
                Ok(json!({"question_id":self.question_id,"text":text,"prompt":text}))
            }
            _ => bail!("provide one nonempty option or text answer"),
        }
    }
}

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
