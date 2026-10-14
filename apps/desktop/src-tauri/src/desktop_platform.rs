//! Unix desktop launch environment. GUI launchers may omit user tool directories.
use std::path::PathBuf;

pub(crate) fn search_path() -> Option<std::ffi::OsString> {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut paths: Vec<PathBuf> = std::env::split_paths(&current).collect();
    if cfg!(unix) {
        let mut extra = Vec::new();
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            extra.extend([home.join(".local/bin"), home.join(".cargo/bin")]);
        }
        extra.extend(
            [
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
            ]
            .map(PathBuf::from),
        );
        for path in extra {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    std::env::join_paths(paths).ok()
}

pub(crate) fn default_terminal_shell() -> &'static str {
    if cfg!(windows) {
        "powershell"
    } else {
        "default"
    }
}

pub(crate) fn shell_supported(shell: &str) -> bool {
    if cfg!(windows) {
        matches!(shell, "powershell" | "cmd" | "git_bash" | "wsl")
    } else {
        matches!(shell, "default" | "sh" | "bash" | "zsh" | "fish")
    }
}

pub(crate) fn effective_terminal_shell(shell: Option<&str>) -> &str {
    match shell {
        None => default_terminal_shell(),
        Some(shell) if shell_supported(shell) => shell,
        Some(
            "powershell" | "cmd" | "git_bash" | "wsl" | "default" | "sh" | "bash" | "zsh" | "fish",
        ) => default_terminal_shell(),
        Some(shell) => shell, // Unknown settings still fail shell validation.
    }
}

#[cfg(unix)]
pub(crate) fn unix_shell(shell: &str) -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;
    let executable = |path: &std::path::Path| {
        path.is_file()
            && path
                .metadata()
                .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
    };
    if shell == "default" {
        if let Some(path) = std::env::var_os("SHELL").map(PathBuf::from) {
            if path.is_absolute() && executable(&path) {
                return Ok(path);
            }
        }
        let preferred = PathBuf::from(if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/bash"
        });
        if executable(&preferred) {
            return Ok(preferred);
        }
        return Ok(PathBuf::from("/bin/sh"));
    }
    if !matches!(shell, "sh" | "bash" | "zsh" | "fish") {
        return Err("Invalid Unix terminal shell".into());
    }
    search_path()
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|path| path.join(shell))
                .find(|path| executable(path))
        })
        .ok_or_else(|| format!("Shell {shell} is not installed or executable"))
}
