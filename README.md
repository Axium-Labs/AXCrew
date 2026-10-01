# AX Crew Backend

聊天执行区使用逐调用紧凑行。说明和思考直接显示为正文，同一 call ID 的开始、成功、失败原地更新。点击工具行展开真实工具类型、操作、压缩结果；原始输出需要再次展开，长输出在卡片内部滚动。错误不会变成成功。超过一分钟的耗时显示为分钟，超过一小时显示为小时。每轮结束显示修改文件卡片；ACP `turn_changes` 优先于 patch 累计统计，历史回放保留该卡片。
输入框上方显示当前轮已成功修改的文件数及增删行数，工作进行中实时更新，点击汇总可在右栏查看差异；轮结束后的权威变更快照替代增量统计。移除普通“正在回复”小字，保留等待授权、失败等状态提示。

会话输入框随文本和面板宽度自动增高，达到上限后在框内滚动。设置中的提供商列表使用对齐列，窄窗口自动换行。导入页自动扫描用户目录及当前项目中的 Codex、Cursor、Claude Code、Windsurf 和共享 `.agents/skills` 配置，可勾选技能包或整份 MCP 配置导入当前项目/全局 AX，也支持手动选择路径。扫描只读取配置；导入结果按项显示，同名冲突交由 AX 拒绝，失败项保留供重试。

npm run tauri:dev
AX Crew now also includes a native [Android control client](android/README.md) in `android/`.
It connects to the same computer-hosted Crew Gateway over HTTPS/WSS, with devices,
Crews/Agents, task submission and streaming, session history, and mobile permission
approval. See the [desktop-to-Android feature mapping](android/MIGRATION.md) for scope.
The desktop's **Settings → 连接与系统 → Android 控制客户端** panel shows the current
loopback upstream and temporary admin token for configuring your HTTPS reverse proxy.
The phone does not run AX or connect through SSH. Android development/build/install
and connection instructions are in [android/README.md](android/README.md).

AX Crew is a Rust control plane for the existing [AX](../ax) runtime. It schedules deterministic task DAGs across AX devices, maintains device identity and session bindings, and streams events. AX owns the agent loop, session history, memory, tools, skills, MCP, models, permissions, and credentials. See [DESIGN.md](DESIGN.md) for the source-based call-chain analysis and schema/state machines.

## Build and start

Desktop Settings > AX includes **Agent environment** (Windows native / WSL)
and **Integrated terminal shell** (PowerShell / Command Prompt / Git Bash /
WSL). These settings are shared with `ax environment` and the AX TUI's
`/environment` menu. They apply to new AX processes and new terminal tabs.
Install Linux AX at `~/.local/bin/ax` in the default WSL distribution before
selecting WSL; Crew checks availability before saving. Desktop child processes
use Crew's `AX_HOME` (by default `~/.ax`) so the launcher and settings agree.

Build AX and Crew separately:

```powershell
cd C:\Users\14181\Desktop\axlab\ax
cargo build -p cli
cd C:\Users\14181\Desktop\axlab\ax_crew
cargo build
$env:AX_CREW_ADMIN_TOKEN = '<long-random-admin-token>'
.\target\debug\ax-crew.exe --ax C:\Users\14181\Desktop\axlab\ax\target\debug\ax.exe --database .\crew.sqlite3 --listen 127.0.0.1:8765
```

Crew binds loopback by default. A non-loopback bind requires `AX_CREW_ADMIN_TOKEN`. For PC B, expose the gateway through HTTPS/WSS with a TLS reverse proxy that forwards WebSocket upgrades to Crew. Set the admin token whenever the API is reachable beyond the local machine, including through a reverse proxy. All REST query/control routes and `/api/ws` require `Authorization: Bearer <token>` when set. Pair-code redemption and the device gateway are public endpoints protected by the one-time code and Ed25519 challenge respectively. Device private keys never enter Crew's database.

Issue a one-time code from PC A:

```powershell
$headers = @{ Authorization = "Bearer $env:AX_CREW_ADMIN_TOKEN" }
$pair = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8765/api/pairing' -Headers $headers
$pair.code
```

On PC B, using its own AX build and locally configured model credentials:

```powershell
ax crew pair <code> --gateway https://crew.example.com
ax crew connect https://crew.example.com
```

`ax crew connect` reconnects automatically. Use `http://127.0.0.1:8765` only for a same-machine test. Device status is updated by signed authentication and heartbeats; losing the socket marks it offline. Active remote work returns to `ready` and uses its bound AX Session when the device reconnects. AX's interrupted-tool recovery marks unknown side effects instead of replaying them.

## API and workflow

Create a Crew through `POST /api/crews`, then members through `POST /api/crews/{id}/members`. Member `device_id` is `local` or a paired device ID; `cwd` is an absolute path **on that device**. `provider` and `model` select models already configured in that device's AX installation. `skills` and `mcp_servers` are arrays of locally installed/configured names. `permission_profile` is `ask` (default), `allow`, or `deny`. `max_concurrency` defaults to 1.

