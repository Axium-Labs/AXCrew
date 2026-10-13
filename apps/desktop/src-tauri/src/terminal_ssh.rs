//! Interactive OpenSSH terminals. The PTY transports SSH; the shell runs remotely.
use portable_pty::CommandBuilder;
use std::path::PathBuf;

#[derive(serde::Deserialize)]
pub struct SshTerminal {
    pub host: String,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub(crate) fn command(config: &SshTerminal, cwd: Option<&str>) -> Result<CommandBuilder, String> {
    let host = config.host.trim();
    if host.is_empty()
        || host.starts_with('-')
        || !host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-@:[]".contains(&c))
        || host
            .split('@')
            .any(|part| part.is_empty() || part.starts_with('-'))
        || host.matches('@').count() > 1
    {
        return Err("Invalid SSH host".into());
    }
    if config.port == Some(0) {
        return Err("Invalid SSH port".into());
    }
    let cwd = cwd
        .filter(|path| !path.is_empty())
        .ok_or("SSH terminal requires a remote project directory")?;
    if !cwd.starts_with('/') || cwd.contains('\0') {
        return Err("SSH terminal requires an absolute POSIX project directory".into());
    }
    let mut command = CommandBuilder::new("ssh");
    // Force a remote PTY even though OpenSSH's stdin is the desktop PTY. Leave
    // authentication and known-host prompts interactive, as in a normal SSH client.
    command.args(["-tt", "-o", "ConnectTimeout=10"]);
    if let Some(port) = config.port {
        command.args(["-p", &port.to_string()]);
    }
    if let Some(path) = config
        .identity_file
        .as_deref()
        .filter(|path| !path.is_empty())
    {
        if path.contains(['\n', '\r', '\0']) {
            return Err("Invalid SSH identity file path".into());
        }
        let path = if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\"))
        {
            let home = std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .ok_or("Cannot resolve SSH identity file home directory")?;
            PathBuf::from(home).join(rest)
        } else {
            PathBuf::from(path)
        };
        command.arg("-i");
        command.arg(path);
    }
    command.arg(host);
    // No local shell wraps ssh, and a failed cd ends the SSH command. Directory
    // text is quoted once for the POSIX shell and cannot become a command.
    command.arg(format!(
        "cd -- {} && exec \"${{SHELL:-/bin/sh}}\" -i",
        quote(cwd)
    ));
    Ok(command)
}
