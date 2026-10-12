use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
};

const LIMIT: usize = 256 * 1024;
static SAVES: Mutex<()> = Mutex::new(());

#[tauri::command]
pub async fn write_workspace_file(
    root: String,
    relative: String,
    content: String,
    expected: String,
) -> Result<(), String> {
    super::blocking(move || write_sync(root, relative, content, expected)).await
}

fn checked_path(root: &str, relative: &str) -> Result<PathBuf, String> {
    if std::path::Path::new(relative).is_absolute() {
        let base = PathBuf::from(root)
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let path = PathBuf::from(relative)
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !path.starts_with(base) {
            return Err("Path must stay inside the workspace".into());
        }
        Ok(path)
    } else {
        super::workspace_path(root, relative)
    }
}

fn check_content(path: &PathBuf, expected: &str) -> Result<fs::Permissions, String> {
    // Open the existing target without truncation, verifying write access before staging a replacement.
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > LIMIT as u64 {
        return Err("Only UTF-8 files up to 256 KiB can be edited".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes != expected.as_bytes() {
        return Err("文件已被其他程序修改；草稿已保留，请复制修改内容后取消编辑并重新读取。 / File changed on disk; draft kept. Copy your edits, cancel and reload before retrying.".into());
    }
    Ok(metadata.permissions())
}

pub(super) fn write_sync(
    root: String,
    relative: String,
    content: String,
    expected: String,
) -> Result<(), String> {
    if content.len() > LIMIT || expected.len() > LIMIT {
        return Err("File is too large to edit (256 KiB maximum)".into());
    }
    let _guard = SAVES.lock().map_err(|error| error.to_string())?;
    let path = checked_path(&root, &relative)?;
    let permissions = check_content(&path, &expected)?;
    let temporary = path.with_file_name(format!(".axcrew-edit-{}.tmp", uuid::Uuid::new_v4()));
    let mut staged = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let result = (|| {
        staged
            .write_all(content.as_bytes())
            .map_err(|error| error.to_string())?;
        staged.sync_all().map_err(|error| error.to_string())?;
        drop(staged);
        fs::set_permissions(&temporary, permissions).map_err(|error| error.to_string())?;
        if checked_path(&root, &relative)? != path {
            return Err("File path changed while saving".into());
        }
        check_content(&path, &expected)?;
        fs::rename(&temporary, &path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
