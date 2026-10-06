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

Member fields: `device_id` is `local` a paired device ID, or a saved SSH device ID; `cwd` is an
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

- `POST /api/sessions` creates a conversation; `POST /api/sessions/{task_id}/message`
  appends a follow-up. Both accept optional `reasoning_effort` with the selected
  provider's advertised wire value. It is saved in task input and forwarded to AX
  for that turn; omitted values retain existing default behavior.
- Model capability catalogues expose each model's `reasoning_efforts` and
  `default_reasoning_effort`. Desktop clients must use that subset rather than
  synthesizing universal effort levels; empty or missing values offer no slider.

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

## Distributed API (additive)

`/api/distributed` exposes scoped worker credentials, durable Tasks/Events/Workflows, lease fencing and immutable artifact exchange. It is separate from legacy device pairing and task APIs. See the canonical [Distributed Collaboration REST contract](../distributed-collaboration.md#rest-contract); existing authentication/error/route contracts are unchanged.


## Connections, workspaces and projects

All routes below require the existing administrator authentication.

| Method and route | Contract |
|---|---|
| GET /api/connections/ssh | Active saved hosts: id, name, host, port, identity_file; optional fields are null. |
| GET /api/connections/ssh/discover | Concrete Host aliases from the gateway user primary SSH config; wildcard aliases excluded. |
| POST /api/connections/ssh | Save name, host, optional port and identity_file. Host is host or user@host, port 1..65535. Returns a generated ssh: ID, initially offline. |
| POST /api/connections/ssh/{id}/connect | Probe SSH remote directory without AX; mark online on success, offline on failure. |
| GET /api/devices/{id}/workspace?cwd=... | Host-side read-only listing: cwd, parent and directories of name/path. Omitted cwd starts at user home. |
| GET /api/projects | Persisted id, name, device_id, cwd and member_id entries. |
| POST /api/projects | Validate name, device_id and cwd on the owning host; create/reuse a bound environment. |
| DELETE /api/projects/{id} | Remove project label, retain members and sessions. |
| POST /api/environments/{id}/model | provider/model creates or reuses an immutable member with identical device/cwd/policy/capabilities; returns that member. |

SSH records store an identity-file path on the Crew gateway, never private key
contents. The existing device revoke route removes a host from active choices.
For SSH, model/skill/capability inspection and history use local AX; remote folders are listed through SSH shell commands.
Remote session creation uses member_id instead of a local cwd; follow-ups stay
bound to their initial environment. Paired-device history failures never fall back to the local store. SSH history belongs to the local AX store.

For paired AX, omitted cwd returns registered roots with empty cwd, null parent
and hint registered_workspaces. Only an exact registered root may be validated;
its result disables navigation to parents/subdirectories. Heartbeat
capabilities.workspaces advertises id/name/path roots. Older devices fall back
to existing Crew member roots.

SSH execution contexts are passed to local AX via AX_SSH_CONTEXT_FILE, pointing to a short-lived
JSON manifest of hosts, default_host and remote cwd. A file avoids environment
block limits for large catalogues. AX_SSH_CONTEXT JSON remains supported for
standalone integrations. No remote AX process is launched. The ssh
tool accepts action list or exec, optional host_id/cwd/timeout_seconds and a
remote command. Private key paths are never exposed by its host list.
SSH tasks bypass configured Crew global/member concurrency limits; independent
SSH tools bypass the fixed local tool pool, retaining dependency/resource and
permission checks. Local and paired AX limits are unchanged.
