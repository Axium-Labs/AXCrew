# Development

## Prerequisites

- Rust 1.92+ (edition 2024) with the MSVC toolchain on Windows.
- Node.js + npm, and the Tauri 2 CLI (`cargo install tauri-cli --version "^2" --locked`) for the desktop app.
- JDK 17/21 and Android SDK 36.1 for the Android client.
- Python 3 for the process-level tests in [`tests/`](../../tests/).

## Control plane

Run every command from the repository root. The root is a Cargo workspace whose
only member is `crates/server`, so the artifact lands at
`target/debug/ax-crew.exe` exactly as before.

`python tests/integration/active_guidance_process.py ../ax/target/debug/ax.exe
target/debug/ax-crew.exe` uses a local mock model and isolated data to verify ACP,
local and paired-device guidance, pending permissions, one run per task, durable
replay and real tool-created file diffs. It requires current builds of both AX
and Crew, without production credentials or model calls.

```powershell
cargo build
cargo fmt --check
cargo check --workspace
cargo clippy --workspace --all-targets
cargo test --workspace
```

Start it:

```powershell
$env:AX_CREW_ADMIN_TOKEN = '<long-random-admin-token>'
.\target\debug\ax-crew.exe --ax ..\ax\target\debug\ax.exe --database .\crew.sqlite3 --listen 127.0.0.1:8765
```

A non-loopback `--listen` requires `AX_CREW_ADMIN_TOKEN`.

## Desktop

```powershell
cd apps\desktop
npm ci
npm run tauri:dev     # app + Vite + the local backend
npm run test:ui
npm run test:e2e
```

`cargo tauri build` and `npm run pack:portable` both work from `apps/desktop`;
the packaging scripts themselves live in the repository's `scripts/` directory
because they also build the backend.

### Desktop theming

The desktop UI has one palette system, defined in `apps/desktop/src/styles.css`:

- Tailwind v4 `@theme` tokens (`--color-surface`, `--color-accent`,
  `--color-success`, …) hold the dark values at `:root`; light overrides live
  under `[data-theme="light"]`. The theme is selected by the `ax-crew-ui`
  zustand store (`theme: dark | light | system`), which sets
  `document.documentElement.dataset.theme`.
- Shell CSS variables (`--shell-bg`, `--shell-panel`, `--shell-text`,
  `--shell-border`, `--shell-hover`, `--shell-active`, …) mirror the same
  values for plain CSS files.
- The accent is a single low-saturation iris used only for selection, toggles,
  focus and primary actions. It has two roles: `accent-text` /
  `--shell-accent` for text, links and tinted backgrounds, and
  `--color-accent` / `--shell-accent-strong` for solid fills with white text
  (primary buttons, switches, sliders, the chat send button). Never reintroduce
  a second blue for generic controls.
- Green / amber / red exist only as `success` / `warning` / `danger` status
  colors and are defined separately for both themes.
- Dark theme is graphite (near-black blue-gray surfaces); light theme is warm
  white. Page-level CSS files consume the tokens via `var(--shell-*)` /
  `var(--color-*)`; do not hardcode hex colors outside `styles.css` (exceptions:
  OS conventions such as the Windows close button, QR codes and chart
  palettes).
- Shape and size tokens (`styles.css` `:root`): `--radius-control` (11px) and
  `--control-h` (32px) for every button, input, select trigger and search
  field; `--radius-chip` (12px) for segmented containers, notices and small
  boxes; `--radius-card` (16px) for cards, lists and rows; `--radius-panel`
  (20px) for `.panel` and dialogs. Pill radius (999px) is only for chips, tags
  and switches — not for action buttons or selects. `--page-title` (26px) is
  the size of every top-level page title (`PageHead`, Settings, Connections,
  Artifacts); narrow layouts drop to 22px.
- Shared classes: every view switcher (list/calendar, gallery/table, 7/30
  days) uses `.ax-segmented` with `.is-active` or `aria-pressed`; every inline
  notice or error box uses `.ax-notice` / `.ax-notice.is-error` (`.is-flush`
  removes the top margin). Input focus uses the solid accent
  (`--color-accent` / `--shell-accent-strong`) ring. Settings switches are 42×26 with a
  20px thumb and `--shell-active` when off. Dialogs use `ui/Dialog`; the
  hand-rolled session dialogs match its radius, surface, overlay and
  animation.

## Android

