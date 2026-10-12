# Distributed Collaboration

Introduced in AXCrew 0.3.3 with AX 0.3.7, alongside existing Crew/Task/Session/device
control. Open the desktop sidebar **Distributed** (`/distributed`) to manage the
cluster. Existing routes, SQLite data and Android controls remain compatible;
the dedicated cluster management page is currently desktop-only.
The desktop provides three views: collaboration workspace, Host/AX nodes, and
cross-Goal execution activity. Advanced policy, raw checkpoints and recovery
identities are disclosed progressively inside the relevant collaboration.

## Model and boundaries

`Host → AX Instance → Execution` allows both one Host with several AX instances
and one AX participating in multiple Goals through isolated Sessions. Session
isolation alone does not imply concurrency: the worker runs independent ACP
processes up to its explicitly approved execution limit (default one), subject
to shared Host reservations. Local AX Subagents/Sessions/Tasks
retain their existing identity and runtime. The new distributed Task is a durable
work specification, ownership record and attempt history in AXCrew.

AXCrew owns assignment, ownership, placement, retry, cancellation and failover.
AX decides what assistance it needs and performs reasoning and local execution.
Workers use outbound REST polling; AX instances never require direct peer links
or a permanently live Coordinator Agent.

```text
Task decomposition → capability scheduling → cross-machine execution
→ Event / Artifact return → state persistence
→ failure recovery / replanning → continued execution
```

Code follows existing layers: `domain/distributed.rs` defines the aggregate;
`storage/repositories/distributed.rs` owns SQLite transactions/blob access;
`orchestration/distributed.rs` owns policy and state transitions;
`api/distributed.rs` authenticates, validates transport input and shapes responses.
`main.rs` starts a two-second reconciler. AX's CLI worker executes assignments
through the existing ACP adapter, without moving model inference into Crew.

## Durable state

### Optional AX Goal checkpoints

AX's worker now binds explicit Goals to the existing Durable Task ID and writes
`Workflow.state.ax_goal_runtime[task_id]`. This contains AX's existing TaskQueue,
cumulative Runtime consumption/reservations and bounded Message receipts. The
ordinary Workflow checkpoint endpoint/CAS and source lease, incarnation and
generation authorize every write; no Crew schema, scheduler or budget ledger is
added. Plain tasks omit these checkpoints. The existing 256 KiB Workflow limit
applies, and failure to checkpoint stops execution before advancing.

New owners import authoritative Goal state through host-bound ACP `session/new`
metadata, preserving consumption and verifier versions/bindings. Missing state,
unavailable/incompatible validators, unsafe interrupted checks, ordinary tool
effects or unmigrated local child workspaces prevent automatic execution until
reconciled. Workspace-relative policy paths are rebased; external paths are
rejected. Complete Session databases/workspaces are not automatically migrated.
Result submission remains fenced by the existing Durable Task owner/generation.

Worker configuration `resume_goals` defaults false: intentionally paused or
blocked Goals are retained without unattended resume. Interrupted running work
uses existing Crew failover; enabling resume does not reset caps or bypass effects
review. Legacy workflows retain their existing failed-attempt outcome. Workbench
workflows keep a paused/blocked AX Goal or pending question interactive in its
current ACP Session; the execution lease and slot remain reserved. Crew-level
pause fences the process and retains the latest authoritative checkpoint. Desktop Goal
settings edit templates for new Goals and do not alter running saved policy.
See AX's `docs/goal.md` for the receipt contract and Runtime boundaries.

Additive tables:

| Table | Purpose |
|---|---|
| `distributed_cluster` | One transactional JSON aggregate: Hosts, Instances, Tasks, attempts, Workflows, artifact metadata, ordered Events and report receipts |
| `distributed_blobs` | Immutable SHA-256-addressed artifact bytes |

Updates use SQLite IMMEDIATE transactions under the existing database mutex.
Ownership, attempt generation, resource reservations and Events commit together.
Instance credentials are stored as SHA-256 digests and removed from public views.
The aggregate is deliberately separate from legacy task/session/device tables.
Keep the SQLite database on durable storage; a process restart preserves state
and reconciles expired leases. This is one authoritative Crew process, not a
distributed multi-writer database or replicated consensus implementation.

