# Development

Production Rust modules/Cargo targets do not depend on private, untracked test
files. Keep local regression wiring in a disposable source overlay and separately
verify the intended formal file set with build, test compilation and static checks.
Private test sources and generated artifacts remain local.

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

Windows/Linux/macOS build dependencies, native bundle configurations, matching
backend staging and optional target selection are in [platforms.md](../platforms.md).
The native desktop now requires Rust 1.92+, matching the workspace requirement.

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

### Shared desktop surfaces

Keep shared design rules in the existing component layer instead of adding
page-specific copies:

- `src/styles.css`: global theme, shape and motion tokens, shell layout and shared
  keyframes. Feature CSS consumes these tokens; it does not define another palette.
- `src/components/ui/primitives.css`: Button, Input/Textarea, Menu and Dialog
  presentation. These components import the file themselves. Standard Dialog
  owns its fixed header and scrolling body; `layout="custom"` is reserved for
  callers such as collaboration wizards that already own their body/footer layout.
- `src/components/ui/select.tsx` and `select.css`: the common labelled
  single-selection control using `options`. Legacy native selection implementations
  in `components/shared.tsx` have been removed; consumers import this primitive.
- `src/components/shared.tsx` and `shared.css`: PageHead, Empty, Field, Status and
  Action, plus common page/panel/row/form layouts. Empty accepts an optional icon,
  action and feature class; features do not need to recreate its markup.
- Feature styles such as `pages/management.css`, `settings.css`, `schedule.css`
  and `artifacts.css` own only their layouts and domain-specific presentation.
  Schedule/artifact compact layouts use container width rather than guessing how
  much room remains after navigation.

Buttons and fields keep their semantic variants and keyboard focus states.
Closed dialogs restore the previous connected control unless their caller owns
focus restoration. Shared component rules live below caller utility classes in
the CSS cascade. Keep reduced-motion handling and theme variables when extending
the components, and remove superseded rules instead of adding override layers.

### Shared single-selection control

Import `Select` and `SelectOption` from `components/ui/select`. Its component owns
popup behavior and automatically loads its stylesheet; consumers need no settings
page CSS. Supply `label`, `value`, `onChange` and `options` (`value`, `label`, optional
`group` / `disabled`). Optional `className`, `id`, `name`, `placeholder` and
`disabled` support different layouts. Empty string is a valid option/filter value;
real IDs cannot collide with the internal encoding. Group headings, selected
checks, keyboard selection, scrolling, popup collision handling and Escape are
shared. Escape closes the popup before its parent dialog. `SettingsSelect` is a
compatibility export of the same implementation, without separate behavior.

The distributed views and dialogs use this control for collaboration, AX, Host,
status, project, operation, permissions, placement and Long Project selectors.
Settings appearance, model/provider, capability, Goal and host permission callers
share the same implementation. Keep page-specific CSS limited to width/layout;
change common selection styling in `components/ui/select.css`.

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


Workbench validation covers shared-AX/multi-Goal placement, shared Host capacity,
whole-Workflow pause/recovery, CAS and incarnation/generation fencing, scoped
native settings, partial batch results, actual ACP guidance and one-request
approvals, and native Long Project checkpoint continuity. Locally maintained
process scenarios use real AX workers and Crew with a controlled model endpoint;
UI/browser interaction scenarios cover both themes and narrow/wide layouts.
Those local test sources/results are not public build dependencies. Native
management paths must be tested against target AX commands, not only HTTP mocks.


### Shared disclosure control

Use `components/ui/disclosure` for expandable information and advanced form sections.
`Disclosure` accepts `title`, `children`, optional `defaultOpen` and `className`; it
loads its own stylesheet. Its shared Button provides Enter/Space, `aria-expanded`,
`aria-controls`, a rotating Lucide chevron and keyboard focus styling. Collapsing
hides rather than unmounts children, preserving form drafts. Distributed views and
all related dialogs use it instead of browser-native details/summary controls.

The server workspace also compiles outbound chat adapters using reqwest, tokio-tungstenite and prost. Windows channel sidecars use current-user DPAPI through windows-sys; no external Node/OpenClaw runtime or inbound relay is required. See [configuration and platform prerequisites](../chat-channels.md).

### Optional WhatsApp companion

The server embeds `apps/channel-bridge/whatsapp.mjs`, `package.json` and `package-lock.json` at compile time. Keep all three in source distributions. No Node build step is required for Rust compilation. At runtime, WhatsApp requires Node.js 20+ and the user-triggered dependency installation in Settings. `npm ci --omit=dev` in `apps/channel-bridge` installs dependencies for local development; `node_modules` is excluded from source control. iMessage uses the separately installed `imsg` binary on macOS.
