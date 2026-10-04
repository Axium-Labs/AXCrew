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

- **One control surface** — drive AX on your laptop, server, GPU server and
  cloud VMs from a single desktop app, or from your phone.
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
- **Clean boundary.** Crew never interprets model output and never stores
  agent messages, memory or credentials. AX keeps being AX; Crew only
  coordinates.

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
The local option keeps the selected directory; cloud is visibly unavailable.
Existing sessions keep these controls read-only.

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
| [docs/desktop/README.md](docs/desktop/README.md) | Desktop settings and scoped capabilities |
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
