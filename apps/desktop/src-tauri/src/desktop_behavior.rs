//! Persisted native window-close preference, available before the WebView loads.
use serde::{Deserialize, Serialize};
use std::{fs, io, path::PathBuf, sync::Mutex};

#[derive(Deserialize, Serialize)]
struct Config {
    close_to_tray: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CloseAction {
    Hide,
    Quit,
    Allow,
}

pub(crate) struct ClosePreference {
    path: PathBuf,
    enabled: Mutex<bool>,
}

impl ClosePreference {
    pub(crate) fn default_at(path: PathBuf) -> Self {
        Self {
            path,
            enabled: Mutex::new(true),
        }
    }

    pub(crate) fn load(path: PathBuf) -> io::Result<Self> {
        let enabled = match fs::read(&path) {
            Ok(raw) => {
                serde_json::from_slice::<Config>(&raw)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
                    .close_to_tray
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => true,
            Err(error) => return Err(error),
        };
        Ok(Self {
            path,
            enabled: Mutex::new(enabled),
        })
    }

    pub(crate) fn enabled(&self) -> bool {
        // A poisoned preference must not accidentally quit an active session.
        self.enabled.lock().map(|value| *value).unwrap_or(true)
    }

    pub(crate) fn save(&self, enabled: bool) -> io::Result<bool> {
        let mut current = self
            .enabled
            .lock()
            .map_err(|_| io::Error::other("Desktop preference lock failed"))?;
        let content = serde_json::to_vec_pretty(&Config {
            close_to_tray: enabled,
        })?;
        let temporary = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        fs::write(&temporary, content)?;
        if let Err(error) = fs::rename(&temporary, &self.path) {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        *current = enabled;
        Ok(enabled)
    }

    pub(crate) fn close_action(&self, quitting: bool) -> CloseAction {
        if quitting {
            CloseAction::Allow
        } else if self.enabled() {
            CloseAction::Hide
        } else {
            CloseAction::Quit
        }
    }
}
