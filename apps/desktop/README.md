# AX Crew Desktop

A native desktop control client for [AX](../../ax), built with Tauri 2 and React.

AX Crew brings conversations, tasks, devices, and model settings into one
desktop app. It starts the Crew backend automatically; AX runs the agents and
keeps their credentials, tools, skills, memory, and session history.

- **Native desktop** — a Windows app with a system tray and integrated terminal.
- **AX runtime** — use the AX installed on your machine or a workspace build.
- **Local data** — Crew settings and its database live in the app data directory.
- **Connected devices** — pair remote AX runtimes or connect the Android client.
- **Session files** — a wider Files panel with saved change review, a lazy
  workspace tree, closable file tabs and Markdown Preview/Source. Local desktop
  browsing includes hidden files; remote conversations show saved diffs only.
- **System metrics** — Settings → System shows real local Windows CPU, memory,
  system-volume usage and uptime, plus supported NVIDIA GPUs' usage/VRAM,
  refreshing every three seconds. Capacities
  use GiB; unavailable readings stay explicit instead of showing placeholder values.

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
cd ..\ax
cargo build -p cli

cd ..\axcrew
cargo build

cd apps\desktop
npm ci
npm run tauri:dev
```

The last command opens AX Crew and starts Vite and the local Crew backend.
Keep that terminal open while developing. After the first setup, simply run:

```powershell
cd apps\desktop
npm run tauri:dev
```

Rebuild AX or the Crew backend with the commands above after changing their
source. Development prefers installed AX, then falls back to
`ax\target\debug\ax.exe`. To use your workspace AX explicitly, set this before
starting the app:

```powershell
$env:AX_CREW_AX = '..\..\ax\target\debug\ax.exe'
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
cd ..\..
.\scripts\start-workspace.ps1
```

The script starts the release desktop with the workspace release AX and Crew
backend. It restores the shell's previous environment variables after launch.
To check the required binaries without opening the app:

```powershell
.\scripts\start-workspace.ps1 -CheckOnly
```

If a build is missing, follow [Build from source](#build-from-source) below.
By default, closing the window hides it in the tray; choose **Quit** in the system tray menu to
exit fully. In Settings → System, turn off **Hide to the system tray when closing
the window** to make the close button quit AX Crew and stop its local service.
The native preference survives restart. The settings card contains only this
switch; it has no Quit button.

## Installation

Download the Windows x64 installer from [GitHub Releases](https://github.com/Axium-Labs/AXCrew/releases/latest), then
open **AX Crew** from the Start menu. The release package includes the Crew
backend. AX is installed separately: open Settings → 本地 AX → AX 更新 to
install or update it, then restart Crew.

## Development

### Build from source

Build the workspace AX release and the desktop installer:

```powershell
cd ..\ax
cargo build -p cli --release

cd apps\desktop
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

## Usage

The model/effort trigger beside Send opens a compact card with a lightning button,
a central effort/model button, without a reset control. Clicking the central button
opens a separate provider-grouped model menu with selected/hover states and
keyboard navigation; selection or Escape returns to the card. Escape again or
clicking outside closes it. The theme-colored **思考强度 / Reasoning effort** slider supports
click, drag and arrow keys. The 28px white thumb sits over a 24px rounded track,
with the fill ending underneath its center. Dragging has 80ms light damping and
gentle attraction near the model's supported stops, then eases into a step over
200ms on release.
Fast gives the thumb a forward-dash effect with small particles trailing leftward
from behind it on a 0.9-second cycle, confined to the filled portion of the bar. The minimum
has no colored fill peeking around the thumb. Reduced-motion preferences disable
these animations.
The lightning button toggles AX's **Fast**
inference mode. Its title reads “更快 · 用量更多”.
This saves `inference.mode` in the local AX `config.json`, preserving the model,
reasoning effort, and advanced Fast settings. It applies to subsequent local AX
turns; running turns keep their current mode. Paired devices use their own AX
configuration. Use an AX build that supports Fast mode.

The model/effort trigger highlights on hover, keyboard focus, or while open.
Settings → Plugins → Agents manages delegation depth (0 off, 1 direct
children, 2+ nested children) and shared parallelism (1–64), using the
global/project selector. Save applies on the next turn; reset restores global
defaults or project inheritance. Only edited fields are written, preserving
inheritance for other project fields. AX owns validation/persistence through
its settings command. Older AX can read and write global limits, while
project-scoped settings and reset/inheritance require an updated AX. Settings
→ AX has no separate Subagents switch.
In Capabilities → Import from other AI apps, each app starts collapsed. Click
its header to show/hide skills and MCP configurations; collapsing preserves
selections. Rescanning or changing workspace closes all source groups.
Settings success notices clear after four seconds and on section changes.
Remove provider also works for environment credentials through AX's
`auth remove` command, preserving system environment variables. Re-entering
credentials or signing in again re-enables the provider; this requires a
compatible AX build. Distributed cards and empty states have 24px separation.
The popup is 260px wide with a 26px slider. Its central model button is transparent
until hovered, focused from the keyboard or its menu is open; the accent follows
the app theme. The conversation list contains Project and Recent sections, with
remote conversations in Recent and cloud selection available before starting a chat.
The slider uses the selected model catalogue's exact supported effort values;
models without advertised values do not expose invented strength choices.
The native WebView stays at zoom 1; system DPI and responsive layouts handle
monitor/window changes. Side navigation collapses on smaller windows and remains
manually accessible. A turn rail previews and jumps to each request/answer pair.
Terminal tabs use an unnumbered label; drag a tab along the strip to reorder it
without restarting its shell.

