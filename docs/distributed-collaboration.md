# Distributed Collaboration

Introduced in AXCrew 0.3.3 with AX 0.3.7, alongside existing Crew/Task/Session/device
control. Open the desktop sidebar **Distributed** (`/distributed`) to manage the
cluster. Existing routes, SQLite data and Android controls remain compatible;
the dedicated cluster management page is currently desktop-only.
The desktop provides three views: collaboration workspace, Host/AX nodes, and
cross-Goal execution activity. Expandable requirements, configuration previews, tool details and history share
the app Disclosure control with keyboard interaction and retained form drafts.
Advanced policy, raw checkpoints and recovery
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

## Instance deregistration

Nodes provides a per-instance Delete action and explicit confirmation. This removes
Crew enrollment, not the AX installation or its local configuration, Memory,
Sessions or workspace. The existing aggregate stores credential-free disabled
metadata in serde-defaulted `removed_instances`, separate from active `instances`;
old snapshots load with an empty archive. Removed IDs are excluded from catalog,
scheduling, enrollment choices, online counts and worker authentication. A worker
must enroll again to reconnect, with a new identity/token.

Deletion runs atomically with backend checks: a nonterminal Task still owned by
or explicitly pinned to the instance, selected participation in an unfinished
Workflow, or an executing native command blocks it. Reassign/cancel those Tasks,
remove that explicit Workflow member, or wait for the management outcome first.
Pending native commands and undeliverable execution commands are failed visibly.
Tasks, attempts, Session chains, artifacts, Events, checkpoints and Host records
remain. Activity can filter removed AX as historical instances and preserves
Host → AX names; Goal/member history marks them deleted. Historical fixed placement
and participant policy are retained as history: before retrying such work, replace
its removed member/AX assignment. Other AX on the same Host remain unaffected.
Repeated deletion is idempotent; unknown IDs are rejected. Hosts without active AX
retain their inventory and display a compact no-instance message.

## Placement and policy

Eligibility combines **AX Capability + Host Resource**:

- Every requested capability category, Skill, MCP, Tool, model matching condition, permission and environment tag
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
| DELETE `/instances/{id}` | Admin-only deregistration; rejects unfinished assigned/pinned Tasks, unfinished selected Workflow membership and executing native management; revokes worker credential, archives metadata and retains all history; repeated deletion is accepted |
| POST `/{hosts|instances}/{id}/enabled` | `enabled` (admin) |
| POST `/hosts/{id}/resources` | `cpu, ram_mb, gpu` (admin) |
| POST `/artifacts` | Source lease identity, `kind, name, content_base64` → Artifact |
| GET `/artifacts/{id}` | `artifact, content_base64` after project access check |

Requirements contain `capabilities` (string arrays used only for matching), `resources`
(`cpu`, `ram_mb`, `gpu`) and optional `instance_id`, `host_id`, execution `model`
(`provider`, `model`), and task `duty`. `resource_limits` is rejected: this
release does not enforce operating-system quotas. Task input and summary are
bounded (256 KiB combined); CPU defaults to one. Use a new request ID for a new logical
step; retries of the same request must have the same content. Heartbeat responses
omit already acknowledged task payloads. Observations remain in the ordered
durable Event stream; reads/polls support delayed/disconnected clients.

## Desktop and operational limits

The desktop uses a compact console layout with a shared status overview above
Workspace / Nodes / Activity. Counts come from the current cluster snapshot:
online AX (enabled and seen within 30 seconds), running Tasks and active
collaborations, failed Tasks plus enabled offline AX, and pending Tasks awaiting
placement. Disabled AX are excluded from the offline issue count. Missing state
shows a reading indicator rather than zero counts; a failed refresh shows a sync
error alongside the retained snapshot.

