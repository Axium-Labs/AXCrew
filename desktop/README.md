# AX Crew Desktop

The desktop app uses Tauri 2 and the React frontend in `src/`. Its Windows window uses a custom titlebar without system decorations. Window size and position are persisted, while titlebar decorations always follow `src-tauri/tauri.conf.json`.

Run `npm ci` and `npm run tauri:dev` from this directory to launch it locally.

The native Android client can control this same backend through an HTTPS reverse
proxy. In Settings → 连接与系统, use “显示 Android 连接信息” to reveal the current
loopback upstream and token for 60 seconds. Both rotate when the desktop backend
restarts. See [Android connection instructions](../android/README.md). Device pairing
codes are for AX runtimes, not Android control-client login.

Navigation, the conversation list, and the right panel have independent persisted visibility. Use the brand collapse button or `Ctrl+B` for navigation, `Ctrl+Shift+B` for the conversation list, and `Esc` to dismiss the active picker or right panel. `Ctrl+K` opens command search; `Alt+C` opens conversations. Narrow windows overlay the right panel without overwriting the other panel preferences.

The sidebar keeps conversations, schedule, and artifacts at the top, with terminal, phone connection, agent capabilities, and settings at the bottom. Click Terminal or press `Ctrl+Backquote` to toggle the dock. The first opening creates a PowerShell tab in the configured workspace. Use `+` for another tab, the `…` menu to dock at the right or bottom, and the panel edge to resize it. Hiding the dock preserves its live tabs; closing a tab stops that shell. The dock uses a 220 ms size transition and remembers its position and dimensions. Shell sessions themselves are not restored after quitting the desktop app. The interactive terminal requires Tauri and is unavailable in a regular browser preview.

An AX session is one conversation, even when follow-up messages create multiple Crew tasks. Its first task supplies the title and route; sends and cancellation target its latest turn. Drafts stay separate while navigating within the app. Enter sends, Shift+Enter adds a newline, and IME confirmation does not send. Failed sends retain their draft. Closing the app discards unsent drafts.

The session composer does not expose a member picker. New conversations use an existing local execution environment when available; the backend returns an explicit error if none has been configured. The desktop titlebar checks the authenticated settings endpoint and offers a retry when the local service is unavailable. In development, Tauri uses freshly built `target/debug` AX and Crew binaries before bundled resources.

Verification:

- `npm run build`: TypeScript and production build.
- `npm run test:ui`: component interactions, conversation identity, stream reconciliation, and API failures.
- `npm run test:e2e`: Edge browser checks at 960/1440 CSS pixels and 100%/150% pixel density. Uses isolated API fixtures and does not modify the desktop database.
