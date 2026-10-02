//! Release installer updates. GitHub is canonical; matching GitCode assets are
//! tried in measured source order, with strict SHA256 verification per source.
use crate::release_source::{self, Release, UpdateSource};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, time::Duration};
use tauri::Manager;

#[derive(Serialize)]
pub struct Status {
    current_version: &'static str,
    latest_version: String,
    available: bool,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("AX-Crew/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(240))
        .build()
        .map_err(|e| e.to_string())
}
async fn releases(client: &reqwest::Client) -> Result<Vec<(UpdateSource, Release)>, String> {
    release_source::latest(client, &UpdateSource::sources("AXCrew")).await
}
fn installer_name(tag: &str) -> Result<String, String> {
    let version = tag.trim_start_matches('v');
    if version.is_empty()
        || !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
    {
        return Err("Release 版本号无效".into());
    }
    Ok(format!("AX-Crew-{version}-windows-x64-setup.exe"))
}
fn asset_url<'a>(release: &'a Release, name: &str) -> Result<&'a str, String> {
    let url = &release
        .assets
        .iter()
        .find(|a| a.name == name)
        .ok_or_else(|| format!("此版本缺少 {name}"))?
        .browser_download_url;
    let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    let github = parsed.scheme() == "https"
        && parsed.host_str() == Some("github.com")
        && parsed
            .path()
            .starts_with("/Axium-Labs/AXCrew/releases/download/");
    let gitcode = parsed.scheme() == "https"
        && matches!(parsed.host_str(), Some("gitcode.com" | "api.gitcode.com"));
    #[cfg(test)]
    let mock =
        parsed.scheme() == "http" && matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    #[cfg(not(test))]
    let mock = false;
    if !github && !gitcode && !mock {
        return Err("Release 资产 URL 不属于已配置的官方源或 GitCode 镜像".into());
    }
    Ok(url)
}
fn expected_hash(text: &str, name: &str) -> Result<String, String> {
    let entries: Vec<_> = text
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let hash = fields.next()?;
            let filename = fields.next()?.trim_start_matches('*');
            (filename == name && fields.next().is_none()).then_some(hash)
        })
        .collect();
    match entries.as_slice() {
        [hash] if hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit()) => {
            Ok(hash.to_ascii_lowercase())
        }
        [] => Err("SHA256SUMS 缺少安装包校验值".into()),
        _ => Err("SHA256SUMS 中的安装包校验值无效或重复".into()),
    }
}
async fn verified_download(
    client: &reqwest::Client,
    source: &UpdateSource,
    release: &Release,
    name: &str,
    temporary: &std::path::Path,
) -> Result<(), String> {
    let sums_response = request_asset(
        client,
        source,
        asset_url(release, "SHA256SUMS")?,
        Duration::from_secs(30),
    )
    .await?;
    let expected = expected_hash(
        &sums_response
            .text()
            .await
            .map_err(|e| format!("{} SHA256SUMS: {e}", source.name))?,
        name,
    )?;
    let mut response = request_asset(
        client,
        source,
        asset_url(release, name)?,
        Duration::from_secs(180),
    )
    .await?;
    let mut file = fs::File::create(temporary).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("{} installer download: {e}", source.name))?
    {
        size += chunk.len();
        if size > 200 * 1024 * 1024 {
            return Err("安装包超过大小限制".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    file.sync_all().map_err(|e| e.to_string())?;
    if format!("{:x}", hash.finalize()) != expected {
        return Err(format!("{} 安装包 SHA256 校验失败", source.name));
    }
    Ok(())
}

async fn request_asset(
    client: &reqwest::Client,
    source: &UpdateSource,
    url: &str,
    timeout: Duration,
) -> Result<reqwest::Response, String> {
    let mut last = String::new();
    for attempt in 0..3 {
        let result = tokio::time::timeout(timeout, client.get(url).timeout(timeout).send()).await;
        match result {
            Ok(Ok(response)) if response.status().is_success() => return Ok(response),
            Ok(Ok(response)) => {
                let status = response.status();
                last = format!("{} HTTP {status}", source.name);
                if !(status.is_server_error() || status.as_u16() == 429) {
                    return Err(last);
                }
            }
            Ok(Err(error)) => {
                last = format!("{} download network error: {error}", source.name);
                if !(error.is_connect() || error.is_timeout() || error.is_body()) {
                    return Err(last);
                }
            }
            Err(_) => last = format!("{} download timed out", source.name),
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
        }
    }
    Err(last)
}

async fn download_first_verified(
    client: &reqwest::Client,
    sources: &[(UpdateSource, Release)],
    name: &str,
    temporary: &std::path::Path,
) -> Result<(), String> {
    let mut failures = Vec::new();
    for (source, release) in sources {
        match verified_download(client, source, release, name, temporary).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                let _ = fs::remove_file(temporary);
                failures.push(error);
            }
        }
    }
    let _ = fs::remove_file(temporary);
    Err(format!(
        "所有 Release 下载源均失败：{}",
        failures.join("; ")
    ))
}