Workspace navigation shows collaboration status and completion counts. The same
objective, work-task, member and recent-activity regions remain visible when there
are no collaborations, with compact contextual empty states. Objective text is a
bounded preview of the root input/Goal target; the full input remains in task
details. Nodes show configured execution slots (not guaranteed available capacity),
active Session counts from the last Session of each running attempt,
current/pinned/previously attempted collaborations and Tasks and capability tags before expansion.
Host inventory and measured metrics stay distinct from requested reservations.
All dropdowns in the distributed views and dialogs use the shared settings-style
Select, including project/AX placement, permissions, batch operation and native
management scope. The popup uses the app theme, keyboard navigation and selected
checks; Escape closes only the open popup before its containing dialog.
Activity provides counted secondary tabs, localized status filters and a clear
filters action; Execution/Session chains, recovery history and artifact downloads
continue to use the existing endpoints. The dark and light themes share the same
palette tokens; narrow windows stack the content regions.


The workspace organizes existing Workflows as ordinary collaborative tasks or
explicit AX Goals. Create tasks, add peer work to a Workflow, specify dependencies,
choose automatic/manual placement, assign participant work duties, inspect the common
feed, and enter an individual live Session. Work duties enter the existing
AX task context; capability tags never become role prompts. Whole-Workflow controls include all peers, including tasks that
are not descendants of the root. Reassignment fences the previous attempt,
retains original request idempotency, and schedules the next generation from the
existing checkpoint and resource policy.

Nodes group AX instances under their Host, showing measured CPU/RAM, available
GPU/VRAM readings, disks and sampled network throughput. Inventory refresh is
every 60 seconds; unknown fields remain unknown and stale offline readings are
last known values. Capacity reservations are distinct from measured utilization.
Expand an AX using its name or the right-hand disclosure button; both stay
synchronized and work for offline instances too. Inspect current work/Goal/Session,
active/pending capabilities and scoped
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
`participants` (AX ID to work duty; empty means automatic), capability
`requirements`, exact `member_models` (AX ID to Provider/Model), and
`excluded_instances` (excluded even during automatic placement). Root submissions save policy atomically before placement;
only admins may set it. The policy restricts eligible AX and never mutates host
permissions or installed capabilities. Removing/excluding a member fences its
active ownership and clears its nonterminal task pins in this Workflow. Retained
owners keep frozen execution settings; new work duties and models apply to
subsequent attempts. New-member tasks can save atomically with the policy. Each task
retains its own requirements, dependencies, attempt history and immutable
submission digest. AX Instances can participate in several Workflows.

Configuration scopes:

- Crew application/device settings continue through the existing settings UI.
- AX Instance global/project native settings affect all future executions using
  that target home/project. Writes require explicit scope confirmation and no
  active executions. Pending native writes block new placement while executing.
- Goal batch policy changes only that Workflow's participant range and required
  capabilities, member work duties and execution model defaults. Removing members
  fences their work in this Workflow only. Existing AX Goal policy/budget remains
  frozen in its checkpoint.
- Session guidance, native Long Project edits and one-request approvals target
  the latest recorded Session of one current execution generation; historical
  Sessions are read-only and pending commands for retired Sessions fail visibly. They cannot grant
  a persistent permission or weaken a host Sandbox.

Additional admin routes (existing admin authentication and error shape):

| POST suffix | Contract |
|---|---|
| `/workflows/{id}/settings` | `expected_revision, kind, participants, requirements`, optional `member_models, excluded_instances, new_tasks:[Submit]`; atomic CAS policy/tasks, member fencing; preserves checkpoint state |
| `/workflows/{id}/control/{pause|resume|cancel|retry}` | Controls all Workflow tasks and retains checkpoints/usage |
| `/tasks/{id}/reassign` | `generation, instance_id` (null = automatic), optional exact `model`, `duty`, `dependencies`, `host_id`, `clear_host`, `resources`; fences old execution, rejects cross-Workflow dependencies/cycles; omitted/null model inherits the new owner |
| `/tasks/{id}/commands` | `generation, session_id, kind, text, request_id?`; latest Session of live attempt only |
| `/plans` | `tasks:[{spec:Submit, depends_on:[earlier task index]}]`; 1-64 tasks in one transaction, first task owns root policy or joins existing Workflow; stable request IDs make retries idempotent; placement occurs after all tasks exist |
| `/placement` | `project_id, requirements`, optional `workflow_id` or `collaboration`; returns `[{instance_id,reasons}]`, empty reasons means currently eligible; uses scheduler predicate and current reservations |
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


