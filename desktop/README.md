# AX Crew Desktop

The desktop app uses Tauri 2 and the React frontend in `src/`. Its Windows window uses a custom titlebar without system decorations. Window size and position are persisted, while titlebar decorations always follow `src-tauri/tauri.conf.json`.

Run `npm ci` and `npm run tauri:dev` from this directory to launch it locally.

The native Android client can control this same backend through an HTTPS reverse
proxy. In Settings → 连接与系统, use “显示 Android 连接信息” to reveal the current
loopback upstream and token for 60 seconds. Both rotate when the desktop backend
restarts. See [Android connection instructions](../android/README.md). Device pairing
codes are for AX runtimes, not Android control-client login.

Navigation, the conversation list, and the right panel have independent persisted visibility. Use the brand collapse button or `Ctrl+B` for navigation, `Ctrl+Shift+B` for the conversation list, and `Esc` to dismiss the active picker or right panel. `Ctrl+K` opens command search; `Alt+C` opens conversations. Narrow windows overlay the right panel without overwriting the other panel preferences.

In Settings → 本地 AX, “AX 更新” checks the latest GitHub Release against the AX
installed on this machine and downloads or updates it on request. Updates go
through AX's own `ax --update` (SHA256-checked, and on Windows the replacement
happens after AX exits) or, when nothing is installed yet, the official install
script; the panel prints whichever ran verbatim. It manages the installed AX
only — the AX this desktop runs is chosen at startup and is reported in “当前运行环境”.

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

The session composer does not expose a member picker. New conversations use an existing local execution environment when available; the backend returns an explicit error if none has been configured. The desktop titlebar checks the authenticated settings endpoint and offers a retry when the local service is unavailable. In development, Tauri uses freshly built `target/debug` AX and Crew binaries before bundled resources.

Verification:

- `npm run build`: TypeScript and production build.
- `npm run test:ui`: component interactions, conversation identity, stream reconciliation, and API failures.
- `npm run test:e2e`: Edge browser checks at 960/1440 CSS pixels and 100%/150% pixel density. Uses isolated API fixtures and does not modify the desktop database.

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