Tasks progress `pending → running → completed / failed / cancelled`; operator
pause introduces `paused`, and resume returns it to eligible placement. Lost leases
finish the attempt and return the task to pending until its retry budget is
exhausted (default 3, accepted 1–20). Explicit retry adds three attempts without
rewriting the submission identity. Dependents of failed/cancelled tasks fail;
independent analysis/replanning tasks can consume their error summaries/artifacts.
Cancellation cascades through children. Attempt history and Events are retained.

Each running attempt has an AX owner, worker incarnation, generation and 90-second
lease. Heartbeats renew only live, matching attempts. Replacement increments the
generation; late results, expired renewals and old incarnations are rejected.
Repeated report message IDs must contain identical content. Child submission
identity is `(parent_task_id, request_id)`, independent of the parent attempt's
AX owner, so recovery reuses existing children. Root identity is scoped to creator.

Every root creates a Workflow; children inherit it. Workflow State is an explicit
JSON checkpoint (256 KiB maximum) with compare-and-swap revision. Assignment
includes the checkpoint, known workflow tasks/results and observations. Children
continue when the planning AX fails, and a replacement can replan from durable
state. Workflow is active while tasks are pending/running, and paused while its
collaboration policy suspends placement. Failed peers block completion even if
the root succeeded; terminal workflows otherwise resolve completed/cancelled. This does
not migrate full AX sessions or automatically serialize a model's hidden state.

## Placement and policy

Eligibility combines **AX Capability + Host Resource**:

- Every requested role, Skill, MCP, Tool, model, permission and environment tag
  must be advertised by the instance. The logical project must be approved.
- Optional `requirements.instance_id` pins an instance; otherwise Crew chooses.
- Host and AX must be enabled and seen within 30 seconds. A Host is maintained
  through its instance heartbeats; disabling a Host fences its work.
- Per-instance concurrency limits and shared Host CPU/RAM/GPU reservations must
  fit. Oldest eligible work is considered first, preferring less-busy instances.

Enrollment approves stable Host identity, project IDs, concurrency and
`can_delegate`. Resource/capability fields remain optional for legacy API clients,
but the desktop enrollment form does not contain them. New Hosts have no scheduling
capacity until an AX worker reports detected hardware. Reports contain hostname,
OS/architecture, logical CPU count/name, physical RAM MiB, PCI/display GPU count
and names, and errors. `Host.inventory_at` is a server timestamp; last-known
inventory survives Crew restart and offline status. Native detection runs in a
bounded background task every 60 seconds, outside the five-second lease loop.

The authenticated instance can report only its own Host through a valid incarnation.
All instances on that Host share the reported capacity; it is never summed.
Unknown RAM/GPU are null in inventory and conservatively zero in available scheduling
capacity. GPU detection includes integrated/display adapters, not just CUDA GPUs.
Resource reservations are requested task capacity, not measured utilization, OS
quotas or GPU device allocation. Refreshing capacity does not evict valid running
work; it controls new placement. The legacy admin resource endpoint is retained;
a subsequent worker inventory refresh replaces its capacity values.

After first connection, admin may stage `pending_capabilities` using the instance
capability endpoint. Active `capabilities` remain the last worker report and are
the only capabilities used by scheduling. The UI generates fields to merge into
local `worker.json`; install/enable dependencies on that Host and restart the worker.
A matching worker report clears pending state. Startup checks the pending policy
if present, otherwise the current policy, for model/Skill/MCP/profile. Capability
selections remain trusted local configuration, not hardware attestation or a
health check of every external service. Model credentials remain on the Host.