Conversation transcripts start with messages without a session-ID metadata line.
The AX Session ID is available in the Details sidebar.
The composer leaves 20px of space below it. Its project/location strip appears
only before the first send in a new chat, hides when work begins and stays hidden
in existing chats. Failed first sends restore it; a new chat shows it again.

The desktop app uses the React frontend in `src/`. Its Windows window uses a custom titlebar without system decorations. Window size and position are persisted, while titlebar decorations always follow `src-tauri/tauri.conf.json`.

The native Android client can control this same backend through an HTTPS reverse
proxy. In Connections → Control this computer, use “显示 Android 连接信息” to reveal the current
loopback upstream and token for 60 seconds. The gateway configuration persists across restarts. See [Android connection instructions](../android/README.md). Device pairing
codes are for AX runtimes, not Android control-client login.

Navigation, the conversation list, main Chat and the right panel have independent persisted visibility. Use the brand collapse button or `Ctrl+B` for navigation, `Ctrl+Shift+B` for the conversation list, and `Esc` to dismiss the active picker or right panel. `Ctrl+K` opens command search; `Alt+C` opens conversations. A single workspace budget reserves a 560px chat target (520px minimum),
automatically collapses navigation then Sessions, and uses a preview drawer when
both panel minima cannot fit. Automatic changes preserve preferences, drafts and
file tabs. Manually expanding a panel with insufficient space opens a drawer.
Drag the chat/preview separator to resize (default 55:45; preview minimum 420px
for Files, 320px for Chat/Details). Arrow keys, Home/End and Enter support keyboard
resizing/reset; double-click restores the default split. Panel layout offers a
sidebar-only view and a return to main chat. Restore default layout resets the
split and visibility without deleting drafts or file tabs. The composer measures
its own width, auto-grows with text, and moves secondary actions to More below
600px while keeping model selection and Send visible.

In Settings → 本地 AX, “AX 更新” checks the latest GitHub Release against the AX
installed on this machine and downloads or updates it on request. Updates go
through AX's own `ax --update` (SHA256-checked, and on Windows the replacement
happens after AX exits) or, when nothing is installed yet, the official install
script; the panel prints whichever ran verbatim. It manages the installed AX
only. Release builds use system AX and never a bundled or workspace AX. Without AX, Settings remains available for installation. Restart Crew after installing or updating AX.

Settings → 插件 lists what AX reports through its ACP catalog
extensions, so the panel and AX can never disagree: installed skills with any
missing required tools (`_ax/skills`), configured MCP servers with description,
enabled flag and declared capabilities (`_ax/mcp`), Mods and Agents. AX's
built-in tools (`_ax/tools`) are not plugins and are not listed there; their
names are offered as toggles when configuring a distributed AX instance's Tool
field. Project skills (`<project root>/.ax/skills`, with legacy `skills` support) and the MCP
config (`<project root>/.ax/mcp.toml`) are resolved from AX's working directory,
so the panel queries the workspace selected in the session view. With no
workspace, the project view asks for a directory instead of querying an unrelated
working directory; the Global configuration selector still allows catalog browsing.
MCP-provided tools are not listed individually — they only exist once a
session connects to a server, so the servers are listed instead.

Settings → Plugins is the sole plugin entry. The page omits the workspace path
and scope explanation, and uses searchable Mod/MCP/Skills/Agents tabs and
scope-aware rows, menus and switches. Plugin names open full details.
Scope and enabled status remain visible in narrow windows; tabs
support arrow keys/Home/End. Search can be cleared, failed catalog reads offer
Retry, and the add dialog asks for the source first (path shown, directory names
pre-fill the name), then the name, and retains
failed drafts. Native pickers and saves prevent duplicate submissions; changing
workspace discards old dialogs and late feedback. Saves invalidate all inherited
catalog views, and success notices expire after four seconds. Imports live
under Settings → Import / Export. Mod loading/execution/management runs in AX,
requiring updated AX and Node.js 20.6+. If the installed AX lacks `_ax/mods`,
the page shows a local AX update hint; see [the desktop guide](../../docs/desktop/README.md)
and [AX Mods](../../../ax/docs/mods.md) for packaging and compatibility limits.
Settings selectors use rounded app-themed menus. Boolean settings and import
selections use right-aligned pill switches with labels and descriptions on the
left; memory deletion has a separate action row with confirmation.
Settings location readouts use rounded directory/file labels showing complete
absolute paths, with Windows verbatim prefixes removed and long paths wrapped.
Native operations keep their
original paths.
Connections is available only through the outer `/connect` page.

