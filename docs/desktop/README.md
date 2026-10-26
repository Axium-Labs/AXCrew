# Desktop behavior

Current behavior of the AXCrew desktop client is documented here. Build,
installation and packaging instructions are in
[apps/desktop/README.md](../../apps/desktop/README.md).

## Command search

The titlebar command button and `Ctrl/Cmd+K` open a dedicated command palette.
The search field forms the header; recent conversations, commands, pages, crews,
devices and tasks have separate headings and compact rows with type labels.
Without a query, up to five recent conversations appear first. Searching checks
all conversation titles and the other existing entries, returning up to 35 total
results. Empty groups are omitted. Results use the existing navigation routes;
the palette adds no server API or command execution path.

Only the results scroll vertically; the search bar and keyboard footer stay
visible. Long titles truncate with full-title tooltips, and the panel fits narrow
and short windows using the current display theme. Arrow keys select and reveal
the active result; Enter opens it, except during IME composition. Escape, the Esc
button or clicking outside closes the panel, restoring its previous focus when
that control still exists. Reopening clears the query and selection. The search
input exposes the active option through combobox/listbox accessibility roles.

## Settings pages

The desktop reuses common buttons, inputs, menus, single-selection controls and
dialogs across management, settings, schedule, artifacts and conversation metadata.
Standard dialogs keep their header and close control visible while the body
scrolls. Conversation rename, project assignment and delete confirmation use the
same primitives; delete still requires explicit confirmation. Multi-step
collaboration editors retain their own body/footer layout inside the shared dialog.

Overview groups the existing task, device and approval data into count cards and
focused panels; counts remain unavailable until their data arrives. Management
lists, status labels, filters and empty states share one visual treatment.
Schedule and artifact tables rearrange into compact rows when their available
content width shrinks, keeping their existing actions accessible. Settings aligns
its search and grouped navigation in the sidebar; narrow windows use a horizontal
navigation strip that reveals the selected section. Theme and language settings
continue to apply to all of these surfaces.

Chat shows AX's model connection progress with actual counts, for example
`正在连接模型（1/5）…` and `正在重新连接模型（2/5）…`. Once the model responds,
normal thinking/output replaces that status. A terminal model error shows
`模型连接失败（已尝试 5/5 次）` with expandable error details outside the collapsed
work section. The final status is retained in task output for reopening; desktop
notifications use the same model-specific wording. Counts may end earlier for
authentication, permission, partial-stream errors or the connection budget.
The matching AX runtime supplies these events. Existing task lifecycle states
are preserved for scheduling; the chat presents the model failure explicitly.

Stopping a conversation retains its submitted message, earlier turns and already
received partial output while history reloads, including when AX has not yet
checkpointed the current turn. Cancelled and failed tasks reconcile their live
output with saved history instead of replacing the transcript with an empty
result. The matching AX runtime saves ordinary messages before preparing its
file baseline, so those submissions also survive reopening the session. Partial
output that AX has not checkpointed remains available in the current desktop's
live conversation cache; an application restart can only replay saved output.

With a matching AX runtime, large or slow workspaces cannot indefinitely block
chat while preparing automatic file change previews. AX bounds and cancels the
snapshot worker; the transcript shows when a complete file change preview is
unavailable. Tool execution remains available. See [AX ACP limits](../../../ax/docs/acp-crew.md).

### Personalization and automatic learning

Settings → Personalization (`/settings/personalization`) separates tool-driven
memory writes from **Automatic learning (self-evolution)**. The memory tool
switch controls writing memories; automatic learning has its own global switch
backed by `ax personalize --evolution`. Automatic analysis requires both memory
and automatic learning to be enabled.

Evolution data belongs to a project, rather than an AX-wide skill list. The card
uses the selected project directory, falling back to Crew's default working
directory, and validates that folder on this computer. It displays the actual
local project path and only that project's learning data. If no valid local
project is available, choose a local project folder in the card.

The **Automatic learning** card reads the local AX JSON outputs for
`evolution status`, `evolution skills` and `evolution show`. Pending skills show
their full SKILL.md as plain text and an evidence summary containing evidence
IDs and task summaries. The desktop verifies the text's UTF-8 SHA-256 digest
against the pending review digest. Accept and reject use `evolution review`
with that digest, so a changed proposal must be reviewed again. Learned skills
show their status, use count and
success count, with an archive action. Runtime status starts collapsed and shows
pending analysis items, the last analysis time, consecutive failures and backoff
duration. A dot using the existing unread indicator style marks Personalization
in settings navigation while skills await review.

All calls use the desktop's `ax_tui_command` bridge. Global personalization uses
the local AX home; evolution commands run in the validated local project folder.
This surface supports only the AX runtime on this computer, including when Crew
is connected to a remote server; evolution
data is never written to or sent through the Crew server. If local AX is missing,
cannot run, or predates the evolution commands, the card shows an unavailable
reason instead of an error alert. A matching AX runtime is required to use it.

### Goal policies

Settings → Goal (`/settings/goal`) edits AX's global defaults or the selected
project's Goal template. **Enable Goal** opts ordinary new tasks into this scoped
policy, saved through AX's `enabled` field (default false). Switch edits apply
with Save policy; failed saves retain the draft. Disabling preserves all rules
and explicit Goal commands. Existing Goals, parked answers and resume actions
keep their saved policy. The matching AX build supports automatic Goal admission
in the shared CLI/TUI/ACP prompt path; distributed workers retain controller
policies. It exposes deterministic/model validation, All/Any
conditions, Command/HTTP/registered-host/MCP validators with ID/version/reference,
timeouts and explicit safe replay, cumulative execution caps and conservative
progress thresholds/action. Advanced host input is a JSON object; reserved Goal
context is supplied by Runtime. Save validates configuration without executing it.

The native `ax_goal_settings` bridge calls `ax goal-settings --scope global|project`,
with complete GoalConfig JSON on stdin for writes and `--reset` for reset/inherit.
AX owns persistence (`$AX_HOME/config.json.goal` or `.ax/goal.json`); Crew keeps no
duplicate policy store. Global settings work without a workspace; project writes
validate the selected workspace. Failed reads offer retry; failed writes retain
the draft and show AX's error. The matching AX build is required.

Defaults affect explicitly created Goals and, when enabled, ordinary new tasks.
Already saved Goals keep their own policies. Zero budgets add no cap; round/time
execution remains in Runtime. Token
and cost enforcement require complete measured data; estimates and unavailable
billing never claim precise hard caps. The page distinguishes retained local state,
background execution and Crew-owned Durable Task takeover. It does not enable
automatic resume or expand host permissions. This local AX settings surface does
not change remote-device/Android settings contracts.

