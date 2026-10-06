## 2026-10-06 00:28

Task: Codex-style Connections, SSH hosts, named projects and cloud environments

Changed:
- Desktop Connections replaces Connect phone while preserving /connect and settings routes.
- Control-this-computer authorization/add-device, paired-host management and SSH tabs.
- New ConnectionDialogs and shared modal CSS: discovered SSH aliases, manual host/port/key path,
  named project and host-side folder selection; local Tauri native folder picker retained.
- Session composer enables Cloud → Choose environment, remote host model catalog selection,
  immutable model-specific members and fixed existing-session host/cwd/model.
- api/domain/orchestration/storage connection modules and additive SSH/project tables.
- OpenSSH transport shares local ACP streaming, resume, approval and cancellation lifecycle.
- Remote history failures cannot fall back to gateway-local AX transcripts.
- README, desktop/architecture/protocol/development docs and regression fixtures synchronized.

Why:
- Support actual remote project creation and conversations using the requested UI,
  validating source folders on their owning host rather than the gateway filesystem.
- Retain paired AX registered-workspace restrictions and existing historical bindings.

Tests:
- cargo fmt --check, check --workspace, clippy --workspace --all-targets: PASS.
- cargo test --workspace: 28 passed.
- Desktop check/build: PASS; test:ui: 121 passed / 22 files.
- New connection Playwright suite: 5 passed (960/1440, dark/light, cloud model/member binding).
- Existing shell/session-action browser run: 26 passed initially; four outdated connection/cloud
  assertions updated and passed on rerun. Terminal drag-reorder test still fails independently.
- connections_process.py: PASS (auth, local/paired roots, invalid paths, model environment reuse
  and immutability, remote multi-turn/history, SSH failure, restart and project removal).
- smoke.py with absolute binary paths, gateway_socket.py, workspace_recovery.py, model_catalog.py: PASS.
  Initial smoke with relative AX path failed after child cwd change; absolute-path rerun passed.
- Android assembleDebug, testDebugUnitTest, lintDebug: PASS using installed Android Studio JBR.

Issues / limits:
- SSH remote command assumes POSIX shell and ax on noninteractive PATH; password/passphrase
  prompts unsupported. Private key content is never stored, only gateway-local key-file path.
- SSH restarts offline and needs Connect. No external SSH host available for live validation.
- Paired hosts expose registered AX root directories only; register new roots on that AX host.
- Remote image upload, local file preview, Fast inference and goal loops remain unavailable.
- Existing AX clippy warnings, Vite large-bundle and Android SDK XML-version warnings remain.
- Unrelated terminal pointer drag regression remains failing; no terminal implementation changed.

Next:
- Verify external SSH against a configured POSIX AX host.
- Investigate terminal drag timing/reorder separately.

No commit, version change, release or installed-app replacement performed.
Preserved existing distributed-collaboration work and other uncommitted changes.
