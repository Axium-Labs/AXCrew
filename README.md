# AX Crew

A Rust control plane that connects, controls and orchestrates AX agents across
your machines.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](crates/server/Cargo.toml)
[![Rust 1.92+](https://img.shields.io/badge/rust-1.92+-orange)](https://www.rust-lang.org)
[![Release](https://img.shields.io/github/v/release/Axium-Labs/AXCrew)](https://github.com/Axium-Labs/AXCrew/releases/latest)

**English** | [简体中文](README.zh-CN.md)

[AX](https://github.com/Axium-Labs/AX) is a fast, native terminal agent that
runs on any machine — a laptop, a build server, a GPU box, a cloud VM. AX Crew
is the control plane on top of it: it pairs those machines, delegates work
between them, streams what their agents are doing, and gives you one surface
to control the whole fleet. The two are developed and released together — the
agent runtime and the control plane that coordinates it.

- **Interactive chat questions** — ordinary main and side chats show compact
  floating AX questions above the composer, with choices and optional text replies. Answering resumes the
  same task/session; pending questions survive reopening and failed answers
  retain their drafts.
- **One control surface** — drive AX on your laptop, server, GPU server and
  cloud VMs from a single desktop app, or from your phone.
- **Settings → Goals** — configure AX-owned global/project acceptance validators,
  conservative progress observations and cumulative Runtime caps. An opt-in
  switch applies them automatically to ordinary new tasks; advanced forms start
  collapsed and retain drafts when folded. Durable execution and takeover retain Crew's existing leases/checkpoints.
- **Codex account sign-in** — choose browser authorization or device-code login
  in desktop model settings; the full one-time code is visible and copyable.
- **Settings → Plugins** — manage Mods, MCP and skills in settings. The page
  keeps workspace paths and scope explanations out of the plugin list, and
  explains when the installed AX needs updating to support Mods.
  Responsive lists keep scope/status visible, support keyboard tabs and plugin
  details, and refresh inherited configuration after changes.
  The Agents tab controls global/project delegation depth (0 off, 1 direct
  children, 2+ nested children) and shared parallelism (1–64). Save applies
  on the next turn; reset restores defaults or inheritance. Both scopes use
  the current AX `settings --scope` / `--reset` interface.
  Other settings show complete readable absolute paths in rounded icon labels.
- **Local system metrics** — desktop System settings show real Windows CPU,
  memory, system-volume usage and uptime, plus supported NVIDIA GPU usage/VRAM,
  with explicit unavailable readings.
- **Adaptive workspace** — one layout budget protects chat width, collapses
  navigation and Sessions before moving Files to a drawer, and supports a saved
  resizable chat/preview split with reset.
- **Settings switches** — boolean options and import selections use right-aligned
  pill switches with titles and descriptions on the left.
  Application and website permission choices use the same themed dropdowns as
  the other settings pages.
- **Desktop close behavior** — closing hides to the tray by default; disabling
  that setting makes closing quit Crew and stop the local service. The preference
  survives restart, and the tray Quit action always exits. System settings
  contain only the close-behavior switch.
- **Completion reminders** — when the desktop is unfocused, completed/failed
  tasks trigger a short Windows chime, a system notification and taskbar/tray
  icon attention. Unread result dots appear in Recent, project sessions and the
  Sessions navigation; reading that conversation clears its dot. Other unread
  conversations remain marked, including after restarting Crew.
- **Compact conversation controls** — a model/effort card with Fast, a stepped
  reasoning slider; click the central card for the model
  menu. Session IDs live in the Details sidebar, leaving transcripts clean.
  The composer leaves bottom space and shows project/location setup only before
  starting a new conversation. The compact model card follows the app theme,
  with lightly damped effort dragging, gentle attraction near steps, and small
  a forward-dash particle wake behind the thumb when Fast is enabled;
  remote conversations stay accessible in Recent without a separate Remote projects section.
- **Conversation files** — a wide Review/files pane with saved diffs, an
  expandable local workspace tree, closable tabs and Markdown preview/source.
  Local UTF-8 files can be edited and saved with a disk-change check. Drafts
  stay available across tabs and conversation navigation during this app run.
  Files stay open when switching to side chat or details.
- **Continue local AX conversations** — opening local history shows the original
  messages and composer together. Sending resumes the same AX session in its
  original workspace. Placeholder titles use the first user request.
- **Cross-machine delegation** — hand a task to another machine; Crew routes
  it to that machine's AX and streams the result back.
- **Task orchestration** — deterministic task DAGs with dependencies, retries,
  cancellation and automatic resume across devices.
- **Automation** — recurring jobs such as nightly builds, error digests,
  standup briefs and deployment checks, scheduled from presets or plain chat.
- **Local-first** — agents stay on your hardware; each machine keeps its own
  credentials, sessions and memory. There is no agent cloud.

## Screenshot / Topology

![AX Crew desktop](docs/images/session.png)

AX runs where the work happens; Crew connects the machines and gives you one
control surface:

```text
   Laptop (AX)   Server (AX)   GPU Server (AX)   Cloud VM (AX)
        │             │              │                │
        └─────────────┴──────────────┴────────────────┘
                             ▼
                ┌──────────────────────────┐
                │      Crew Gateway        │
                │  pairing · routing ·     │
                │  DAG scheduling ·        │
                │  event streaming         │
                └────────────┬─────────────┘
                             │  REST / WebSocket
                ┌────────────▼─────────────┐
                │   Desktop client         │
                │   (+ Android client)     │
                └──────────────────────────┘
```

Each device pairs over authenticated WSS; the desktop and Android clients talk
to the gateway over REST/WebSocket.

## What is AX Crew

AX Crew is a Rust control plane for AX. It runs alongside AX — on the same
machine or on one that manages the others — and turns separate AX runtimes
into one fleet.

- **AX is the agent.** It owns the agent loop, session history, memory, tools,
  skills, MCP, models, permissions and credentials on its own machine.
- **Crew is the control plane.** It connects machines (pairing, identity,
  routing), controls them (sessions, permissions, terminal) and orchestrates
  them (task DAGs, automations, retries, cancellation).
- **Clean boundary.** Crew never interprets model output or replicates AX's
  Session/Memory stores or provider credentials. Distributed collaboration
  retains selected results, checkpoints and explicitly published artifacts.

## Why

Running AX on one machine is easy. Running it on five — a laptop for
interactive work, a build server for long tasks, a GPU server for heavy jobs,
a cloud VM for 24/7 automation — is where you need a control plane.

- **Put the agent where the work is.** Long builds and heavy jobs run on
  machines that can handle them; you stay on your laptop.
- **Delegate across machines.** Send a task to another member of the Crew and
  get the result back without copying files, sessions or credentials.
- **Automate the routine.** Nightly builds, error digests, standup briefs and
  deployment checks run on schedule and report to one place.
- **Keep control in your hands.** Approve tool access from the desktop or the
  phone; every machine keeps its own credentials.
- **No agent cloud.** Your agents never run on someone else's infrastructure
  just to be coordinated.

## How it works

1. **Run AX on each machine.** Install AX wherever you want agents; models,
   credentials, skills and memory stay local to each machine.
2. **Pair the machine.** Generate a one-time code in Crew, then on the machine
   run `ax crew pair <code> --gateway <url>` once and `ax crew connect <url>`.
3. **Build a Crew.** Add machines as members, each with its working directory,
   model and permission profile (`ask` / `allow` / `deny`).
4. **Create tasks.** A task is a prompt assigned to a member. Declare
   dependencies to form a DAG; Crew starts each task when its predecessors
   finish, honoring per-member concurrency limits.
5. **Watch it run.** Crew streams live events — agent messages, tool calls,
   permission requests — to the desktop.
6. **Intervene when needed.** Approve or reject tool access, cancel tasks,
   retry failures. If a machine disconnects, its work returns to `ready` and
   resumes the same AX session on reconnect.
7. **Automate the repeatable.** Schedule recurring tasks from presets or plain
   chat.

![Schedule view](docs/images/Schedule.png)

## Quick Start

### Install and run

1. Install [AX](https://github.com/Axium-Labs/AX) on the machines you want to
   control.
2. Install AX Crew — download the Windows installer from
   [GitHub Releases](https://github.com/Axium-Labs/AXCrew/releases/latest).
3. Open AX Crew, sign in to a model provider, pick a model and a workspace,
   and send your first message.

The desktop composer has a joined project/location strip: click the folder to
choose a project, or the local-computer pill to open the work-location menu.
The local option keeps the selected directory. Choosing Cloud reveals a Choose
environment menu for paired AX or SSH projects. Paired AX runs on its host;
SSH runs local AX and local models, using SSH only for remote shell commands. Existing sessions keep their directory, host and model fixed.
Add project opens a named-project dialog with local/remote source selection.

### Add another machine

Generate a one-time pairing code on the gateway, then on the second machine:

```powershell
ax crew pair <code> --gateway https://crew.example.com
ax crew connect https://crew.example.com
```

![Device pairing](docs/images/connect.png)

`ax crew connect` reconnects automatically. Full API and pairing details:
[docs/protocol/api.md](docs/protocol/api.md).

## Security

- **Loopback by default.** The gateway binds to loopback; any non-loopback
  bind requires `AX_CREW_ADMIN_TOKEN`, and all REST/WebSocket routes require
  `Authorization: Bearer <token>` when it is set.
- **TLS in transit.** Remote machines connect over HTTPS/WSS, typically through
  your own reverse proxy; WSS certificate verification is mandatory.
- **One-time pairing.** Pairing codes expire after five minutes and can be used
  once.
- **Signed device identity.** Devices authenticate with an Ed25519 challenge;
  private keys never enter Crew's database.
- **Human approval.** Tool access follows each member's permission profile and
  can be granted once, for the session, or rejected; unanswered requests
  expire.
- **Credential isolation.** Crew never sees provider API keys or OAuth tokens —
  they stay in each machine's AX installation.

## AX vs AX Crew

| | AX | AX Crew |
|---|---|---|
| Role | Agent runtime | Control plane |
| Scope | One machine | Many machines |
| Owns | Agent loop, sessions, memory, tools, skills, MCP, models, permissions, credentials | Device identity, pairing, task DAGs, scheduling, events, automations |
| Talks to | Models and tools | AX runtimes (ACP) and clients (REST/WebSocket) |
| Gives you | An agent on one machine | One surface for a fleet of agents |

AX does the thinking; Crew does the coordination. Run them on the same box or
apart — AX needs no cloud, and Crew adds no agent of its own. See the
[AX README](https://github.com/Axium-Labs/AX) for the runtime side of the pair.

## Architecture

AX Crew is one product made of three deliverables that only meet at stable
interfaces:

- `crates/server` — the control plane: REST/WebSocket API, DAG scheduling,
  storage, transports. The only Cargo workspace member.
- `apps/desktop` — a Tauri 2 + React desktop client with an integrated
  terminal, schedule and artifact views.
- `apps/android` — a native Android control client.

The control plane layers strictly: `api/` → `orchestration/` → `storage/` →
`domain/`, with `transport/`, `gateway/` and `ax/` as the communication and
AX-adapter boundaries. Desktop and Android reach the control plane through the
API only.

The root only organises the product; it holds no code of its own. See
[docs/architecture/README.md](docs/architecture/README.md) for the full
repository layout and module responsibilities, and
[docs/architecture/design.md](docs/architecture/design.md) for the Crew/AX
boundary, schema and state machines.

## Docs

Start with [docs/README.md](docs/README.md), the documentation map:

| Document | Topic |
|---|---|
| [docs/architecture/README.md](docs/architecture/README.md) | System architecture, layering, repository layout |
| [docs/protocol/api.md](docs/protocol/api.md) | REST/WebSocket API, authentication, pairing |
| [docs/architecture/storage.md](docs/architecture/storage.md) | Database and durability boundary |
| [docs/development/README.md](docs/development/README.md) | Build, test and packaging |
| [docs/desktop/README.md](docs/desktop/README.md) | Desktop settings and scoped plugins |
| [docs/releases/0.3.0.md](docs/releases/0.3.0.md) | Release snapshots |

## Development

Requires Rust 1.92+. The root is a Cargo workspace whose only member is
`crates/server`:

```powershell
cargo build
cargo test --workspace
```

See [docs/development/README.md](docs/development/README.md) for the full
build flow — desktop, Android, packaging — and the process-level tests.

## License

MIT. See [crates/server/Cargo.toml](crates/server/Cargo.toml).

## Optional Distributed Collaboration

The **Distributed** sidebar opens a unified collaboration workspace with three views: Workspace, Nodes and Activity. Expandable distributed sections use the shared app-style Disclosure, preserving drafts when collapsed. All distributed dropdowns reuse the shared settings-style Select with themed popups and keyboard navigation. A compact status overview shows online AX, running work, failed Tasks/offline AX and queued Tasks. Stable objective/task/member/feed regions keep the workspace usable even before the first collaboration; node rows expose capacity, work/Session associations and capabilities, while Activity provides counted secondary navigation and resettable filters. Organize existing Tasks/Workflows as ordinary collaborations or explicit AX Goals; add AX participants and roles, choose placement, inspect dependencies and live ACP Sessions, and pause/resume/cancel/reassign work. Instance names and their disclosure buttons both expand details, including offline nodes. Nodes support confirmed instance deletion with busy/reference checks, credential revocation and retained execution history. Nodes follow Host → AX Instance; shared capacity and approved execution slots govern concurrency across Goals. Goal-scoped policies stay separate from AX-wide configuration. Batch operations preview differences and retain partial failures; optional native remote settings/plugins require host opt-in and confirmed write scope. Long Project is off by default and stays inline within a Goal, retaining AX-owned document/history, Session rotation and cumulative budget checkpoints. See [architecture, API and setup](docs/distributed-collaboration.md).


Creation and add-work dialogs have a fixed three-step navigation and action
footer with scrolling content. Selected AX cards expand duty/model settings
below their identity and status, numbered task cards organize assignments and
dependencies, and confirmation summarizes work and placement. Larger member
pools support AX/Host search; both themes and narrow/short windows are supported.

Distributed collaboration now creates actual multi-AX work through a three-step
plan form and one atomic Task/Workflow transaction. Native worker model catalogs
feed searchable execution selections; each Attempt freezes its Provider/Model
and duty. Matching previews share scheduler predicates and pending Tasks display
reasons. Member removal fences only its Workflow; new-member work can save in the
same policy transaction. Latest-Session routing and read-only Session history
retain rotation and migration associations. Resource minimums reserve scheduler
capacity; system resource limits are explicitly unsupported. See
[distributed contracts](docs/distributed-collaboration.md).