Acceptance rules, Custom validators, Execution budget and Progress and recovery
start collapsed. Click their full-width headings (or press Enter/Space) to reveal
fields independently. Collapsing retains edits, and Save includes hidden fields.
The forms use themed inputs and visible textarea borders, with keyboard focus
and one-column fields on narrow windows.

The cost limit is entered in USD, and input/output estimated rates in USD per
million tokens. Decimal amounts support up to six places and convert exactly to
the existing integer micro-USD fields; saved values display in USD without
changing their amount. A zero limit adds no cap. A blank rate is unconfigured,
while a zero rate means free usage. Negative, excessive-precision and unsafe
integer amounts block saving rather than being rounded. AX persistence and the
native bridge protocol retain their existing units and fields.

Connections lives in the outer **Connections** (`/connect`) page, with Control
this computer, Control other devices and SSH tabs, including phone authorization,
paired AX devices and persisted OpenSSH hosts. Settings has no duplicate
Connections page; old `/settings/connections` links redirect to `/connect`.
**System** (`/settings/system`) contains service status, local system metrics,
desktop behaviour and Crew updates.
Model settings group account sign-in, API-key and environment providers.
WorkBuddy China and International are separate accounts. Account sign-in shows
a URL to click or copy; closing the dialog cancels waiting. AX stores the
credentials and refreshes models after authorization.

Codex account sign-in first offers **Browser login** and **Device-code login**.
Both choices have equal width and the same neutral styling; neither is presented
as the default or primary action. Narrow dialogs stack the two equal choices.
Browser mode opens the displayed authorization URL on an explicit click and AX
receives a PKCE-protected local callback. Device mode displays the full one-time
code in a separate selectable block, with a Copy code button and 15-minute
expiry instructions. A retry returns to the method picker. WorkBuddy retains
its browser flow and regional account separation.

The native `ax_begin_login` command accepts `method: browser | device` for Codex
and starts AX with `auth login openai-codex --method <method> --json`. Progress
uses the AX-owned stderr JSON protocol (`type`, `message`, `url`, `code`), then
the existing `ax-login` event. Codes have no assumed length or format; legacy
human-readable prompts are recognized by their instruction context. Prompt
output is drained before the completion event, and the frontend buffers events
arriving before the login ID. URL opening retains its HTTPS host allowlist.
This requires an AX build supporting `--method` and `--json`; update both AX
and AXCrew together when installing this change. No REST/Android contract changes.

### Computer Use and browser settings

Settings → Computer Use (`/settings/desktop`) contains two shared pill switches
and a Limits card with full-width numeric fields, following the existing dark
and light theme. The local `ax_computer_use` command calls `ax computer-use` to
read/write AX's global configuration, without a selected workspace or service
request. It does not retain a separate Crew setting or display simulated success.
The bridge and local chat runtime share Crew's existing `AX_HOME`: an explicit
environment override, otherwise the user's `~/.ax` directory.

Computer Use and screenshots default on; explicit saved disable settings are
preserved by AX, including when upgrading. Missing settings use AX's defaults;
node/image defaults are 1200/1280. AX returns supported status and built-in limits (1–10000 nodes,
320–4096 image pixels on the longest edge). Switch changes save immediately;
integer edits save on blur or Enter. Controls lock during writes; failures retain
confirmed values, failed reads offer retry, and invalid numbers remain editable.
Native Windows is currently supported; unavailable environments cannot enable it.
Enabling applies when AX builds the next turn registry. Disabling also rejects
subsequent helper calls from a registry that previously had access. AX enforces
limits, approvals, bounded privacy scans and actual window/control operations.
See AX's `docs/computer-use.md` for the runtime contract and renderer limitations.

Computer Use also includes Application access; Browser settings includes a real
Browser Use switch and Website access. The shared HostPermissionsPanel calls
`ax_host_permissions`, which invokes AX's early `host-permissions` CLI with Crew's
same global AX home. No workspace/gateway/model is required. Rules can be added,
changed to ask/always allow/deny, or removed. Removing returns access to ask.
Application paths and website origins wrap within the available width; controls
lock during writes, failed writes retain confirmed values, and failed reads offer retry.
Application and website rule selectors, including new-rule selectors, use the
same themed `SettingsSelect` as model and execution settings. Inputs and action
buttons share the standard control height, radius and keyboard focus treatment.

The Browser page's Page Interactions tiles and simulated navigation controls have
been removed. Its options explain AX's owned Playwright sessions. Actual browser
operations come from AX's tool runtime, not simulated local notices. It needs Node,
Playwright and a supported browser installed by the user; no personal browser
profile is shared. The current driver blocks cross-origin resources, redirect hops,
WebSockets, popups, uploads and downloads, so some websites cannot work fully.

Application/site access and file/terminal sandbox mode are independent.
Allowed Computer Use apps cover ordinary actions; explicit task approval rules
and capability denials still apply. Browser action approval remains separate. ACP access prompts offer once, this session, always and deny through
the existing dynamic permission dialog. Generic action approval does not grant a
new app/site. Desktop control delegates to AX's Windows UIA, Linux AT-SPI or
macOS Accessibility backend; Unix requires driver dependencies, macOS requires
OS privacy permissions, and Wayland restricts raw input/capture. See
[AX Computer Use](../../../ax/docs/computer-use.md). Native Windows/macOS
OS workspace isolation is not implemented and explicit confined modes still fail
closed. See [AX host access](../../../ax/docs/host-permissions.md).

### Local system metrics

The desktop System page refreshes local CPU usage, physical memory usage, the
Windows system volume's used/total capacity, and system uptime every three
seconds while the card is mounted. CPU is measured from the change in Windows
idle/kernel/user counters, with a 250 ms initial sample on the blocking pool;
an inactive interval longer than ten seconds starts a fresh sample. A real zero
is displayed as `0%`; positive readings below 0.1% show `<0.1%` instead of
rounding down to zero. Other percentages retain up to one decimal place.

Memory and disk capacities use binary **GiB** (`_mb` command fields contain
whole MiB). The disk label includes the actual Windows volume drive letter,
derived from the Windows directory instead of hardcoding C:. Its capacity is
the space available to the current user, including any disk quota, and is not
a sum of all disks. System uptime uses the Windows uptime counter, rendered in
the selected language. Loading, unavailable readings, and command failures are
distinct; failures offer retry and suppress stale readings. Missing/failed
readings are `null`, never fallback capacities or fictitious zero usage.

