## 2026-10-05 15:34 +08:00

Task: Simplify distributed enrollment, automatic Host viewing and post-connect capabilities

Changed:
- domain/distributed.rs, orchestration/distributed.rs, api/distributed.rs, api/mod.rs
- apps/desktop/src/lib/distributed.ts, pages/Distributed.tsx,
  pages/distributed-details.tsx, pages/distributed.css
- tests/distributed.rs, tests/desktop/distributed.test.tsx,
  tests/desktop/distributed.browser.spec.ts, tests/integration/distributed_process.py
- README.md, apps/desktop/README.md, docs/distributed-collaboration.md,
  docs/protocol/README.md, docs/architecture/design.md

Summary:
- Enrollment asks only connection/project/instance policy information; CPU/RAM/GPU and
  Skill/MCP/Tool/model fields removed. Legacy API resource/capability inputs remain optional.
- Authenticated, incarnation-fenced worker reports persist inventory/server timestamp;
  shared capacity is replaced once per Host, never summed for multiple AX instances.
- Host and AX views show detected logical CPU, memory, GPU names/count, OS/hostname,
  last detection, online/offline state and execution reservations. Missing inventory
  displays pending; failed GPU/RAM detection is unknown, not false physical zero.
- Connected instance capability editor stages pending_capabilities and generates local
  worker settings. Only reported active capabilities enter placement; matching reports
  clear pending state. Local dependency installation/configuration remains required.
- Additive serde-default JSON fields preserve old cluster state; no legacy Agent Loop,
  device, session, task or Android behavior changed.
- Website claims reviewed; existing generic resource/capability architecture remains accurate.

Tests:
- cargo fmt --check, cargo check --workspace, cargo clippy --workspace --all-targets: PASS.
- cargo test --workspace: PASS (15 existing unit tests + 10 distributed regressions).
- npm run build: PASS; existing Vite chunk-size warning remains.
- npm run test:ui: PASS (117 tests, 21 files).
- Distributed browser checks: PASS (960/1440 px, dark/light; inventory, enrollment,
  connected capability editor and recovery). Screenshots visually inspected.
- tests/integration/distributed_process.py: PASS — three real AX workers, auto inventory,
  post-connect settings/restart/report, failure/analysis/Patch/retest and Crew recovery.
- smoke.py, gateway_socket.py, workspace_recovery.py, model_catalog.py: PASS.
- Android assembleDebug/testDebugUnitTest/lintDebug: PASS after supplying documented
  ANDROID_HOME; existing SDK XML warning remains.

Issues / limits:
- Windows native detection verified. Linux/macOS inventory not executed on this host.
- Capacity reservations are not live utilization or OS/GPU isolation. Capability names
  select locally enabled configuration and do not attest external service health.
- Cross-machine test uses logical Hosts on one Windows machine, fake model and sandbox off.

Next:
- Source changes only; no new version bump, commit, release or installed-app replacement.
