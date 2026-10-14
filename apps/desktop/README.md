# AX Crew Desktop

A native desktop control client for [AX](../../ax), built with Tauri 2 and React.

AX Crew brings conversations, tasks, devices, and model settings into one
desktop app. It starts the Crew backend automatically; AX runs the agents and
keeps their credentials, tools, skills, memory, and session history.

- **Interactive questions** — main and side chats show compact floating questions
  above the composer, with numbered choices, an optional text reply and collapse. Pending questions survive reopening;
  answering continues the same task/session, and failures retain drafts.
- **Native desktop** — shared Windows/Linux/macOS desktop code with native
  packaging, system tray and integrated terminal. See
  [platform build requirements and limits](../../docs/platforms.md).
- **Project terminals** — local projects use the selected local shell; SSH
  projects open interactive OpenSSH in the remote project directory, reusing
  saved host/port/key settings and normal SSH authentication/host-key prompts.
  Switching projects selects the matching terminal and retains existing
  connections, with directory-only tab labels and an eight-terminal limit.
  Both local and SSH terminals omit the duplicate location row above the shell
  prompt; hovering a tab shows its full initial path.
  Paired AX devices need an SSH connection for interactive terminals.
- **AX runtime** — use the AX installed on your machine or a workspace build.
- **Computer Use** — the same settings and app permissions route to AX's Windows,
  Linux AT-SPI and macOS Accessibility backends. Unix dependency/TCC requirements
  and Wayland restrictions are explained in [AX Computer Use](../../../ax/docs/computer-use.md).
- **Goal settings** — global/project defaults and an opt-in switch that lets
  ordinary new tasks automatically use AX Goal policies, with configurable
  Command/HTTP/host/MCP acceptance, progress policies and Runtime execution caps.
  Settings read/write AX's existing templates; automatic use defaults off.
  Acceptance, validators, budget and recovery sections start collapsed; clicking
  a heading reveals the form and folding retains its draft.
- **Codex sign-in** — choose browser or device-code login in model settings.
  Device codes are displayed in full with a Copy code button. AX saves the
  credentials; this flow requires the matching AX build with `--method`/`--json`.
- **Local data** — Crew settings and its database live in the app data directory.
- **Completion reminders** — completed/failed work sounds a short chime on
  Windows and requests taskbar/tray attention when Crew is unfocused, minimized
  or hidden. Foreground conversations receive unread result dots without sound;
  opening a result clears only that conversation. System toasts require OS
  notification permission; the chime and unread icons do not.
- **Connected devices** — pair remote AX runtimes or connect the Android client.
- **Session files** — a wider Files panel with saved change review, a lazy
  workspace tree, closable file tabs and Markdown Preview/Source. Local desktop
  browsing includes hidden files; local UTF-8 files up to 256 KiB support Edit,
  Save and Cancel with draft preview and disk-change checks. Drafts survive
  tab/conversation navigation for the current app run. Remote conversations
  show saved diffs only.
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
Application and website permissions use the shared themed settings dropdown,
with standard control dimensions and keyboard navigation.
Remove provider also works for environment credentials through AX's
`auth remove` command, preserving system environment variables. Re-entering
credentials or signing in again re-enables the provider; this requires a
compatible AX build. Distributed collaboration uses a compact console with a shared live overview, collaboration navigation, objective/task/member/feed regions, Host-grouped nodes and filtered execution activity with progressive advanced details.
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

Local AX history opens with its original messages and a working composer. Send
adopts the existing binding and continues that same AX session in its original
workspace, without a separate read-only/continue step. Explicit titles remain;
`ACP session` or empty titles display the first user request, or an untitled
label for conversations without text. Failed sends keep the draft and history.

During active work, Send/Enter forwards guidance to the same task and AX goal
through `_ax/steer`. The single composer action shows Stop while input is empty,
or Send when guidance is entered. This also works in
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

创建协作与添加工作任务采用三步向导，步骤导航和底部操作保持可见，长表单在中间滚动。普通任务 / 目标使用并列选择卡片；成员卡片分开展示 AX 名称、Host、在线状态，选中后在下方展开职责与模型配置。超过四个可选成员时支持按 AX / Host 搜索。工作任务采用独立编号卡片，确认页汇总任务内容、分工、模型、依赖和节点匹配原因。返回上一步保留草稿，深浅主题与窄 / 短窗口共用主题配色和自适应布局。

侧边栏「分布式协作」现在包含协作工作台、节点管理、执行活动三个视图。以已有 Workflow/Task 组织普通任务或 AX Goal，按能力与资源自动分配或手动选择 AX，设置成员工作职责、依赖及实际工作任务，查看整体进度和实时 ACP 消息/工具调用，进入真实 Session 补充要求、回答问题及进行单请求权限审批。支持整个协作或单任务暂停、恢复、取消、重试、重新分配与检查点接管。

节点按 Host → AX Instance 展示，分别显示机器实测 CPU/RAM/GPU/磁盘/网络、跨 Goal 任务预留与执行槽位。展开 AX 可查看项目、能力、当前 Goal/任务/Session，并复用配置组件管理目标 AX 原生设置、个性化、Memory 开关、自定义指令和插件。远程原生管理需要机器明确启用；配置写入必须确认实例/项目影响范围，活动执行期间拒绝写入。Goal 成员/能力策略只影响该 Goal。多选批量能力配置、原生子 Agent 设置与启停提供逐节点差异预览、确认及部分失败结果；共享配置导出不含凭证，一次性连接 worker.json 明确标为私有。

