# AXCrew documentation

Current AXCrew behavior and contracts are documented here. Release-specific
changes live under [releases](releases/); development procedures are separate.

## Documentation map

See [platforms.md](platforms.md) for Windows/Linux/macOS builds, packaging,
terminal defaults, telemetry, installer updates and capability limits.

| Document | Topic |
|---|---|
| [distributed-collaboration.md](distributed-collaboration.md) | Distributed control plane, scoped worker API, recovery and desktop management |
| [releases/0.3.11.md](releases/0.3.11.md) | Current release |
| [architecture/README.md](architecture/README.md) | System architecture: control plane modules, layering, boundaries, repository layout |
| [architecture/design.md](architecture/design.md) | AX/Crew runtime boundary and execution ownership |
| [architecture/storage.md](architecture/storage.md) | SQLite WAL database, durable vs live data, source-of-truth boundary |
| [platforms.md](platforms.md) | Platform support, packaging and client boundaries |
| [protocol/README.md](protocol/README.md) | REST, WebSocket and ACP contracts |
| [protocol/api.md](protocol/api.md) | REST/WebSocket API reference, authentication, pairing and connection |
| [development/README.md](development/README.md) | Build, test and packaging commands |
| [desktop/README.md](desktop/README.md) | Desktop chat, settings, imports and scoped AX capabilities |
Older release notes remain available in this directory by version.

## How to read

- **New users** — start with the repository [README](../README.md).
- **Contributors** — read [architecture/README.md](architecture/README.md)
  first, then the topic document for the area you touch.
- **Protocol work** — [protocol/README.md](protocol/README.md) points at the
  canonical descriptions so the contract cannot drift.
- **Documentation scope** — these pages describe current behavior and stable
  contracts. Machine-specific test results and task progress belong in local
  work logs, not product documentation.
