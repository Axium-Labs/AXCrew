# AGENTS.md

Short map for anyone changing this repository. Detailed explanation lives in
[docs/architecture/README.md](docs/architecture/README.md).

## Layout

```text
apps/desktop/     Tauri 2 + React desktop client (its own Cargo project)
apps/android/     Kotlin/Compose Android control client
crates/server/    the control plane — the only Cargo workspace member
docs/             architecture/ protocol/ development/ releases/
scripts/          repository-level build and release scripts
tests/            local-only integration tests (ignored, not distributed)
```

Inside `crates/server/src/`, dependencies point one way only:
`domain/` → `storage/` → `orchestration/` → `api/`, with `transport/`,
`gateway/` and `ax/` as the communication and AX-adapter boundaries, and
`auth/`, `config/`, `error.rs`, `app.rs` as cross-cutting support.

## Where a change goes

| Changing… | Edit |
|---|---|
| An endpoint, its request or its response | `api/<resource>.rs` (+ `api/mod.rs` for a new route) |
| Composer input, attachments, prompt assembly | `api/composer.rs` |
| A persisted concept or the schedule maths | `domain/` |
| The schema, a query or a migration | `storage/schema.sql`, `storage/migrations.rs`, `storage/repositories/<aggregate>.rs` |
| Task dispatch, automations, approvals, crew rules | `orchestration/` |
| How AX is reached (local ACP or remote) | `transport/` |
| The device WebSocket or its handshake | `gateway/` |
| Reading AX's own local store | `ax/` |
| Startup flags, tokens, error shape, shared state | `config/`, `auth/`, `error.rs`, `app.rs` |
| The desktop UI | `apps/desktop/src/` |
| The phone UI | `apps/android/app/src/main/java/com/axcrew/android/` |

`main.rs` stays thin: config, `App` construction, scheduler loops, router, serve.
Do not add handlers or business logic to it.

## Must stay true

- Zero behaviour change unless the task says otherwise: no REST, protocol,
  database-format or configuration breaking changes.
- `api/` handlers never run SQL, never schedule and never open a transport.
- SQL against Crew's own database lives only in `storage/`. `ax/` is the only other
  `rusqlite` user and it opens AX's own store read-only. Domain models never depend
  on SQLite.
- Desktop and Android reach the server through the API only.
- No `utils`/`common`/`helpers` modules.

## Update alongside the code

| If you touch… | Also update |
|---|---|
| A module's responsibility or the layering | `docs/architecture/README.md` |
| REST / WebSocket / ACP contracts | `docs/protocol/README.md`, root `README.md` |
| Build, test or packaging commands | `docs/development/README.md`, `scripts/` |
| A user-visible feature | `README.md` and the matching `apps/*/README.md` |
| The schema or a state machine | `docs/architecture/design.md` |
| A version number | every manifest listed in [../RELEASE_WORKFLOW.md](../RELEASE_WORKFLOW.md) |

## Verify before finishing

```text
cargo fmt --check
cargo check --workspace
cargo clippy --workspace --all-targets
cargo test --workspace
```

Then the desktop (`apps/desktop`: `npm run build`) and Android build.
When the local-only test harness is present, also run its desktop interaction
tests (`npm run test:ui`) and process-level tests in `tests/`. Standalone tests,
test-runner configuration and work logs are not distributed in this repository.
