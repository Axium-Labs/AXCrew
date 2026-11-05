# Storage

**English** | [简体中文](storage.zh-CN.md)

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

Subagent envelopes also stay live: their titles, tasks, summaries, errors and
nested text/tool content are excluded from the event index. Only execution and
parent IDs, child-session identity, lifecycle status and nested update kind are
retained. Detailed child history is replayed through AX's parent session store.

## Source of truth

AX's own installation/home store remains the source of truth for session
conversation and memory. Standalone AX defaults to `<install-dir>/.ax`; Crew
passes `AX_HOME` (default `~/.ax`) to its local runtime. See
[AX storage](https://github.com/Axium-Labs/AX/blob/main/docs/storage.md) for project
subdirectories, legacy stores and explicit overrides. ACP session IDs are exactly AX session IDs; Crew
stores only the binding. Provider credentials stay under AX's home and never
reach Crew's database.

## Schema and migrations

The authoritative table definitions are in
[`schema.sql`](../../crates/server/src/storage/schema.sql); database opening and
normalization live in [`migrations.rs`](../../crates/server/src/storage/migrations.rs).
Foreign keys are on; dependency and state updates are transactional. Opening a
database applies the idempotent schema and normalizes interrupted task states
back to `ready`; SSH devices are marked offline until probed again. The schema
records its version in `PRAGMA user_version`. Chat-channel secrets use separate
protected sidecar storage; see [chat channels](../chat-channels.md).
