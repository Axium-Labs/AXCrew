# Desktop Settings & Capabilities

How the AX Crew desktop client ([`apps/desktop`](../../apps/desktop/README.md))
is configured. Build, install and packaging instructions live in
[apps/desktop/README.md](../../apps/desktop/README.md); this page documents
the settings surfaces and their behaviour.

## Settings pages

Settings has separate **Connections** (`/settings/connections`) and **System**
(`/settings/system`) pages. Connections has Control this computer, Control other devices and SSH tabs,
including phone authorization, paired AX devices and persisted OpenSSH hosts; System contains service status, desktop behaviour and Crew updates.
Model settings group account sign-in, API-key and environment providers.
WorkBuddy China and International are separate accounts. Account sign-in shows
a URL to click or copy; closing the dialog cancels waiting. AX stores the
credentials and refreshes models after authorization.

## Chat execution view

The chat area groups work by user turn. During work, thinking and progress prose
appear inside one expandable process block with a static status label and elapsed
time. Related calls remain in one group even when progress prose separates them;
that prose stays available inside the group. A change of operation keeps its
progress paragraph separate. When work stops, the process block automatically
folds, including when it was manually expanded, and the last answer stays visible.
Late replayed tools do not move that answer into the folded block.

Each tool call is a compact muted single line. Operation labels and tool headers
follow the interface language; command text, paths, queries and real output are
preserved. Web rows show the page count and host instead of a long encoded URL.
Start, success and failure of the same call ID update in place. Clicking a row reveals the real tool type, the
operation and the compressed result; the raw output needs another expand and
long output scrolls inside the card. Errors never become successes. Durations
over one minute are shown in minutes, over one hour in hours. Each finished
turn shows a modified-files card; ACP `turn_changes` takes precedence over
accumulated patch stats and the card is kept in history replay.

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
chips. An inset workspace strip joins the top edge of the composer. The
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
One subdued model/effort trigger beside Send opens a combined panel: Fast toggle,
model list and a stepped **思考强度 / Reasoning effort** slider. There are no Default
mode or Reset defaults buttons. Steps come only from that model's AX catalogue
`reasoning_efforts`, preserving provider wire values and the catalogue default.
A stale selection falls back to the selected model's configured/catalogue default
or its first supported value. Missing/empty capabilities disable effort selection
and omit the request parameter. The Tauri bridge retains these fields. New turns
and follow-ups both forward `reasoning_effort`; changing it does not affect running
work. Paired AX uses its own catalogue; SSH uses local AX. The permission button
turns orange when YOLO mode is selected.

The left edge of the transcript has a quiet turn rail. Hover or keyboard focus
previews the user request and latest answer text; clicking a mark scrolls to that
turn. It is built from conversation history and does not create tasks or branches.

Native minimum window size is 640×480 logical pixels. WebView zoom stays at 1;
monitor DPI is handled by the system. Window width
does not enlarge fonts. The main navigation collapses automatically at 1100px
and can still be opened manually; the conversation list initially collapses below
900px without changing the saved large-window preference. Narrow layouts overlay
side panes, constrain popovers to the viewport and reflow Settings below 650px.

The input area shows the number of successfully modified files and inserted /
deleted lines for the current turn, updated live while work is in progress;
clicking the summary opens the diff in the right panel. After a turn, the
authoritative change snapshot replaces the incremental stats.

## Conversations

Right-click a conversation to rename, mark, group under a project or delete it
from the list. Labels and groupings are saved on this desktop; moving a
conversation does not change its execution directory. Deleted entries can be
restored from "Show deleted"; AX history is preserved. Language switching
translates interface controls while leaving user text, generated answers and
package descriptions unchanged. Speech credentials have independent reveal
buttons.

The language and theme pickers in Settings → Display use the app's shared
dropdown menu (same dark/light panel as every other menu in the shell) instead
of native `<select>` popups, which the OS renders in its own style. The few
remaining native selects (model picker, backup scope, move-to-project) style
their option lists with the app surface colors as a fallback.

After a task stops, the chat keeps the tool calls and output it already
received; refreshing history merges and deduplicates by call ID. Long-running
sub-session tool records come from updated AX history replay and remain
available after a Crew restart.

## Imports

The import page automatically scans the user directory and the current project
for Codex, Cursor, Claude Code, Windsurf and shared `.agents/skills`
configurations, and imports a skill package or a whole MCP configuration into
the current project or global AX; a manual path can be picked instead.
Scanning only reads configuration; imports are shown per item, name conflicts
are left for AX to reject, and failed items are kept for retry.

Settings → AX capabilities imports local Skill directories and MCP TOML or
JSON through the installed AX's `skill import` / `mcp import` commands,
choosing project or global scope. An updated AX executable is required for
these commands.

## Subagents

The **Subagents** switch in Settings → AX defaults off, saves through AX's
`settings --subagent` command and applies on the next agent turn. Crew shows
the persisted AX value and retains it when saving fails.

## Scoped AX capabilities

Settings → Capabilities switches between **Global configuration** and
**Current project configuration**. Skills, MCP servers and named Agents show
Name / Scope / Status with add, enable, disable and remove actions. Project
views include inherited globals; disabling or removing one there creates a
project mask and leaves global configuration intact. Crew delegates all scope
resolution and mutations to AX's shared registry via ACP/CLI; this requires an
AX binary with `_ax/scopedCapabilities` support. Project capability files live
under `<project>/.ax`, and named Agent instructions load only when delegated
to.

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
