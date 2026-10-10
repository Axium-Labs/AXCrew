# Architecture

AXCrew is one product made of three deliverables that only meet at stable
interfaces: the control plane (`crates/server`), the desktop client
(`apps/desktop`) and the Android client (`apps/android`). The clients talk to the
control plane over the REST/WebSocket API and nothing else; neither client links
against server internals.

## Documents

| Document | Contents |
|---|---|
| [../distributed-collaboration.md](../distributed-collaboration.md) | Additive distributed models, storage, orchestration and API modules. |
| [design.md](design.md) | The source-based AX call-chain analysis, the Crew/AX boundary, the database schema and the state machines. |
| [storage.md](storage.md) | The SQLite WAL database, what is stored durably and the source-of-truth boundary. |
| [android-migration.md](android-migration.md) | How each desktop surface maps to the Android client, and what was deliberately not migrated. |
| [../protocol/README.md](../protocol/README.md) | Where the REST, WebSocket and ACP contracts are defined. |
| [../development/README.md](../development/README.md) | Build, test and packaging commands. |
| [../desktop/README.md](../desktop/README.md) | Desktop settings and scoped AX capabilities. |

## Repository layout

The root only organises the product; it holds no code of its own.

| Path | Responsibility |
|---|---|
| `crates/server/` | The control plane: REST/WebSocket API, scheduling, storage, transports. The only Cargo workspace member. |
| `apps/desktop/` | The Tauri 2 + React desktop client (`src/` is the frontend, `src-tauri/` the Rust shell). Its own Cargo project. |
| `apps/android/` | The native Kotlin/Compose Android control client. |
| `docs/` | `architecture/`, `protocol/`, `development/`, `desktop/`, `releases/`. |
| `scripts/` | Repository-level build and release scripts. |
| Local validation | Standalone tests and work logs are maintained locally and excluded from the published repository. |

## The control plane

`crates/server` is the only Cargo workspace member. Its modules are ordered so
that dependencies only ever point one way:

```text
api/            HTTP boundary
  |
orchestration/  business processes
  |
storage/        persistence (the only SQLite-aware layer)
  |
domain/         pure models and schedule maths

transport/      how work reaches AX   (used by orchestration)
gateway/        the device WebSocket  (used by transport)
ax/             read-only local AX adapter (used by api and transport)
auth/ config/ error/ app.rs           cross-cutting support
```

| Module | Single responsibility | Change it when |
|---|---|---|
| `main.rs` | Parse the config, build `App`, start the scheduler loops, mount the router, serve. Nothing else. | Startup wiring changes. |
| `app.rs` | `AppState` plus the authentication checks that need the database. | A handler needs new shared state. |
| `config/` | The clap arguments and the environment variables that shape startup. | A new flag or environment variable appears. |
| `auth/` | The issued-token store and `Authorization` parsing. | The token format or header handling changes. |
| `error.rs` | The single HTTP error shape. | The error contract changes. |
| `api/` | One module per resource; `request -> validation -> orchestration -> response`. | An endpoint or its request/response shape changes. |
| `domain/` | Pure models and the wall-clock schedule maths. No SQLite, no HTTP, no tokio. | A persisted concept or a scheduling rule changes. |
| `storage/` | `Db` facade, `schema.sql`, migrations and one repository module per aggregate. The only layer that writes SQL. | The schema, a query or a migration changes. |
| `orchestration/` | Task scheduling, automations, approval brokering, crew rules and host workspace validation. | A business process changes. |
| `transport/` | Local AX ACP, paired AX gateway runs and local AX with OpenSSH tools behind one `Transport` trait. | How AX is reached changes. |
| `gateway/` | The device WebSocket, its Ed25519 handshake and its links. | The device protocol changes. |
| `ax/` | Read-only discovery of the local AX stores and usage aggregation. | Reading AX's own store changes. |

### Rules that keep the boundaries honest

- Domain models never depend on SQLite. SQL against Crew's own database lives only
  in `storage/`; the one other `rusqlite` user is `ax/`, which opens AX's own store
  read-only and never writes to it.
- API handlers never execute SQL, never schedule work and never open a transport.
  They call `crate::orchestration` or the `Db` facade.
- Pure input validation lives in `orchestration/` (for example
  `orchestration::crew`). Checks that must read other rows — does this crew exist,
  does this device exist, is this dependency acyclic — stay inside the storage
  transaction that performs the write, so they cannot race with it.
