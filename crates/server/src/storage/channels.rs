//! Protected sidecar persistence. Does not alter task/session database formats.
use crate::domain::channel::ChannelState;
use anyhow::{Result, ensure};
use std::{io::Write, path::PathBuf, sync::Mutex};

pub struct ChannelStore {
    path: PathBuf,
    state: Mutex<ChannelState>,
}
impl ChannelStore {
    pub fn load(path: PathBuf) -> Result<Self> {
        let state = if path.exists() {
            ensure!(
                std::fs::metadata(&path)?.len() <= 8 * 1024 * 1024,
                "channel state too large"
            );
            serde_json::from_slice(&unprotect(&std::fs::read(&path)?)?)?
        } else {
            ChannelState::default()
        };
        Ok(Self {
            path,
            state: Mutex::new(state),
        })
    }
    pub fn snapshot(&self) -> ChannelState {
        self.state.lock().unwrap().clone()
    }
    pub fn update<T>(&self, action: impl FnOnce(&mut ChannelState) -> Result<T>) -> Result<T> {
        let mut state = self.state.lock().unwrap();
        let mut next = state.clone();
        let result = action(&mut next)?;
        let bytes = protect(&serde_json::to_vec(&next)?)?;
        ensure!(bytes.len() <= 8 * 1024 * 1024, "channel state too large");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let temp = self.path.with_extension("tmp");
        let mut file = options.open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(temp, &self.path)?;
        *state = next;
        Ok(result)
    }
}
#[cfg(not(windows))]
fn protect(value: &[u8]) -> Result<Vec<u8>> {
    Ok(value.to_vec())
}
#[cfg(not(windows))]
fn unprotect(value: &[u8]) -> Result<Vec<u8>> {
    Ok(value.to_vec())
}
#[cfg(windows)]
fn protect(value: &[u8]) -> Result<Vec<u8>> {
    crypt(value, true)
}
#[cfg(windows)]
fn unprotect(value: &[u8]) -> Result<Vec<u8>> {
    crypt(value, false)
}
#[cfg(windows)]
fn crypt(value: &[u8], encrypt: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len().try_into()?,
        pbData: value.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI binds credentials to the current Windows account; no UI prompt is allowed.
    unsafe {
        let ok = if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        ensure!(
            ok != 0,
            "cannot unlock chat credentials for this OS account"
        );
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData.cast());
        Ok(result)
    }
}
