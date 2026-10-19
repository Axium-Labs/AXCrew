# Protocol

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
  `agent_thought_chunk`, `agent_question`, `tool_call`, `tool_call_update`, `turn_changes`) are
  shared with the ACP adapter.
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

Distributed enrollment now allows omitted resource and capability fields. Worker
heartbeats can add `host_inventory` and active `capabilities`; connected instance
settings are staged through `POST /api/distributed/instances/{id}/capabilities`.
Existing callers remain compatible; details and unknown hardware semantics are in
[Distributed Collaboration](../distributed-collaboration.md).


Connections/projects are additive authenticated REST resources documented in
[api.md](api.md). Local and paired AX directory inspection use its read-only workspace extension.

Local AX history can be continued through the existing attach/message API.
The local index resolves placeholder titles from the first user request while
preserving AX's stored data; see the session endpoints in [api.md](api.md).
SSH directory inspection uses remote shell commands; inference/history run in
local AX with an SSH context. Heartbeats optionally advertise registered roots;
existing gateway envelopes and session bindings are unchanged.


The collaboration workbench extends the existing distributed aggregate with
serde-defaulted Workflow policy, reported Attempt Session chains, execution
inbox commands and opt-in instance native-management commands. No new Session
store, Goal ledger, scheduler or SQL table is introduced. The collaboration
orchestration module handles CAS scope policy, whole-Workflow control,
reassignment and partial batch results; the API only authenticates and delegates.
AX retains ACP execution, settings validation, approvals and native Long Project
history. See [workbench scope and command contracts](../distributed-collaboration.md).


Distributed instance deregistration is admin-only `DELETE /api/distributed/instances/{id}`.
The existing aggregate retains credential-free `removed_instances` metadata for history;
active-task/pinned-task, unfinished explicit Workflow membership and executing native
management checks run in the orchestration transaction. The response is `{accepted:true}`,
including a repeated deletion of an archived ID. Workers lose authentication; Tasks,
Sessions, Events and artifact histories are retained. See the distributed contract.


Distributed collaboration now creates actual multi-AX work through a three-step
plan form and one atomic Task/Workflow transaction. Native worker model catalogs
feed searchable execution selections; each Attempt freezes its Provider/Model
and duty. Matching previews share scheduler predicates and pending Tasks display
reasons. Member removal fences only its Workflow; new-member work can save in the
same policy transaction. Latest-Session routing and read-only Session history
retain rotation and migration associations. Resource minimums reserve scheduler
capacity; system resource limits are explicitly unsupported. See
[distributed contracts](../distributed-collaboration.md).


Distributed workflow settings optionally accept `title` and `objective` with the
existing revision CAS. Admin-only `POST /api/distributed/tasks/{id}/edit` compares
generation and original title/input before editing or soft removal. Started task
input is immutable; removal fences ownership and preserves history. See the
[editing contract](../distributed-collaboration.md#editing-an-existing-collaboration).


Distributed admin lifecycle endpoints add `DELETE /api/distributed/hosts/{id}`
(no body) and `DELETE /api/distributed/workflows/{id}` (`expected_revision`).
They return `accepted: true` only after transactional reference/CAS validation.
Host inventory is retained in `removed_hosts`; soft-removed Workflows expose
`removed: true` and cannot execute or accept edits/new work. Both fields default
on older persisted state. See [lifecycle details](../distributed-collaboration.md).

Chat platforms use outbound provider protocols, local stdio companions or Microsoft-authenticated Teams HTTPS ingress and reuse existing session/approval payloads; desktop-only management is under `/api/channels`. Native phone credentials retain their LAN capability restrictions and revoked/expired credentials close event streams. The experimental `/api/direct` and `/api/remote` surfaces have been removed. The channel `cwd` remains a string and may now be empty (no default project). Peer-scoped `/projects`, `/project`, `/new`, `/sessions` and `/session` commands select local workspaces and retained conversations through the existing session APIs. See [chat channel contract](../chat-channels.md).
