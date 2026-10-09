//! AX capability catalogs for Crew settings. AX owns scope merge and policy.
//! Skills, MCP servers, named Agents and Mods carry the same scope/status metadata.
//! Project sources live under `<project>/.ax`; legacy sources remain AX's concern.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;

use crate::{ax, DesktopState};

/// 目录查询只读本地元数据，给足余量但不无限期等。
const CATALOG_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Serialize)]
pub struct AxSkill {
    pub name: String,
    pub description: String,
    pub scope: String,
    pub source: Option<String>,
    pub status: String,
    /// 技能要求但本机没有的工具；非空表示这个技能跑不起来。
    pub missing_tools: Vec<String>,
    pub enabled: bool,
}

#[derive(Serialize)]
pub struct AxMcpServer {
    pub name: String,
    pub description: String,
    pub scope: String,
    pub source: Option<String>,
    pub status: String,
    pub enabled: bool,
    pub capabilities: Vec<String>,
}

#[derive(Serialize)]
pub struct AxAgent {
    pub name: String,
    pub description: String,
    pub scope: String,
    pub source: Option<String>,
    pub status: String,
    pub enabled: bool,
}

#[derive(Serialize)]
pub struct AxToolInfo {
    pub name: String,
    pub description: String,
}

#[derive(Serialize)]
pub struct AxCatalog {
    /// 实际用来查询的目录；`None` 表示没有指定工作目录，只剩全局技能。
    pub cwd: Option<String>,
    pub skills: Vec<AxSkill>,
    pub mcp_servers: Vec<AxMcpServer>,
    pub tools: Vec<AxToolInfo>,
    pub agents: Vec<AxAgent>,
    pub mods: Vec<Value>,
    /// 单项拿不到时的原因（例如 AX 版本太旧还不支持该扩展）；其余照常返回。
    pub warnings: Vec<String>,
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().into_iter().flatten().filter_map(|item| item.as_str().map(str::to_owned)).collect()
}

/// 取出某个 id 的 `result`；出错或缺席时记一条警告，让其余目录照常显示。
fn result_of(replies: &HashMap<i64, Value>, id: i64, label: &str, warnings: &mut Vec<String>) -> Option<Value> {
    let Some(reply) = replies.get(&id) else {
        warnings.push(format!("{label}：AX 没有返回结果"));
        return None;
    };
    if let Some(error) = reply.get("error") {
        let message = if label == "Mod" && error.get("code").and_then(Value::as_i64) == Some(-32601) {
            "当前使用的 AX 不支持 Mod，请更新本机 AX 后重试。"
        } else {
            error.get("message").and_then(Value::as_str).unwrap_or("查询失败")
        };
        warnings.push(format!("{label}：{message}"));
        return None;
    }
    match reply.get("result") {
        Some(result) => Some(result.clone()),
        None => {
            warnings.push(format!("{label}：AX 返回了空结果"));
            None
        }
    }
}