`get_system_info` is a local Tauri command; the browser preview does not poll
it. Windows uses native CPU, memory, disk and uptime collectors; Linux/macOS use
sysinfo and show the filesystem containing HOME instead of a Windows volume.
GPU collection
uses the installed NVIDIA NVML driver through `nvml-wrapper`, loaded lazily
and reused. Each supported NVIDIA GPU has its own name, usage and used/total
dedicated VRAM row in GiB; driver/permission/unsupported-field failures remain
unavailable. Intel/AMD GPU telemetry is not yet collected; no GPU reading does
not imply that the host has no GPU. The `gpus` array contains these per-device
nullable fields; legacy `gpu_count` / `gpu_memory_mb` cover NVML devices only.
On hosts with more than 64 logical processors, `GetSystemTimes` is limited to the calling
thread's primary processor group.

### Window closing and quitting

System settings has one **Desktop behavior** card. **Hide to the system tray when
closing the window** is enabled by default, preserving background service
operation from earlier releases. When enabled, closing the main window hides it
while the service and tasks keep running; the tray's Show action restores and
unminimizes it. When disabled, closing the main window quits AX Crew and shuts
down the local service. This card contains only the close-behavior switch. The
tray's Quit action always shuts down and exits, regardless of the switch. Other
windows are not subject to the main-window close preference.

The native shell loads `desktop-settings.json` in its app data directory before
the UI opens. `get_minimize_on_close` returns the actual native state;
`set_minimize_on_close {enabled}` atomically persists it and returns the saved
boolean. Opening Settings does not write or reset this preference. UI state
changes only after a successful save; read/save errors stay visible and
read errors can be retried. An old localStorage-only preference is no longer
used, since it never changed the previous native close behavior. The browser
preview disables these desktop controls. Failed runtime shutdown does not mark
the application as already quitting.

## Chat execution view

### Completion reminders and unread results

The desktop listens globally for live `task.completed` and `task.failed` events,
including when another page or conversation is open. Its default completion
policy follows Codex's unfocused mode: switching to another application,
minimizing Crew or hiding it to the tray triggers a short Windows chime and a
system toast. Windows taskbar attention flashes without taking focus; the
taskbar overlay and tray icon retain a small iris dot while unread results exist.
The chime is embedded in the desktop executable and uses asynchronous native
playback, so it does not depend on WebView autoplay. OS notification permission
affects toasts only. Non-Windows shells use the native badge-count API; the
embedded chime and taskbar overlay are Windows-specific.

While Crew is focused, another conversation's completion only adds unread dots
to Recent, its project row and the Sessions navigation. The currently visible
conversation stays quiet and is considered read. Hidden main/side chats are not
acknowledged; the side-chat tab also shows unread results. Returning to the app
clears results only for the conversation actually being viewed, retaining other
unread dots and icon badges. Opening a result or deleting its conversation clears
its dot. Failure results follow the same policy; cancellation is not a completion
reminder. Notifications use the conversation title rather than final-answer text.

`store/attention.ts` persists unread turn IDs/conversation identities and bounded
event deduplication in localStorage. Focus and visible chat registrations are
transient. Follow-up task IDs belong to the same device/AX-session identity, so
unread state is shared by Recent and project rows and clears across all turns
when read. Restart restores badges without replaying sounds or marking historical
completed tasks unread. This is a live desktop reminder, not background push when
the app is fully quit; events missed while disconnected are not replayed.

`lib/completionNotifications.ts` owns focus subscriptions, toast permission and
serialized native badge updates; `src-tauri/src/completion_attention.rs` owns
the native `completion_attention {unreadCount, alert}` command. The existing
REST/WebSocket contracts and AX runtime are unchanged.

### Questions during ordinary chat

Main chat and side chat show a compact floating question panel above the composer
when AX calls `request_user_input`. It shares the composer’s left/right edges and width, with an 8 px gap and
a 300 px height cap, and overlays the transcript without expanding its layout. Numbered option rows
show labels, with descriptions on hover; an optional single-line text entry
submits custom answers. The close control collapses the panel to a reopen chip
without answering or discarding its draft. Clicking an option or submitting free text continues the
same Crew task and AX session. Ordinary composer text can also answer the parked
question; option IDs, labels and 1-based numbers select an offered option.
Questions work independently of the automatic Goal switch and permission dialogs.

While AX finishes parking, the choices remain disabled. A parked task uses the
existing `waiting_user` status, releases its execution slot and is not marked
completed or announced as a completion. Saved task state restores the current
question after reopening the conversation or restarting Crew. Custom answer drafts
use the existing per-conversation local draft store, keyed by task/question, so
navigation and failed submissions retain them without mixing main/side chats.
Answered tool receipts show the question and human-readable choice in history.

`POST /api/sessions/{task_id}/answer` submits the question identity and one option
or text answer. A transactional status/identity check rejects duplicate, stale,
empty and invalid submissions. The existing `/message` route answers a parked
question without creating a follow-up task; attachments/context are rejected for
this answer path and retained by the composer. Gateway forwards structured
`_meta.axGoal` Answer metadata with AX's saved goal/question identities through
local, SSH and paired-device transports. AX must support these structured answers;
its shared prompt path preserves the supplied identity rather than reinterpreting
answer text against a different question. Question/task state is separate from
permissions and never authorizes a tool.

### Conversation history and execution

Opening a local AX conversation shows its original transcript and composer
together. The first Send records its Crew binding through `/api/sessions/attach`
and sends `/api/sessions/{task_id}/message`, resuming the original AX session and
workspace. There is no separate read-only or continue button. Existing adoption
is reused; failed sends retain drafts and attachments. The local replay is kept
visible as the view switches to the continued turn. Searching the list does not
unload the selected conversation.

Local indexes preserve explicit titles. Empty titles and `ACP session` use the
first user message with whitespace collapsed (up to 80 characters); empty
conversations show an untitled label. This changes the view, leaving AX's index
and transcript intact. Already adopted placeholder titles also use this local
index in the desktop. User-renamed titles keep priority.

The chat area groups work by user turn. Progress prose, guidance and tool calls
keep their received order during work and after Stop. Only adjacent calls share
one collapsed tool group; intervening progress remains visible between groups.
Thought chunks have their own closed-by-default disclosure and are never promoted
to an answer. Answered-question receipts appear alongside their question call.
The outer work section stays open by default, including after completion or
cancellation; the user can fold it manually without losing individual tool state.
A current Crew task only promotes its last assistant message to a final answer
when its status is completed, not cancelled, failed or waiting for user input.
Standalone AX histories without Crew task status retain the legacy last-assistant
fallback. Late replayed child calls do not remove a completed answer.

