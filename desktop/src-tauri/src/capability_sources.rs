//! Read known application locations only; scanning never starts an application.
use std::{collections::HashSet, fs, path::Path};
use serde::Serialize;

#[derive(Serialize)]
pub struct ImportItem { name: String, path: String, kind: &'static str }
#[derive(Serialize)]
pub struct ImportSource { id: &'static str, name: &'static str, items: Vec<ImportItem> }

fn scan_source(home: &Path, workspace: Option<&Path>, id: &'static str, name: &'static str, configs: &[&str], skills: &[&str]) -> ImportSource {
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    for (root, scope) in [(Some(home), "User"), (workspace, "Project")] {
        let Some(root) = root else { continue };
        for relative in configs {
            let path = root.join(relative);
            if !path.is_file() { continue; }
            let Ok(contents) = fs::read_to_string(&path) else { continue };
            let has_servers = if path.extension().is_some_and(|ext| ext == "json") {
                serde_json::from_str::<serde_json::Value>(&contents).ok()
                    .and_then(|v| v.get("mcpServers").and_then(|s| s.as_object()).map(|s| !s.is_empty())).unwrap_or(false)
            } else {
                toml::from_str::<toml::Value>(&contents).ok()
                    .and_then(|v| v.get("mcp_servers").and_then(|s| s.as_table()).map(|s| !s.is_empty())).unwrap_or(false)
            };
            if has_servers && seen.insert(path.clone()) {
                items.push(ImportItem { name: format!("MCP · {scope}"), path: path.to_string_lossy().into_owned(), kind: "mcp" });
            }
        }
        for relative in skills {
            let Ok(entries) = fs::read_dir(root.join(relative)) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.join("SKILL.md").is_file() && seen.insert(path.clone()) {
                    items.push(ImportItem { name: entry.file_name().to_string_lossy().into_owned(), path: path.to_string_lossy().into_owned(), kind: "skill" });
                }
            }
        }
    }
    items.sort_by(|a,b| a.kind.cmp(b.kind).then(a.name.cmp(&b.name)).then(a.path.cmp(&b.path)));
    ImportSource { id, name, items }
}

fn scan(home: &Path, workspace: Option<&Path>) -> Vec<ImportSource> {
    [
        scan_source(home, workspace, "codex", "Codex", &[".codex/config.toml"], &[".codex/skills"]),
        scan_source(home, workspace, "cursor", "Cursor", &[".cursor/mcp.json"], &[".cursor/skills"]),
        scan_source(home, workspace, "claude", "Claude Code", &[".claude.json", ".mcp.json"], &[".claude/skills"]),
        scan_source(home, workspace, "windsurf", "Windsurf", &[".codeium/windsurf/mcp_config.json"], &[".windsurf/skills", ".codeium/windsurf/skills"]),
        scan_source(home, workspace, "shared", "Agent Skills", &[], &[".agents/skills"]),
    ].into_iter().filter(|source| !source.items.is_empty()).collect()
}

#[tauri::command]
pub async fn ax_scan_capability_sources(cwd: Option<String>) -> Result<Vec<ImportSource>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).ok_or("Cannot locate user home")?;
        let workspace = cwd.map(std::path::PathBuf::from);
        if workspace.as_ref().is_some_and(|path| !path.is_absolute() || !path.is_dir()) { return Err("Choose an existing workspace directory".into()); }
        Ok(scan(Path::new(&home), workspace.as_deref()))
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_only_importable_packages_and_nonempty_configs() {
        let root = std::env::temp_dir().join(format!("crew-scan-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join(".codex/skills/review")).unwrap();
        fs::create_dir_all(root.join(".cursor")).unwrap();
        fs::write(root.join(".codex/skills/review/SKILL.md"), "# Review").unwrap();
        fs::write(root.join(".codex/config.toml"), "[mcp_servers.files]\ncommand = 'test'").unwrap();
        fs::write(root.join(".cursor/mcp.json"), "{\"mcpServers\":{}}").unwrap();
        let sources = scan(&root, Some(&root));
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].items.len(), 2); // Identical home/project paths are deduplicated.
        assert_eq!(sources[0].items[0].kind, "mcp");
        fs::remove_dir_all(root).unwrap();
    }
}
