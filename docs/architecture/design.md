# AX Crew: source-based implementation plan

Model connection feedback is an additive AX ACP `model_connection` update.
The scheduler forwards live attempts and retains a terminal failed frame in
optional task `output.model_connection`, including its actual attempt count.
Desktop/Android present the model error using that metadata. Scheduling keeps
the existing `failed` state; a model error is not treated as a lost remote device
even when the provider's diagnostic contains the word `disconnected`.

Source baseline: `the ax repository` on `main`, inspected 2026-09-27. This document records the boundary before implementation. AX remains the sole agent runtime.

The implementation this plan describes now lives in `crates/server/`; see
[README.md](README.md) for the current module responsibilities and
[../development/README.md](../development/README.md) for the build and test
commands.

## Observed AX calls

1. `crates/cli/src/main.rs::main` parses `run`, `agents`, or `tui`. `Run` resolves a local model via `model_selection::require_resolved`, constructs `ReplState`, then calls `run_prompt` → `run_prompt_with`. The TUI also calls `run_prompt_with` (`crates/cli/src/tui/mod.rs`). `AgentSupervisor::run_tasks` in `crates/core/src/lib.rs` handles *independent* prompts with bounded concurrency; it neither persists sessions nor schedules a DAG.
2. New session: `ReplState::ensure_session` → `create_session` → `MemoryStore::create_session` (`crates/memory/src/lib.rs`), resetting session permission grants, loaded messages, skills, and kernel. `run_prompt_with` creates `AgentKernel` lazily, registers the MCP gateway and a session-bound memory tool, retrieves memory, resolves file references and skill instructions, then calls `AgentKernel::run_turn_checkpointed`.
3. Resume: `ReplState::open_session` → `MemoryStore::session`, `session_restore::recent_history` → `load_context_page`, `session_summary` / `effective_context`, `load_agent_state_messages`, and `session_restore::interrupted_results`. It appends synthetic results for interrupted tool calls rather than replaying side effects, selects context with `runtime_core::select_context`, clears session grants, and rebuilds the kernel on the next prompt (`crates/cli/src/main.rs`, `crates/cli/src/session_restore.rs`). ACP session IDs should be exactly AX UUID session IDs.
4. Model loop: `run_turn_inner` appends/checkpoints the user message, compresses as needed, builds `ModelRequest`, invokes `ModelProvider::complete_stream`, checkpoints the assistant message, checks each tool's declared `ToolPermission`, executes it, checkpoints tool results and loops (`crates/core/src/lib.rs`). The provider implementations and catalog are in `crates/model/src/`; the CLI's `kernel` and `model_selection` wire local credentials and selection.
5. `AgentEvent` variants: `TurnStarted`, `ModelStarted`, `ContentDelta`, `ThinkingDelta`, `ToolStarted`, `ToolFinished`, `TurnFinished`, `ContextCompressed` (`crates/core/src/lib.rs`). ACP maps deltas to `session/update` and tool start/finish to tool updates. Completion is the returned turn result. There is no `PermissionRequested` or `PermissionResolved` event in the kernel: an adapter `ApprovalPolicy` must emit these around its own request and use the existing `PermissionStore` decisions.
6. `ApprovalPolicy::approve` receives the tool name, input, and tool-declared permission. The TUI's `ChannelApproval` (`crates/cli/src/tui/mod.rs`) checks `PermissionStore`: explicit Allow/Deny, auto-Allow safe Ask, otherwise awaits a choice and can grant for the session. Noninteractive `run` uses `DenyDangerous` or `AllowAll`; no permission dialog exists there. The ACP adapter needs its own policy with a request/response channel; it must not change the core check.
7. `MemoryStore` (`crates/memory/src/lib.rs`) uses SQLite WAL for sessions, message indexes, effective context and scoped memory, with append-only JSONL as authoritative raw history (`docs/storage.md`). Crew stores binding IDs, orchestration metadata and selected distributed results/checkpoints/artifacts. Provider credentials remain under AX home (`crates/model/src/auth.rs`, `crates/cli/src/config.rs`). Skill routing and MCP gateway remain in `ReplState`, `crates/skill/src/lib.rs`, and `crates/mcp/src/`.
8. Cancellation: AX currently has no per-session cancellation token. The TUI's Ctrl+C exits the UI; `AgentSupervisor` uses a `JoinSet`, with no public per-task cancel API. ACP cancel can abort the adapter's running turn future. Since a tool may have completed external effects already, a resumed session must use the existing interrupted-call recovery. A later cooperative cancellation API would be a separate core change.