Saved checkpoints and live chunks reconcile by message/call identity or compatible
prose prefixes, not by the ordinal count of thought/assistant rows. Stream-only
rows are placed relative to shared rows, and received stream order resolves replay
ordering differences. This prevents a thought omitted from a checkpoint from
appearing at the end, or a missing progress message from overwriting another.
On cancellation/failure, unfinished tool rows display Stopped and stop their timer;
completed/failed results retain their actual state. This presentation does not
fabricate a command exit code or change the stored tool result.

The main and side-chat composers can send during active work. Send (or Enter)
adds guidance to the same task and AX goal without interrupting streaming or
restarting tools. The composer has one action button: during execution or a question wait, empty
input shows Stop; adding guidance/answer text or attachments switches it to Send.
Stop and Send are never displayed together in either main or side chat. Guidance keeps its chronological position inside work details and survives
history replay with a stable message ID. The
Gateway forwards `_ax/steer` over the existing local/SSH/device connection and
returns the current task only after AX acknowledges acceptance. Waiting for
permission does not block guidance or implicitly approve a tool. Active model,
effort and permission selections apply to future turns; guidance leaves the
running turn's settings in place. Older remote AX runtimes may reject the new
extension; failed sends retain the draft and report that AX needs updating.

Each tool call is a compact muted single line. Operation labels and tool headers
follow the interface language; command text, paths, queries and real output are
preserved. Web rows show the page count and host instead of a long encoded URL.
Start, success and failure of the same call ID update in place. Clicking a row reveals the real tool type, the
operation and the compressed result; the raw output needs another expand and
long output scrolls inside the card. Errors never become successes. Durations
over one minute are shown in minutes, over one hour in hours. Each finished
turn shows a modified-files card; ACP `turn_changes` takes precedence over
accumulated patch stats and the card is kept in history replay.

AX compares workspace contents before/after this run, excluding untouched
pre-existing user edits and including creation, deletion and ordinary non-Git
files. An empty authoritative snapshot clears earlier incremental changes.
Click a file or View changes to open the Files panel's **Review** tab. The Files
panel shares a resizable split with the main chat, defaulting to 45% of the
space remaining after navigation and Sessions. The preview is at least 420px
when docked (Chat/Details at least 320px), up to 980px; chat retains at least
520px. When both minima cannot fit, the preview becomes a drawer at up to 94%
of the workspace width. Panel layout also offers a sidebar-only view and a
return to main chat without changing file tabs.
Review lists files changed in the selected conversation turn with line totals.
Opening Files directly shows the latest turn, including adopted local AX chats.
Saved unified diffs survive reopening with old/new line numbers and +/- signs.
Selecting a different changed file returns to Diff. Deleted files, binary changes
and old records without a diff display explicit explanations. **Current file**
reads live local UTF-8 text (up to 256 KiB); it never substitutes current text for
a missing historical diff.

The **+ → Open file** menu, folder button or **All files** switch opens the
workspace explorer. Directories expand in place and load lazily, retaining the
tree beside the reader. Directory listings include hidden and ignored entries
without a 500-entry truncation; symlinks are skipped. Filter applies to paths in
loaded directories; collapsed directories remain navigable and it is not a
recursive full-project search. Files open in individually closable tabs; repeated
opens select the existing tab. Tabs remain open when switching to Chat/Details
or collapsing the side panel, and reset when changing conversations/workspaces.
The file tree can be hidden for more reading space. Markdown (`.md`, `.markdown`,
`.mdown`, case-insensitive) opens in rendered Preview with a Source switch; other
UTF-8 text opens as source, including empty files. Refresh reloads directory
listings and current text. Path copying and file references remain available.
**Edit** opens a source textarea for a successfully loaded local file. **Save**
or Ctrl/Cmd+S in the editor writes the file; **Cancel** discards the draft and
reloads disk content. Markdown Preview renders the draft without saving it.
Drafts retain the originally read text and survive refresh, tab closure, panel
closure and conversation navigation for the current app run; they are not
persisted across app exit. Editing locks while a save is in progress, and failures
keep the draft visible. The native write command supports existing UTF-8 files
up to 256 KiB, validates canonical workspace containment and compares disk
bytes with the original read before replacing the file through a staged sibling.
Deleted/unreadable files, oversized content and detected external edits fail
without overwriting disk content. On a conflict, copy the draft before Cancel
and reload, then apply it to the current text. This is an optimistic check;
external programs are not locked across the final check and replacement.
Homogeneous CRLF files keep their line endings on save. Successful writes update
the current-file cache and explorer sizes; saved historical diffs remain unchanged.
Arrow keys/Home/End navigate document tabs; Ctrl/Cmd+P within the file panel opens
the workspace tree. At very narrow widths the tree overlays the reader and
automatically hides after opening a file.

Local file browsing requires the desktop app and works without a Crew member.
Remote/SSH conversations can review saved diffs but cannot read remote paths
through this computer's filesystem. Absolute tool paths can be previewed only
when canonically inside the workspace. Editing uses the same local-only boundary
and does not initialize Git repositories or revert historical changes.

The composer auto-grows with the text and panel width, then scrolls once it
reaches its cap. Enter sends, Shift+Enter adds a newline and IME confirmation
does not send. Failed sends retain their draft. Unsent text is stored locally per
conversation; new/existing chat navigation, late session binding and reopening
the app retain it. Branch drafts have separate keys during navigation, while their
branch context is kept only in memory. Image attachments remain
in memory and are not restored after closing the app. User messages can be copied. Each completed turn has one answer
toolbar below the answer and file changes; intermediate narration, thinking and
tools have no copy/branch toolbar. The answer's branch button opens an independent session from the text before it, inheriting
the working directory and execution environment without copying tool state or
changing the original session. Returning from a branch reloads the original tool
records by call ID; history reconciliation preserves the fuller saved/raw result.

