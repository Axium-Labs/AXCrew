## 2026-10-06 14:33

Task: Correct SSH connections to use local AX and remove fixed SSH count/concurrency caps

Changed:
- transport/ssh.rs: direct POSIX directory probes; no remote AX launch. Short-lived
  context manifests and stable local transcript workspaces under AX_HOME.
- transport/ax.rs and transport/mod.rs: execute SSH sessions via the local AX binary;
  models, skills, approvals, history and deletion remain local; source cwd is remote.
- scheduler.rs: SSH tasks bypass Crew global/member concurrency caps, retaining other
  scheduling rules. Local and paired-AX task caps keep their existing behavior.
- sessions/local_ax APIs: local SSH transcript replay survives offline/revoked hosts;
  internal transcript roots are omitted from normal local project discovery.
- Connections/session copy explains local AX models and unlimited SSH host catalogue.
- tests/ssh_transport.rs and integration/ssh_fixture.rs/ssh_local_process.py.
- README, desktop, architecture, protocol and development documentation synchronized.

Why:
- User explicitly requires local AX to control SSH hosts instead of starting remote AX.
- The previous 2026-10-06 connections log describes the superseded remote-AX behavior.
- A file-backed context avoids Windows environment block limits with many saved hosts.

Tests:
- cargo fmt/check/clippy and cargo test --workspace: PASS, 28 tests.
- Desktop check/build: PASS; UI 121 tests / 22 files and connection browser 5 tests: PASS.
- Android assembleDebug/testDebugUnitTest/lintDebug: PASS (existing SDK warning remains).
- ssh_local_process.py with real local binaries and mock SSH: PASS, 264 saved hosts,
  six remote shells in one session with concurrent execution; eight simultaneous SSH
  tasks using one member while Crew --concurrency=1; remote AX absent; local history
  works without SSH contact and after host revoke. Context exceeds 32,767 bytes.
- Existing connections_process.py and smoke.py with absolute binary paths: PASS.
- AX whole-workspace tests and git diff --check for both projects: PASS.

Limits / existing issues:
- External SSH authentication/server and WSL runtime not live-tested.
- Remote POSIX shell/OpenSSH keys or agent required; interactive passwords unsupported.
- No fixed SSH host or cross-host concurrency cap; machine/network/model resources apply.
- Existing terminal pointer drag-reorder browser regression is unrelated and remains
  outside this change. No terminal implementation changed.
- Remote images/file preview/Fast/goal controls retain their existing restrictions.

No commit, version change, release or installed-app replacement.
Preserved other uncommitted work and historical logs.
