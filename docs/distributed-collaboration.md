# Distributed Collaboration

Introduced in AXCrew 0.3.3 with AX 0.3.7, alongside existing Crew/Task/Session/device
control. Open the desktop sidebar **Distributed** (`/distributed`) to manage the
cluster. Existing routes, SQLite data and Android controls remain compatible;
the dedicated cluster management page is currently desktop-only.

## Model and boundaries

`Host → AX Instance → Execution` allows both one Host with several AX instances
and one AX with several concurrent executions. Local AX Subagents/Sessions/Tasks
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

Tasks progress `pending → running → completed / failed / cancelled`. Lost leases
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
state. Workflow is active while any task is pending/running; terminal workflows
are completed when the root succeeded, otherwise cancelled or blocked. This does
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

Admin enrollment approves stable Host identity/resources and per-instance
capabilities, project IDs, concurrency and `can_delegate`. Adding another AX on
the same Host cannot silently change its capacity. Resources are declared
reservations, not measurements, OS quotas or GPU device allocation. Changing
capacity does not evict already running valid work; it controls new placement.
Capabilities are trusted declarations; local worker configuration is checked for
projects/concurrency/model/selected Skill/MCP/profile, not hardware attestation.

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
| POST `/enroll` | `host_id, host_name, resources, name, capabilities, projects, max_executions, can_delegate` → `instance, token` (token shown once) |
| POST `/tasks` | `request_id, title, input, project_id`, optional `context_summary, workspace_revision, workflow_id, requirements, dependencies, artifacts, parent_id, parent_generation, max_attempts` → Task |
| GET `/tasks/{id}` | `task, workflow, observations, cursor`; event cursor query supported |
| POST `/tasks/{id}/cancel` or `/retry` | Central task control |
| GET `/workflows/{id}` | Workflow and participating tasks |
| POST `/workflows/{id}/checkpoint` | `expected_revision, state`, worker also supplies source lease Report → Workflow |
| GET `/worker/identity` | Authenticated `instance_id`, before worker start mutation |
| POST `/worker/start` | `incarnation` → authenticated `instance_id`; replaces old epoch |
| POST `/worker/heartbeat` | `incarnation, active:[{task_id,generation}]` → new/unacknowledged `assignments`, all owned `leases`, `server_time` |
| POST `/worker/report` | `incarnation, task_id, generation, message_id, kind, text, artifacts`; kind `completed`, `failed` or `observation` |
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

The management page has Host, AX Instance, Workflow, Task, Artifact and Event tabs.
It supports enrollment/config download, enabling/disabling Hosts/instances,
Host resource editing, capability/resource/dependency/commit-aware task submission,
attempt/result/error inspection, cancellation/retry and artifact download.
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
