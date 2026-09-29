//! 检查 / 下载 / 更新系统中安装的 AX。
//!
//! 设置页的「本地 AX」要回答三件事：这台机器上有没有 AX、线上最新是哪一版、
//! 以及一次点击就能把它装上或升级。检查只读 GitHub Releases API；下载与替换
//! 交给 AX 自己的 `--update`（自带 SHA256 校验，Windows 上还会等进程退出后再
//! 换文件）或官方安装脚本，这里不重复实现第二份升级器。
//!
//! 管理对象是**系统里安装的** AX（PATH 上的那一份，或官方安装目录里的那一份）。
//! Crew 自己运行的 AX 由启动时选定，不在这里动它。

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::{ax, proc::command};

const RELEASE_API: &str = "https://api.github.com/repos/Axium-Labs/AX/releases/latest";
const INSTALL_PS1: &str = "https://raw.githubusercontent.com/Axium-Labs/AX/main/scripts/install.ps1";
#[cfg(not(windows))]
const INSTALL_SH: &str = "https://raw.githubusercontent.com/Axium-Labs/AX/main/scripts/install.sh";
/// 安装包约 15 MB，给足时间，但绝不无限期挂在设置页上。
const RUN_TIMEOUT: Duration = Duration::from_secs(240);

#[derive(Serialize)]
pub struct AxUpdateStatus {
    /// 这次检查/更新对应的 AX 路径；`None` 表示这台机器上还没有装 AX。
    pub binary: Option<String>,
    pub local_version: Option<String>,
    /// GitHub 上的最新 tag，形如 `v0.1.1`。
    pub latest_version: String,
    pub up_to_date: bool,
    /// `none` / `update` / `install`，设置页据此决定按钮文案。
    pub action: String,
    pub install_dir: String,
    /// 只在真正下载或更新之后带上：安装脚本或 `ax --update` 的原始输出。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report: Option<String>,
}

#[derive(serde::Deserialize)]
struct Release {
    tag_name: String,
}

/// 解析版本号。`ax --version` 输出 `ax 0.1.0`，GitHub 的 tag 是 `v0.1.1`。
fn parse_version(text: &str) -> Option<Vec<u64>> {
    let token = text.split_whitespace().last()?;
    let core = token.trim_start_matches('v').split(['-', '+']).next()?;
    let parts: Vec<u64> = core.split('.').map(|part| part.parse().ok()).collect::<Option<_>>()?;
    (!parts.is_empty()).then_some(parts)
}

/// 去掉前缀形式，只留可比的部分（`ax 0.1.0` / `v0.1.0` → `0.1.0`）。
fn normalize(text: &str) -> String {
    text.split_whitespace().last().unwrap_or(text).trim_start_matches('v').to_owned()
}

fn is_newer(latest: &str, local: &str) -> Option<bool> {
    let (latest, local) = (parse_version(latest)?, parse_version(local)?);
    let width = latest.len().max(local.len());
    let pad = |mut parts: Vec<u64>| {
        parts.resize(width, 0);
        parts
    };
    Some(pad(latest) > pad(local))
}

/// 由「线上 tag + 本机版本」决定要不要动手，以及动哪一种。
fn decide(latest: &str, local: Option<&str>) -> (bool, &'static str) {
    let Some(local) = local else { return (false, "install") };
    // 版本号解析不出来时退回 AX 自己的判断方式：tag 去掉 v 后是否与新版本相同。
    let up_to_date = is_newer(latest, local).map_or_else(|| normalize(latest) == normalize(local), |newer| !newer);
    (up_to_date, if up_to_date { "none" } else { "update" })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // GitHub 的 API 会拒绝没有 User-Agent 的请求。
        .user_agent(concat!("AX-Crew/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

async fn latest_tag(client: &reqwest::Client) -> Result<String, String> {
    let response = client.get(RELEASE_API).send().await.map_err(|error| format!("无法访问 GitHub Releases：{error}"))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            403 | 429 => "GitHub 接口访问过于频繁，请稍后再试".to_owned(),
            status => format!("GitHub Releases 返回 {status}"),
        });
    }
    let release: Release = response.json().await.map_err(|error| format!("无法解析 GitHub Release：{error}"))?;
    let tag = release.tag_name.trim().to_owned();
    if tag.is_empty() { return Err("GitHub Releases 没有返回版本号".to_owned()); }
    Ok(tag)
}

fn status(binary: Option<PathBuf>, latest: String, report: Option<String>) -> AxUpdateStatus {
    let local_version = binary.as_deref().and_then(ax::version);
    let (up_to_date, action) = decide(&latest, local_version.as_deref());
    AxUpdateStatus {
        binary: binary.map(|path| path.to_string_lossy().into_owned()),
        local_version,
        latest_version: latest,
        up_to_date,
        action: action.to_owned(),
        install_dir: ax::install_dir().to_string_lossy().into_owned(),
        report,
    }
}

