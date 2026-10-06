# 2026-10-05 — Durable Distributed Control Plane and desktop management

Task: Add an opt-in Distributed Collaboration layer with Host → AX Instance →
Execution, durable async collaboration, centralized ownership and a sidebar page.

Changed:
- `domain/distributed.rs`, `storage/repositories/distributed.rs`, additive
  `distributed_cluster` / `distributed_blobs` schema, `orchestration/distributed.rs`.
- `/api/distributed` REST module and startup reconciler; separate worker enrollment
  credentials, live owner/incarnation/generation fencing, deduplication, Events,
  Artifacts and CAS Workflow State.
- `apps/desktop/src/pages/Distributed.tsx`, distributed styles/API types, App route
  and bilingual sidebar. Host/AX/Workflow/Task/Artifact/Event tabs, enrollment with
  private worker config, resources/policy, task placement input, cancel/retry.
- `tests/distributed.rs` (8 regressions), `tests/integration/distributed_process.py`, desktop
  Vitest/browser tests and configuration under `tests/desktop/`.
- Existing browser sidebar expectation includes the new entry. Model-catalog
  process fixture now matches already-supported native Anthropic models.
- Both README languages, architecture/storage/protocol/development/desktop docs;
  dedicated `docs/distributed-collaboration.md` is the canonical contract.
- Sibling AX runtime adapter/Tool and optional unreleased website copy synchronized;
  existing release version numbers stay unchanged.

Summary:
- Scheduling combines every requested AX capability, logical project policy,
  per-instance slots and resource reservations shared by AX instances on a Host.
- Durable tasks/attempts/events/checkpoints/artifact metadata persist transactionally.
  Parent replacement reuses child submissions and remote work continues without
  a permanently live Coordinator Agent. Full AX Session/Memory are not replicated.
- Old/reassigned execution uploads/reports are fenced. Duplicate submissions,
  reports and content-addressed artifacts are idempotent. Invalid uploads fail
  before blob insertion; a crash between blob and metadata can leave an orphan.

Tests:
- Server `cargo test --workspace`: PASS (15 existing + 8 distributed).
- `cargo check --workspace`, `cargo clippy --workspace --all-targets`,
  `cargo fmt --check`, debug build: PASS.
- Desktop build: PASS (existing bundle-size warning); Vitest: 114 PASS.
- Browser management: 4 PASS (960/1440 pixels, dark/light); existing sidebar /
  terminal docking: PASS.
- Real 3-AX / 2-logical-Host process test: PASS — failed test, observation,
  log analysis, Patch transfer, retest, artifact hashes, scoped auth, Event cursor,
  Crew restart without a live original Coordinator.
- Existing process suites: smoke, gateway_socket, model_catalog, workspace_recovery:
  PASS; AX workspace tests/clippy/fmt: PASS.
- Android `assembleDebug`, `testDebugUnitTest`, `lintDebug`: PASS (existing warnings).
- Website Astro check: 0 errors/warnings/hints; production build: PASS.

Issues / limits:
- One authoritative Crew process with SQLite, metadata aggregate/history growth,
  no object store/GC/replicated consensus. Resource values are reservations, not
  hardware probes or enforced OS quotas. Dedicated cluster UI is desktop-only.
- At-least-once attempts need idempotent external effects. Real physical multi-Host
  networking/TLS/GPU isolation has not been tested; the fake-model process fixture
  explicitly uses sandbox off. Ordinary AX and legacy device APIs remain available.

Next:
- Physical deployment/network-outage validation and larger-cluster storage/GC as
  operational needs warrant. No release, commit or installed app replacement.
