use std::{ffi::OsStr, fs, io::Write, path::{Path, PathBuf}, process::Command};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;

use crate::DesktopState;

const PROVIDERS: &[(&str, &str, Option<&str>)] = &[
    ("ant-ling", "Ant Ling", Some("ANT_LING_API_KEY")),
    ("anthropic", "Anthropic", Some("ANTHROPIC_API_KEY")),
    ("azure-openai-responses", "Azure OpenAI", Some("AZURE_OPENAI_API_KEY")),
    ("baseten", "Baseten", Some("BASETEN_API_KEY")),
    ("cerebras", "Cerebras", Some("CEREBRAS_API_KEY")),
    ("cloudflare-ai-gateway", "Cloudflare AI Gateway", Some("CLOUDFLARE_API_KEY")),
    ("cloudflare-workers-ai", "Cloudflare Workers AI", Some("CLOUDFLARE_API_KEY")),
    ("deepseek", "DeepSeek", Some("DEEPSEEK_API_KEY")),
    ("fireworks", "Fireworks", Some("FIREWORKS_API_KEY")),
    ("google", "Google Gemini", Some("GEMINI_API_KEY")),
    ("groq", "Groq", Some("GROQ_API_KEY")),
    ("huggingface", "Hugging Face", Some("HF_TOKEN")),
    ("kimi-coding", "Kimi Coding", Some("KIMI_API_KEY")),
    ("meta", "Meta", Some("META_API_KEY")),
    ("minimax", "MiniMax", Some("MINIMAX_API_KEY")),
    ("minimax-cn", "MiniMax CN", Some("MINIMAX_CN_API_KEY")),
    ("mistral", "Mistral", Some("MISTRAL_API_KEY")),
    ("moonshotai", "Moonshot AI", Some("MOONSHOT_API_KEY")),
    ("moonshotai-cn", "Moonshot AI CN", Some("MOONSHOT_API_KEY")),
    ("nvidia", "NVIDIA", Some("NVIDIA_API_KEY")),
    ("openai", "OpenAI", Some("OPENAI_API_KEY")),
    ("openai-codex", "OpenAI Codex", None),
    ("opencode", "OpenCode", Some("OPENCODE_API_KEY")),
    ("opencode-go", "OpenCode Go", Some("OPENCODE_API_KEY")),
    ("openrouter", "OpenRouter", Some("OPENROUTER_API_KEY")),
    ("qwen-token-plan", "Qwen Token Plan", Some("QWEN_TOKEN_PLAN_API_KEY")),
    ("qwen-token-plan-cn", "Qwen Token Plan CN", Some("QWEN_TOKEN_PLAN_CN_API_KEY")),
    ("qwen-token-plan-individual", "Qwen Individual", Some("QWEN_TOKEN_PLAN_API_KEY")),
    ("radius", "Radius", Some("RADIUS_API_KEY")),
    ("together", "Together", Some("TOGETHER_API_KEY")),
    ("vercel-ai-gateway", "Vercel AI Gateway", Some("AI_GATEWAY_API_KEY")),
    ("xai", "xAI", Some("XAI_API_KEY")),
    ("xiaomi", "Xiaomi", Some("XIAOMI_API_KEY")),
    ("xiaomi-token-plan-ams", "Xiaomi Token Plan AMS", Some("XIAOMI_TOKEN_PLAN_AMS_API_KEY")),
    ("xiaomi-token-plan-cn", "Xiaomi Token Plan CN", Some("XIAOMI_TOKEN_PLAN_CN_API_KEY")),
    ("xiaomi-token-plan-sgp", "Xiaomi Token Plan SGP", Some("XIAOMI_TOKEN_PLAN_SGP_API_KEY")),
    ("zai", "Z.AI", Some("ZAI_API_KEY")),
    ("zai-coding-cn", "Z.AI Coding CN", Some("ZAI_CODING_CN_API_KEY")),
];

#[derive(Clone, Serialize)]
pub struct AxModel { pub provider: String, pub id: String, pub display_name: String }
#[derive(Serialize)]
pub struct AxProvider { pub id: String, pub name: String, pub configured: bool, pub source: Option<String>, pub models: Vec<AxModel> }
#[derive(Serialize)]
pub struct AxLocalState {
    pub installed_path: Option<String>, pub installed_version: Option<String>, pub installed_compatible: bool,
    pub active_path: String, pub active_version: Option<String>, pub home: String,
    pub selected_model: Option<AxModel>, pub providers: Vec<AxProvider>,
}

