# AX Crew Backend

AX Crew now also includes a native [Android control client](android/README.md) in `android/`.
It connects to the same computer-hosted Crew Gateway over HTTPS/WSS, with devices,
Crews/Agents, task submission and streaming, session history, and mobile permission
approval. See the [desktop-to-Android feature mapping](android/MIGRATION.md) for scope.
The desktop's **Settings → 连接与系统 → Android 控制客户端** panel shows the current
loopback upstream and temporary admin token for configuring your HTTPS reverse proxy.
The phone does not run AX or connect through SSH. Android development/build/install
and connection instructions are in [android/README.md](android/README.md).

AX Crew is a Rust control plane for the existing [AX](../ax) runtime. It schedules deterministic task DAGs across AX devices, maintains device identity and session bindings, and streams events. AX owns the agent loop, session history, memory, tools, skills, MCP, models, permissions, and credentials. See [DESIGN.md](DESIGN.md) for the source-based call-chain analysis and schema/state machines.

## Build and start

Build AX and Crew separately:

```powershell
cd C:\Users\14181\Desktop\axlab\ax
cargo build -p cli
cd C:\Users\14181\Desktop\axlab\ax_crew
cargo build
$env:AX_CREW_ADMIN_TOKEN = '<long-random-admin-token>'
.\target\debug\ax-crew.exe --ax C:\Users\14181\Desktop\axlab\ax\target\debug\ax.exe --database .\crew.sqlite3 --listen 127.0.0.1:8765
```

Crew binds loopback by default. A non-loopback bind requires `AX_CREW_ADMIN_TOKEN`. For PC B, expose the gateway through HTTPS/WSS with a TLS reverse proxy that forwards WebSocket upgrades to Crew. Set the admin token whenever the API is reachable beyond the local machine, including through a reverse proxy. All REST query/control routes and `/api/ws` require `Authorization: Bearer <token>` when set. Pair-code redemption and the device gateway are public endpoints protected by the one-time code and Ed25519 challenge respectively. Device private keys never enter Crew's database.

Issue a one-time code from PC A:

```powershell
$headers = @{ Authorization = "Bearer $env:AX_CREW_ADMIN_TOKEN" }
$pair = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8765/api/pairing' -Headers $headers
$pair.code
```

On PC B, using its own AX build and locally configured model credentials:

```powershell
ax crew pair <code> --gateway https://crew.example.com
ax crew connect https://crew.example.com
```

`ax crew connect` reconnects automatically. Use `http://127.0.0.1:8765` only for a same-machine test. Device status is updated by signed authentication and heartbeats; losing the socket marks it offline. Active remote work returns to `ready` and uses its bound AX Session when the device reconnects. AX's interrupted-tool recovery marks unknown side effects instead of replaying them.

## API and workflow

Create a Crew through `POST /api/crews`, then members through `POST /api/crews/{id}/members`. Member `device_id` is `local` or a paired device ID; `cwd` is an absolute path **on that device**. `provider` and `model` select models already configured in that device's AX installation. `skills` and `mcp_servers` are arrays of locally installed/configured names. `permission_profile` is `ask` (default), `allow`, or `deny`. `max_concurrency` defaults to 1.

Create tasks with `POST /api/tasks` using `crew_id`, `title`, `assigned_member`, `input`, and optional `dependencies`, `priority`, `parent_id`, `description`. Dependencies must already exist in the same Crew, so the create-only graph is acyclic by construction. Start a root task with `POST /api/tasks/{id}/start`. Dependent tasks become ready and run automatically after all predecessors complete. Failed or cancelled dependencies fail descendants; `POST /api/tasks/{id}/retry` resets a failed or cancelled task. `POST /api/tasks/{id}/cancel` interrupts active work.

`input` may be a plain prompt string or `{"prompt":"...","include_dependencies":true}`. The latter adds the completed predecessors' final outputs to the AX prompt in a deterministic order. Crew does not generate or revise the DAG with a model.

`GET /api/tasks`, `/api/tasks/{id}`, `/api/sessions`, and `/api/sessions/{task_id}` inspect state and AX session bindings. `GET /api/devices` lists devices; `POST /api/devices/{id}/rename` takes `{"name":"..."}`, and `/revoke` removes authorization. `GET /api/ws` streams live `CrewEvent` JSON. A tool approval produces `permission.requested` with `request_id`; resolve it with `POST /api/permissions/{request_id}/resolve` and `{"option_id":"allow_once"}` (also `allow_session` or `reject_once`). Unanswered requests are denied after five minutes. When cancelled, an outstanding request is denied immediately.

Crew's WAL SQLite database holds devices, hashed pairing codes, Crews, members, tasks, dependencies, runs, session bindings and a redacted event index. The task's final output is kept as its result. Message deltas, tool arguments and permission inputs are broadcast live but excluded from the durable event payload. AX's own project `.ax` directory remains the source of truth for session conversation and memory.

## Verification

The process-level smoke test uses a local fake model endpoint, two AX processes, and the Crew server; it does not call an external model:

```powershell
python tests/smoke.py C:\Users\14181\Desktop\axlab\ax\target\debug\ax.exe .\target\debug\ax-crew.exe
```

It covers ACP session setup, local-to-remote DAG execution, live event mapping, permission resolution, cancel/retry, disconnect/reconnect with the same AX Session, pairing, and revocation.
