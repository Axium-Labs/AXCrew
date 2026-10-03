# REST & WebSocket API

The Crew control plane exposes a REST API for management and a WebSocket
stream for live events. Every route below is implemented in
`crates/server/src/api/`; the protocol compatibility commitments are listed in
[README.md](README.md).

## Authentication

- All REST query/control routes and `/api/ws` require
  `Authorization: Bearer <token>` when `AX_CREW_ADMIN_TOKEN` is set. Set the
  token whenever the API is reachable beyond the local machine, including
  through a reverse proxy.
- Pair-code redemption and the device gateway are public endpoints, protected
  by the one-time code and the Ed25519 challenge respectively. Device private
  keys never enter Crew's database.

## Crews and members

- `POST /api/crews` — create a Crew.
- `POST /api/crews/{id}/members` — add a member to a Crew.

Member fields: `device_id` is `local` or a paired device ID; `cwd` is an
absolute path **on that device**. `provider` and `model` select models already
configured in that device's AX installation. `skills` and `mcp_servers` are
arrays of locally installed/configured names. `permission_profile` is `ask`
(default), `allow`, or `deny`. `max_concurrency` defaults to 1.

## Tasks

- `POST /api/tasks` — create a task with `crew_id`, `title`,
  `assigned_member`, `input`, and optional `dependencies`, `priority`,
  `parent_id`, `description`. Dependencies must already exist in the same
  Crew, so the create-only graph is acyclic by construction.
- `POST /api/tasks/{id}/start` — start a root task. Dependent tasks become
  ready and run automatically after all predecessors complete.
- `POST /api/tasks/{id}/retry` — reset a failed or cancelled task. Failed or
  cancelled dependencies fail descendants until retried or explicitly
  cancelled.
- `POST /api/tasks/{id}/cancel` — interrupt active work.

`input` may be a plain prompt string or
`{"prompt":"...","include_dependencies":true}`. The latter adds the completed
predecessors' final outputs to the AX prompt in a deterministic order. Crew
does not generate or revise the DAG with a model.

## Sessions and devices

- `GET /api/tasks`, `/api/tasks/{id}`, `/api/sessions` and
  `/api/sessions/{task_id}` inspect state and AX session bindings.
- `GET /api/devices` lists devices; `POST /api/devices/{id}/rename` takes
  `{"name":"..."}`; `POST /api/devices/{id}/revoke` removes authorization.

## Live events and permissions

`GET /api/ws` streams live `CrewEvent` JSON. A tool approval produces
`permission.requested` with a `request_id`; resolve it with
`POST /api/permissions/{request_id}/resolve` and
`{"option_id":"allow_once"}` (also `allow_session` or `reject_once`).
Unanswered requests are denied after five minutes. When a task is cancelled,
an outstanding request is denied immediately.

The `payload.sessionUpdate` values (`agent_message_chunk`,
`agent_thought_chunk`, `tool_call`, `tool_call_update`, `turn_changes`) are
shared with the ACP adapter; the `event_id`, `kind`, `task_id` and `payload`
envelope is stable.

## Pairing and connection

Issue a one-time code on the machine running Crew (with the admin token):

```powershell
$headers = @{ Authorization = "Bearer $env:AX_CREW_ADMIN_TOKEN" }
$pair = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8765/api/pairing' -Headers $headers
$pair.code
```

On the machine to connect, using its own AX build and locally configured model
credentials:

```powershell
ax crew pair <code> --gateway https://crew.example.com
ax crew connect https://crew.example.com
```

`ax crew connect` reconnects automatically. Use `http://127.0.0.1:8765` only
for a same-machine test. Device status is updated by signed authentication and
heartbeats; losing the socket marks the device offline. Active remote work
returns to `ready` and uses its bound AX Session when the device reconnects.
AX's interrupted-tool recovery marks unknown side effects instead of replaying
them.

## Storage boundary

Crew's WAL SQLite database holds devices, hashed pairing codes, Crews,
members, tasks, dependencies, runs, session bindings and a redacted event
index. A task's final output is kept as its result. Message deltas, tool
arguments and permission inputs are broadcast live but excluded from the
durable event payload. AX's own project `.ax` directory remains the source of
truth for session conversation and memory. See
[architecture/storage.md](../architecture/storage.md) for the schema and
durability rules.