```powershell
cd apps\android
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

See [apps/android/README.md](../../apps/android/README.md) for connection and
release-signing details.

## Process-level tests

These drive the built binaries and never call an external model:

```powershell
python tests\smoke.py C:\path\to\ax.exe .\target\debug\ax-crew.exe
python tests\gateway_socket.py .\target\debug\ax-crew.exe
python tests\model_catalog.py C:\path\to\ax.exe .\target\debug\ax-crew.exe
python tests\workspace_recovery.py .\target\debug\ax-crew.exe
```

`tests/smoke.py` uses a local fake model endpoint, two AX processes and the
Crew server. It covers ACP session setup, local-to-remote DAG execution, live
event mapping, permission resolution, cancel/retry, disconnect/reconnect with
the same AX Session, pairing and revocation.

## Repository-level scripts

| Script | Purpose |
|---|---|
| `scripts/prepare-binaries.mjs` | Builds the release backend and stages it into `apps/desktop/src-tauri/bin/`. |
| `scripts/pack-portable.mjs` | Produces `dist-pack/AX-Crew-<version>-win-x64-portable.zip`. |
| `scripts/start-workspace.ps1` | Launches the workspace builds without replacing the installed AX. |

## Documentation upkeep

- A change to a module's responsibility → update
  [architecture/README.md](../architecture/README.md).
- A change to the REST, WebSocket or ACP contract → update
  [protocol/README.md](../protocol/README.md) and
  [protocol/api.md](../protocol/api.md).
- A new command or script → update this page.
- [AGENTS.md](../../AGENTS.md) stays a short map; detailed explanation belongs here.

## Distributed tests

`cargo test --workspace` includes `tests/distributed.rs`: capability/resource scheduling, concurrent idempotent submissions, retry history, ownership/incarnation fencing, permissions, dependency outcomes and coordinator replacement with Workflow State. Desktop Vitest also includes `tests/desktop/distributed.test.tsx` (`cd apps/desktop; npm run test:ui`). Browser coverage uses `npx playwright test --config ../../tests/desktop/playwright.config.ts` from `apps/desktop`; screenshots/outputs are ignored under its `test-results/`.

After building both binaries: `python tests/integration/distributed_process.py ../ax/target/debug/ax.exe target/debug/ax-crew.exe` (Windows; adjust paths on Linux). It launches three real workers on two logical Hosts against a local fake SSE model, verifies failed test → analysis → Patch → retest, auth scoping, immutable artifact hashes, ordered event reads and Crew restart. No physical multi-host networking/hardware isolation is implied by this test. Existing process tests remain `smoke.py`, `gateway_socket.py`, `model_catalog.py` and `workspace_recovery.py`.


Connection/project regression uses tests/integration/connections_process.py with
absolute AX and Crew executable paths. It runs an isolated authenticated gateway
and a local model stub; no real credentials or external model calls are needed.
The desktop connection browser suite is run from apps/desktop with:
npx playwright test --config ../../tests/desktop/connections.playwright.config.ts
It covers SSH forms, project host selection, cloud/model binding and dark/light
layouts at 960/1440 pixels. Component coverage lives in
tests/desktop/connections.test.tsx and runs with npm run test:ui.

The additional tests/integration/ssh_local_process.py regression builds a small
test SSH executable from ssh_fixture.rs and runs real local AX/Crew against
a mock model and POSIX shell. On Windows it needs the installed Git Bash; it
does not require an SSH server, remote AX, personal credentials or external APIs.
It proves one-turn multi-host control, local history during SSH outages/removal,
and eight concurrent tasks despite --concurrency 1 and member concurrency 1.

Chat presentation regression: from apps/desktop, run
`npx playwright test --config ../../tests/desktop/transcript.playwright.config.ts`.
It covers static running status, related web-call grouping, automatic completion
folding after manual expansion, a single final answer toolbar, and saved tool
output after branching and returning, at desktop and HiDPI scales. Vitest includes
tests/desktop/tool-presentation.test.ts plus transcript component/reconciliation
tests. Screenshots and traces are ignored under apps/desktop/test-results/.

Composer/responsive regression: from apps/desktop, run
`npx playwright test --config ../../tests/desktop/composer.playwright.config.ts`.
It covers catalogue-backed effort/model/Fast controls, follow-up effort payloads,
new/existing draft navigation and reload, turn previews/jumps, 960/760/560px
layouts and manual navigation at desktop/HiDPI pixel densities. Vitest includes
tests/desktop/model-controls.test.tsx and drafts.test.tsx for unsupported/stale
capabilities, local persistence and binding arrival while composing.
Gateway: `cargo test -p ax-crew --lib effort_tests`; Tauri bridge (from src-tauri):
`cargo test --lib catalogue_tests`. AX provider catalogue parsing is covered by
`cargo test -p model --test reasoning_catalogue` in the AX workspace.
