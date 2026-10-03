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