## Boundary and placement

Add `ax acp` as an additive CLI subcommand and `crates/cli/src/acp.rs` as the JSON-RPC stdio adapter. It reuses `ReplState::{create_session,open_session}`, `run_prompt_with`, `AgentEvent`, and a new adapter-local `ApprovalPolicy`. Keep `crates/core`, `memory`, `model`, `tool`, `mcp`, and `skill` behavior unchanged. AX-specific status/catalog extensions are read-only; absent capabilities must be reported honestly.

Crew is a separate Rust binary (`crates/server/Cargo.toml`, `crates/server/src/`) and the only member of the root Cargo workspace. Its `Transport` abstraction sends ACP requests to a local `ax acp` subprocess or an outbound WebSocket-connected remote AX bridge. Crew owns pairing, device routing, deterministic DAG scheduling, event aggregation, REST/WebSocket API and its own SQLite WAL database. It never interprets model responses or replicates AX Session/Memory stores or provider credentials. Optional distributed collaboration persists selected task results, observations, workflow checkpoints and explicitly published artifacts (including logs/transcripts). Remote agent process uses the same ACP adapter and calls the gateway over WSS. Device and member configuration are metadata, not new agents.


Protocol framing: line-delimited JSON-RPC 2.0 over stdio for `ax acp`. Initial methods: `initialize`, `session/new`, `session/load`, `session/resume`, `session/prompt`, `session/cancel`, permission response, and `_ax/status` / catalog extensions. ACP update notifications carry AX events. The gateway wraps ACP messages with a routed device/request envelope and authenticates the WebSocket first. A request is correlated by JSON-RPC ID; notification ordering is retained per session.

## Crew database (separate `crew.sqlite3`, WAL)

`devices(id PK,name,hostname,platform,arch,ax_version,protocol_version,capabilities_json,status,last_seen,public_key UNIQUE,revoked_at)`; `pairings(code_hash PK,expires_at,used_at)`; `crews(id PK,name,created_at)`; `crew_members(id PK,crew_id FK,name,role,device_id FK,cwd,provider,model,skills_json,mcp_servers_json,permission_profile,max_concurrency)`; `tasks(id PK,crew_id FK,parent_id FK,title,description,assigned_member FK,assigned_device FK,priority,status,input_json,output_json,retry_count,created_at,started_at,finished_at)`; `task_dependencies(task_id FK,depends_on_id FK,PRIMARY KEY(task_id,depends_on_id))`; `task_runs(id PK,task_id FK,attempt,status,started_at,finished_at,error)`; `session_bindings(task_id PK,member_id,device_id,ax_session_id)`; `events(id PK,timestamp,kind,crew_id,member_id,device_id,task_id,session_id,payload_json)`; `automations(id PK,name,message,schedule_kind,interval_minutes,daily_time,weekdays,utc_offset_minutes,member_id,model,approval,silent,strict_schedule,hide_from_chat,lean_context,folder,enabled,created_at,last_run_at,next_run_at,run_count,last_status)`; `automation_runs(id PK,automation_id FK,task_id,status,started_at,finished_at,detail)`; `client_pairings(code_hash PK,expires_at,used_at,device_id,name,platform,status,credential_pending)`; `client_authorizations(device_id PK,name,platform,credential_hash,created_at,last_active,revoked_at)`; `app_settings(key PK,value_json)`.

No message, memory, provider credential, API key, or OAuth table. Foreign keys on; transactional dependency and state updates. Migration version in `PRAGMA user_version`.

## State machines

