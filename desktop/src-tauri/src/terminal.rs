use std::{collections::HashMap, io::{Read, Write}, path::PathBuf, sync::Mutex};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

pub struct TerminalState(Mutex<HashMap<String, TerminalSession>>);

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl Default for TerminalState {
    fn default() -> Self { Self(Mutex::new(HashMap::new())) }
}

#[derive(Clone, serde::Serialize)]
struct TerminalOutput { id: String, data: Vec<u8> }

#[derive(Clone, serde::Serialize)]
struct TerminalExit { id: String }

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { cols: cols.max(2), rows: rows.max(2), pixel_width: 0, pixel_height: 0 }
}

#[tauri::command]
pub fn terminal_create(app: AppHandle, state: State<'_, TerminalState>, id: String, cwd: Option<String>, cols: u16, rows: u16) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "Invalid terminal ID".to_owned())?;
    let directory = cwd.filter(|value| !value.is_empty()).map(PathBuf::from)
        .unwrap_or(std::env::current_dir().map_err(|error| error.to_string())?);
    let directory = if directory.is_absolute() { directory } else {
        std::env::current_dir().map_err(|error| error.to_string())?.join(directory)
    };
    if !directory.is_dir() { return Err("Terminal workspace is not a directory".into()); }
    let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
    if sessions.contains_key(&id) { return Ok(()); }
    if sessions.len() >= 8 { return Err("Maximum of eight terminals reached".into()); }
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|error| error.to_string())?;
    let mut command = CommandBuilder::new(if cfg!(windows) { "powershell.exe" } else { "/bin/sh" });
    if cfg!(windows) { command.arg("-NoLogo"); }
    command.cwd(directory);
    let child = pair.slave.spawn_command(command).map_err(|error| error.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;
    sessions.insert(id.clone(), TerminalSession { master: pair.master, writer, child });
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 { break; }
            let _ = app.emit("terminal-output", TerminalOutput { id: id.clone(), data: buffer[..count].to_vec() });
        }
        let _ = app.emit("terminal-exit", TerminalExit { id });
    });
    Ok(())
}

#[tauri::command]
pub fn terminal_write(state: State<'_, TerminalState>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
    let session = sessions.get_mut(&id).ok_or("Terminal has closed")?;
    session.writer.write_all(data.as_bytes()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_resize(state: State<'_, TerminalState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|error| error.to_string())?;
    let session = sessions.get(&id).ok_or("Terminal has closed")?;
    session.master.resize(size(cols, rows)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalState>, id: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        session.child.kill().map_err(|error| error.to_string())?;
    }
    Ok(())
}

impl TerminalState {
    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.0.lock() {
            for (_, mut session) in sessions.drain() { let _ = session.child.kill(); }
        }
    }
}