Workers get separate credentials scoped to the distributed API and approved
projects. Delegation requires `can_delegate`; child creation and checkpoints
require a live owning parent/source generation. A recovering owner can control
existing children. Worker credentials cannot administer Hosts or enroll peers or
access legacy admin APIs. Same-project workers can inspect task results/artifacts;
catalog metadata lists peer capabilities. Legacy open-loopback admin behavior
remains unchanged. For remote operation configure the existing admin bearer token
and a TLS reverse proxy; AX refuses non-loopback plain HTTP. Local runtime
permissions and sandbox restrictions continue to govern actual operations.

## Workspace and Artifact contracts

`project_id` is a logical identity (ASCII letters/digits, `_`, `-`, `.`, max128);
never send absolute machine paths as workspace identity. Each worker maps it to
a local source directory. Every execution uses an isolated clone/snapshot outside
that source. Optional `workspace_revision` pins a Git commit; Patch artifacts
transport uncommitted changes. Results never automatically overwrite another
worker or merge into the source checkout.

Artifacts are independent objects: ID, originating task/generation, project,
kind/name, SHA-256 digest and byte size. Content is immutable, hash-verified by AX,
limited to 8 MiB and accessed by reference. Uploads require a live lease and are
idempotent for the same task/generation/digest/kind/name. An interrupted upload
can leave an unreferenced blob. Task messages contain summaries and references;
artifact/report contents may be sensitive and are subject to project access.

## REST contract

All routes are additive under `/api/distributed`. Existing API error shape is
`{"error":"..."}` (validation/policy failures use the existing HTTP 400 behavior).
Enrollment/Host policy changes require the existing admin credential. Worker
mutations require its enrollment credential; read/submit/control/checkpoint also
allow admin where appropriate.

| Method / suffix | Request / response |
|---|---|
| GET `/` | Project-filtered durable snapshot plus `revision`, `server_time`; excludes credential hashes/receipts |
| GET `/catalog` | Hosts and AX capabilities/resources |
| GET `/events?after_sequence=0&limit=256` | Ordered events and next `cursor`; max1000 events |
| POST `/enroll` | `host_id, host_name, name, projects, max_executions, can_delegate`; optional legacy `resources, capabilities` → `instance, token` (token shown once) |
| POST `/instances/{id}/capabilities` | Capability string arrays (admin, after first connection) → pending local settings; does not immediately change scheduling |
| POST `/tasks` | `request_id, title, input, project_id`, optional `context_summary, workspace_revision, workflow_id, requirements, dependencies, artifacts, parent_id, parent_generation, max_attempts, collaboration` → Task |
| GET `/tasks/{id}` | `task, workflow, observations, cursor`; event cursor query supported |
| POST `/tasks/{id}/{cancel|retry|pause|resume}` | Central task control |
| GET `/workflows/{id}` | Workflow and participating tasks |
| POST `/workflows/{id}/checkpoint` | `expected_revision, state`, worker also supplies source lease Report → Workflow |
| GET `/worker/identity` | Authenticated `instance_id`, before worker start mutation |
| POST `/worker/start` | `incarnation` → authenticated `instance_id`; replaces old epoch |
| POST `/worker/heartbeat` | `incarnation, active:[{task_id,generation}]`, optional `host_inventory, capabilities` → new/unacknowledged `assignments`, all owned `leases`, `server_time` |
| POST `/worker/report` | `incarnation, task_id, generation, message_id, kind, text, artifacts`; kind `completed`, `failed`, `observation`, `session` or `activity` |
| POST `/{hosts|instances}/{id}/enabled` | `enabled` (admin) |
| POST `/hosts/{id}/resources` | `cpu, ram_mb, gpu` (admin) |
| POST `/artifacts` | Source lease identity, `kind, name, content_base64` → Artifact |
| GET `/artifacts/{id}` | `artifact, content_base64` after project access check |

Requirements contain `capabilities` (string arrays by category), `resources`
(`cpu`, `ram_mb`, `gpu`) and optional `instance_id`. Task input and summary are
bounded (256 KiB combined); CPU defaults to one. Use a new request ID for a new logical
step; retries of the same request must have the same content. Heartbeat responses
omit already acknowledged task payloads. Observations remain in the ordered
durable Event stream; reads/polls support delayed/disconnected clients.

## Desktop and operational limits