Pairing: `issued(code hash, expiry)` → `redeemed(public key, challenge)` → `verified` → `device online`; expiration or first successful redemption consumes the code. Future connections use fresh nonce challenge with Ed25519 signature and verify against stored key. `revoked_at` disables authentication and dispatch immediately. Never send the private key to Crew.

Task: `pending` → `ready` when every dependency completes → `running` → `completed` / `failed` / `cancelled` or `waiting_permission` / `waiting_user`. A failed/cancelled dependency blocks descendants until retry policy or explicit user action. Retry increments attempt and returns task to `ready`; validate acyclicity before insertion. Concurrent ready tasks obey global and member limits. Device loss marks active run interrupted; after reconnect resume its AX session, with existing AX tool recovery semantics.

Planning-question suspension: `running` → `waiting_user` only after AX's prompt
response confirms it is parked. No completion event, finished timestamp or
successful dependency release is produced. An answer atomically verifies the
status and question ID, stores the structured answer in the existing task output,
and moves the same task to `ready`; normal dispatch resumes the same AX session.
The original task input stays unchanged. Restart leaves `waiting_user` parked;
queued/in-flight answer identities survive the existing ready/run recovery.

Remote connection: `offline` → `connecting` → `authenticating` → `online` ↔ `busy`; heartbeat timeout/socket close → `offline`; reconnect verifies a fresh challenge, refreshes capabilities, and resumes eligible interrupted work. `error` records auth/protocol failures. Remote AX initiates WSS; no inbound AX port is required. WSS certificate verification is mandatory outside explicit local development settings.

## Delivery and verification

Implement in slices: (1) AX ACP adapter and its local transport contract, (2) Crew SQLite/API/DAG/local execution and event stream, (3) outbound authenticated remote transport and pairing, (4) PC A/PC B integration exercise including cancel, retry, resume, disconnect and reconnect. Validate AX's original CLI commands and workspace tests after additive CLI changes. The current source does not support cancel or permission events natively; any adapter behavior must state its exact semantics in docs and tests.

## Additive distributed state machine

`domain/distributed.rs`, `storage/repositories/distributed.rs`, `orchestration/distributed.rs` and `api/distributed.rs` extend their existing layers. Two idempotent schema additions (`distributed_cluster` and `distributed_blobs`) store the transactional cluster aggregate and immutable artifact content. They leave legacy device/task/session tables intact. Tasks use centralized owner/incarnation/generation leases; Workflows persist explicit CAS checkpoints independently of a Coordinator AX. Capability and shared Host resource placement, cancellation/retry and recovery semantics are detailed in [Distributed Collaboration](../distributed-collaboration.md).

Distributed Hosts now persist worker-reported inventory and its server timestamp.
Enrollment can omit capacity; unknown Hosts are not placed until detection.
Connected AX instances retain separate pending settings and active worker-reported
capabilities, with only active capabilities entering placement. All additions are
serde-defaulted JSON aggregate fields, preserving existing SQLite state and clients.


## Named projects and SSH environments

The additive ssh_connections(id REFERENCES devices, config) table stores
nonsecret OpenSSH settings. projects(id,name,member_id REFERENCES crew_members)
stores labels bound to immutable execution members; device/cwd derive from
members. Removing a project preserves members and conversations. Revocation
excludes hosts from active lists. Startup resets SSH offline because probes do
not survive restart. Model changes create/reuse another member rather than
mutating a session-bound environment. Paired validation retains AX registered
workspace restrictions.

SSH environments bind remote source paths but run the local AX process in a
stable local transcript workspace. Host context is injected only into that
process. SSH commands execute through the registered SSH tool; local filesystem
execution tools are excluded in this context to prevent confusing remote paths
with local files. Local model/credential/session stores remain authoritative.
The scheduler exempts SSH task counts from global/member limits without changing
other task classes. Same-host tool effects still serialize inside a turn.


The collaboration workbench extends the existing distributed aggregate with
serde-defaulted Workflow policy, reported Attempt Session chains, execution
inbox commands and opt-in instance native-management commands. No new Session
store, Goal ledger, scheduler or SQL table is introduced. The collaboration
orchestration module handles CAS scope policy, whole-Workflow control,
reassignment and partial batch results; the API only authenticates and delegates.
AX retains ACP execution, settings validation, approvals and native Long Project
history. See [workbench scope and command contracts](../distributed-collaboration.md).