pub fn installed_ax() -> Option<PathBuf> {
    let filename = if cfg!(windows) { "ax.exe" } else { "ax" };
    std::env::var_os("PATH").and_then(|path| std::env::split_paths(&path).map(|part| part.join(filename)).find(|candidate| candidate.is_file()))
}

pub fn version(path: &Path) -> Option<String> {
    Command::new(path).arg("--version").output().ok().filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

pub fn supports_acp(path: &Path) -> bool {
    Command::new(path).args(["acp", "--help"]).output().is_ok_and(|output| output.status.success())
}

fn ax_home() -> PathBuf {
    std::env::var_os("AX_HOME").map(PathBuf::from).unwrap_or_else(|| {
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(PathBuf::from).unwrap_or_default().join(".ax")
    })
}

fn read_json(path: &Path) -> Result<Value, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| format!("{}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(error) => Err(error.to_string()),
    }
}

fn write_private_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|error| error.to_string())?;
        file.write_all(serde_json::to_string_pretty(value).map_err(|error| error.to_string())?.as_bytes()).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        #[cfg(windows)] {
            let user = std::env::var("USERNAME").map_err(|error| error.to_string())?;
            let output = Command::new("icacls").arg(&temporary).arg("/inheritance:r").arg("/grant:r").arg(format!("{user}:F"))
                .output().map_err(|error| error.to_string())?;
            if !output.status.success() { return Err("Could not restrict AX credential file permissions".into()); }
        }
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}

fn cached_models(home: &Path, provider: &str) -> Vec<AxModel> {
    let path = home.join("models").join(format!("{provider}.json"));
    let cache = read_json(&path).unwrap_or_default();
    cache["models"].as_array().into_iter().flatten().filter_map(|item| {
        Some(AxModel { provider: provider.to_owned(), id: item["id"].as_str()?.to_owned(), display_name: item["display_name"].as_str().unwrap_or_else(|| item["id"].as_str().unwrap_or("")).to_owned() })
    }).collect()
}

fn state(active: &Path) -> Result<AxLocalState, String> {
    let home = ax_home();
    let auth = read_json(&home.join("auth.json"))?;
    let config = read_json(&home.join("config.json"))?;
    let installed = installed_ax();
    let selected = config.get("model").and_then(|model| Some(AxModel {
        provider: model.get("provider")?.as_str()?.to_owned(),
        id: model.get("model")?.as_str()?.to_owned(),
        display_name: model.get("model")?.as_str()?.to_owned(),
    }));
    let providers = PROVIDERS.iter().map(|(id, name, environment)| {
        let stored = auth.get(*id).is_some();
        let ambient = environment.is_some_and(|name| std::env::var(name).is_ok_and(|value| !value.is_empty()));
        let mut models = if stored || ambient { cached_models(&home, id) } else { Vec::new() };
        if let Some(model) = selected.as_ref().filter(|model| model.provider == *id && (stored || ambient)) {
            if !models.iter().any(|item| item.id == model.id) { models.insert(0, model.clone()); }
        }
        AxProvider { id: (*id).to_owned(), name: (*name).to_owned(), configured: stored || ambient,
            source: if stored { Some("AX".into()) } else if ambient { Some("环境变量".into()) } else { None }, models }
    }).collect();
    Ok(AxLocalState {
        installed_path: installed.as_ref().map(|path| path.to_string_lossy().into_owned()),
        installed_version: installed.as_deref().and_then(version),
        installed_compatible: installed.as_deref().is_some_and(supports_acp),
        active_path: active.to_string_lossy().into_owned(), active_version: version(active),
        home: home.to_string_lossy().into_owned(), selected_model: selected, providers,
    })
}

