# AXCrew distributed benchmark

**English** | [简体中文](benchmarks.zh-CN.md)

The external [AX-Bench Agent package](https://github.com/Axium-Labs/AX/blob/main/benchmarks/agent/README.md) measures
production Crew and AX workers without changing Crew scheduling, leases,
permissions or persistence. [Distributed controller configuration](https://github.com/Axium-Labs/AX/blob/main/benchmarks/agent/docs-crew.md)
describes real node management, DAGs, artifact checks, fault/restore and collectors.

The controller supports dedicated local or SSH workers with explicit run-scoped
start/stop/crash/network hooks. The bundled owned-worker helper checks retained
PID birth identity before signaling a process; it preserves execution data.
Node configuration is explicit, with no inferred cloud provisioning or simulated
workers. Task aliases become native Workflow/dependency identities, siblings are
submitted concurrently and actual execution concurrency is observed separately.

Deterministic checks cover actual task JSON, immutable artifact bytes/verifiers,
submission idempotency/conflict rejection, Workflow checkpoint CAS, observed
attempt generations/owner fencing and dependency execution ordering. Actual
fault receipts must exist before recovery is scored; missing triggers are not
successful tests. Resources and Provider usage come from declared read-only
collectors and retain their process/network scope; unavailable values stay null.

Use a dedicated Crew server, benchmark projects and isolated worker workspaces.
The adapter cancels only its own tasks and restores configured node faults during
cleanup. Every case repeats >=3 times; parent Runner integration avoids multiplying
three outer repetitions into nine. JSON/CSV/Markdown reports retain snapshots,
node/fault events, failures, source/model identities and measurement boundaries.

Single-host execution, multiple logical Host IDs and operator-attested physical
machine fingerprints are separate scopes. Multiple Host IDs alone are not proof
of multiple physical machines. State assertions cover observed histories, not a
formal proof of every distributed interleaving. No capability/distributed score
is produced by offline planning or controller regression fixtures.