The workspace organizes existing Workflows as ordinary collaborative tasks or
explicit AX Goals. Create tasks, add peer work to a Workflow, specify dependencies,
choose automatic/manual placement, assign participant roles, inspect the common
feed, and enter an individual live Session. Participant roles enter the existing
AX task context. Whole-Workflow controls include all peers, including tasks that
are not descendants of the root. Reassignment fences the previous attempt,
retains original request idempotency, and schedules the next generation from the
existing checkpoint and resource policy.

Nodes group AX instances under their Host, showing measured CPU/RAM, available
GPU/VRAM readings, disks and sampled network throughput. Inventory refresh is
every 60 seconds; unknown fields remain unknown and stale offline readings are
last known values. Capacity reservations are distinct from measured utilization.
Expand an AX for current work/Goal/Session, active/pending capabilities and scoped
configuration. Activity filters Goal, AX, Host and task status, and shows each
Execution's Session chain, events/errors, checkpoints and downloadable artifacts.
Downloaded configs select an independent execution root and AX home per instance.
Paths/model credentials and capabilities still require correct local setup.

Recovery guarantees durable control-plane state and fenced result publication.
Executions are at least once: remote side effects need their own idempotency.
No automatic garbage collection, large-object store, replicated Crew HA,
network partition consensus or OS resource enforcement is included. Existing
single-machine and device features stay opt-in independent of the cluster.

Validation includes durable scheduling/fencing/CAS regression tests, desktop UI
tests and a real three-AX-process/two-logical-Host scenario with a fake model:
failed test → log analysis → Patch → retest, scoped auth, event cursor and Crew
restart. This simulates Hosts on one computer; physical networking/GPU isolation
has not been validated by that test. See [development](development/README.md)
and [AX worker setup](../../ax/docs/distributed-collaboration.md).

The current snapshot endpoint and transactional aggregate retain complete cluster metadata history. They target small clusters; histories/receipts grow without automatic pruning and large-scale deployments need storage/pagination extensions.


## Workbench policy, Session control and native settings

All additions below reuse `distributed_cluster`; there is no second Goal, node,
Session database or scheduler. `orchestration/collaboration.rs` handles scoped
operator policies and inbox commands; AX's `distributed_session` bridges the
existing ACP stream, and `distributed_settings` invokes existing native CLI
settings/capability operations on the target host.

`Workflow.collaboration` has `kind` (`goal`/`task`; legacy default empty), `paused`,
`participants` (AX ID to role; empty means automatic), and capability
`requirements`. Root submissions save policy atomically before placement;
only admins may set it. The policy restricts eligible AX and never mutates host
permissions, installed capabilities or settings of active executions. Each task
retains its own requirements, dependencies, attempt history and immutable
submission digest. AX Instances can participate in several Workflows.

Configuration scopes:

- Crew application/device settings continue through the existing settings UI.
- AX Instance global/project native settings affect all future executions using
  that target home/project. Writes require explicit scope confirmation and no
  active executions. Pending native writes block new placement while executing.
- Goal batch policy changes only that Workflow's participant range and required
  capabilities. Existing AX Goal policy/budget remains frozen in its checkpoint.
- Session guidance, native Long Project edits and one-request approvals target
  the recorded Session of one current execution generation. They cannot grant
  a persistent permission or weaken a host Sandbox.

Additional admin routes (existing admin authentication and error shape):

| POST suffix | Contract |
|---|---|
| `/workflows/{id}/settings` | `expected_revision, kind, participants, requirements`; CAS policy, preserves checkpoint state |
| `/workflows/{id}/control/{pause|resume|cancel|retry}` | Controls all Workflow tasks and retains checkpoints/usage |
| `/tasks/{id}/reassign` | `generation, instance_id` (null = automatic); fences old execution |
| `/tasks/{id}/commands` | `generation, session_id, kind, text, request_id?`; live recorded Session only |
| `/batch` | `instance_ids, confirm_instance_scope:true`, exactly one of `capabilities`/`enabled`; per-node accepted/error, partial failures retained |
| `/instances/{id}/manage` | `action, scope:global|project, project_id?, input, confirm_instance_scope`; target opt-in required |

