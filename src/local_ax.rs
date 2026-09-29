//! Read-only discovery of the AX installations on this machine.
//!
//! Crew keeps its own database and never copies AX messages into it. To let the
//! desktop app show the conversations a user already has in AX, this module
//! enumerates the local AX stores (the AX home plus every project recorded in
//! `session-projects.json`) and reads their session index and raw transcript.
//! Nothing here writes to those files.

use anyhow::{Context, Result, anyhow};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

/// The AX home directory, matching the CLI's own resolution order.
pub fn ax_home() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("AX_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(path));
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|home| home.join(".ax"))
}

#[derive(Clone, Debug)]
pub struct LocalProject {
    pub id: String,
    pub root: String,
    pub data_dir: PathBuf,
}

/// Windows returns `\\?\` verbatim paths from `canonicalize`; strip it so the
/// same store recorded twice (with and without the prefix) is recognised.
fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
}

fn normalized(path: &Path) -> PathBuf {
    PathBuf::from(display_path(path))
}

fn project_id(entry: &Value) -> Option<String> {
    entry["id"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| entry["root"].as_str().map(str::to_owned))
}

/// Every local AX store on this machine, most recently registered first.
pub fn projects() -> Vec<LocalProject> {
    let mut projects = Vec::new();
    if let Some(home) = ax_home().map(|home| normalized(&home)) {
        // The AX home doubles as the store AX used when it ran outside a project,
        // whose workspace is the directory holding `.ax`.
        let root = home
            .parent()
            .filter(|_| home.file_name().is_some_and(|name| name == ".ax"))
            .map(Path::to_path_buf)
            .unwrap_or_else(|| home.clone());
        projects.push(LocalProject {
            id: "ax-home".into(),
            root: display_path(&root),
            data_dir: home.clone(),
        });
        if let Ok(bytes) = fs::read(home.join("session-projects.json")) {
            if let Ok(entries) = serde_json::from_slice::<Vec<Value>>(&bytes) {
                for entry in entries {
                    let (Some(id), Some(data_dir)) = (
                        project_id(&entry),
                        entry["data_dir"].as_str().map(PathBuf::from),
                    ) else {
                        continue;
                    };
                    let data_dir = normalized(&data_dir);
                    projects.push(LocalProject {
                        id,
                        root: entry["root"]
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| display_path(&data_dir)),
                        data_dir,
                    });
                }
            }
        }
    }
    let mut seen = HashSet::new();
    projects.retain(|project| seen.insert(project.data_dir.clone()));
    projects
}

fn database(project: &LocalProject) -> PathBuf {
    project.data_dir.join("memory.sqlite3")
}

fn transcript_path(project: &LocalProject, session: &str) -> PathBuf {
    project
        .data_dir
        .join("sessions")
        .join(format!("{session}.jsonl"))
}

/// The first user turn, used as a recognisable one-line preview in the list.
fn preview(project: &LocalProject, session: &str) -> (u64, String) {
    let Ok(file) = fs::File::open(transcript_path(project, session)) else {
        return (0, String::new());
    };
    let mut messages = 0u64;
    let mut preview = String::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        messages += 1;
        if !preview.is_empty() || messages > 400 {
            continue;
        }
        if let Ok(message) = serde_json::from_str::<Value>(&line) {
            if message["role"] == "user" {
                preview = message["content"]
                    .as_str()
                    .unwrap_or("")
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(90)
                    .collect();
            }
        }
    }
    (messages, preview)
}

/// Session index of one AX store, newest first. Missing stores are not an error.
pub fn sessions(project: &LocalProject) -> Result<Vec<Value>> {
    let database = database(project);
    if !database.is_file() {
        return Ok(Vec::new());
    }
    let connection = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("无法只读打开 {}", database.display()))?;
    connection.busy_timeout(std::time::Duration::from_secs(2))?;
    let mut statement =
        connection.prepare("SELECT id,title,created_at,updated_at FROM sessions ORDER BY updated_at DESC")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })?;
    let mut sessions = Vec::new();
    for row in rows {
        let (id, title, created_at, updated_at) = row?;
        let (messages, preview) = preview(project, &id);
        sessions.push(json!({
            "id": id,
            "title": title,
            "created_at": created_at,
            "updated_at": updated_at,
            "messages": messages,
            "preview": preview,
        }));
    }
    Ok(sessions)
}