Instance deregistration moves an idle active instance without unfinished assignment or membership references into the existing
Cluster aggregate's serde-defaulted `removed_instances` map, clears credential/incarnation
and disables management. It never removes Task/Attempt/Workflow/Session/Event/artifact
history or Host inventory. The same transaction rejects unfinished ownership/pinning,
unfinished explicit participation and executing native management; pending native and
undeliverable execution commands fail. Repeated deletion retains the original event.


Distributed collaboration now creates actual multi-AX work through a three-step
plan form and one atomic Task/Workflow transaction. Native worker model catalogs
feed searchable execution selections; each Attempt freezes its Provider/Model
and duty. Matching previews share scheduler predicates and pending Tasks display
reasons. Member removal fences only its Workflow; new-member work can save in the
same policy transaction. Latest-Session routing and read-only Session history
retain rotation and migration associations. Resource minimums reserve scheduler
capacity; system resource limits are explicitly unsupported. See
[distributed contracts](../distributed-collaboration.md).


Distributed collaboration edits add defaulted `Workflow.objective: Option<String>`
and `DistributedTask.removed: bool` to the existing JSON aggregate. An operator
removal retains task records, dependencies, attempts, artifacts and checkpoints;
it cancels unfinished work and clears lease ownership. Retained dependents/children
block removal. Removed tasks cannot execute again and are excluded from workflow
completion aggregation. See the distributed collaboration edit contract.


Distributed lifecycle removal uses the existing aggregate transaction in
`orchestration/collaboration_edit.rs`. Serde-defaulted `Cluster.removed_hosts`
archives disabled inventory; serde-defaulted `Workflow.removed` separates retained
history from visible collaborations. Workflow removal marks its tasks removed,
fences unfinished attempts, releases owners/leases and reconciles command failures.
Cross-workflow dependencies block the entire transaction; Host removal requires no
active enrollment or unfinished Host pin. No SQL table or worker protocol changes.
Removed workflows reject edits/control/checkpoints/new submissions. Explicit admin
submission may reopen a cancelled retained workflow, without restarting old tasks.
A terminal workflow is completed only if all its retained tasks completed.

Chat platform configuration, peer bindings, cursors and bounded admission state are stored in the protected `chat-channels.dat` sidecar, independent of task/session schema. Each platform has an opt-in connection and dispatcher. Binding requires a one-time command plus local approval; replacement credentials clear account grants. See [state and reliability limits](../chat-channels.md).

Chat channel sidecars also retain optional Slack App Tokens, Teams tenant/public-origin fields, bridge paths and WhatsApp authentication state. These fields have backward-compatible defaults; secrets and WhatsApp keys remain protected by the existing sidecar encryption. A per-configuration generation rejects stale receiver writes after settings replacement.

## Chat navigation menu state

Each approved channel peer has at most one current numbered menu in server memory.
Opening a menu/page snapshots its project directories or own conversation IDs,
configuration generation, selected directory and current task, expiring after five
minutes. Invalid selection keeps the snapshot; a valid selection consumes it before
normal conversation-command validation. Ordinary chat, slash commands or explicit
menu cancellation closes it. Stale generation/task/directory and expiry reject the
selection. Server restart clears menus while persisted project/history bookmarks
remain. Active work blocks opening menus; work/questions that start later discard
the menu and preserve the task's numeric answer path. No model call interprets
management input. Menus add no database/sidecar fields; the separate welcome flag
below is a compatible per-peer addition.

## Chat welcome state

New peer authorization sets `welcome_pending=true` in the protected channel sidecar.
The platform dispatcher persists false before attempting the welcome and its live
main menu. Unattempted welcomes survive restart; attempted/ambiguous sends are not
replayed. Existing peers deserialize the missing field as false. Repeat approval
never re-arms it; revoke/disconnect/credential replacement removes the binding.
Disabled channels do not dispatch welcomes. Welcome processing precedes incoming
messages and respects an already open selector or active task. No Crew database or
public API payload change is required.