#[tauri::command]
pub async fn crew_check_update() -> Result<Status, String> {
    let sources = releases(&client()?).await?;
    let release = &sources[0].1;
    let available = crate::ax_update::is_newer(&release.tag_name, env!("CARGO_PKG_VERSION"))
        .ok_or("无法比较 Release 版本号")?;
    if available {
        let name = installer_name(&release.tag_name)?;
        if !sources.iter().any(|(_, release)| {
            asset_url(release, &name).is_ok() && asset_url(release, "SHA256SUMS").is_ok()
        }) {
            return Err("GitHub 与 GitCode 均缺少此版本安装包或 SHA256SUMS".into());
        }
    }
    Ok(Status {
        current_version: env!("CARGO_PKG_VERSION"),
        latest_version: release.tag_name.clone(),
        available,
    })
}

#[tauri::command]
pub async fn crew_apply_update(app: tauri::AppHandle) -> Result<(), String> {
    if !cfg!(all(windows, target_arch = "x86_64")) {
        return Err("此安装更新入口仅支持 Windows x64".into());
    }
    let client = client()?;
    let sources = releases(&client).await?;
    let release = &sources[0].1;
    if crate::ax_update::is_newer(&release.tag_name, env!("CARGO_PKG_VERSION")) != Some(true) {
        return Err("AX Crew 已是最新版本".into());
    }
    let name = installer_name(&release.tag_name)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let temporary = dir.join(format!("{}.part", uuid::Uuid::new_v4()));
    download_first_verified(&client, &sources, &name, &temporary).await?;
    let installer = dir.join(&name);
    if installer.exists() {
        fs::remove_file(&installer).map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, &installer).map_err(|e| e.to_string())?;
    crate::shutdown_runtime(&app)?;
    let mut launch = crate::proc::command(installer);
    launch.arg("/UPDATE");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let directory = executable
            .parent()
            .filter(|path| path.join("uninstall.exe").is_file())
            .map(std::path::Path::to_path_buf)
            .or_else(|| {
                std::env::var_os("LOCALAPPDATA")
                    .map(|path| std::path::PathBuf::from(path).join("AX Crew"))
            })
            .ok_or("无法确定 AX Crew 安装目录")?;
        launch.raw_arg(format!("/D={}", directory.display()));
    }
    launch
        .spawn()
        .map_err(|e| format!("无法启动安装向导：{e}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installer_is_versioned_and_cannot_escape_download_directory() {
        assert_eq!(
            installer_name("v0.2.1").unwrap(),
            "AX-Crew-0.2.1-windows-x64-setup.exe"
        );
        assert!(installer_name("../evil").is_err());
    }
    #[test]
    fn asset_urls_are_restricted_to_known_providers() {
        let release = Release {
            tag_name: "v0.3.0".into(),
            assets: vec![crate::release_source::Asset {
                name: "setup.exe".into(),
                browser_download_url: "https://example.com/setup.exe".into(),
            }],
        };
        assert!(asset_url(&release, "setup.exe").is_err());
    }
    #[test]
    fn checksum_must_have_exactly_one_valid_matching_entry() {
        let hash = "a".repeat(64);
        assert_eq!(
            expected_hash(&format!("{hash}  installer.exe"), "installer.exe").unwrap(),
            hash
        );
        assert!(expected_hash("bad  installer.exe", "installer.exe").is_err());
        assert!(
            expected_hash(&format!("{hash} installer.exe unexpected"), "installer.exe").is_err()
        );
        assert!(expected_hash(
            &format!("{hash} installer.exe\n{hash} installer.exe"),
            "installer.exe"
        )
        .is_err());
    }

    #[tokio::test]
    async fn bad_checksum_removes_partial_file_then_uses_matching_mirror() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        fn server(bodies: Vec<String>) -> (String, thread::JoinHandle<()>) {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let worker = thread::spawn(move || {
                for body in bodies {
                    let (mut stream, _) = listener.accept().unwrap();
                    let mut request = [0; 2048];
                    let _ = stream.read(&mut request).unwrap();
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                }
            });
            (url, worker)
        }
        let payload = b"verified installer";
        let good_sums = format!("{:x}  setup.exe", Sha256::digest(payload));
        let (bad_url, bad_server) = server(vec![
            format!("{}  setup.exe", "0".repeat(64)),
            "tampered installer".into(),
        ]);
        let (good_url, good_server) = server(vec![
            good_sums,
            String::from_utf8(payload.to_vec()).unwrap(),
        ]);
        let release = |base: &str| Release {
            tag_name: "v0.3.0".into(),
            assets: vec![
                crate::release_source::Asset {
                    name: "SHA256SUMS".into(),
                    browser_download_url: format!("{base}/sums"),
                },
                crate::release_source::Asset {
                    name: "setup.exe".into(),
                    browser_download_url: format!("{base}/setup"),
                },
            ],
        };
        let sources = vec![
            (
                UpdateSource {
                    name: "GitHub",
                    api: String::new(),
                    github: true,
                },
                release(&bad_url),
            ),
            (
                UpdateSource {
                    name: "GitCode",
                    api: String::new(),
                    github: false,
                },
                release(&good_url),
            ),
        ];
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        let path = std::env::temp_dir().join(format!("crew-update-{}.part", uuid::Uuid::new_v4()));
        download_first_verified(&client, &sources, "setup.exe", &path)
            .await
            .unwrap();
        assert_eq!(fs::read(&path).unwrap(), payload);
        let _ = fs::remove_file(path);
        bad_server.join().unwrap();
        good_server.join().unwrap();
    }
}
