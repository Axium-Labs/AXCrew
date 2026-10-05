# Desktop Settings & Capabilities

How the AX Crew desktop client ([`apps/desktop`](../../apps/desktop/README.md))
is configured. Build, install and packaging instructions live in
[apps/desktop/README.md](../../apps/desktop/README.md); this page documents
the settings surfaces and their behaviour.

## Settings pages

Settings has separate **Connections** (`/settings/connections`) and **System**
(`/settings/system`) pages. Connections contains remote AX pairing and phone
access; System contains service status, desktop behaviour and Crew updates.
Model settings group account sign-in, API-key and environment providers.
WorkBuddy China and International are separate accounts. Account sign-in shows
a URL to click or copy; closing the dialog cancels waiting. AX stores the
credentials and refreshes models after authorization.

## Chat execution view

The chat area renders each tool call as a compact single line. Explanations and
thinking appear as regular text; the start, success and failure of the same
call ID update in place. Clicking a tool row reveals the real tool type, the
operation and the compressed result; the raw output needs another expand and
long output scrolls inside the card. Errors never become successes. Durations
over one minute are shown in minutes, over one hour in hours. Each finished
turn shows a modified-files card; ACP `turn_changes` takes precedence over
accumulated patch stats and the card is kept in history replay.

The composer auto-grows with the text and panel width, then scrolls once it
reaches its cap. Enter sends, Shift+Enter adds a newline and IME confirmation
does not send. Failed sends retain their draft; closing the app discards
unsent drafts. Each user message and model reply can be copied; a reply's
branch button opens an independent session from the text before it, inheriting
the working directory and execution environment without copying tool state or
changing the original session.

The new-session page is deliberately clean: no welcome heading or suggestion
chips. An inset workspace strip joins the top edge of the composer. Its
transparent folder button shows the current project directory (click to pick
another directory), and its rounded "此计算机 / This computer" button opens
an upward work-location menu with a check on the local option. Choosing the
local option preserves the selected project directory. Cloud is shown disabled
with an unavailable hint because cloud execution is not implemented. Existing
sessions keep their directory fixed and both controls are display-only.
The reasoning-effort, Fast-inference and model pickers moved
into the composer's bottom toolbar (right side, next to the round send
button); the old footer row below the box is gone. The permission button
turns orange when YOLO mode is selected.

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