Create tasks with `POST /api/tasks` using `crew_id`, `title`, `assigned_member`, `input`, and optional `dependencies`, `priority`, `parent_id`, `description`. Dependencies must already exist in the same Crew, so the create-only graph is acyclic by construction. Start a root task with `POST /api/tasks/{id}/start`. Dependent tasks become ready and run automatically after all predecessors complete. Failed or cancelled dependencies fail descendants; `POST /api/tasks/{id}/retry` resets a failed or cancelled task. `POST /api/tasks/{id}/cancel` interrupts active work.

`input` may be a plain prompt string or `{"prompt":"...","include_dependencies":true}`. The latter adds the completed predecessors' final outputs to the AX prompt in a deterministic order. Crew does not generate or revise the DAG with a model.

`GET /api/tasks`, `/api/tasks/{id}`, `/api/sessions`, and `/api/sessions/{task_id}` inspect state and AX session bindings. `GET /api/devices` lists devices; `POST /api/devices/{id}/rename` takes `{"name":"..."}`, and `/revoke` removes authorization. `GET /api/ws` streams live `CrewEvent` JSON. A tool approval produces `permission.requested` with `request_id`; resolve it with `POST /api/permissions/{request_id}/resolve` and `{"option_id":"allow_once"}` (also `allow_session` or `reject_once`). Unanswered requests are denied after five minutes. When cancelled, an outstanding request is denied immediately.

Crew's WAL SQLite database holds devices, hashed pairing codes, Crews, members, tasks, dependencies, runs, session bindings and a redacted event index. The task's final output is kept as its result. Message deltas, tool arguments and permission inputs are broadcast live but excluded from the durable event payload. AX's own project `.ax` directory remains the source of truth for session conversation and memory.

## Verification

The process-level smoke test uses a local fake model endpoint, two AX processes, and the Crew server; it does not call an external model:

```powershell
python tests/smoke.py C:\Users\14181\Desktop\axlab\ax\target\debug\ax.exe .\target\debug\ax-crew.exe
```

It covers ACP session setup, local-to-remote DAG execution, live event mapping, permission resolution, cancel/retry, disconnect/reconnect with the same AX Session, pairing, and revocation.

## Desktop settings and imports

会话页运行时显示“思考中”和实时用时，完成后保留用时并收起执行过程。每条用户消息和模型回复下方可以复制正文；模型回复的分支按钮以该位置之前的用户/模型文字创建独立会话，继承工作目录和执行环境，不复制工具执行状态或更改原会话。

每轮修改的文件在回复底部列出，点击文件或“查看变更”打开右侧变更页，可切换保存的差异与当前文件内容。输入框图片和已发送图片都可以点击预览；历史图片从原工作目录读取。选中文字后可添加到输入框或在右侧聊天中提问。侧边聊天发送到独立 AX 会话，使用只读权限，切换侧栏标签保留聊天；后端仍保留其任务与历史记录。

Settings has separate Connections (`/settings/connections`) and System
(`/settings/system`) pages. Connections contains remote AX pairing and phone
access; System contains service status, desktop behavior and Crew updates.
Model settings groups account sign-in, API-key and environment providers.
WorkBuddy China and International are separate accounts. Account sign-in shows
a URL to click or copy; closing the dialog cancels waiting. AX stores the
credentials and refreshes models after authorization.

Settings → AX capabilities imports local Skill directories and MCP TOML or
JSON through the installed AX's `skill import` / `mcp import` commands. Choose
project or global scope. An updated AX executable is required for these commands.

Terminal tabs can be dragged to reorder, and scrolled horizontally. Right-click
a conversation to rename, mark, group under a project or delete it from the
list. These labels and groupings are saved on this desktop; moving a conversation
does not change its execution directory. Deleted entries can be restored from
Show deleted; AX history is preserved. Language switching translates interface
controls while leaving user text, generated answers and package descriptions
unchanged. Speech credentials have independent reveal buttons.

To preview both workspace release builds without replacing your installed AX,
quit the existing Crew from its tray, then run
`desktop/scripts/start-workspace.ps1`. The script sets AX_CREW_AX and
AX_CREW_BACKEND only while starting the app, then restores your shell environment.
`-CheckOnly` verifies the three build paths without launching anything.

Windows 安装包在覆盖/卸载文件前按完整安装路径关闭遗留的 Crew 桌面和后台进程，并等待退出，避免旧版本遗留网关占用 `bin/ax-crew.exe`。安装器清理指令由 `desktop/scripts/prepare-binaries.mjs` 从可读 PowerShell 源码生成，使用 `desktop` 下的 `npm run tauri:build` 打包。