The new-session page is deliberately clean: no welcome heading or suggestion
chips. The composer keeps 20px of space below it inside the chat panel. An inset
workspace strip joins its top edge only before the first send of a new chat.
It hides while sending and remains hidden in running, completed or reopened
conversations. Failed first sends restore the strip and retain the draft;
starting another new chat shows it again. The
compact controls are 28px high with 13px regular text and 16px icons; subdued
text keeps the strip secondary to the input. Project, This computer and Cloud
controls share a transparent default background, with subtle hover/menu feedback.
The transparent folder button shows the current project directory (click to pick
another directory), and its rounded "此计算机 / This computer" button opens
an upward work-location menu with a check on the local option. Choosing the
local option preserves the selected project directory. Choosing Cloud reveals
Choose environment; only online paired AX/SSH environments can send. The model
picker uses the paired host catalog for AX devices, and local AX models for SSH.
New sessions stay bound to the selected model.
Existing sessions keep their directory, device and model fixed.
One subdued model/effort trigger beside Send opens a compact card: Fast at the
left and the current effort above the model name in a central button. There is no
reset-effort button.
The card is 260px wide with a 24px rounded track and a 28px thumb, following the app theme accent.
The central model button has a transparent idle background, highlighting only
on hover, keyboard focus or while its model menu is open. Opening the card focuses
the card itself, avoiding a permanent focus highlight on Fast.
Clicking the central button opens a separate provider-grouped model menu with a selected
row, hover/focus feedback and arrow-key navigation. Choosing a model or pressing
Escape returns to the card; Escape again or clicking outside closes the card.
A theme-accent stepped **思考强度 / Reasoning effort** slider supports click, drag and
arrow keys without repeating all strength labels below it. The thumb and fill glide
between steps. Dragging uses an 80ms damped response and smoothly attracts toward
nearby catalogue stops without preventing movement between them; release eases
into the nearest supported step over 200ms, including releases outside the track. The fill
ends beneath the thumb center, sharing its motion, and a separate clipped rounded
track keeps both ends round. At minimum the thumb completely covers the fill;
keyboard focus outlines the
track without a colored halo around the thumb. Fast gives the thumb a forward-dash
effect: small particles originate beneath it and accelerate leftward as a fading
wake on a 0.9-second cycle, clipped to the filled part of the track. The unfilled side keeps only static
step marks. Reduced-motion preferences disable particles
and sliding transitions.
Steps come only from that model's AX catalogue
`reasoning_efforts`, preserving provider wire values and the catalogue default.
A stale selection falls back to the selected model's configured/catalogue default
or its first supported value. Missing/empty capabilities disable effort selection
and omit the request parameter. The Tauri bridge retains these fields. New turns
and follow-ups both forward `reasoning_effort`; changing it does not affect running
work. Paired AX uses its own catalogue; SSH uses local AX. Transcript content starts
with messages, without an AX Session ID or duplicate local-session metadata line;
the AX Session ID remains available in the Details sidebar. The permission button
turns orange when YOLO mode is selected.

The left edge of the transcript has a quiet turn rail. Hover or keyboard focus
previews the user request and latest answer text; clicking a mark scrolls to that
turn. It is built from conversation history and does not create tasks or branches.

Native minimum window size is 640×480 logical pixels. WebView zoom stays at 1;
monitor DPI is handled by the system. Window width does not enlarge fonts.
A single layout manager measures the actual outer workspace and any right-docked
terminal. It budgets a 560px chat target (520px minimum), collapses main navigation
first, then Sessions, then switches the preview to a drawer. On exceptionally
small effective viewports, the navigation rail also disappears and can be opened
from the title bar. If the entire viewport is smaller than 520px, chat uses the
available width and the composer adapts to it instead of overflowing.

Automatic collapse never writes user preferences. Navigation, Sessions, main
Chat visibility and right-panel visibility have independent state. Sessions and
navigation can be opened as drawers when there is insufficient docking space;
Escape or the backdrop dismisses them. Preview tabs and drafts stay mounted when
hidden. Expanding a viewport restores preferred panels with a 24px restoration
margin to avoid oscillating around a threshold. The preview split ratio persists
in the existing session-layout store, separately from visibility.

Drag the separator between chat and preview to resize within both panel minima.
Arrow keys adjust by 20px; Home/End move to the preview limits; Enter or double-click
restores the default 55:45 chat/preview split. Restore default layout in the chat
or panel menu restores navigation, Sessions and Chat, closes the right panel and
resets the ratio, retaining drafts and file tabs. Composer secondary actions move
into More composer actions below 600px of actual form width; model selection and
Send stay visible. The shared auto-grow hook still resizes textarea height after
text or container-width changes. Popovers remain constrained to the viewport;
Settings reflows below 650px.

The input area shows the number of successfully modified files and inserted /
deleted lines for the current turn, updated live while work is in progress;
clicking the summary opens the diff in the right panel. After a turn, the
authoritative change snapshot replaces the incremental stats.

## Conversations

The conversation list has Project and Recent sections; the separate Remote
projects section is removed. Remote conversations remain in Recent, and new
remote work can still be started through the composer Cloud environment picker.

Right-click a conversation to rename, mark, group under a project or delete it
from the list. Labels and groupings are saved on this desktop; moving a
conversation does not change its execution directory. Deleted entries can be
restored from "Show deleted"; AX history is preserved. Language switching
translates interface controls while leaving user text, generated answers and
package descriptions unchanged. Speech credentials have independent reveal
buttons.

The language and theme pickers in Settings → Display use the app's shared
dropdown menu. Model/provider, backup and capability-scope pickers use a shared
rounded Radix Select with app-themed menus. Settings boolean controls and import
selections use pill switches: titles and descriptions on the left, controls on the
right, with separators between rows. Enabled switches use the theme accent with
a white thumb; disabled controls and keyboard focus remain visible. Memory
deletion is a separate action row and keeps its confirmation dialog.

After a task stops, the chat keeps the tool calls and output it already
received; refreshing history merges and deduplicates by call ID. Long-running
sub-session tool records come from updated AX history replay and remain
available after a Crew restart.

## Imports

Settings → Import / Export automatically scans the user directory and current project
for Codex, Cursor, Claude Code, Windsurf and shared `.agents/skills`
configurations, and imports a skill package or a whole MCP configuration into
the current project or global AX; a manual path can be picked instead.
Scanning only reads configuration; imports are shown per item, name conflicts
are left for AX to reject, and failed items are kept for retry.
Plugins, Import / Export and Local AX validate the selected directory before
using it. A removed or inaccessible persisted directory displays its path and
an explicit **Choose workspace** action; cancelling preserves the selection.
Crew never silently substitutes another project. User-level import discovery
continues without a valid project; project scanning and import/export actions
resume after the user chooses an existing directory. The native scanner also
skips invalid optional project paths without blocking user-level discovery.
Each source app starts collapsed, showing its name and available-item count.
Click its header (or use Enter/Space) to expand or collapse its Skill/MCP list;
apps expand independently and selected items remain selected while collapsed.
Rescanning or switching workspace resets expansion; closed lists do not render
all item rows, keeping large skill collections compact.

