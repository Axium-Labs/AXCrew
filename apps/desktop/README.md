# AX Crew Desktop

A native desktop control client for [AX](../../ax), built with Tauri 2 and React.

AX Crew brings conversations, tasks, devices, and model settings into one
desktop app. It starts the Crew backend automatically; AX runs the agents and
keeps their credentials, tools, skills, memory, and session history.

- **Native desktop** — a Windows app with a system tray and integrated terminal.
- **AX runtime** — use the AX installed on your machine or a workspace build.
- **Local data** — Crew settings and its database live in the app data directory.
- **Connected devices** — pair remote AX runtimes or connect the Android client.

## Quick Start

### Building and running from this workspace

Requires Rust 1.92+, Node.js with npm, the Tauri 2 Cargo CLI, and the Windows
build tools (MSVC C++ tools, Windows SDK, and WebView2 Runtime).
If `cargo tauri --version` is unavailable, install the CLI once:

```powershell
cargo install tauri-cli --version "^2" --locked
```

Build AX and the Crew backend, then start the desktop app:

```powershell
cd C:\Users\14181\Desktop\axlab\ax
cargo build -p cli

cd C:\Users\14181\Desktop\axlab\ax_crew
cargo build

cd apps\desktop
npm ci
npm run tauri:dev
```

The last command opens AX Crew and starts Vite and the local Crew backend.
Keep that terminal open while developing. After the first setup, simply run:

```powershell
cd C:\Users\14181\Desktop\axlab\ax_crew\apps\desktop
npm run tauri:dev
```

Rebuild AX or the Crew backend with the commands above after changing their
source. Development prefers installed AX, then falls back to
`ax\target\debug\ax.exe`. To use your workspace AX explicitly, set this before
starting the app:

```powershell
$env:AX_CREW_AX = 'C:\Users\14181\Desktop\axlab\ax\target\debug\ax.exe'
npm run tauri:dev
```

Your first session:

1. Open Settings and sign in to a provider or save an API key in model settings.
2. Pick a model and select a workspace directory for your conversation.
3. Start a conversation and send your first message.

`npm run dev` starts only the browser frontend. Use `npm run tauri:dev` for
the desktop app, its backend, and the integrated terminal.

### Running the existing workspace release builds

Quit the existing AX Crew through its system tray, then run:

```powershell
cd C:\Users\14181\Desktop\axlab\ax_crew
.\scripts\start-workspace.ps1
```

The script starts the release desktop with the workspace release AX and Crew
backend. It restores the shell's previous environment variables after launch.
To check the required binaries without opening the app:

```powershell
.\scripts\start-workspace.ps1 -CheckOnly
```

