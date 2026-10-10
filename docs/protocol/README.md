# Protocol

The protocol is defined in the canonical documents below. This page exists to point at
them instead of restating them, so the contract cannot drift out of sync.

| Contract | Canonical description | Implementation |
|---|---|---|
| Distributed Tasks, Workflow State, Events, Artifacts and worker leases | [distributed-collaboration.md](../distributed-collaboration.md) | `api/distributed.rs`, `orchestration/distributed.rs` |
| Crew REST API and `CrewEvent` WebSocket stream | [api.md](api.md) | `crates/server/src/api/` |
| ACP (JSON-RPC 2.0 over stdio and the routed gateway envelope) | [design.md, "Protocol framing"](../architecture/design.md) | `crates/server/src/transport/` |
| Device gateway handshake (Ed25519 challenge, heartbeats) | [design.md, "State machines"](../architecture/design.md) | `crates/server/src/gateway/` |

## Compatibility commitments

The desktop-only Tauri command `ax_subagent_settings` accepts `cwd`,
`scope` (`global` / `project`), optional `{max_depth, max_concurrent}` settings,
and an optional reset flag. It returns AX's validated effective values by
delegating to AX's current `settings --scope` command for both scopes. The
current scoped-settings/reset interface is required; there is no legacy
fallback or capability probe. This does not add a Crew REST/ACP method.
See [desktop delegation settings](../desktop/README.md#subagents).

These are treated as contracts, not implementation details:

- **REST**: no route is removed or renamed, and no request or response field is
  removed or retyped. Additive optional fields are allowed.
- **WebSocket events**: the `event_id`, `kind`, `task_id` and `payload` envelope
  is stable. The `payload.sessionUpdate` values (`agent_message_chunk`,
  `agent_thought_chunk`, `tool_call`, `tool_call_update`, `turn_changes`) are
  shared with the ACP adapter.
- **ACP**: line-delimited JSON-RPC 2.0 with `initialize`, `session/new`,
  `session/load`, `session/resume`, `session/prompt`, `session/cancel`, the
  permission response, the read-only `_ax/*` catalogue extensions and additive
  `_ax/steer` guidance for the active turn. Acceptance is acknowledged without
  cancelling the prompt; `user_message_chunk` includes `_ax.steering` and a
  stable message ID for replay.
- **Database**: the SQLite file format is unchanged. `schema.sql` is idempotent,
  so an existing database opens without a conversion step.

Any change to one of these needs a matching update to the documents above and to
the locally maintained process-level tests (not distributed in this repository).

Distributed enrollment now allows omitted resource and capability fields. Worker
heartbeats can add `host_inventory` and active `capabilities`; connected instance
settings are staged through `POST /api/distributed/instances/{id}/capabilities`.
Existing callers remain compatible; details and unknown hardware semantics are in
[Distributed Collaboration](../distributed-collaboration.md).


Connections/projects are additive authenticated REST resources documented in
[api.md](api.md). Local and paired AX directory inspection use its read-only workspace extension.
SSH directory inspection uses remote shell commands; inference/history run in
local AX with an SSH context. Heartbeats optionally advertise registered roots;
existing gateway envelopes and session bindings are unchanged.
