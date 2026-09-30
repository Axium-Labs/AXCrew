//! Release installer updates, with a SHA256 check before launching the installer.
use std::{fs, io::Write, time::Duration};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

const API: &str = "https://api.github.com/repos/Axium-Labs/AXCrew/releases/latest";
#[derive(Deserialize)]
struct Asset { name: String, browser_download_url: String }
#[derive(Deserialize)]
struct Release { tag_name: String, assets: Vec<Asset> }
#[derive(Serialize)]
pub struct Status { current_version: &'static str, latest_version: String, available: bool }

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent(concat!("AX-Crew/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(240)).build().map_err(|e| e.to_string())
}
async fn release(client: &reqwest::Client) -> Result<Release, String> {
    client.get(API).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| format!("检查 AX Crew 更新失败：{e}"))?
        .json().await.map_err(|e| e.to_string())
}
fn installer_name(tag: &str) -> Result<String, String> {
    let version = tag.trim_start_matches('v');
    if version.is_empty() || !version.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-')) {
        return Err("Release 版本号无效".into());
    }
    Ok(format!("AX-Crew-{version}-windows-x64-setup.exe"))
}
fn asset<'a>(release: &'a Release, name: &str) -> Result<&'a str, String> {
    let url = &release.assets.iter().find(|a| a.name == name)
        .ok_or_else(|| format!("此版本缺少 {name}"))?.browser_download_url;
    if !url.starts_with("https://github.com/Axium-Labs/AXCrew/releases/download/") {
        return Err("安装包必须来自 AXCrew 官方 GitHub Release".into());
    }
    Ok(url)
}
#[tauri::command]
pub async fn crew_check_update() -> Result<Status, String> {
    let release = release(&client()?).await?;
    let available = crate::ax_update::is_newer(&release.tag_name, env!("CARGO_PKG_VERSION"))
        .ok_or("无法比较 Release 版本号")?;
    // A release without a Windows installer must never offer an unusable update.
    if available { asset(&release, &installer_name(&release.tag_name)?)?; asset(&release, "SHA256SUMS")?; }
    Ok(Status { current_version: env!("CARGO_PKG_VERSION"), latest_version: release.tag_name, available })
}
#[tauri::command]
pub async fn crew_apply_update(app: tauri::AppHandle) -> Result<(), String> {
    if !cfg!(all(windows, target_arch = "x86_64")) { return Err("此安装更新入口仅支持 Windows x64".into()); }
    let client = client()?;
    let release = release(&client).await?;
    if crate::ax_update::is_newer(&release.tag_name, env!("CARGO_PKG_VERSION")) != Some(true) {
        return Err("AX Crew 已是最新版本".into());
    }
    let name = installer_name(&release.tag_name)?;
    let sums = client.get(asset(&release, "SHA256SUMS")?).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    let expected = sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        (parts.next()?.trim_start_matches('*') == name && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit())).then(|| hash.to_ascii_lowercase())
    }).ok_or("SHA256SUMS 缺少安装包校验值")?;
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let temporary = dir.join(format!("{}.part", uuid::Uuid::new_v4()));
    let download = async {
        let mut response = client.get(asset(&release, &name)?).send().await.map_err(|e| e.to_string())?
            .error_for_status().map_err(|e| e.to_string())?;
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut size = 0usize;
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            size += chunk.len();
            if size > 200 * 1024 * 1024 { return Err("安装包超过大小限制".to_owned()); }
            hash.update(&chunk);
            file.write_all(&chunk).map_err(|e| e.to_string())?;
        }
        file.sync_all().map_err(|e| e.to_string())?;
        if format!("{:x}", hash.finalize()) != expected { return Err("安装包 SHA256 校验失败，请重新下载".into()); }
        Ok::<_, String>(())
    }.await;
    if let Err(error) = download { let _ = fs::remove_file(&temporary); return Err(error); }
    let installer = dir.join(name);
    if installer.exists() { fs::remove_file(&installer).map_err(|e| e.to_string())?; }
    fs::rename(&temporary, &installer).map_err(|e| e.to_string())?;
    crate::proc::command(installer).spawn().map_err(|e| format!("无法启动安装向导：{e}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installer_is_versioned_and_cannot_escape_download_directory() {
        assert_eq!(installer_name("v0.2.1").unwrap(), "AX-Crew-0.2.1-windows-x64-setup.exe");
        assert!(installer_name("../evil").is_err());
    }
    #[test]
    fn installer_must_be_from_official_release() {
        let release = Release { tag_name: "v0.2.1".into(), assets: vec![Asset { name: "setup.exe".into(), browser_download_url: "https://example.com/setup.exe".into() }] };
        assert!(asset(&release, "setup.exe").is_err());
        assert!(asset(&release, "SHA256SUMS").is_err());
    }
}