If a build is missing, follow [Build from source](#build-from-source) below.
Closing the window hides it in the tray; choose **Quit AX Crew** to exit fully.

## Installation

Download the Windows x64 installer from [GitHub Releases](https://github.com/Axium-Labs/AXCrew/releases/latest), then
open **AX Crew** from the Start menu. The release package includes the Crew
backend. AX is installed separately: open Settings → 本地 AX → AX 更新 to
install or update it, then restart Crew.

## Development

### Build from source

Build the workspace AX release and the desktop installer:

```powershell
cd C:\Users\14181\Desktop\axlab\ax
cargo build -p cli --release

cd C:\Users\14181\Desktop\axlab\ax_crew\apps\desktop
npm ci
npm run tauri:build
```

`tauri:build` builds the Crew release backend, copies it into the app's
resources, builds the frontend, and produces the Windows NSIS installer.
The desktop executable is at
`src-tauri\target\release\ax-crew-desktop.exe`; the installer is under
`src-tauri\target\release\bundle\nsis\`.
Use `scripts\start-workspace.ps1` from the repository root to run these builds
with workspace AX.

For a portable package with the frontend embedded and the Crew backend included:

```powershell
npm run pack:portable
```

The ZIP is written to `../../dist-pack/`. Build the desktop through the Tauri CLI;
plain `cargo build --release` does not embed the production frontend.


### Verification

- `npm run build`: TypeScript and production build.
- `npm run test:ui`: component interactions, conversation identity, stream reconciliation, and API failures.
- `npm run test:e2e`: Edge browser checks at 960/1440 CSS pixels and 100%/150% pixel density. Uses isolated API fixtures and does not modify the desktop database.

## Usage

The lightning button beside the conversation's reasoning and model pickers
toggles AX's **Fast** inference mode. Its tooltip reads “更快 / 用量更多”.
This saves `inference.mode` in the local AX `config.json`, preserving the model,
reasoning effort, and advanced Fast settings. It applies to subsequent local AX
turns; running turns keep their current mode. Paired devices use their own AX
configuration. Use an AX build that supports Fast mode.

Reasoning and model pickers highlight on hover, keyboard focus, or while open.
Terminal tabs use an unnumbered label; drag a tab along the strip to reorder it
without restarting its shell.

The desktop app uses the React frontend in `src/`. Its Windows window uses a custom titlebar without system decorations. Window size and position are persisted, while titlebar decorations always follow `src-tauri/tauri.conf.json`.

The native Android client can control this same backend through an HTTPS reverse
proxy. In Settings → 连接与系统, use “显示 Android 连接信息” to reveal the current
loopback upstream and token for 60 seconds. The gateway configuration persists across restarts. See [Android connection instructions](../android/README.md). Device pairing
codes are for AX runtimes, not Android control-client login.

Navigation, the conversation list, and the right panel have independent persisted visibility. Use the brand collapse button or `Ctrl+B` for navigation, `Ctrl+Shift+B` for the conversation list, and `Esc` to dismiss the active picker or right panel. `Ctrl+K` opens command search; `Alt+C` opens conversations. Narrow windows overlay the right panel without overwriting the other panel preferences.

In Settings → 本地 AX, “AX 更新” checks the latest GitHub Release against the AX
installed on this machine and downloads or updates it on request. Updates go
through AX's own `ax --update` (SHA256-checked, and on Windows the replacement
happens after AX exits) or, when nothing is installed yet, the official install
script; the panel prints whichever ran verbatim. It manages the installed AX
only. Release builds use system AX and never a bundled or workspace AX. Without AX, Settings remains available for installation. Restart Crew after installing or updating AX.

Settings → AX 能力 lists what AX reports through its read-only ACP catalog
extensions, so the panel and AX can never disagree: installed skills with any
missing required tools (`_ax/skills`), configured MCP servers with description,
enabled flag and declared capabilities (`_ax/mcp`), and AX's built-in tool
catalog (`_ax/tools`). Project skills (`<project root>/skills`) and the MCP
config (`<project root>/.ax/mcp.toml`) are resolved from AX's working directory,
so the panel queries the workspace selected in the session view; with no
workspace it shows the global skills in AX home plus the built-in tools.
MCP-provided tools are not listed among the tools — they only exist once a
session connects to a server, so the servers are listed instead.

The sidebar keeps conversations, schedule, and artifacts at the top, with terminal, phone connection, agent capabilities, and settings at the bottom. Click Terminal or press `Ctrl+Backquote` to toggle the dock. The first opening creates a PowerShell tab in the configured workspace. Use `+` for another tab, the `…` menu to dock at the right or bottom, and the panel edge to resize it. Hiding the dock preserves its live tabs; closing a tab stops that shell. The dock uses a 220 ms size transition and remembers its position and dimensions. Shell sessions themselves are not restored after quitting the desktop app. The interactive terminal requires Tauri and is unavailable in a regular browser preview.

An AX session is one conversation, even when follow-up messages create multiple Crew tasks. Its first task supplies the title and route; sends and cancellation target its latest turn. Drafts stay separate while navigating within the app. Enter sends, Shift+Enter adds a newline, and IME confirmation does not send. Failed sends retain their draft. Closing the app discards unsent drafts.

The session composer does not expose a member picker. New conversations use an existing local execution environment when available; the backend returns an explicit error if none has been configured. The desktop titlebar checks the authenticated settings endpoint and offers a retry when the local service is unavailable. In development, Tauri prefers system AX, with a workspace AX fallback; Crew uses the freshly built debug backend.

### Model settings

The provider and model list now comes from the active AX binary's `_ax/models`
`catalog` field. Install/build AX and Crew together; an older AX without this
contract shows an update error rather than guessing support. Credentials saved
in AX are shown as saved, not connected. Saving a key performs online discovery;
refresh also updates existing caches. Offline/cache models remain selectable when
list discovery fails, and the original provider error is displayed. Model-list
success does not establish inference entitlement or account balance.

### Workspace recovery

New desktop messages validate the selected directory before submission. If a
persisted project was moved or deleted, the directory picker opens without the
invalid path as its initial directory. Only a confirmed, validated selection is
sent to the gateway; cancelling retains the draft and sends no task. Existing
session workspaces remain fixed. Gateway defaults skip missing directories and
remote-device paths without modifying historical member/session records.

## Installer releases

Settings → 连接与系统 → AX Crew 版本更新 checks the latest official GitHub Release. Updates download the Windows x64 NSIS installer and verify its SHA256SUMS before exiting Crew and opening the install wizard. Finish active tasks before updating. App data and AX credentials stay outside the installation directory.

Build Windows with `npm run tauri:build`. Publish the installer as `AX-Crew-<version>-windows-x64-setup.exe` with `SHA256SUMS` and the signed Android APK under the same version tag. The updater uses this asset naming contract. Windows installers currently have no Authenticode signature.

Android release signing reads AXCREW_ANDROID_KEYSTORE, AXCREW_ANDROID_STORE_PASSWORD, AXCREW_ANDROID_KEY_ALIAS, and AXCREW_ANDROID_KEY_PASSWORD from the build environment. Keep the keystore and passwords backed up outside the repository; future APK updates need the same key.
