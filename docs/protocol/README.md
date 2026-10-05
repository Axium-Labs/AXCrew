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

These are treated as contracts, not implementation details:

- **REST**: no route is removed or renamed, and no request or response field is
  removed or retyped. Additive optional fields are allowed.
- **WebSocket events**: the `event_id`, `kind`, `task_id` and `payload` envelope
  is stable. The `payload.sessionUpdate` values (`agent_message_chunk`,
  `agent_thought_chunk`, `tool_call`, `tool_call_update`, `turn_changes`) are
  shared with the ACP adapter.
- **ACP**: line-delimited JSON-RPC 2.0 with `initialize`, `session/new`,
  `session/load`, `session/resume`, `session/prompt`, `session/cancel`, the
  permission response, and the read-only `_ax/*` catalogue extensions.
- **Database**: the SQLite file format is unchanged. `schema.sql` is idempotent,
  so an existing database opens without a conversion step.

Any change to one of these needs a matching update to the documents above and to
the process-level tests in [`tests/`](../../tests/).