## Execution-path audit and completed connections

The original production path already provided transactional Task/Workflow storage,
lease/generation/incarnation fencing, asynchronous child work, dependency gating,
Host-wide reservations, approved AX slots, isolated ACP workspaces and failover.
These remain the authority. Desktop creation now calls `POST /plans`, which
reuses `submit_in_cluster` within one aggregate transaction and invokes the same
`reconcile` once. It adds no planning agent, Goal ledger or execution loop.

Previously the form submitted one Task, models were only capability predicates,
and some desktop and permission-event paths used the first Session. Member
changes affected only future placement. The current three-step form defines work,
organizes AX/work duties/model choices and actual work-task assignments, then
previews dependencies, resource minimums and per-node matching reasons. Selecting
additional AX creates editable work-task rows; adding a member later accepts its
work task in the same CAS policy transaction. More tasks and dependencies remain
editable through existing task creation and fenced reassignment controls.

A Task has one effective owner for its current generation. Attempt records freeze
its exact execution Provider/Model and work duty. Task model selection overrides
a member default; otherwise AX's reported current model is inherited. Capability
`models` remains a separate all-required scheduling predicate. Worker commands
pass the frozen selection to that attempt's ACP process; no global AX model
configuration is written. The worker rechecks its own catalog before spawning and
reports the ACP-resolved model; Crew rejects a differing model report.

The worker uses existing `_ax/models` under its own AX_HOME to report a
credential-filtered local Provider/Model catalog, plus current selection and
errors. The existing ACP response adds optional `current:{provider,model}`.
Discovery has a 15-second deadline and runs separately from lease heartbeats,
refreshing every 60 seconds. Crew timestamps accepted catalogs; new execution
model selection requires online nodes and a catalog less than 180 seconds old.
Restart invalidates the previous catalog timestamp until the new incarnation
reports discovery. Pending model defaults match the active catalog as a subset,
so a model picker directory does not prevent local configuration acknowledgement.
Model catalogs are bounded to 5000 entries / 1 MiB, with model capability IDs
bounded independently from other 16 KiB capability policy fields so large valid
provider lists do not break lease heartbeats.
Successful heartbeats without new discovery do not refresh that timestamp.
Offline, expired and errored catalogs are visible and excluded from the picker.
This is local configured/catalog availability, not a remote provider health
attestation; actual inference errors remain real failed Tasks. Credentials never
leave AX. Older workers without catalogs retain inherited-model execution, but
cannot accept exact per-execution model overrides through the new picker.

Ordinary creation reserves one logical CPU slot and no explicit RAM/GPU minimum.
Advanced choices select actual reported Skill/MCP/environment tags, resource
minimums or a Host/AX pin. Every pending Task includes current per-node `placement`
reasons (including unfinished dependencies). Preview is a current snapshot, not a
capacity guarantee: separate rows can compete for the same remaining slots after
submission. CPU/RAM/GPU values reserve scheduler capacity only; they do not pin
GPU devices or enforce process quotas. Requests for `resource_limits` fail
explicitly. Real OS limits and physical GPU isolation remain outside this adapter.

Session chains are chronological. Desktop interaction, PROJECT_STATE imports and
permission events use the latest active Session; the server and AX bridge reject
historical targets. Rotation fails undeliverable old commands instead of replaying
them into a different Session. History selection filters each Session's activity
and exposes no message/answer/approval controls. Node participation includes
current ownership, queued pins and all prior attempts, so migrations remain
visible. Session/Memory stores and full workspaces remain AX-owned and are not
silently copied during takeover.


Workbench edit/add dialogs retain the Workflow ID captured when opened; new
collaborations arriving in a refresh cannot retarget them. Configuration drafts
also detect changes to collaboration policy and require a fresh review rather
than overwriting another operator's policy. Runtime checkpoint-only revisions
can still use the current CAS revision when that policy is unchanged.

A new worker reports model discovery as pending until its first native catalog
arrives. Heartbeats apply fresh capability/catalog/inventory data before new
placement, then fence expired leases before renewals. Newly unavailable models
cannot consume a just-released execution slot using the previous report.
