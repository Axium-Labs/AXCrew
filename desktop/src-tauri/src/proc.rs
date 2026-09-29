//! Console-window-free child processes.
//!
//! This is a GUI app, but every helper it runs (`ax-crew.exe` gateway, `ax`
//! version/ACP probes, `icacls`) is a console-subsystem program. Spawning one
//! without `CREATE_NO_WINDOW` gives it a console of its own: the gateway left a
//! black window on screen for the whole session, and each probe flashed one
//! briefly. Routing every spawn through [`command`] keeps them invisible.

use std::ffi::OsStr;
use std::process::Command;

/// Windows `CREATE_NO_WINDOW`. Ignored on other platforms.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A [`Command`] that never opens a console window on Windows.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_keeps_the_program_it_was_given() {
        let command = command("ax-crew");
        assert_eq!(command.get_program(), OsStr::new("ax-crew"));
    }
}