Long Project 默认关闭，仅作为 Goal 内可选区块，支持原生文档导入编辑/导出、模板、归档检索和 Session Rotation；Session 链沿用原 Goal、任务和累计预算。执行活动可按 Goal、AX、Host 和任务状态追溯各代 Execution、Session、错误、恢复事件及产物。工作台仍使用同一个分布式状态源与已有实时轮询/事件 API。见 [控制层与部署说明](../../docs/distributed-collaboration.md)。

Standalone desktop tests and test-runner configuration are local-only and are
not distributed in the source repository.


### 分布式控制台布局

三个入口共用在线 AX、运行任务、异常与待调度概览，以及自动同步状态。异常统计为失败任务与已启用但离线的 AX；未读取到状态时显示读取提示。协作列表提供状态和完成数，目标、任务、成员、最近动态在空状态与已有协作之间保持相同布局。节点折叠行显示执行槽位、关联协作/任务、运行任务的当前活动 Session 数量与能力标签；配置槽位不代表当前可调度容量。执行活动采用紧凑筛选和带计数的二级导航，可清除筛选，保留 Execution → Session、恢复记录和产物下载。深浅主题共用桌面配色变量，窄窗口自动分栏收起。


分布式页面及弹窗的全部下拉选择使用与设置页一致的共享 `Select`：主题色弹层、分组、选中勾选、禁用项和键盘操作统一实现，弹窗内首次 Escape 只关闭下拉。后续页面从 `src/components/ui/select.tsx` 导入即可，组件自动加载样式；旧 `SettingsSelect` 是同一实现的兼容导出。


节点管理的 AX 行提供删除实例及确认弹窗；删除仅撤销 Crew 连接注册，旧 Worker 凭据失效，本机和远程 AX 配置、Memory、Session、工作目录不删除。未完成关联任务、未完成协作手动成员或执行中的原生配置操作会阻止删除，并提示处理方式。已删除实例仍可在执行活动中作为历史筛选，Host/AX 与 Session/产物记录保留；同 Host 的其他 AX 不受影响。


AX 行右侧箭头和实例名称都可展开 / 收起详情，状态同步；离线或禁用实例也能查看已有信息。箭头是可聚焦按钮，支持 Enter / Space，并提供展开状态和详情区域关联。


分布式页面和弹窗中的依赖要求、配置预览、工具详情、恢复历史等折叠入口统一使用共享 `Disclosure`，提供与应用一致的展开图标、hover 和键盘焦点样式；收起仅隐藏内容，保留表单输入。复用入口为 `src/components/ui/disclosure.tsx`，无需另行导入页面样式。


目标功能的系统界面文案随语言切换：中文使用“目标”，英文使用“Goal”，不并列重复显示；设置导航、默认策略、协作类型及相关提示统一处理。协议字段、命令名与用户自行输入的标题不做翻译。

目标执行预算的费用上限按美元输入，输入 / 输出估算单价按“美元 / 百万 Token”输入，最多支持 6 位小数。界面精确转换为原有后台整数计量单位，读取旧配置时金额不变。上限 0 表示不追加限制，单价留空表示未配置、0 表示免费；负数、超精度或超安全整数范围会阻止保存。


Distributed collaboration now creates actual multi-AX work through a three-step
plan form and one atomic Task/Workflow transaction. Native worker model catalogs
feed searchable execution selections; each Attempt freezes its Provider/Model
and duty. Matching previews share scheduler predicates and pending Tasks display
reasons. Member removal fences only its Workflow; new-member work can save in the
same policy transaction. Latest-Session routing and read-only Session history
retain rotation and migration associations. Resource minimums reserve scheduler
capacity; system resource limits are explicitly unsupported. See
[distributed contracts](../../docs/distributed-collaboration.md).


### Collaboration editing

The distributed workspace fills the available width and places actions in their
own views: one Connect AX entry in Nodes, creation in Workspace, refresh by the
tabs. Edit collaboration saves its name, descriptive objective and members in
responsive cards; adding members can optionally include new work. Task details
support renaming, editing input before the first execution and confirmed removal.
Started inputs remain historical; send Session guidance or add replacement work.
Dependency checks protect removal, execution history is retained in Activity, and
failed/stale saves preserve drafts. See [distributed collaboration](../../docs/distributed-collaboration.md)
for persistence, fencing and editing limits.


Distributed lifecycle controls include confirmed removal of empty Hosts and entire
collaborations, including cancelled/empty ones. Removing a collaboration stops its
unfinished task graph atomically while retaining execution history in Activity;
external dependencies block removal. Cancel keeps the collaboration visible.
Administrators can add new work to a cancelled retained collaboration. Task removal
is directly available in task details, with links to dependency blockers. Polling
preserves the selected collaboration and metadata drafts across runtime-only
updates. See [distributed lifecycle contract](../../docs/distributed-collaboration.md).

The collaboration member picker excludes deleted AX instances, including old
membership references and instances removed during editing. Saving clears obsolete
member/model/new-work references; execution history remains separately accessible.