#[tauri::command]
pub fn ax_local_state(desktop: State<'_, DesktopState>) -> Result<AxLocalState, String> { state(&desktop.ax) }

#[tauri::command]
pub fn ax_store_api_key(desktop: State<'_, DesktopState>, provider: String, key: String) -> Result<AxLocalState, String> {
    if provider == "openai-codex" || !PROVIDERS.iter().any(|item| item.0 == provider) { return Err("Provider does not support API key login".into()); }
    if key.trim().is_empty() { return Err("API key is required".into()); }
    let path = ax_home().join("auth.json");
    let mut auth = read_json(&path)?;
    auth.as_object_mut().ok_or("Invalid AX auth.json")?.insert(provider, json!({"type":"api_key","key":key}));
    write_private_json(&path, &auth)?;
    state(&desktop.ax)
}

#[tauri::command]
pub fn ax_remove_credential(desktop: State<'_, DesktopState>, provider: String) -> Result<AxLocalState, String> {
    if !PROVIDERS.iter().any(|item| item.0 == provider) { return Err("Unknown provider".into()); }
    let path = ax_home().join("auth.json");
    let mut auth = read_json(&path)?;
    if auth.as_object_mut().ok_or("Invalid AX auth.json")?.remove(&provider).is_some() { write_private_json(&path, &auth)?; }
    state(&desktop.ax)
}

#[tauri::command]
pub fn ax_select_model(desktop: State<'_, DesktopState>, provider: String, model: String) -> Result<AxLocalState, String> {
    let current = state(&desktop.ax)?;
    if !current.providers.iter().any(|item| item.id == provider && item.configured && item.models.iter().any(|available| available.id == model)) {
        return Err("Select a model from a configured AX provider".into());
    }
    let path = ax_home().join("config.json");
    let mut config = read_json(&path)?;
    config.as_object_mut().ok_or("Invalid AX config.json")?.insert("model".into(), json!({"provider":provider,"model":model}));
    write_private_json(&path, &config)?;
    state(&desktop.ax)
}

fn workspace_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || !path.is_dir() { return Err("Choose an existing workspace directory".into()); }
    Ok(path)
}

fn backup_command(ax: &Path, cwd: &str, arguments: &[&OsStr]) -> Result<String, String> {
    let output = Command::new(ax).args(arguments).current_dir(workspace_path(cwd)?).output().map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if output.status.success() { Ok(stdout) } else { Err(if stderr.is_empty() { stdout } else { stderr }) }
}

#[tauri::command]
pub fn ax_export(desktop: State<'_, DesktopState>, cwd: String, path: String, scope: String) -> Result<String, String> {
    let destination = PathBuf::from(&path);
    if !destination.is_absolute() || destination.extension().and_then(OsStr::to_str) != Some("axpack") { return Err("Choose an absolute .axpack destination".into()); }
    if destination.exists() { return Err("AX export never overwrites an existing archive".into()); }
    let mut args = vec![OsStr::new("export"), destination.as_os_str()];
    match scope.as_str() { "memory" => args.push(OsStr::new("--memory")), "sessions" => args.push(OsStr::new("--sessions")), "all" => (), _ => return Err("Invalid export scope".into()) }
    backup_command(&desktop.ax, &cwd, &args)
}

#[tauri::command]
pub fn ax_import(desktop: State<'_, DesktopState>, cwd: String, path: String, dry_run: bool) -> Result<String, String> {
    let archive = PathBuf::from(&path);
    if !archive.is_absolute() || !archive.is_file() { return Err("Choose an existing AX archive".into()); }
    let mut args = vec![OsStr::new("import"), archive.as_os_str()];
    if dry_run { args.push(OsStr::new("--dry-run")); }
    backup_command(&desktop.ax, &cwd, &args)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_ax_model_cache() {
        let root = std::env::temp_dir().join(format!("ax-crew-status-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("models")).unwrap();
        fs::write(root.join("models/deepseek.json"), r#"{"models":[{"id":"private-model","display_name":"Private"}]}"#).unwrap();
        assert_eq!(cached_models(&root, "deepseek")[0].id, "private-model");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn updates_existing_ax_json_without_touching_user_data() {
        let root = std::env::temp_dir().join(format!("ax-crew-auth-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("auth.json");
        write_private_json(&path, &json!({"deepseek":{"type":"api_key","key":"first"}})).unwrap();
        write_private_json(&path, &json!({"deepseek":{"type":"api_key","key":"second"}})).unwrap();
        assert_eq!(read_json(&path).unwrap()["deepseek"]["key"], "second");
        fs::remove_dir_all(root).unwrap();
    }
}