fn to_update(session: &str, message: &Value) -> Option<Value> {
    let role = message["role"].as_str()?;
    let content = message["content"].as_str().unwrap_or("").to_owned();
    if content.trim().is_empty() {
        return None;
    }
    let id = message["id"].to_string();
    let update = match role {
        "user" => json!({"sessionUpdate":"user_message_chunk","messageId":id,"content":{"type":"text","text":content}}),
        "assistant" => json!({"sessionUpdate":"agent_message_chunk","messageId":id,"content":{"type":"text","text":content}}),
        "tool" => json!({"sessionUpdate":"tool_call_update","toolCallId":id,"status":"completed","content":[{"type":"content","content":{"type":"text","text":content}}]}),
        _ => return None,
    };
    Some(json!({"sessionId":session,"update":update}))
}

/// Raw transcript of one AX session, in the same shape the ACP `session/load`
/// replay uses so the desktop app renders both through one code path.
pub fn transcript(session: &str) -> Result<Value> {
    for project in projects() {
        let path = transcript_path(&project, session);
        if !path.is_file() {
            continue;
        }
        let file = fs::File::open(&path).with_context(|| format!("无法读取 {}", path.display()))?;
        let mut updates = Vec::new();
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(update) = to_update(session, &message) {
                updates.push(update);
            }
        }
        return Ok(json!({
            "ax_session_id": session,
            "project": {"id": project.id, "root": project.root, "data_dir": display_path(&project.data_dir)},
            "updates": updates,
        }));
    }
    Err(anyhow!("本地 AX 中找不到该会话的记录"))
}

/// The project that owns a session, used when a local conversation is adopted.
pub fn project_of(session: &str) -> Option<LocalProject> {
    projects()
        .into_iter()
        .find(|project| transcript_path(project, session).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_local_store_without_touching_the_ax_home() {
        let root = std::env::temp_dir().join(format!("ax-crew-local-{}", uuid::Uuid::new_v4()));
        let data = root.join(".ax");
        fs::create_dir_all(data.join("sessions")).unwrap();
        let store = Connection::open(data.join("memory.sqlite3")).unwrap();
        store
            .execute_batch(
                "CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
                 INSERT INTO sessions VALUES('s-1','hello',10,20);",
            )
            .unwrap();
        drop(store);
        fs::write(
            data.join("sessions/s-1.jsonl"),
            "{\"id\":1,\"session_id\":\"s-1\",\"role\":\"user\",\"content\":\"hi\",\"created_at\":1}\n\
             {\"id\":2,\"session_id\":\"s-1\",\"role\":\"assistant\",\"content\":\"hello\",\"created_at\":2}\n",
        )
        .unwrap();

        let project = LocalProject { id: "p".into(), root: display_path(&root), data_dir: data.clone() };
        let sessions = sessions(&project).unwrap();
        assert_eq!(sessions[0]["title"], "hello");
        assert_eq!(sessions[0]["messages"], 2);
        assert_eq!(sessions[0]["preview"], "hi");

        // The AX_HOME lookup is redirected for the test so no real store is touched.
        // SAFETY: single-threaded test that restores the environment immediately.
        let previous_home = std::env::var_os("AX_HOME");
        unsafe { std::env::set_var("AX_HOME", &data) };
        let replay = transcript("s-1");
        let missing = transcript("missing");
        unsafe {
            match previous_home {
                Some(home) => std::env::set_var("AX_HOME", home),
                None => std::env::remove_var("AX_HOME"),
            }
        }
        let replay = replay.unwrap();
        assert_eq!(replay["updates"].as_array().unwrap().len(), 2);
        assert!(missing.is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