- Desktop and Android talk to the control plane over the API only. They never
  import server internals, and the server never assumes a specific client.
- There is deliberately no `utils`, `common` or `helpers` module. If a helper is
  needed by one layer, it lives in that layer; if it is genuinely shared it gets a
  named module with a single responsibility.
- `orchestration/` and `transport/` reference each other, and that is the only
  cycle in the graph. The scheduler drives work through the `Transport` trait,
  while a transport takes the `ApprovalBroker` from `orchestration::approval` so it
  can wait for a tool decision. Both directions cross a narrow interface, so the
  cycle is intentional rather than an entanglement.

### Why one `server` crate

`crates/server` stays a single crate on purpose. Splitting `protocol`, `storage`
or `orchestration` into separate crates would add versioning and build cost before
the boundaries have proven stable. `domain/` and `storage/` already provide the
seam, so `crates/protocol` can be extracted later without moving any logic.


Connections/projects have separate domain models, storage repositories,
orchestration validation and authenticated API adapters in their respective
connections.rs modules. transport/ssh.rs performs remote directory probes and resolves local transcript
workspaces. transport/ax.rs owns the local ACP update/approval/cancellation
lifecycle; SSH tasks inject a host context into that local AX process. The source
selector never validates a remote directory on the gateway disk.

### Desktop file workspace

`SessionsWorkspace.tsx` supplies the current conversation's workspace and saved
turn changes, routes transcript review requests, and opens Files through the shared workspace layout. `UnifiedFilePanel.tsx` owns review selection, open document tabs,
the lazy directory explorer and Markdown preview/source. Switching side-panel
sections preserves these tabs; changing conversation/workspace resets them.
The native commands in `src-tauri/src/lib.rs` list complete directories and read
bounded UTF-8 text on the blocking pool, checking canonical workspace containment.
Only local desktop sessions use those filesystem commands; remote/SSH sessions
review saved changes without reading local lookalike paths. This does not change
the control-plane REST/WebSocket contracts.

### Desktop close preference

`DesktopBehavior.tsx` provides the single System-settings close-preference card,
reading native state and updating it after acknowledged saves. The shared
`ui/settings-toggle.tsx` lays out labeled native checkbox inputs with switch
semantics and descriptions; the settings card has no explicit Quit button. The native
`desktop_behavior.rs` owns the close preference and atomic app-data persistence;
`lib.rs` loads it at startup, dispatches main-window close events to Hide or Quit,
and routes explicit tray quit through the same runtime shutdown path.
The existing `set_minimize_on_close` command now returns the persisted boolean;
`get_minimize_on_close` reads it. REST/WebSocket and Android are unchanged.

### Desktop system telemetry

`SystemMetrics.tsx` owns the System page's native-only three-second telemetry
query, nullable reading validation, capacities in GiB and localized uptime.
`system_info.rs` collects Windows CPU counter deltas, physical memory, the actual
Windows system volume and system uptime. The async `get_system_info` bridge runs
it on the blocking pool, including the initial CPU sampling interval; collectors
return null on failure or unsupported platforms. The legacy `_mb` fields contain
MiB; `disk_path` identifies the volume. The lazy NVML collector adds per-device
NVIDIA name, usage and VRAM in `gpus`; individual failed fields remain null.
The driver handle is reused, missing drivers are retried on later reads, and
unsupported vendors remain unavailable. These local shell commands do not
change server or remote-host telemetry or depend on AX's `/system` panel.

### Unified desktop workspace layout

`lib/workspaceLayout.ts` is the pure width-budget allocator for navigation,
Sessions, main chat and preview. `workspaceLayoutContext.tsx`, owned by the shell,
observes the outer workspace and terminal widths; children consume one result
instead of separate viewport thresholds. The allocator reserves a 560px chat
target / 520px minimum, collapses navigation then Sessions, and selects a drawer
when preview and chat minima cannot fit. A 24px restoration margin prevents
threshold oscillation; automatic decisions do not persist visibility.

`store/sessions.ts` keeps main-chat visibility and split ratio alongside existing
list/right visibility and drafts. `WorkspaceSplitter.tsx` supports pointer capture,
keyboard resizing and ratio reset. `usePanelDrawer.ts` handles keyboard focus and
return focus for drawers. `ComposerSecondaryActions.tsx` observes the actual form
width and moves secondary controls to a shared popover below 600px. Existing
`useAutoGrow` handles textarea wrapping after the panel resizes. No server API,
AX behavior, Android state or stored conversation format changes.
