# AX and AXCrew runtime boundary

**English** | [简体中文](design.zh-CN.md)

AXCrew coordinates work and presents its results. AX remains the agent runtime
that owns model calls, tools, permissions, sessions, memory and execution. The
two projects communicate through ACP; AXCrew does not interpret model output or
replicate AX's session, memory or credential stores.

## Responsibilities

| Component | Owns |
|---|---|
| AX | Agent loop, provider selection, tool execution, permissions, session history and local Goal execution. |
| AXCrew server | Device pairing, task/workflow scheduling, durable coordination state, REST/WebSocket APIs and remote transport. |
| Desktop and Android clients | User interaction through the AXCrew REST/WebSocket API. They do not link to server internals. |

AXCrew persists coordination data such as task inputs and results, workflow
checkpoints, event metadata and explicitly published artifacts. AX remains the
source of truth for its session transcript and provider credentials. Crew
workflow checkpoints can store AX Goal state for distributed recovery; they do
not create another AX runtime or session database.

## Execution path

The server validates requests and delegates business operations through its
`api/` and `orchestration/` layers. The scheduler assigns ready tasks to eligible
AX workers over the local ACP process or authenticated remote gateway. Workers
execute through AX and return events and results. Crew persists coordination
state and fences stale worker reports before publishing them.

AX questions, cancellation, permissions and session continuation retain AX's
execution semantics. Crew stores the waiting/task state required to route a
response or resume the same task; it does not synthesize an agent answer.

## Canonical references

- [Architecture](README.md) describes server modules and dependency boundaries.
- [Distributed collaboration](../distributed-collaboration.md) documents
  workflows, recovery, placement and operational limits.
- [Protocol](../protocol/README.md) and [API](../protocol/api.md) define the
  ACP, REST and WebSocket contracts.
- [Storage](storage.md) describes the database and durability boundaries.
- [Android platform mapping](android-migration.md) documents client-specific
  capabilities and limits.


## Local desktop browser transport

For local desktop AX execution, Crew injects a per-launch loopback endpoint and
secret into trusted AX/ACP processes. AX keeps the existing BrowserTool registry,
HostPermissionStore, task policy and execution loop. The desktop bridge owns only
fixed operations on its real sidebar child WebViews, not model decisions. It
returns bounded, untrusted page data through one-use nonce title results and
never grants remote pages Tauri IPC. SSH and paired remote AX do not receive this
local transport, and user-code subprocesses do not inherit its credentials.

Windows Agent-controlled pages require native all-source request filtering and
CDP response enforcement before navigation; setup failure and unsupported
platforms fail closed. Normal user previews remain separate from the controlled
network mode. Cookie profiles are reused, while page routing uses actual AX
Session IDs. See [desktop browser behavior](../desktop/README.md#web-preview-and-compact-change-review)
for adoption/reload, lifecycle, free-browse controls and capability limitations.
