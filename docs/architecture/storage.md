# Storage

Crew keeps its own SQLite WAL database, separate from AX. It stores orchestration metadata and final task results. Optional distributed
collaboration additionally stores selected workflow checkpoints, observations and
Artifact bytes, including explicitly published logs/transcripts. Complete AX
session and memory stores are not replicated; provider credentials stay local.

## What is stored

- Devices (identity, public key, status, capabilities) and hashed pairing codes
- Crews and members
- Tasks, dependencies, runs and session bindings
- A redacted event index
- Automations and automation runs
- Application settings
- Optional distributed cluster state, workflow checkpoints and artifact blobs

A task's final output is kept as its result. Message deltas, tool arguments and
permission inputs are broadcast live over the event stream but excluded from
the durable payload.

## Source of truth

AX's own project `.ax` directory remains the source of truth for session
conversation and memory. ACP session IDs are exactly AX session IDs; Crew
stores only the binding. Provider credentials stay under AX's home and never
reach Crew's database.

## Schema and migrations

The full schema (`devices`, `pairings`, `crews`, `crew_members`, `tasks`,
`task_dependencies`, `task_runs`, `session_bindings`, `events`, `automations`,
`automation_runs`, `client_pairings`, `client_authorizations`,
`app_settings`, `distributed_cluster`, `distributed_blobs`) and the state machines are documented in
[design.md](design.md). Foreign keys are on; dependency and state updates are
transactional; the migration version lives in `PRAGMA user_version`.
`schema.sql` is idempotent, so an existing database opens without a conversion
step.
