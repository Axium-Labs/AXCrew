# Desktop Settings & Plugins

How the AX Crew desktop client ([`apps/desktop`](../../apps/desktop/README.md))
is configured. Build, install and packaging instructions live in
[apps/desktop/README.md](../../apps/desktop/README.md); this page documents
the settings surfaces and their behaviour.

## Settings pages

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
it. CPU, memory, disk and uptime collectors are currently Windows-only; other
platforms return unavailable readings for these collectors. GPU collection
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

The chat area groups work by user turn. During work, thinking and progress prose
appear inside one expandable process block with a static status label and elapsed
time. Related calls remain in one group even when progress prose separates them;
that prose stays available inside the group. A change of operation keeps its
progress paragraph separate. When work stops, the process block automatically
folds, including when it was manually expanded, and the last answer stays visible.
Late replayed tools do not move that answer into the folded block.

The main and side-chat composers can send during active work. Send (or Enter)
adds guidance to the same task and AX goal without interrupting streaming or
restarting tools. Stop remains a separate button. Guidance stays visible when
work details fold and survives history replay with a stable message ID. The
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
Arrow keys/Home/End navigate document tabs; Ctrl/Cmd+P within the file panel opens
the workspace tree. At very narrow widths the tree overlays the reader and
automatically hides after opening a file.

Local file browsing requires the desktop app and works without a Crew member.
Remote/SSH conversations can review saved diffs but cannot read remote paths
through this computer's filesystem. Absolute tool paths can be previewed only
when canonically inside the workspace. The reader is read-only and does not
initialize Git repositories or revert files.

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

## Subagents

Settings → Plugins → Agents contains **Subagent delegation** with maximum
recursion depth and parallelism. Depth 0 disables delegation, 1 permits direct
children, and greater non-negative integers permit nested delegation. The main
model decides when to delegate; changing limits does not launch children.
Parallelism accepts 1–64 (default 8); depth defaults to 1. All levels share the
limit, including waiting ancestors; exhausted nested admission fails rather than
deadlocking. Named-Agent switches independently control which roles can be used.

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

The **分布式协作 / Distributed** sidebar entry opens `/distributed`. Host, AX Instance, Workflow, Task, Artifact and Event tabs support shared resource administration, enrollment/config download, constrained task creation, attempt/error/checkpoint inspection, central cancellation/retry and artifact download. This optional surface is independent of legacy Sessions, devices and local AX settings. See [Distributed Collaboration](../distributed-collaboration.md) for policy and worker setup.


## Connections and named projects

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
