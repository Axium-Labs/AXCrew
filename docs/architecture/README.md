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
| `tests/` | Process-level integration tests (Python) that drive the built binaries. |

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
| `orchestration/` | Task scheduling, automations, approval brokering, crew rules. | A business process changes. |
| `transport/` | Local ACP stdio and remote gateway runs behind one `Transport` trait. | How AX is reached changes. |
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
