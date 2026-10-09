# AX Crew Documentation

Documentation for the AX Crew control plane and its clients. Each topic has one
focused document; this page is the map.

## Documentation map

| Document | Topic |
|---|---|
| [distributed-collaboration.md](distributed-collaboration.md) | Distributed control plane, scoped worker API, recovery and desktop management |
| [releases/0.3.4.md](releases/0.3.4.md) | AXCrew 0.3.4 desktop, SSH and distributed collaboration updates |
| [architecture/README.md](architecture/README.md) | System architecture: control plane modules, layering, boundaries, repository layout |
| [architecture/design.md](architecture/design.md) | Source-based AX call-chain analysis, Crew/AX boundary, schema, state machines |
| [architecture/storage.md](architecture/storage.md) | SQLite WAL database, durable vs live data, source-of-truth boundary |
| [architecture/android-migration.md](architecture/android-migration.md) | Desktop-to-Android feature mapping and scope |
| [protocol/README.md](protocol/README.md) | REST, WebSocket and ACP contracts |
| [protocol/api.md](protocol/api.md) | REST/WebSocket API reference, authentication, pairing and connection |
| [development/README.md](development/README.md) | Build, test and packaging commands |
| [desktop/README.md](desktop/README.md) | Desktop chat, settings, imports and scoped AX capabilities |
| [releases/0.2.5.md](releases/0.2.5.md) | AX Crew 0.2.5 release snapshot |
| [releases/0.2.6.md](releases/0.2.6.md) | AX Crew 0.2.6 release snapshot |
| [releases/0.2.7.md](releases/0.2.7.md) | AX Crew 0.2.7 release snapshot |
| [releases/0.2.8.md](releases/0.2.8.md) | AX Crew 0.2.8 release snapshot |
| [releases/0.2.9.md](releases/0.2.9.md) | AX Crew 0.2.9 release snapshot |
| [releases/0.3.3.md](releases/0.3.3.md) | AXCrew 0.3.3 distributed control plane and management page |
| [releases/0.3.0.md](releases/0.3.0.md) | AX Crew 0.3.0 release snapshot |

## How to read

- **New users** — start with the repository [README](../README.md).
- **Contributors** — read [architecture/README.md](architecture/README.md)
  first, then the topic document for the area you touch.
- **Protocol work** — [protocol/README.md](protocol/README.md) points at the
  canonical descriptions so the contract cannot drift.