Session command kinds are `prompt`, `answer`, `permission`, `project_read`,
`project_history`, `project_import`, `project_config`, and `rotate`. Guidance during
an active turn uses AX `_ax/steer`, not another concurrent turn. `answer` uses the
actual pending question ID plus text/option ID. `permission` requires an actual
AX request ID and `allow_once`/`reject_once`; stale choices fail individually.
Unanswered permission requests expire after 90 seconds. Native project commands
wait for an idle turn boundary; import uses a fixed execution-local input path,
configuration requires AX Goal paused/blocked/created, and rotation uses the
existing native safe-boundary transition. Commands have pending/executing/final
outcomes; expiration or ownership loss fences unprocessed commands.

Worker-only routes use the existing credential and incarnation/generation lease:
`POST /worker/inbox` takes a Report; `POST /worker/commands/{id}` takes
`source, status:executing|completed|failed, result`. Worker reports `session`
with actual `session_id` (including successors) and `activity` with bounded ACP
updates/permission metadata. Attempts record Session chains without copying the
AX-owned raw Session store. Large live details are truncated; published artifacts
and local AX history retain the full available receipts.

Remote native management is explicitly off by default. A worker must set
`remote_management:true` and an independent `ax_home` before the admin can use it.
`POST /worker/manage` takes `incarnation, enabled, completed:[{id,status,result}]`,
claims commands and returns their per-operation outcomes. Supported actions:
`settings.read/write` (existing subagent limits), `goal.read/write` (native Goal
defaults), `personalize.read/write`, and `plugins.list/enable/disable/import`.
Plugin types are skills/mcp/agents/mods; import requires a validated name and
source within an approved local project. Personalization includes Memory/style
switches, project-contained writing samples, and custom instructions with the
native expected-content conflict check. Inputs use a short-lived target-local
file, removed on success or failure. Slow native commands run outside the lease
loop. Writes are never automatically retried after worker incarnation changes;
inspect target settings before retrying uncertain outcomes.

Native subagent settings also support multi-AX batches: read each target first,
preview actual before/after values, confirm global or project scope, then submit
individual native writes. Unreadable nodes are skipped with their failure reason;
completed/failed outcomes remain in the same durable management inbox.

Capability batch configuration remains staged: each result distinguishes
accepted policy from actual worker-reported activation. Preview each node's
before/after fields and confirm AX-wide scope. Capability import accepts only
known string arrays; export omits tokens, credential/provider files and Memory.
Native output also removes credential-bearing fields. Enrollment's one-time
private `worker.json` is a separate connection credential and is explicitly
marked private; never use it as a shareable configuration export.

## Optional Long Project inside a Goal

Long Project is off by default and appears inline only for an enabled Goal.
Creation supports a custom template and automatic rotation. AX continues to own
`PROJECT_STATE.md`, archive history, context pressure and Session rotation;
`state.ax_goal_runtime[task_id].long_project_document` is its bounded projection.
View/export/edit the current document, search native archives, inspect historical
Session links, configure at a paused AX turn boundary, or request native rotation.
Native document/config changes immediately use the same fenced Workflow checkpoint
CAS as runtime turns. Editing prose does not authorize task completion or reset
budget. All historic Sessions share the same Goal/task state and accumulated
usage; recovery retains the existing effects-reconciliation restrictions.

The dedicated workbench is desktop-only; existing Android build/control and old
API clients remain compatible. Logical Host scenarios on one test computer do
not establish physical-machine network or GPU-isolation guarantees.


For opt-in native management, new executions snapshot only approved source-project
Goal/subagent/capability policy and plugin definitions into the isolated checkout.
They never copy source Memory, Sessions, auth, permissions or Long Project stores.
AX home settings remain the global base. Active executions retain their existing
snapshot; already saved Goals retain policy from their authoritative checkpoint.
Automatic result patches exclude `.ax` and execution-input metadata so local
configuration, MCP credentials and runtime stores are not exported as code changes.