Settings success notices disappear after four seconds or when changing the
settings section. Results from an earlier section cannot appear on the newly
opened section; failed AX operations remain visible as errors.
Remove provider works for both AX-owned and environment credentials via
`ax auth remove <id>`. AX records a provider opt-out so an environment-backed
provider does not reappear after restart; system environment variables are
preserved. Saving a new API key or logging in again re-enables it. Older AX
binaries without this command report an update requirement instead of false
success. Removed providers are also omitted from Crew's current-model selection.

Settings → Import / Export imports local Skill directories and MCP TOML or
JSON through the installed AX's `skill import` / `mcp import` commands,
choosing project or global scope. An updated AX executable is required for
these commands.

## Subagent workspace

The session transcript shows a compact card for each delegated AX execution.
Clicking a card opens the right-side **子代理 / Agents** tab and selects that
child. The tab also provides a list of children, status counts, nested delegation
links, expandable task instructions, streamed output, tool inputs/results and a
final result or error. These are the child's public messages and tool activity;
child reasoning is excluded. Ordinary delegation and queue children use the same
view. Parent narration and final answers remain in the main transcript.

The selected child stays selected while updates arrive. The panel follows new
output while scrolled to the bottom and preserves the user's position when reading
earlier work. It reuses the existing resizable 420px-minimum side panel, drawer
and keyboard behavior. Files, Preview and Chat retain their own panel state.
Side Chat keeps its own child selection and detail view, with a Back to side chat
action, so inspecting a side-chat child cannot select an unrelated main-session
agent. Child work views offer copying and saved diff inspection; they do not
apply the parent's branch or workspace-file actions to an isolated child store.

AX supplies additive `sessionUpdate: "subagent"` envelopes. Crew forwards them as
`subagent.update`; session history restores the same envelopes through the bound
parent session. Terminal states do not revert to running when older live chunks
are reconciled with history. An unfinished child of a cancelled parent is shown
as stopped; if the parent otherwise ends without a child receipt, it is shown as
interrupted. Missing work records are identified in the detail view. This feature
requires the updated AX runtime; older binaries and historical sessions may not
provide child activity. The panel does not control child execution separately.
The Android client accepts these additive events without refreshing task lists
for each child output chunk; the agent detail workspace is desktop-only.

## Subagents

Settings → Plugins → Agents contains **Subagent delegation** with maximum
recursion depth and parallelism. Depth 0 disables delegation, 1 permits direct
children, and greater non-negative integers permit nested delegation. The main
model decides when to delegate across research, writing, analysis and coding;
simple tasks can complete directly. Changing limits does not launch children.
Parallelism accepts 1–64 (default 8); depth defaults to 1. All levels share the
limit, including waiting ancestors; exhausted nested admission fails rather than
deadlocking. Ordinary subagents and queue children share these limits and inherit
the current task's permission ceilings; depth 0 disables both local paths in an AX
build with unified delegation. Named-Agent switches independently control preset
roles. The page explains that the model can also assign temporary subtasks without
adding a preset role; no separate automatic-delegation switch is needed.

The existing Global configuration / Current project selector controls these
settings too. Crew reads/saves through the installed AX's `settings --scope`
command, using AX_HOME and the chosen workspace. Both scopes explicitly pass
`--scope`; the current AX scoped-settings/reset interface is required. There
is no legacy global-settings fallback or help-output capability probe. Save
applies on the next turn and leaves running children alone.
Opening the page never writes settings. Saving writes only edited fields, so changing project depth
does not freeze inherited global parallelism. Invalid values cannot be saved; failed saves retain drafts and
show the AX error.
Directory validation runs before executing AX, so an
unavailable project reports a directory-selection instruction rather than a
process-launch failure or generic restart advice. Failed reads offer retry.
Settings → AX retains no separate Subagents switch.

## Scoped AX plugins

Settings → Plugins opens `/settings/capabilities`; there is no separate Plugins
entry in the main sidebar. The plugin page does not display the workspace path
or explanatory scope text; the scope selector still controls where changes apply.
Across settings, workspace directories, AX executable locations, discovered import
sources and plugin detail sources use rounded icon labels with complete absolute
paths, without Windows' `\\?\` prefix (including UNC paths). Long paths wrap within
the available width instead of being abbreviated or truncated. This formatting only affects display; native calls retain
the original paths. The backup workspace card keeps its directory-selection button.
The page switches between **Global configuration** and **Current project
configuration**, with searchable Mod / MCP / Skills / Agents
tabs and counts. Skills/Mods/Agents use icon rows with descriptions, scope and
switches; MCP uses a rounded grouped list with configuration menus and switches.
Lists adapt to the available panel width, retaining scope and enabled status in
narrow windows and wrapping long names. Click a name to read the complete
description and source. Tabs support
arrow keys/Home/End with a linked tab panel. Search includes a clear action;
empty categories offer category-specific source guidance. Loading counts
display a dash until data arrives;
catalog failures offer Retry rather than claiming no plugins are installed.

The add dialog has two visible steps and states the target scope: (1) pick the
source — a Skill/Mod directory or an MCP/Agent TOML file, starting in the
workspace — and see its full path with a Change action; (2) confirm the name.
Directory sources pre-fill the name from the folder unless the user typed one;
TOML sources leave the name to the user, since a file can define several
entries. The add button stays disabled until both are set. Opening
the native picker locks duplicate submissions and Cancel; cancelling the picker keeps the draft,
and failures preserve the draft for retry. Changing workspace or scope clears
dialogs/search/feedback, and late picker or mutation results cannot update the
new view. Scope changes are disabled during writes. Successful mutations
invalidate all global/project catalog caches so inherited views refresh too.
Save notices disappear after four seconds or when switching category. With no
workspace the project catalog is not queried; choose a directory to manage
plugins, or select Global configuration to browse the global catalog.