fn catalog(ax: &Path, cwd: Option<String>, scope: Option<String>) -> Result<AxCatalog, String> {
    // 只接受真实存在的目录：AX 会在自己的 cwd 里找项目技能和 MCP 配置，
    // 路径不存在时宁可退回全局视图，也不要让 spawn 直接失败。
    let directory = cwd.map(PathBuf::from).filter(|path| path.is_dir());
    let requests = format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n",
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
        json!({"jsonrpc":"2.0","id":2,"method":"_ax/skills","params":{"scope":scope}}),
        json!({"jsonrpc":"2.0","id":3,"method":"_ax/mcp","params":{"scope":scope}}),
        json!({"jsonrpc":"2.0","id":4,"method":"_ax/tools"}),
        json!({"jsonrpc":"2.0","id":5,"method":"_ax/agents","params":{"scope":scope}}),
        json!({"jsonrpc":"2.0","id":6,"method":"_ax/mods","params":{"scope":scope}}),
    );
    let replies = ax::acp_replies(ax, directory.as_deref(), &requests, &[1, 2, 3, 4, 5, 6], CATALOG_TIMEOUT);
    if !replies.contains_key(&1) {
        return Err("AX 没有响应能力查询，请确认本机 ax 支持 Crew（ax acp）".to_owned());
    }
    let mut warnings = Vec::new();

    let mut skills = Vec::new();
    if let Some(result) = result_of(&replies, 2, "技能", &mut warnings) {
        skills = result["skills"].as_array().into_iter().flatten().map(|item| AxSkill {
            name: item["name"].as_str().unwrap_or_default().to_owned(),
            description: item["description"].as_str().unwrap_or_default().to_owned(),
            scope: item["scope"].as_str().unwrap_or("global").to_owned(),
            source: item["source"].as_str().map(str::to_owned),
            status: item["status"].as_str().unwrap_or("enabled").to_owned(),
            missing_tools: strings(&item["missing_tools"]),
            enabled: item["enabled"].as_bool().unwrap_or(true),
        }).collect();
    }

    let mut mcp_servers = Vec::new();
    if let Some(result) = result_of(&replies, 3, "MCP 服务器", &mut warnings) {
        mcp_servers = result["servers"].as_array().into_iter().flatten().map(|item| AxMcpServer {
            name: item["name"].as_str().unwrap_or_default().to_owned(),
            description: item["description"].as_str().unwrap_or_default().to_owned(),
            scope: item["scope"].as_str().unwrap_or("global").to_owned(),
            source: item["source"].as_str().map(str::to_owned),
            status: item["status"].as_str().unwrap_or("enabled").to_owned(),
            enabled: item["enabled"].as_bool().unwrap_or(true),
            capabilities: strings(&item["capabilities"]),
        }).collect();
    }

    let mut tools = Vec::new();
    if let Some(result) = result_of(&replies, 4, "工具", &mut warnings) {
        if result["available"].as_bool() == Some(true) {
            tools = result["tools"].as_array().into_iter().flatten().map(|item| AxToolInfo {
                name: item["name"].as_str().unwrap_or_default().to_owned(),
                description: item["description"].as_str().unwrap_or_default().to_owned(),
            }).collect();
        } else {
            warnings.push(format!("工具：{}", result["reason"].as_str().unwrap_or("当前 AX 不支持工具目录")));
        }
    }

    let agents = result_of(&replies, 5, "Agents", &mut warnings).map(|result| result["agents"].as_array().into_iter().flatten().map(|item| AxAgent {
        name: item["name"].as_str().unwrap_or_default().to_owned(),
        description: item["description"].as_str().unwrap_or_default().to_owned(),
        scope: item["scope"].as_str().unwrap_or("global").to_owned(),
        source: item["source"].as_str().map(str::to_owned),
        status: item["status"].as_str().unwrap_or("enabled").to_owned(),
        enabled: item["enabled"].as_bool().unwrap_or(true),
    }).collect()).unwrap_or_default();
    Ok(AxCatalog {
        mods: result_of(&replies, 6, "Mod", &mut warnings).and_then(|result|result["mods"].as_array().cloned()).unwrap_or_default(),
        cwd: directory.map(|path| path.to_string_lossy().into_owned()),
        skills,
        mcp_servers,
        tools,
        agents,
        warnings,
    })
}

#[tauri::command]
pub async fn ax_catalog(desktop: State<'_, DesktopState>, cwd: Option<String>, scope: Option<String>) -> Result<AxCatalog, String> {
    let ax = desktop.ax.clone();
    // 要 spawn `ax acp` 并读盘，别占着异步运行时。
    tauri::async_runtime::spawn_blocking(move || catalog(&ax, cwd, scope)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_reply_becomes_a_warning_not_a_failure() {
        let mut warnings = Vec::new();
        let replies = HashMap::new();
        assert!(result_of(&replies, 2, "技能", &mut warnings).is_none());
        assert_eq!(warnings, vec!["技能：AX 没有返回结果".to_owned()]);
    }

    #[test]
    fn jsonrpc_errors_are_reported_with_their_message() {
        let mut warnings = Vec::new();
        let replies = HashMap::from([(4, json!({"jsonrpc":"2.0","id":4,"error":{"code":-32601,"message":"method not found"}}))]);
        assert!(result_of(&replies, 4, "工具", &mut warnings).is_none());
        assert_eq!(warnings, vec!["工具：method not found".to_owned()]);
    }

    #[test]
    fn catalog_returns_the_result_object() {
        let mut warnings = Vec::new();
        let replies = HashMap::from([(3, json!({"jsonrpc":"2.0","id":3,"result":{"servers":[]}}))]);
        let result = result_of(&replies, 3, "MCP 服务器", &mut warnings).unwrap();
        assert_eq!(strings(&result["servers"]), Vec::<String>::new());
        assert!(warnings.is_empty());
    }

    #[test]
    fn unsupported_mod_catalog_explains_the_installed_ax_requirement() {
        let mut warnings = Vec::new();
        let replies = HashMap::from([(6, json!({"jsonrpc":"2.0","id":6,"error":{"code":-32601,"message":"method not found"}}))]);
        assert!(result_of(&replies, 6, "Mod", &mut warnings).is_none());
        assert_eq!(warnings, vec!["Mod：当前使用的 AX 不支持 Mod，请更新本机 AX 后重试。".to_owned()]);
    }

    #[test]
    fn other_mod_errors_keep_their_actual_cause() {
        let mut warnings = Vec::new();
        let replies = HashMap::from([(6, json!({"jsonrpc":"2.0","id":6,"error":{"code":-32603,"message":"configuration read failed"}}))]);
        assert!(result_of(&replies, 6, "Mod", &mut warnings).is_none());
        assert_eq!(warnings, vec!["Mod：configuration read failed".to_owned()]);
    }
}
