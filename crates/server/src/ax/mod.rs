//! The local AX adapter: read-only discovery of the AX installations on this
//! machine.
//!
//! Crew keeps its own database and never copies AX messages into it. To let the
//! desktop app show the conversations a user already has in AX, this module
//! enumerates the local AX stores (the AX home plus every project recorded in
//! `session-projects.json`) and reads their session index and raw transcript.
//! Nothing here writes to those files.
//!
//! This is not a transport: it never talks to an AX process. `crate::transport`
//! owns the ACP connection to AX, and `crate::storage` owns Crew's own database.

pub mod usage;

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
    PathBuf::from(host_path(&display_path(path)))
}

/// AX running through WSL records paths in Linux form in the shared AX home.
fn host_path(path: &str) -> String {
    if cfg!(windows) {
        if let Some(mounted) = path.strip_prefix("/mnt/") {
            let bytes = mounted.as_bytes();
            if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b'/' {
                return format!(
                    "{}:\\{}",
                    char::from(bytes[0]).to_ascii_uppercase(),
                    mounted[2..].replace('/', "\\")
                );
            }
        }
    }
    path.to_owned()
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
                            .map(host_path)
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
    let mut statement = connection
        .prepare("SELECT id,title,created_at,updated_at FROM sessions ORDER BY updated_at DESC")?;
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
    // ACP has no field for message time, so it rides along in the private `_ax`
    // object the Crew client already reads for vendor extensions.
    let at = message["created_at"].as_i64().unwrap_or(0);
    let update = match role {
        "user" => {
            json!({"sessionUpdate":"user_message_chunk","messageId":id,"content":{"type":"text","text":content}})
        }
        "assistant" => {
            json!({"sessionUpdate":"agent_message_chunk","messageId":id,"content":{"type":"text","text":content}})
        }
        "tool" => {
            let result=serde_json::from_str::<Value>(&content).ok().filter(|value|value.get("raw_output").is_some()).unwrap_or_else(||json!({"status":if legacy_failed(&content){"error"}else{"success"},"raw_output":content}));
            let call_id = message["metadata"]["tool_call_id"]
                .as_str()
                .map_or_else(|| id.clone(), str::to_owned);
            json!({"sessionUpdate":"tool_call_update","toolCallId":call_id,"status":if result["status"]=="error"{"failed"}else{"completed"},"rawOutput":result})
        }
        "system" if content.starts_with("[ax-changes]\n") => {
            json!({"sessionUpdate":"turn_changes","changedFiles":serde_json::from_str::<Value>(content.trim_start_matches("[ax-changes]\n")).unwrap_or(Value::Null)})
        }
        _ => return None,
    };
    Some(json!({"sessionId":session,"update":with_time(update, at)}))
}

fn legacy_failed(content: &str) -> bool {
    content.lines().next().is_some_and(|line| {
        line.strip_prefix("exit_code:")
            .is_some_and(|code| code.trim().parse::<i32>().is_ok_and(|code| code != 0))
    }) || [
        "tool execution failed:",
        "invalid tool input:",
        "permission denied for tool:",
        "unknown tool:",
        "web fetch failed for every url:",
        "Execution interrupted",
    ]
    .iter()
    .any(|prefix| content.starts_with(prefix))
}

fn tool_starts(session: &str, message: &Value) -> Vec<Value> {
    let Some(calls) = message["metadata"]["tool_calls"].as_array() else {
        return vec![];
    };
    calls.iter().map(|call|{
        let name=call["function"]["name"].as_str().unwrap_or("tool");
        let args=call["function"]["arguments"].as_str().and_then(|text|serde_json::from_str::<Value>(text).ok()).unwrap_or(Value::Null);
        let path=args["path"].as_str().unwrap_or("");
        let title=match name {
            "shell"=>format!("running {}",args["command"].as_str().unwrap_or("")),
            "filesystem"=>format!("{} {path}",args["operation"].as_str().unwrap_or("read")),
            "search"=>format!("searching {} in {path}",args["query"].as_str().unwrap_or("")),
            "patch"=>format!("editing {path}"),
            _=>name.to_owned(),
        };
        json!({"sessionId":session,"update":with_time(json!({"sessionUpdate":"tool_call","toolCallId":call["id"],"title":title,"kind":name,"rawInput":{"name":name,"arguments":args},"status":"pending"}),message["created_at"].as_i64().unwrap_or(0))})
    }).collect()
}

fn with_time(mut update: Value, at: i64) -> Value {
    if let Value::Object(ref mut map) = update {
        map.insert("_ax".to_owned(), json!({"createdAt": at}));
    }
    update
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
            updates.extend(tool_starts(session, &message));
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
    #[test]
    fn wsl_shared_project_paths_use_host_paths() {
        if cfg!(windows) {
            assert_eq!(
                super::host_path("/mnt/c/Users/A B/project"),
                "C:\\Users\\A B\\project"
            );
            assert_eq!(
                super::normalized(std::path::Path::new("/mnt/d/AX/.ax/projects/id")),
                std::path::PathBuf::from("D:\\AX\\.ax\\projects\\id")
            );
        } else {
            assert_eq!(super::host_path("/mnt/c/project"), "/mnt/c/project");
        }
        assert_eq!(super::host_path("/home/user/project"), "/home/user/project");
    }
    #[test]
    fn replay_uses_real_call_ids_failure_results_and_changes() {
        let assistant = serde_json::json!({"role":"assistant","metadata":{"tool_calls":[{"id":"real-call","function":{"name":"shell","arguments":"{\"command\":\"exit 1\"}"}}]},"created_at":10});
        let starts = super::tool_starts("s", &assistant);
        assert_eq!(starts[0]["update"]["toolCallId"], "real-call");
        assert_eq!(starts[0]["update"]["kind"], "shell");
        let message = serde_json::json!({"id":12,"role":"tool","content":"{\"status\":\"error\",\"raw_output\":\"exit_code: 1\"}","metadata":{"tool_call_id":"real-call"},"created_at":12});
        let finish = super::to_update("s", &message).unwrap();
        assert_eq!(finish["update"]["toolCallId"], "real-call");
        assert_eq!(finish["update"]["status"], "failed");
        assert!(super::legacy_failed("exit_code: 1\nstdout:"));
        let changes=super::to_update("s",&serde_json::json!({"role":"system","content":"[ax-changes]\n[{\"path\":\"a.rs\",\"additions\":1,\"deletions\":0}]"})).unwrap();
        assert_eq!(changes["update"]["sessionUpdate"], "turn_changes");
    }

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

        let project = LocalProject {
            id: "p".into(),
            root: display_path(&root),
            data_dir: data.clone(),
        };
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
        // The wall-clock time rides along in `_ax` so the client can label each row.
        assert_eq!(replay["updates"][0]["update"]["_ax"]["createdAt"], 1);
        assert_eq!(replay["updates"][1]["update"]["_ax"]["createdAt"], 2);
        assert!(missing.is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
