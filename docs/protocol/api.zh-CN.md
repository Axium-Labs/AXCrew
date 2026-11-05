<a id="rest--websocket-api"></a>
# REST 与 WebSocket API

[English](api.md) | **简体中文**

Crew 控制平面提供管理用 REST API 和实时事件 WebSocket 流。下列路由均实现于 `crates/server/src/api/`；协议兼容性承诺见 [README.md](README.zh-CN.md)。

<a id="authentication"></a>
## 认证

- 管理路由使用既有 Bearer 授权关卡。配置管理员令牌、留存的已签发令牌或手机授权后，必须进行认证；完全未配置的回环网关可以在本机无令牌使用。非回环绑定必须配置 `AX_CREW_ADMIN_TOKEN`，通过反向代理暴露 API 时也应设置。
- REST 接受 `Authorization: Bearer <token>`；`/api/ws` 也接受既有的 `?token=` 形式。手机凭证仅有受限的局域网 API 范围，不授予桌面管理员管理权限或模型供应商密钥访问权限。授权撤销/过期后，流会重新校验授权。
- 配对码兑换与设备网关是公开端点，分别由一次性配对码和 Ed25519 挑战保护。设备私钥绝不会进入 Crew 数据库。

<a id="crews-and-members"></a>
## Crew 与成员

- `POST /api/crews`：创建 Crew。
- `POST /api/crews/{id}/members`：向 Crew 添加成员。

