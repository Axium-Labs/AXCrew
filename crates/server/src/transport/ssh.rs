//! SSH is a remote command channel owned by LOCAL AX; remote AX is never spawned.
use crate::domain::connections::SshConnection;
use anyhow::{Result, bail};
use serde_json::{Value, json};
use tokio::{io::AsyncWriteExt, process::Command};

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
pub(super) fn command(config: &SshConnection) -> Result<Command> {
    crate::orchestration::connections::validate_ssh(config)?;
    let mut cmd = Command::new("ssh");
    cmd.args([
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]);
    if let Some(port) = config.port {
        cmd.arg("-p").arg(port.to_string());
    }
    if let Some(path) = config.identity_file.as_deref().filter(|p| !p.is_empty()) {
        let path = if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\"))
        {
            std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .map(std::path::PathBuf::from)
                .unwrap_or_default()
                .join(rest)
        } else {
            std::path::PathBuf::from(path)
        };
        cmd.arg("-i").arg(path);
    }
    cmd.arg(&config.host)
        .arg("sh -s")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    Ok(cmd)
}
pub(super) async fn workspace(config: &SshConnection, cwd: Option<&str>) -> Result<Value> {
    let cwd = cwd.filter(|p| !p.is_empty()).unwrap_or(".");
    if cwd.contains('\0') {
        bail!("invalid remote cwd");
    }
    let mut child = command(config)?.spawn()?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow::anyhow!("SSH stdin unavailable"))?;
    // NUL-delimited paths preserve spaces, quotes and newlines without remote Python.
    let script = format!(
        "set -e\ncd -- {}\nroot=$(pwd -P)\nprintf '%s\\000' \"$root\"\nfind -L \"$root\" -mindepth 1 -maxdepth 1 -type d -print0\n",
        quote(cwd)
    );
    let output = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        stdin.write_all(script.as_bytes()).await?;
        drop(stdin);
        child.wait_with_output().await
    })
    .await??;
    if !output.status.success() {
        bail!(
            "SSH directory probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let mut paths = output
        .stdout
        .split(|c| *c == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8_lossy(p).into_owned());
    let root = paths
        .next()
        .filter(|p| p.starts_with('/'))
        .ok_or_else(|| anyhow::anyhow!("SSH omitted absolute directory"))?;
    let mut directories = paths
        .map(|path| json!({"name":path.rsplit('/').next().unwrap_or(&path),"path":path}))
        .collect::<Vec<_>>();
    directories.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    let parent = if root == "/" {
        None
    } else {
        Some(
            root.rsplit_once('/')
                .map_or("/", |(p, _)| if p.is_empty() { "/" } else { p }),
        )
    };
    Ok(json!({"cwd":root,"parent":parent,"directories":directories}))
}
/// Durable local transcript workspace; it is NOT the remote source directory.
pub(super) fn local_workspace(device: &str) -> Result<std::path::PathBuf> {
    let id = device
        .strip_prefix("ssh:")
        .ok_or_else(|| anyhow::anyhow!("invalid SSH ID"))?;
    if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
        bail!("invalid SSH ID");
    }
    let home = crate::ax::ax_home().ok_or_else(|| anyhow::anyhow!("AX home unavailable"))?;
    let root = home.join("ssh-workspaces").join(id);
    std::fs::create_dir_all(&root)?;
    Ok(root.canonicalize()?)
}

/// A file avoids Windows environment-block size limits for large host catalogues.
pub(super) struct ContextFile {
    pub path: std::path::PathBuf,
}
impl ContextFile {
    pub fn new(hosts: Vec<SshConnection>, default_host: &str, cwd: &str) -> Result<Self> {
        let home = crate::ax::ax_home().ok_or_else(|| anyhow::anyhow!("AX home unavailable"))?;
        let directory = home.join("ssh-contexts");
        std::fs::create_dir_all(&directory)?;
        let path = directory.join(format!("{}.json", uuid::Uuid::new_v4()));
        std::fs::write(
            &path,
            json!({"hosts":hosts,"default_host":default_host,"cwd":cwd}).to_string(),
        )?;
        Ok(Self { path })
    }
}
impl Drop for ContextFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}