AX built-in tools are not plugins and are not shown on this page; tool-catalog
read failures are not surfaced there either. When configuring a distributed AX
instance, the Tool field offers this machine's AX built-in tool names as toggle
buttons (the target machine's AX remains authoritative).
Executable capabilities have add, details, enable, disable and remove actions. Project
views include inherited globals; disabling or removing one there creates a
project mask and leaves global configuration intact. Crew delegates all scope
resolution and mutations to AX's shared registry via ACP/CLI; this requires an
AX binary with `_ax/scopedCapabilities` support. Project capability files live
under `<project>/.ax`, and named Agent instructions load only when delegated
to.

Mods are executed by AX's actual session runtime, with hooks, commands, custom
tools, ephemeral session state and persistent per-Mod stores. Crew sends `_ax/mods`
catalog requests and delegates management to AX. Add a directory containing
`mod.json` and a JavaScript entry. Updated AX and Node.js 20.6+ are required;
the desktop uses the installed AX executable. If that executable returns
`-32601` for `_ax/mods`, Crew explains that the local AX needs updating while
continuing to show the other catalogs. Updating Crew alone does not add Mod
support to an older AX executable.
AX rejects Node Mods when workspace sandboxing is active or a local runtime is
executing through SSH. DSH's full UI/managed-tier API is not implemented. See
[AX Mod package and API guide](../../../ax/docs/mods.md) for supported events,
options, `/mod:<command>`, lifecycle and compatibility limitations.

Side chat includes the main composer's add-context menu, image attachment/paste/
drop previews, native workspace file references, permission menu, model/effort
popover, Fast mode, voice input, stop and send. Local creation sends its selected
provider/model; remote creation uses its chosen member. A created side chat keeps
its original model and workspace; effort and permission choices apply to future
turns, with active guidance retaining the running turn's policy. File references
use the canonical workspace reader. Failed sends retain text and attachments.
Browser Web Speech supplies voice input; unsupported WebViews disable the mic
with an explanation. This does not consume the stored Xfy credentials. Escape
closes an open composer menu first, leaving the side panel open.

## Distributed management

The **分布式协作 / Distributed** sidebar entry opens `/distributed`. Workspace, Nodes and Activity views organize existing Goal/Task collaborations, Host → AX Instance management and Execution/Session history. They support participant roles, scoped policies, live ACP guidance/approvals, shared capacity, whole-Workflow pause/resume/cancel/retry, reassignment, confirmed batch operations and opt-in target native settings/plugins. Long Project stays optional and inline inside a Goal. This optional surface is backed by the existing durable cluster and AX-owned Sessions/settings; legacy device controls remain available. See [Distributed Collaboration](../distributed-collaboration.md) for policy and worker setup.

The creation and add-work dialogs use a three-step wizard with a fixed step
navigation and action footer, and a scrolling content area. Creation starts with
equally sized Task/Goal choices. Members have separate AX/Host identity and
online status; selection reveals duty and model settings below the identity,
without squeezing the name. More than four available members adds an AX/Host
search. Numbered work-task cards contain assignments, model overrides and
dependencies. The confirmation step summarizes work, duties, models, resource
minimums and current node matching reasons. Back navigation preserves drafts;
dark/light themes and narrow or short windows retain accessible controls.


## Connections and named projects

In **Add project**, the name is optional once a source folder is selected. Empty
or whitespace-only names use the final folder component (Windows, UNC and POSIX
paths, including trailing separators); filesystem roots use their drive/root
label. The name input previews this default as its placeholder. Changing the
folder updates the default without overwriting an explicitly entered name;
clearing a custom name restores the folder default. This applies to local,
SSH and paired-device folder selection. Creation still requires a source folder,
and a failed request retains both the name draft and selected path for retry.
The desktop sends the resolved name through the existing project API.

### Project terminals

Opening the desktop terminal or using Ctrl+Backquote follows the displayed
conversation's bound host and project directory; a new conversation uses its
chosen environment. Local projects start the configured PowerShell/CMD/Git
Bash/WSL shell. SSH projects start OpenSSH directly inside the native PTY with
`-tt`, the saved host/port/identity file and a safely quoted remote `cd`, followed
by the remote user's interactive POSIX shell. No remote AX installation is
required for this terminal. The SSH directory is never validated on local disk.
OpenSSH reads the desktop user's SSH config and agent, checks known hosts and
can display normal interactive authentication/host-key prompts. This is separate
from the noninteractive authentication used by the agent's SSH tools.

Switching host or directory selects an existing matching terminal or opens a new
one when the dock is visible. Hiding keeps processes running; reopening selects
the current project. Tabs retain their original host/directory and remain manually
selectable. Tab labels show only the directory name, with the full initial path
in the tooltip; local/SSH prefixes and the duplicate location row are omitted.
The shell prompt displays its working directory normally for both local and SSH
terminals. Remote directory matching is case-sensitive.
There are at most eight total terminals; reaching this limit leaves the new
project without an active terminal until a tab is closed and + is used. Failed
SSH startup or remote `cd` never opens a fallback local shell. Closing a tab kills
its local SSH transport, and a tab closed during startup also closes any late
process. ConPTY cursor reports arriving during creation are buffered for OpenSSH.

Unresolved project metadata and an unselected remote environment do not open a
local terminal. Paired AX devices currently have no interactive-terminal gateway
protocol; the dock explains that an SSH connection is needed. This change does
not add remote file browsing or alter agent placement. SSH hosts still require
a POSIX shell; a real SSH client must be installed on the desktop machine.

The previous phone-connection route now opens Connections. Control this computer
shows pending/authorized devices with allow, deny and revoke actions. Add device
opens Android connection information. Control other devices lists paired AX
devices and links to pairing management. SSH offers concrete aliases from the
gateway user primary ~/.ssh/config, multiple selection and a manual
host/user, optional port and identity-file path form.

Saving an SSH host persists settings; Connect probes its remote directory through
OpenSSH. SSH uses LOCAL AX and local model credentials. It sends remote shell
commands through the ssh tool; remote hosts need no AX installation or model
credentials. OpenSSH uses noninteractive default/agent authentication or a key
path, verifies known host keys and accepts previously unseen hosts. Password
and passphrase prompts are unsupported. Remote hosts currently require a POSIX
shell and find with depth/NUL-output support (Linux/macOS).

The selected project supplies the default SSH host and remote cwd. In one AX
conversation, ssh list exposes all saved active hosts; ssh exec accepts another
host_id so one local AX can operate multiple hosts. The registry, task scheduler
and independent-host tool calls impose no fixed SSH host/task count. Calls that
affect the same host within a turn retain resource ordering; approvals still
apply. Ordinary local/paired AX task limits remain configured as before.

SSH transcript workspaces live locally under AX_HOME/ssh-workspaces/{host-id}.
Remote source cwd stays separate from this local storage path. Follow-up/history
replay and deletion use local AX; history remains readable when SSH is offline
or revoked. SSH starts offline after restart and needs Connect for new work.
The isolated process regression uses real local AX and POSIX shells behind a
test OpenSSH stand-in: 264 saved hosts (a manifest beyond the Windows
environment-size limit), six hosts in one turn and eight concurrent same-member
tasks. External SSH/network authentication has not been live-tested.

AX's WSL execution setting also forwards SSH context; key paths are translated
to Linux paths. A WSL AX must include the new SSH tool, and its OpenSSH config
must resolve the chosen aliases.

Add project asks for a name, a source host and one directory. Local Tauri uses
the native folder picker; browser previews use the workspace API. SSH browses
directories as the login account. Paired AX lists only registered workspace
roots, preserving the bridge allowlist; register a folder with AX on that host
first. Removing a project retains members and existing conversation history.


Goal 系统界面文案按当前语言显示：中文“目标”、英文“Goal”。设置导航使用共享 i18n 键 settings.goal，目标策略与分布式相关说明保持同一语言；API 字段、原生命令和用户内容保留原值。


### Collaboration editing

The distributed workspace fills the available width and places actions in their
own views: one Connect AX entry in Nodes, creation in Workspace, refresh by the
tabs. Edit collaboration saves its name, descriptive objective and members in
responsive cards; adding members can optionally include new work. Task details
support renaming, editing input before the first execution and confirmed removal.
Started inputs remain historical; send Session guidance or add replacement work.
Dependency checks protect removal, execution history is retained in Activity, and
failed/stale saves preserve drafts. See [distributed collaboration](../distributed-collaboration.md)
for persistence, fencing and editing limits.


Distributed lifecycle controls include confirmed removal of empty Hosts and entire
collaborations, including cancelled/empty ones. Removing a collaboration stops its
unfinished task graph atomically while retaining execution history in Activity;
external dependencies block removal. Cancel keeps the collaboration visible.
Administrators can add new work to a cancelled retained collaboration. Task removal
is directly available in task details, with links to dependency blockers. Polling
preserves the selected collaboration and metadata drafts across runtime-only
updates. See [distributed lifecycle contract](../distributed-collaboration.md).

The collaboration member picker excludes deleted AX instances, including old
membership references and instances removed during editing. Saving clears obsolete
member/model/new-work references; execution history remains separately accessible.
The editor and the workbench history both name archived members, including ones
that never ran a task, so a stale participant reference that would still constrain
placement stays diagnosable. A pin to a removed Host is labelled as removed in the
reassign picker instead of showing a raw identifier.

## Display color themes

Settings → Display keeps Dark, Light and Follow system as independent appearance modes.
The Color theme selector includes the original AXCrew palette and 28 additional app-adapted
styles: ChatGPT, Absolutely, Ayu, Catppuccin, Dracula, Everforest, GitHub, Gruvbox, Linear,
Lobster, Material, Matrix, Monokai, Night Owl, Nord, Notion, OG, One, Oscurange, Raycast,
Rose Pine, Sentry, Solarized, Temple, Tokyo Night, Vercel, VS Code Plus and Xcode.
Each menu item shows a color sample and supports keyboard selection. Both light and
dark variants update the shell, conversation surfaces, settings popups and terminal.
Mode and palette are saved separately on this desktop; existing preferences retain
the AXCrew palette. Selecting AXCrew restores the original colors. These palettes are
AXCrew adaptations, not imports of the reference application's theme definitions.

会话列表与右侧面板展开/收起时提供滑动与淡入淡出过渡，并遵循系统减少动画设置。展开时使用面板内的收起入口，关闭后使用聊天栏的展开入口，避免重复按钮；收起后的面板不参与键盘焦点。

Android 客户端允许正常截图和录屏。手机扫码连接使用局域网；账号授权、接口权限限制和撤销仍然生效。

设置 → 聊天平台提供 Slack、Discord、Telegram、Webex、企业微信、飞书、Microsoft Teams、个人微信、iMessage 和 WhatsApp 的私聊文字接入。Teams 需公网 HTTPS 回调；iMessage 需运行于 Mac；WhatsApp 需 Node.js 连接组件与扫码关联设备。其余平台使用出站连接，无需 AXCrew 共用中转。账号绑定需电脑确认，支持独立会话、任务状态、取消和单次工具审批。左侧选择平台，右侧仅显示该平台的配置；切换平台保留本页未保存的输入和扫码进度。配置与限制见 [聊天渠道](../chat-channels.md)。


### Web preview and compact change review

The desktop conversation sidebar has a resizable Preview tab with an HTTP(S)
search/address field, reload and a start-page button. Bare domains use HTTPS;
localhost and loopback addresses use HTTP. Keywords open Bing search on submit.
The desktop uses a native child webview, so websites and search results load as
top-level pages instead of iframes. Rounded navigation controls provide back,
forward and reload; the pill-shaped address field uses a quiet focus border.
The address placeholder is left-aligned and disappears on focus. The browser tab
strip adds, switches and closes pages independently; inactive native pages are
hidden while retaining page state and history. Page titles label native tabs.
The themed start page offers local server shortcuts. Browser development mode
retains an iframe and offers a new-tab link for websites that block embedding.
Local dev-server URLs found in the current conversation
are offered as buttons and load only after a click. Interactive embedded pages can
receive their dev server's live updates. URLs with credentials, privileged schemes
and the application origin are rejected, including native navigations. Remote
projects need a reachable URL or an already forwarded port. Switching conversations
clears the browser tabs and closes their native views. Each child follows the
panel's clipped bounds in physical pixels, accounting for UI zoom and display
scaling, and hides beneath app dialogs/menus. New-window links create new tabs;
downloads are disabled. Remote pages receive no app capabilities. The panel
does not start servers or forward ports automatically.

Ask AX to inspect inserts the preview URL into the composer for the user to send.
AX uses its existing separate browser tool; embedded page cookies, clicks and DOM
are not shared with it. Existing browser tool restrictions still apply.

File change summaries use compact rows, aligned counts, truncated paths with full
path tooltips, and the existing sidebar diff viewer. Unavailable undo is omitted.
Allowed Computer Use applications no longer trigger generic per-action prompts;
explicit task Ask/Deny and capability Deny still apply. Website rules are unchanged.

Chat platform settings use an optional default project directory. Project and
conversation selection is available directly in an approved private chat through
`/projects`, `/project`, `/new`, `/sessions` and `/session`; the default does not
move existing conversations. See [chat channels](../chat-channels.md).

Chat platform setup explains the natural-language menu entry points (`菜单`,
`切换项目`, `查看历史会话`) and numbered selection, plus direct new-conversation,
project-name and status/cancel phrases. Slash commands remain available.

Account-pairing guidance explains the automatic welcome menu after first approval
and the `菜单`/`怎么用`/`你能做什么` help phrases. Ordinary messages without a
project open a chooser; new/switch confirmations include a short menu reminder.