The sidebar keeps conversations, schedule, and artifacts at the top, with terminal, connections, and settings at the bottom. Click Terminal or press `Ctrl+Backquote` to toggle the dock. The first opening creates a PowerShell tab in the configured workspace. Use `+` for another tab, the `…` menu to dock at the right or bottom, and the panel edge to resize it. Hiding the dock preserves its live tabs; closing a tab stops that shell. The dock uses a 220 ms size transition and remembers its position and dimensions. Shell sessions themselves are not restored after quitting the desktop app. The interactive terminal requires Tauri and is unavailable in a regular browser preview.

An AX session is one conversation, even when follow-up messages create multiple Crew tasks. Its first task supplies the title and route; sends and cancellation target its latest turn. Drafts stay separate while navigating within the app. Enter sends, Shift+Enter adds a newline, and IME confirmation does not send. Failed sends retain their draft. Unsent text drafts persist locally across reopening; image attachments remain in memory only.

During active work, Send/Enter forwards guidance to the same task and AX goal
through `_ax/steer`; the separate Stop button still cancels. This also works in
side chat and while waiting for tool permission. Guidance does not change the
running model, effort or permissions, survives replay and stays outside folded
work details. AX acknowledgement is required before clearing the draft; an old
remote runtime reports an update requirement instead of pretending acceptance.

Changed-file review compares this turn's start/end contents, including deleted
and newly created files. Saved diffs show old/new line numbers in a wider panel;
File explicitly reads current local text. Missing historical diffs, binary and
deleted files are explained. Adopted local AX sessions can browse their own
workspace. See [chat execution details](../../docs/desktop/README.md).

Local conversations use a local execution environment. Cloud conversations require selecting an online remote project environment; missing or offline environments cannot send. Paired AX validation/history run on that AX host. SSH directories are inspected remotely, while inference and history stay local. Remote images, local file preview, Fast inference and goal loops are currently unavailable. The desktop titlebar checks the authenticated settings endpoint and offers a retry when the local service is unavailable. In development, Tauri prefers system AX, with a workspace AX fallback; Crew uses the freshly built debug backend.

### Model settings

The provider and model list now comes from the active AX binary's `_ax/models`
`catalog` field. Install/build AX and Crew together; an older AX without this
contract shows an update error rather than guessing support. Credentials saved
in AX are shown as saved, not connected. Saving a key performs online discovery;
refresh also updates existing caches. Offline/cache models remain selectable when
list discovery fails, and the original provider error is displayed. Model-list
success does not establish inference entitlement or account balance.

The desktop composer has a joined project/location strip: click the folder to
choose a project, or the local-computer pill to open the work-location menu.
The local option keeps the selected directory. Choosing Cloud reveals a Choose
environment menu for paired AX or SSH projects. Paired AX runs on its host;
SSH runs local AX and local models, using SSH only for remote shell commands. Existing sessions keep their directory, host and model fixed.
Add project opens a named-project dialog with local/remote source selection.

### Workspace recovery

New desktop messages validate the selected directory before submission. If a
persisted project was moved or deleted, the directory picker opens without the
invalid path as its initial directory. Only a confirmed, validated selection is
sent to the gateway; cancelling retains the draft and sends no task. Existing
session workspaces remain fixed. Gateway defaults skip missing directories and
remote-device paths without modifying historical member/session records.

## Installer releases

Settings → System → AX Crew 版本更新 checks the latest official GitHub Release. Updates download the Windows x64 NSIS installer and verify its SHA256SUMS before exiting Crew and opening the install wizard. Finish active tasks before updating. App data and AX credentials stay outside the installation directory.

Build Windows with `npm run tauri:build`. Publish the installer as `AX-Crew-<version>-windows-x64-setup.exe` with `SHA256SUMS` and the signed Android APK under the same version tag. The updater uses this asset naming contract. Windows installers currently have no Authenticode signature.

Android release signing reads AXCREW_ANDROID_KEYSTORE, AXCREW_ANDROID_STORE_PASSWORD, AXCREW_ANDROID_KEY_ALIAS, and AXCREW_ANDROID_KEY_PASSWORD from the build environment. Keep the keystore and passwords backed up outside the repository; future APK updates need the same key.

## 分布式协作

侧边栏「分布式协作」管理 Host、AX Instance、Workflow、Task、Artifact 与 Event。添加实例仅设置连接、逻辑项目与并发等基础信息，不填写 CPU/RAM/GPU、Skill/MCP/Tool 或模型。AX 连接后自动探测并展示 Host 配置、在线状态和任务预留；同 Host 多个实例共享机器容量。连接后的 AX 实例页可配置能力，下载字段合并到本地 worker 配置、安装/启用依赖并重启后由 AX 上报生效。可下载独立 worker 配置、提交带能力/资源/依赖要求的任务、查看错误与检查点、取消/重试和下载产物。新接口与原有会话/设备控制并存。见 [控制层与部署说明](../../docs/distributed-collaboration.md)。

Standalone desktop tests and test-runner configuration are local-only and are
not distributed in the source repository.
