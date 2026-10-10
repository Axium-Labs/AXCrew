# Development

## Prerequisites

- Rust 1.92+ (edition 2024) with the MSVC toolchain on Windows.
- Node.js + npm, and the Tauri 2 CLI (`cargo install tauri-cli --version "^2" --locked`) for the desktop app.
- JDK 17/21 and Android SDK 36.1 for the Android client.

## Control plane

Run every command from the repository root. The root is a Cargo workspace whose
only member is `crates/server`, so the artifact lands at
`target/debug/ax-crew.exe` exactly as before.

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
.\gradlew.bat :app:assembleDebug :app:lintDebug
```

See [apps/android/README.md](../../apps/android/README.md) for connection and
release-signing details.

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


## Local validation

Standalone test suites, their tooling and work logs are maintained locally and
excluded from the published repository. Published build commands do not depend
on these local files. Source-embedded Rust unit tests remain runnable with
`cargo test --workspace`.
