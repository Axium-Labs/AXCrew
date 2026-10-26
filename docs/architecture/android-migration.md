# Android client scope

The Android app controls an AXCrew Gateway through the same REST and WebSocket
API as the desktop client. It does not run an AX Runtime, execute remote shell
commands, manage model-provider credentials on a computer, or administer AX
installations and backups.

## Available workflows

| Area | Android support |
|---|---|
| Sessions | Connect to a Gateway, choose a device and project, create or continue conversations, and view live output and task history. Supports camera, image, file and voice input. |
| Tasks and schedules | View task details and create, edit, enable, pause, run or remove schedules. The desktop retains its visual workflow and calendar views. |
| Devices | View connection status, platform, version and reported capabilities; rename a device and submit work to it. Pairing and revocation remain desktop operations. |
| Permissions | Review pending tool requests and allow once, allow for the session or reject. Android does not approve requests automatically. |
| Activity and artifacts | Browse recent activity and task artifacts, then open the related task. Desktop-only artifact folder organization is not shared. |
| Settings | Configure a Gateway connection using Android Keystore protected credentials, sign out and follow the system theme. |

## Client and data boundaries

The Android client uses a native Compose interface backed by a ViewModel and
repository layer. It reads and writes through the Crew API; it does not connect
directly to server storage or link against server internals. Crew and Member
remain server-side execution entities; Android presents device and work choices
without exposing that internal team model.

Workspace file browsing, local terminal sessions, remote shell access and
desktop filesystem operations are unavailable on Android. Those capabilities
depend on desktop-local APIs and are not exposed through an equivalent restricted
Gateway interface. Android does not add a shell or file endpoint to bypass that
boundary.

## References

- [Platform support](../platforms.md) describes supported clients and packaging.
- [REST and WebSocket API](../protocol/api.md) defines the shared wire contract.
- [Desktop behavior](../desktop/README.md) describes desktop-specific workflows.
