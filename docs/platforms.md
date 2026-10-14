# Desktop platforms

AX Crew shares one React/Tauri client and one Rust gateway across Windows,
Linux and macOS. Frontend, API, database and AX ACP protocol remain common;
Android's separate client and protocol are unchanged.

## Native builds

Install Rust 1.92+, Node.js/npm and Tauri 2 CLI, then run `npm ci` and
`npm run tauri:build` in `apps/desktop`. Install AX separately, at its official
user path or through `AX_CREW_AX`.

- Windows: existing NSIS installer with resource `bin/ax-crew.exe`.
- Linux: Debian/AppImage packages with executable resource `bin/ax-crew`.
  Ubuntu/Debian build prerequisites: `build-essential`, `pkg-config`,
  `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`,
  `librsvg2-dev`, `patchelf`, `libssl-dev`. A graphical desktop/WebKitGTK 4.1
  is required; AppImages may require FUSE or extraction.
- macOS: `.app`/`.dmg` bundles with executable resource `bin/ax-crew`, minimum
  macOS 12 and Xcode command-line tools. Intel and Apple Silicon packages are
  separate. Public distribution still needs signing/notarization; local
  unsigned builds are not notarized releases.

Platform-specific Tauri configs override the Windows resource and bundle format.
`prepare-binaries.mjs` stages the matching gateway; for cross-compilation set
`AX_CREW_TARGET` and pass the same Tauri `--target`. It honors `CARGO_TARGET_DIR`.
Use an absolute `CARGO_TARGET_DIR` when sharing a custom build directory between
gateway and desktop builds, since their Cargo working directories differ.
`pack:portable` retains Windows ZIPs, produces Linux AppImages and ZIPs the
complete macOS `.app` with `ditto`. Do not ship a bare Unix desktop executable.

The manual/pull-request `Desktop platform builds` workflow generates Windows
x64, Linux x64/arm64 and macOS Intel/Apple Silicon installers.
`stage-platform-assets.mjs` sets canonical filenames and generates SHA256SUMS.
It uploads workflow artifacts without publishing a release. Corresponding native
CI jobs must actually pass before macOS/arm64 builds are treated as verified.
New assets cannot be downloaded from existing Releases until separately released.

## Runtime

Unix terminal settings offer default login shell, POSIX sh, Bash, Zsh and Fish.
Default resolves executable `$SHELL`, then `/bin/zsh` on macOS or `/bin/bash`
on Linux, finally `/bin/sh`. PTYs start interactive login shells in the selected
project directory. Explicit shells must be installed. Foreign saved choices
fall back to the platform default. Windows retains its existing choices.

GUI subprocesses/PTYS retain inherited PATH and append standard user/system
locations: `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`, `/usr/local/bin`
and OS paths. Nonstandard tool installations must be on inherited PATH. SSH
requires the local OpenSSH client and a remote POSIX shell.

Unix System settings uses sysinfo for CPU, memory, uptime and the filesystem
containing HOME, preserving nullable MiB fields and UI GiB rendering. Windows
collectors are unchanged. NVIDIA NVML is optional; Apple/Intel/AMD GPU metrics
remain unavailable. Dock reopening on macOS restores the main window. Tray and
completion attention depend on OS desktop support; the embedded chime is
Windows-only, with Unix notification behavior supplied by the platform.

## Updates and data

AX uses its native official installer/updater. Crew verifies its platform package
against SHA256SUMS. Windows retains NSIS updates; macOS opens the downloaded DMG,
Linux opens the Debian package with the desktop installer association. The user
completes installation and restarts Crew. Non-Debian distributions use AppImage.
Missing installer associations report the saved package path.

Gateway databases and configuration remain in Tauri's per-user data directory,
separate from bundles; `AX_HOME`, `AX_CREW_AX`, `AX_CREW_BACKEND` retain their
meaning. Computer Use now delegates to AX's Windows UIA, Linux AT-SPI or macOS
Accessibility adapter, with Unix runtime/TCC prerequisites and Wayland input/
capture limits described in [AX Computer Use](../../ax/docs/computer-use.md).
AX's native macOS confinement remains unavailable and is not relaxed.

## Verification status

Windows frontend, native tests and gateway checks pass locally. Linux x64 has
native gateway/desktop tests, real PTY input/resize/Ctrl+C and telemetry checks,
and a debug Debian bundle launched under Ubuntu/WSL with a virtual X server.
The packaged window and bundled gateway's health were checked in isolated user
data directories. Native Computer Use was also accepted against an isolated
GTK/X11 fixture (real reads, text, controls, input, capture and permission refusal).
This is not a physical Linux desktop acceptance run or a release
build. macOS, Linux arm64, macOS signing/notarization and external SSH remain
unverified here; corresponding native validation is required before distribution.