#[tauri::command]
pub async fn ax_check_update() -> Result<AxUpdateStatus, String> {
    let latest = latest_tag(&client()?).await?;
    // 探测版本要 spawn 进程，别占着异步运行时。
    tauri::async_runtime::spawn_blocking(move || status(ax::installed_ax(), latest, None))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn ax_apply_update() -> Result<AxUpdateStatus, String> {
    let latest = latest_tag(&client()?).await?;
    tauri::async_runtime::spawn_blocking(move || apply(latest)).await.map_err(|error| error.to_string())?
}

fn apply(latest: String) -> Result<AxUpdateStatus, String> {
    let existing = ax::installed_ax();
    let before = existing.as_deref().and_then(ax::version);
    // 已经有 AX 且它自带升级器：交给 AX 自己，它会校验 SHA256，并在 Windows 上让
    // 一个脱离的助手等进程退出后再替换文件。
    let updatable = existing.clone().filter(|path| supports_update(path));
    let (report, binary) = match updatable {
        Some(path) => {
            let report = run_update(&path)?;
            wait_for_replacement(&path, before.as_deref());
            (report, Some(path))
        }
        // 还没装过，或者装的是没有 `--update` 的旧版本：跑官方安装脚本。
        None => {
            let report = run_installer()?;
            let installed = ax::install_dir().join(ax::executable_name());
            let binary = installed.is_file().then_some(installed).or(existing).or_else(ax::installed_ax);
            (report, binary)
        }
    };
    if let Some(path) = binary.as_deref() { ax::forget_probes(path); }
    Ok(status(binary, latest, Some(report)))
}

/// 旧版 AX 没有 `--update`：用 `--update --help` 探一下，探不通就走安装脚本。
fn supports_update(path: &Path) -> bool {
    command(path)
        .args(["--update", "--help"])
        .output()
        .is_ok_and(|output| output.status.success() && String::from_utf8_lossy(&output.stdout).contains("--update"))
}

/// Windows 上 `ax --update` 是让助手等 AX 退出后再换文件，版本号会晚一小会儿才变；
/// 给它几次机会，免得设置页更新完显示的还是替换前的版本。
fn wait_for_replacement(path: &Path, before: Option<&str>) {
    for attempt in 0..8 {
        ax::forget_probes(path);
        let probed = ax::version(path);
        if probed.is_some() && probed.as_deref() != before { return; }
        if attempt < 7 { std::thread::sleep(Duration::from_millis(400)); }
    }
}

fn run_update(path: &Path) -> Result<String, String> {
    let mut command = command(path);
    command.arg("--update");
    run_bounded(command, RUN_TIMEOUT)
}

#[cfg(windows)]
fn run_installer() -> Result<String, String> {
    let script = format!("iex ((iwr '{INSTALL_PS1}' -UseBasicParsing).Content)");
    let mut command = command("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script]);
    run_bounded(command, RUN_TIMEOUT)
}

#[cfg(not(windows))]
fn run_installer() -> Result<String, String> {
    let mut command = command("sh");
    // 安装脚本自己会按 SHA256SUMS 校验下载到的包，与官方一行命令安装完全一致。
    command.args(["-c", &format!("curl -fsSL {INSTALL_SH} | sh")]);
    run_bounded(command, RUN_TIMEOUT)
}

/// 跑一个会下载几十兆的子进程。
///
/// 输出重定向到临时文件而不是管道：下载进度足以写满管道缓冲区，管道一旦堵住，
/// 子进程就再也走不到退出，`output()` 会一直挂着。超时同样自己收尾。
fn run_bounded(mut command: Command, timeout: Duration) -> Result<String, String> {
    let log = std::env::temp_dir().join(format!("ax-crew-update-{}.log", uuid::Uuid::new_v4()));
    let result = (|| {
        let file = fs::File::create(&log).map_err(|error| error.to_string())?;
        let mirror = file.try_clone().map_err(|error| error.to_string())?;
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::from(file))
            .stderr(Stdio::from(mirror))
            .spawn()
            .map_err(|error| format!("无法启动安装进程：{error}"))?;
        let deadline = Instant::now() + timeout;
        let finished = loop {
            match child.try_wait() {
                Ok(Some(finished)) => break Some(finished),
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(150)),
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("安装超过 {} 秒未完成，已中止", timeout.as_secs()));
                }
                Err(error) => return Err(error.to_string()),
            }
        };
        let output = fs::read_to_string(&log).unwrap_or_default();
        let trimmed = output.trim();
        if finished.is_some_and(|status| status.success()) {
            Ok(if trimmed.is_empty() { "已完成。".to_owned() } else { trimmed.to_owned() })
        } else {
            Err(if trimmed.is_empty() { "安装进程以非零状态退出".to_owned() } else { trimmed.to_owned() })
        }
    })();
    let _ = fs::remove_file(&log);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_versions_from_ax_and_github() {
        assert_eq!(parse_version("ax 0.1.0"), Some(vec![0, 1, 0]));
        assert_eq!(parse_version("v0.1.1"), Some(vec![0, 1, 1]));
        assert_eq!(parse_version("0.2.0-beta.1"), Some(vec![0, 2, 0]));
        assert_eq!(parse_version("nightly"), None);
    }

    #[test]
    fn compares_versions_numerically_not_as_text() {
        assert_eq!(is_newer("v0.1.1", "ax 0.1.0"), Some(true));
        assert_eq!(is_newer("v0.1.0", "ax 0.1.0"), Some(false));
        assert_eq!(is_newer("v0.10.0", "ax 0.9.9"), Some(true));
        // 自编译的开发版比线上还新：不算「有更新」。
        assert_eq!(is_newer("v0.1.0", "ax 0.2.0"), Some(false));
        assert_eq!(is_newer("nightly", "ax 0.1.0"), None);
    }

    #[test]
    fn decides_between_install_update_and_nothing() {
        assert_eq!(decide("v0.1.1", None), (false, "install"));
        assert_eq!(decide("v0.1.1", Some("ax 0.1.0")), (false, "update"));
        assert_eq!(decide("v0.1.1", Some("ax 0.1.1")), (true, "none"));
        // 解析不了版本时退回字符串比较，至少不会把一致的版本报成有更新。
        assert_eq!(decide("nightly", Some("nightly")), (true, "none"));
        assert_eq!(decide("nightly", Some("ax 0.1.0")), (false, "update"));
    }
}
