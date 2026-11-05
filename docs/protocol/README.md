# Protocol

**English** | [简体中文](README.zh-CN.md)

The protocol is defined in the canonical documents below. This page exists to point at
them instead of restating them, so the contract cannot drift out of sync.

Optional Goal durability uses the existing fenced Workflow checkpoint contract
with a reserved `ax_goal_runtime` state key; see the distributed document below.
Desktop `ax_goal_settings` invokes AX's own `goal-settings` CLI and does not add
a REST/Android settings API. Host-bound ACP imports are an AX worker adapter seam,
not a user-supplied remote Session ownership override.

| Contract | Canonical description | Implementation |
|---|---|---|
| Distributed Tasks, Workflow State, Events, Artifacts and worker leases | [distributed-collaboration.md](../distributed-collaboration.md) | `api/distributed.rs`, `orchestration/distributed.rs` |
| Crew REST API and `CrewEvent` WebSocket stream | [api.md](api.md) | `crates/server/src/api/` |
| ACP (JSON-RPC 2.0 over stdio and the routed gateway envelope) | [api.md](api.md) and [runtime boundary](../architecture/design.md) | `crates/server/src/transport/` |
| Device gateway handshake and heartbeats | [api.md](api.md) and [distributed collaboration](../distributed-collaboration.md) | `crates/server/src/gateway/` |

## Compatibility commitments

These are treated as contracts, not implementation details:

- **REST**: preserve existing supported routes and field types when extending the
  API. Experimental removed surfaces are not supported endpoints; use the current
  [API reference](api.md). Additive optional fields preserve existing callers.
- **WebSocket events**: the `event_id`, `kind`, `task_id` and `payload` envelope
  is stable. The `payload.sessionUpdate` values (`agent_message_chunk`,
  `agent_thought_chunk`, `agent_question`, `tool_call`, `tool_call_update`, `turn_changes`) are
  shared with the ACP adapter.
- **Subagent activity**: additive `payload.sessionUpdate: "subagent"` is
  broadcast as `kind: "subagent.update"` inside the bound parent task/session.
  It carries stable `agentId`, optional `parentAgentId`, `title`/`task`,
  `childSessionId`, `status` (`running`, `completed`, `failed`, `cancelled`),
  optional `summary`/`error`, and optional nested ACP `update` for child text,
  tool calls/results or model connection status. Nested content is never
  appended to the parent task's assistant output. The durable Crew event index
  retains IDs, status and nested update kind only; replayed child content comes
  from the existing authenticated parent `session/load` history, owned by AX.
- **Model connection updates**: additive `payload.sessionUpdate: "model_connection"`
  carries `status` (`connecting`, `retrying`, `connected`, `failed`), 1-based
  `attempt`, `maxAttempts` (at most 5) and optional `error`. These frames remain
  live status rather than assistant messages. A terminal failed frame is retained
  as optional `output.model_connection` on the failed task and its final event,
  so clients can restore the specific failure after reconnecting. The task state
  machine and REST routes are unchanged.
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

## Related contracts

- [Distributed collaboration](../distributed-collaboration.md) owns enrollment,
  capabilities, Workflow checkpoints, placement, instance/Host removal, CAS
  editing, native management and Session routing. Keep endpoint and lifecycle
  details there rather than duplicating them in this index.
- [API](api.md#connections-workspaces-and-projects) owns connection, project,
  workspace and local-history endpoints. SSH uses local AX inference/history
  with a remote shell context.
- [Desktop settings](../desktop/README.md) owns Tauri-only configuration commands,
  including Goal and scoped delegation settings; these are not Android REST APIs.
- [Chat channels](../chat-channels.md) owns channel transport, peer authorization,
  project/session commands and menu lifetime. Management endpoints are listed in
  [API](api.md#chat-channel-management).