成员字段：`device_id` 可以是 `local`、配对设备 ID 或已保存的 SSH 设备 ID；`cwd` 是执行主机上的绝对路径。本地/配对成员使用该主机的 AX 模型、技能和 MCP 配置。SSH 成员使用本地 AX 安装进行推理、加载技能和保存历史，远程主机只执行 Shell 命令，详见[连接](#connections-workspaces-and-projects)。`skills` 与 `mcp_servers` 是已安装/配置名称数组。`permission_profile` 为 `ask`（默认）、`allow` 或 `deny`；`max_concurrency` 默认为 1。

<a id="tasks"></a>
## 任务

- `POST /api/tasks`：使用 `crew_id`、`title`、`assigned_member`、`input`，以及可选 `dependencies`、`priority`、`parent_id`、`description` 创建任务。依赖必须已存在于同一 Crew，因此只允许创建的任务图天然无环。
- `POST /api/tasks/{id}/start`：启动根任务。依赖任务在所有前置任务完成后就绪并自动运行。
- `POST /api/tasks/{id}/retry`：重置失败或已取消任务。失败/已取消的依赖会令后继任务失败，直到重试或明确取消。
- `POST /api/tasks/{id}/cancel`：中断正在执行的工作。

`input` 可以是普通提示词字符串，也可以是 `{"prompt":"...","include_dependencies":true}`。后者会按确定顺序把已完成前置任务的最终输出加入 AX 提示词。Crew 不通过模型生成或修改 DAG。

<a id="sessions-and-devices"></a>
## 会话与设备

- `GET /api/ax/local` 列出本地 AX 项目和对话。`ACP session` 或空白占位标题采用首条用户请求，最多 80 个字符，不写入 AX 存储。`GET /api/ax/local/{ax_session_id}` 重放历史。
- `POST /api/sessions/attach` 接受 `ax_session_id` 和可选 `cwd`/`title`，记录已有本地对话绑定；已接入的对话复用原任务。未提供或仍为占位的标题从原始本地会话解析。后续消息使用 `/api/sessions/{task_id}/message` 恢复同一 AX 会话，不将原记录复制成新会话。
- `POST /api/sessions` 创建对话；空闲时，`POST /api/sessions/{task_id}/message` 追加后续消息。执行中则向当前会话的运行任务发送指导；AX 确认 `_ax/steer` 后返回同一任务，不另启执行，也不取消当前工作。权限等待期间同样如此；指导不会授权待审批工具。拒绝/不支持指导时返回错误，让客户端保留草稿。新轮次与后续消息均接受可选 `reasoning_effort`，其值必须来自所选供应商公开的协议值；该值存入任务输入，并在本轮传给 AX。省略时沿用默认行为。执行中指导保留当前轮次的模型、强度与权限，新选择在后续普通轮次生效。本地指导支持既有附件载荷，配对/SSH 的附件限制不变。实时事件与持久历史中的指导更新使用 `user_message_chunk`、`_ax.steering:true` 和稳定的 `messageId`。
- 规划问题以 `payload.sessionUpdate: agent_question` 到达，内容为 `{id,text,allowFreeText,options:[{id,label,description?}]}`。带 `_meta.axGoal.waiting_for_user:true` 的 prompt 响应会把 Crew 任务停驻为 `waiting_user`；`output` 保留问题和 AX `goal_id`，`finished_at` 保持 null。此时发出 `task.waiting_user`，而不是 `task.completed`。持久事件索引保存问题 ID，实时事件保留完整问题。
- `POST /api/sessions/{task_id}/answer` 接受 `{question_id,option_id}` 或 `{question_id,text}`，返回同一 Task，并将其排队为 `ready`。待回答问题与回答在事务中原子校验。无效、过期或重复回答返回既有 400 错误结构。原任务输入与 AX 绑定不变；临时排队回答保存在任务输出中，直到执行结束。恢复的 ACP prompt 携带 `_meta.axGoal:{action:"answer",goal_id,answer}`；此元数据是权威信息，但不授予工具权限。
- 向 `waiting_user` 对话发送 `/message` 文本时，是回答当前问题而非创建新任务。支持选项 ID、标签及从 1 开始的编号；其他文本需要 `allowFreeText`。此路径拒绝附件/上下文。已排队回答不能再次接受。重启后未回答任务仍保持停驻，恢复运行时也保留已排队回答的身份。
- 模型能力目录提供每个模型的 `reasoning_efforts` 与 `default_reasoning_effort`。桌面必须使用该子集，不自行生成通用强度档位；空值或缺失时不显示滑块。
- `GET /api/tasks`、`/api/tasks/{id}`、`/api/sessions`、`/api/sessions/{task_id}` 查看状态与 AX 会话绑定。
- `GET /api/devices` 列出设备；`POST /api/devices/{id}/rename` 接受 `{"name":"..."}`；`POST /api/devices/{id}/revoke` 撤销授权。

<a id="live-events-and-permissions"></a>
## 实时事件与权限

`GET /api/ws` 传输实时 `CrewEvent` JSON。工具审批产生携带 `request_id` 的 `permission.requested`；通过 `POST /api/permissions/{request_id}/resolve` 与 `{"option_id":"allow_once"}` 处理，也支持 `allow_session` 或 `reject_once`。五分钟内未回应的请求自动拒绝；任务取消时，未处理请求立即拒绝。

`payload.sessionUpdate` 的取值（`agent_message_chunk`、`agent_thought_chunk`、`tool_call`、`tool_call_update`、`turn_changes`）与 ACP 适配器共享；`event_id`、`kind`、`task_id`、`payload` 信封保持稳定。

子代理更新使用 `kind: "subagent.update"` 与 `payload.sessionUpdate: "subagent"`。稳定的 `agentId` 标识执行，`parentAgentId` 关联嵌套委派，`childSessionId` 标识 AX 子会话。`title`、`task`、`status`、可选 `summary`/`error`，以及可选嵌套 ACP `update` 描述子代理活动。嵌套更新可包含助手文本、工具调用/结果或模型连接状态；其作用域属于子代理，不成为父任务最终助手文本。`GET /api/sessions/{task_id}/history` 使用所分配设备上既有父会话绑定重放这些信封，客户端不能选择子会话路径或存储。`GET /api/events` 仅返回已脱敏的子代理 ID/状态与嵌套更新类型；详细历史仍由 AX 持有。

对于直接本地历史和 ACP 不可用时的回退，Crew 只读取 AX 父系统记录引用、位于该 AX 存储规范 `child-runs` 目录之下的子存储。子文件缺失或不可读时仍保留已知生命周期。回退最多读取 256 个存储、32 MiB 或 20,000 条子更新；达到界限后可向子代理信封添加 `historyTruncated: true`，继承的子提示词与推理内容不包含在回退结果中。即使父任务尚未记录最终生命周期事件就已停止，AX 保存的子代理结果仍可恢复终态。没有子代理索引的旧本地记录可能在该回退路径中缺少子详情；正常 ACP 检查路径使用 AX 自身的兼容重放。

<a id="pairing-and-connection"></a>
## 配对与连接

在运行 Crew 的机器上使用管理员令牌签发一次性配对码：

```powershell
$headers = @{ Authorization = "Bearer $env:AX_CREW_ADMIN_TOKEN" }
$pair = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8765/api/pairing' -Headers $headers
$pair.code
```

在待连接机器上，使用该机器自己的 AX 构建和本地配置的模型凭证执行：

```powershell
ax crew pair <code> --gateway https://crew.example.com
ax crew connect https://crew.example.com
```

`ax crew connect` 会自动重连。`http://127.0.0.1:8765` 仅用于同机测试。设备状态通过签名认证和心跳更新；Socket 断开后设备标记为离线。进行中的远程工作返回 `ready`，设备重连后使用已绑定的 AX Session。AX 的中断工具恢复会标注未知副作用，不自动重放这些操作。

<a id="storage-boundary"></a>
## 存储边界

Crew 的 WAL SQLite 数据库保存设备、哈希配对码、Crew、成员、任务、依赖、运行记录、会话绑定和脱敏事件索引。任务最终输出作为结果保存。消息增量、工具参数与权限输入实时广播，但排除在持久事件载荷之外。AX 自身项目的 `.ax` 目录仍是会话对话与记忆的权威来源。表结构和持久化规则见 [architecture/storage.md](../architecture/storage.zh-CN.md)。

<a id="distributed-api-additive"></a>
## 分布式 API（增量扩展）

`/api/distributed` 提供限定作用域的工作进程凭证、持久 Tasks/Events/Workflows、租约围栏隔离与不可变产物交换，独立于旧设备配对和任务 API。详见权威的[分布式协作 REST 约定](../distributed-collaboration.zh-CN.md#rest-contract)；既有认证/错误/路由约定不变。

<a id="connections-workspaces-and-projects"></a>
## 连接、工作区与项目

以下路由均要求既有管理员认证。

| 方法和路由 | 约定 |
|---|---|
| GET /api/connections/ssh | 活跃的已保存主机：id、name、host、port、identity_file；可选字段为 null。 |
| GET /api/connections/ssh/discover | 网关用户主 SSH 配置中明确的 Host 别名，不包含通配别名。 |
| POST /api/connections/ssh | 保存 name、host，以及可选 port、identity_file。host 为主机名或 user@host，port 范围 1..65535；返回生成的 ssh: ID，初始离线。 |
| POST /api/connections/ssh/{id}/connect | 无需 AX 探测 SSH 远程目录；成功标记在线，失败标记离线。 |
| GET /api/devices/{id}/workspace?cwd=... | 主机侧只读列表：cwd、parent，以及含 name/path 的目录。未提供 cwd 时从用户主目录开始。 |
| GET /api/projects | 已持久化的 id、name、device_id、cwd、member_id 条目。 |
| POST /api/projects | 在所属主机上校验 name、device_id、cwd；创建或复用绑定环境。 |
| DELETE /api/projects/{id} | 移除项目标签，保留成员与会话。 |
| POST /api/environments/{id}/model | provider/model 创建或复用 device/cwd/policy/capabilities 相同的不可变成员，并返回该成员。 |

SSH 记录只保存 Crew 网关上的身份文件路径，绝不保存私钥内容。既有设备撤销路由会将主机从活跃选项中移除。对于 SSH，模型/技能/能力检查和历史使用本地 AX；远程目录通过 SSH Shell 命令列出。远程会话创建使用 member_id 而非本地 cwd；后续消息保持绑定初始环境。配对设备历史失败时，绝不回退到本地存储；SSH 历史属于本地 AX 存储。

对于配对 AX，省略 cwd 时返回已注册根目录，cwd 为空、parent 为 null，提示为 registered_workspaces。仅可校验精确的已注册根目录，其返回结果禁用父目录/子目录导航。心跳 capabilities.workspaces 公布 id/name/path 根目录；旧设备回退到已有 Crew 成员根目录。

SSH 执行上下文通过 AX_SSH_CONTEXT_FILE 传给本地 AX，该变量指向短期存在的 JSON 清单，包含 hosts、default_host 和远程 cwd。使用文件可避免大型目录触及环境块大小限制。独立集成仍支持 AX_SSH_CONTEXT JSON。不会启动远程 AX 进程。ssh 工具支持 list 或 exec 动作、可选 host_id/cwd/timeout_seconds 及远程命令；主机列表绝不暴露私钥路径。SSH 任务绕过已配置的 Crew 全局/成员并发限制；独立 SSH 工具绕过固定本地工具池，但仍遵循依赖/资源与权限检查。本地和配对 AX 限制不变。

分布式协作增加管理员 Workflow 策略/控制、按代次隔离的重新分配、实时 Session 收件箱、经确认的部分批量操作，以及目标主动启用的原生管理操作。工作进程收件箱/结果要求既有租约，原生管理要求实例化标识。这些能力均为 `/api/distributed` 下的增量扩展，详见[工作台权威约定](../distributed-collaboration.zh-CN.md#workbench-policy-session-control-and-native-settings)。

`DELETE /api/distributed/instances/{id}` 要求管理员授权；首次或重复移除均返回 `{"accepted":true}`。编排层拒绝移除仍拥有/固定未完成 Tasks、明确属于未完成 Workflows，或正在执行原生管理的实例。去掉凭证的元数据移至快照 `removed_instances`；Host、Task、Attempt、Session、Event、检查点和产物历史保持不变。

<a id="chat-channel-management"></a>
## 聊天渠道管理

桌面管理员使用的 `/api/channels` 配置、账号绑定与微信扫码流程见[聊天渠道](../chat-channels.zh-CN.md)。管理响应绝不包含平台凭证。原生局域网手机凭证不能管理信任/渠道/SSH/分布式设置，也不能读取模型供应商密钥；管理员/已签发令牌的权限不变。撤销和过期会终止现有事件流。实验性 `/api/direct` 与 `/api/remote` 路由已移除。

`POST /api/channels/whatsapp/install` 为桌面管理员安装可选配套依赖。`POST /api/messaging/teams` 是独立的、上限为 256 KiB、经 Microsoft JWT 验证的入站接口；Crew 管理员/手机令牌不能授权该接口。扩展平台字段与限制在聊天渠道约定中定义。
