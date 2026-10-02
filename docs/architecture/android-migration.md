# 桌面实现与 Android 对应关系

实现依据：根 README、[设计说明](design.md)，Rust 后端（`crates/server/src/`：`api/`、`domain/`、`storage/`、`orchestration/`、`transport/`、`gateway/`、`ax/`），桌面 `App.tsx` 路由、`pages`、Zustand `store`、`lib/api.ts/types.ts/live.ts/query.ts/conversations.ts/sessionTranscript.ts` 以及 Tauri commands。Android 是新增目录，不迁移或重写桌面架构。

## 产品结构

| 桌面现有实现 | Android 首版 | 范围与差异 |
|---|---|---|
| SessionsWorkspace / Sessions | 会话首页 + 历史侧栏 | 未连接也可写草稿，左上角连接 Gateway / 切换设备；按设备和 AX session 合并多轮；创建、继续、停止、历史、实时消息与工具状态；已支持拍照、图片、文件与语音输入；未迁移 Markdown 富渲染、斜杠补全 |
| Tasks | 会话执行与任务详情 | 底部入口已改为计划；会话、设备及计划记录可打开任务详情，保留状态、start/cancel/retry 和结果；没有桌面可视化 DAG |
| Devices / DeviceDetail | 设备、详情 | 在线/离线、平台/架构/版本、最近在线、能力目录、重命名、按设备发任务；配对新 AX 与撤销仍在桌面执行 |
| Crews / CrewDetail / MemberWorkspace | 隐藏内部团队结构 | 手机直接选择设备、工作目录和模型；底层保留 Crew/Member 执行实体及权限 |
| Home / permission banner | 顶部状态、全局审批入口与横幅 | 待审批列表恢复，显示实际工具输入、Allow Once/Allow Session/Reject；不自动批准 |
| Activity | 更多 → 动态 | 实时事件 + 脱敏历史，最近 300 条；暂不提供桌面的多维过滤和无限分页 |
| Artifacts | 更多 → 产物 | 与桌面同样从 Task output 派生；可打开对应任务；桌面 localStorage 的文件夹归档不共享 |
| Schedule | 计划 | 创建、编辑、暂停/启用、运行、删除、七日概览、执行记录；文件夹管理留在桌面 |
| Settings | 连接与系统、跟随系统主题 | HTTPS Gateway + Keystore 凭据、退出；不管理电脑上的模型登录、AX 安装和备份 |
| WorkspaceFiles / 项目目录 / GoalLoop | 暂未迁移 | 依赖 Tauri 本地文件/进程 API，Gateway 没有等价受限文件接口；不新增远程 shell 绕过边界 |
| TerminalDock | 不迁移 | 原生终端属于电脑本地能力，手机只控制 Crew API |

移动端启动进入会话首页，底部常驻输入框，左上角打开连接与历史侧栏；连接配置使用底部面板，不阻挡首页。保留四项底部导航，大屏切换导航栏；桌面多栏工作区拆分为会话/详情/表单。保留 AX CREW 品牌、灰蓝表面、紫色强调、圆角面板、等宽状态/日志。UI 只调用 ViewModel/Repository，不直接操作 OkHttp。

## 工程

```text
apps/android/
  app/src/main/java/com/axcrew/android/
    MainActivity.kt                 Compose / ProcessLifecycleOwner
    navigation/CrewApp.kt           Navigation Compose + adaptive shell
    feature/                       ViewModel and feature screens
    ui/                            shared panels, status, fields and theme
    data/
      SecureConnectionStore.kt     Android Keystore encrypted configuration
      model/                       serializable wire DTOs, conversation/transcript logic
      network/GatewayApi.kt        cancellable OkHttp HTTP + WebSocket
      repository/CrewRepository.kt snapshot, events, reconnect, actions
  app/src/test/                     TLS protocol/lifecycle regression tests
```

## 协议复用

- 设备/团队/成员/任务直接使用 `/api/devices`、`/api/crews`、`/api/crews/{id}/members`、`/api/tasks`，`Agent` 就是原 `Member`，没有创造另一种运行时实体。
- 执行操作调用 `/api/tasks/{id}/{start,cancel,retry}`。会话绑定 `/api/sessions`，历史 `/api/sessions/{task_id}/history`，续写 `/api/sessions/{task_id}/message`。
- 原 `/api/ws` `CrewEvent`，使用 `event_id/kind/task_id/payload`；沿用 `agent.message.delta`、`task.*`、`permission.*`、`tool.*`、`session.bound`、`device.*`。
- 内容读取 `payload.sessionUpdate` 的 `agent_message_chunk/agent_thought_chunk/tool_call/tool_call_update`，与桌面一致。
- `/api/permissions` 返回 `{request_id, request:{sessionId,toolCall,options}}`。解析选择用原 `/api/permissions/{request_id}/resolve` 和 `option_id = allow_once | allow_session | reject_once`。
- 无后端数据迁移、无新 REST 路由、无新鉴权绕过。新增可选 files 字段和 session_files 标志；后端让 `/api/ws` 同时读取客户端控制帧响应 Ping，并在广播丢帧时断开促使客户端重新同步；浏览器协议保持兼容。

## 仓库其他改动

- 桌面新增 `AndroidConnection.tsx`，Settings 增加同一 Gateway 连接信息入口；不改原端口生成、托盘和后端生命周期。
- `crates/server/src/ax/mod.rs`（当时为 `src/local_ax.rs`）只修复既有测试夹具指向错误临时 AX_HOME 的问题，并恢复之前的环境变量。
- `tests/smoke.py` 配对命令增加 `--`，避免随机配对码以 `-` 开头时被解释为 CLI 参数。
- `tests/gateway_socket.py` 验证原生 WebSocket 心跳与任务事件；全部使用临时数据库。

## 会话与计划交互更新

- 移除手机「团队」导航，内部 Crew/Member 协议保留；任务导航替换为桌面「计划」。
- 新增 `feature/Composer.kt`（语音、系统相机、图片/文件选择）、`feature/ScheduleScreen.kt`（计划编辑与执行记录）、`data/AttachmentReader.kt`（受限读取附件）。
- `SessionScreen.kt` 直接使用现有会话 API，并按设备能力提供模型选择；既有会话模型固定。
- `crates/server/src/api/sessions.rs` 与 `api/composer.rs`（当时为 `src/main.rs`）兼容增加会话 files 字段、settings.session_files 标志及文件安全落盘。旧版桌面的 images 和文字请求保持兼容。
- 本次已迁移图片附件和计划列表/编辑/运行/记录；尚未迁移桌面文件夹管理、拖动日历、富 Markdown、远端设备文件传输。手机计划日历使用适合窄屏的按日列表。
