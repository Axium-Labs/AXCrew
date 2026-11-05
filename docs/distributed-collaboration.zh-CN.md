<a id="distributed-collaboration"></a>
# 分布式协作

[English](distributed-collaboration.md) | **简体中文**

此功能在 AXCrew 0.3.3 与配套 AX 0.3.7 中引入，与既有 Crew/Task/Session/设备控制并存。从桌面侧栏 **Distributed**（`/distributed`）管理集群。既有路由、SQLite 数据和 Android 控制保持兼容；专用集群管理页目前仅在桌面提供。桌面包含协作工作区、Host/AX 节点和跨 Goal 执行活动三个视图。需求、配置预览、工具详情和历史的展开区域统一使用 Disclosure 控件，支持键盘交互并保留表单草稿；高级策略、原始检查点和恢复标识在对应协作中按需展开。

<a id="model-and-boundaries"></a>
## 模型与边界

`Host → AX Instance → Execution` 同时允许一台 Host 上的多个 AX 实例，以及同一 AX 通过隔离 Session 参与多个 Goal。会话隔离本身不代表并发：工作进程按明确批准的执行上限启动独立 ACP 进程，默认一个，并受共享 Host 资源预留约束。本地 AX 子代理/Session/Task 保留原有身份和运行时。新增分布式 Task 是 AXCrew 内持久化的工作规格、所有权记录与执行尝试历史。

AXCrew 负责任务分配、所有权、放置、重试、取消和故障接管。AX 自行决定需要何种协助，并进行推理与本地执行。工作进程通过出站 REST 轮询获取任务；AX 实例之间无需直连，也无需始终存活的协调 Agent。

```text
Task decomposition → capability scheduling → cross-machine execution
→ Event / Artifact return → state persistence
→ failure recovery / replanning → continued execution
```

代码沿用既有分层：`domain/distributed.rs` 定义聚合；`storage/repositories/distributed.rs` 负责 SQLite 事务/二进制内容访问；`orchestration/distributed.rs` 负责策略和状态迁移；`api/distributed.rs` 负责认证、传输输入校验和响应结构。`main.rs` 启动每两秒运行一次的协调器。AX CLI 工作进程通过既有 ACP 适配器执行分配，不把模型推理移入 Crew。

<a id="durable-state"></a>
## 持久状态

<a id="optional-ax-goal-checkpoints"></a>
### 可选 AX Goal 检查点

AX 工作进程将显式 Goal 绑定到既有 Durable Task ID，并写入 `Workflow.state.ax_goal_runtime[task_id]`，其中包含 AX 原有 TaskQueue、累计 Runtime 消耗/预留和有界 Message 回执。每次写入由普通 Workflow 检查点端点/CAS、源租约、实例化标识与代次授权；不新增 Crew 表结构、调度器或预算账本。普通任务省略这些检查点。既有 256 KiB Workflow 上限仍适用；检查点写入失败时，执行必须先停止，不能继续推进。

新所有者通过绑定主机的 ACP `session/new` 元数据导入权威 Goal 状态，保留消耗及验证器版本/绑定。状态缺失、验证器不可用/不兼容、中断检查不安全、普通工具副作用或未迁移的本地子工作区，都会阻止自动执行，直到完成协调。工作区相对策略路径会重定位；外部路径被拒绝。不会自动迁移完整 Session 数据库/工作区。结果提交仍由既有 Durable Task 所有者/代次隔离。

工作进程配置 `resume_goals` 默认为 false：主动暂停或受阻 Goal 会保留，不会无人值守恢复。中断的运行工作使用既有 Crew 故障接管；开启恢复不会重置上限或绕过副作用审查。旧工作流保留原有失败尝试结果。工作台工作流会在当前 ACP Session 内保持暂停/受阻 AX Goal 或待回答问题可交互，同时保留执行租约和槽位。Crew 级暂停隔离执行进程，并保留最新权威检查点。桌面 Goal 设置修改新 Goal 模板，不改变运行中保存的策略。回执约定和 Runtime 边界见 AX 的 `docs/goal.md`。

增量表：

| 表 | 用途 |
|---|---|
| `distributed_cluster` | 单个事务性 JSON 聚合：Hosts、Instances、Tasks、执行尝试、Workflows、产物元数据、有序 Events 与上报回执 |
| `distributed_blobs` | 按 SHA-256 寻址的不可变产物字节 |

更新在既有数据库互斥锁下使用 SQLite IMMEDIATE 事务。所有权、执行尝试代次、资源预留和 Events 一起提交。实例凭证以 SHA-256 摘要保存，并从公开视图移除。该聚合刻意独立于旧任务/会话/设备表。SQLite 数据库必须放在持久存储中；进程重启保留状态并协调过期租约。它是一个权威 Crew 进程，不是分布式多写数据库或复制共识实现。

任务按 `pending → running → completed / failed / cancelled` 推进；操作者暂停引入 `paused`，恢复后重新进入可放置状态。租约丢失会结束当前尝试，并将任务返回 pending，直到重试预算耗尽，默认 3 次，接受 1–20。显式重试增加 3 次机会，不改写提交身份。失败/已取消任务的依赖后继会失败；独立分析/重规划任务可消费其错误摘要/产物。取消向子任务级联。尝试历史和 Events 保留。

每个运行尝试都有 AX 所有者、工作进程实例化标识、代次和 90 秒租约。心跳只续约仍存活且匹配的尝试。接管递增代次；迟到结果、过期续约和旧实例化标识被拒绝。同一报告消息 ID 的重复上报必须内容完全相同。子任务提交身份为 `(parent_task_id, request_id)`，不依赖父尝试的 AX 所有者，因此恢复时复用既有子任务。根任务身份限定于创建者。

每个根任务创建一个 Workflow，子任务继承它。Workflow State 是显式 JSON 检查点，上限 256 KiB，使用比较并交换修订号。分配包含检查点、已知工作流任务/结果和观察记录。规划 AX 失败后子任务仍可继续，接管者可从持久状态重规划。存在 pending/running 任务时 Workflow 活跃；协作策略暂停任务放置时它处于 paused。即使根任务成功，失败的同级任务仍会阻止完成。只有所有保留任务均完成，终态 Workflow 才算 completed；已取消同级任务会阻止虚假成功。这不会迁移完整 AX 会话，也不会自动序列化模型隐藏状态。

<a id="instance-deregistration"></a>
## 实例注销

Nodes 提供逐实例 Delete 与明确确认。这只移除 Crew 注册，不移除 AX 安装、本地配置、Memory、Sessions 或工作区。现有聚合把去掉凭证、已禁用的元数据放入有 serde 默认值的 `removed_instances`，与活跃 `instances` 分开；旧快照加载时归档为空。已删除 ID 不参与目录、调度、注册选项、在线统计与工作进程认证。工作进程重连前必须重新注册，取得新身份/令牌。

删除与后端检查原子执行：实例仍拥有或被明确固定到非终态 Task、被选为未完成 Workflow 成员，或正在执行原生命令时禁止删除。先重新分配/取消相关 Tasks、移除明确 Workflow 成员或等待管理结果。待执行原生命令及无法投递的执行命令会明确失败。Tasks、尝试、Session 链、产物、Events、检查点与 Host 记录保留。Activity 可将已删除 AX 作为历史实例筛选，并保留 Host → AX 名称；Goal/成员历史标记为已删除。历史固定放置和参与策略作为历史保留；重试前应替换已删除的成员/AX 分配。同 Host 上其他 AX 不受影响。重复删除幂等，未知 ID 被拒绝。

没有活跃 AX 的 Host 显示无实例提示，并提供需独立确认的 **Remove host**。移除要求没有已注册 AX，且没有未完成任务固定到该 Host，检查原子完成。`removed_hosts` 为 Activity 保留禁用清单；`hosts` 仍是在线统计、注册选项和调度使用的活跃清单。不删除本地机器文件。新的显式注册可复用 Host ID，重新检测清单；旧实例凭证仍被撤销。

<a id="removing-and-cancelling-collaborations"></a>
## 移除与取消协作

**Cancel collaboration** 确认后停止所有未完成工作，并将协作保留在 Workspace。**Remove collaboration** 适用于所有状态，包括已取消或空协作。确认当前工作数量后，在单个事务中移除整个内部任务图：取消未完成任务，清除所有者/租约，使待执行/运行中的 Session 命令经正常协调失败。迟到工作进程写入仍被隔离。其他保留工作流的依赖后继会阻止移除，并显示任务名和详情链接。

已有数据中的 `Workflow.removed` 默认为 false。移除的工作流及任务不再出现在 Workspace 和活跃统计中，但执行回执、Sessions、产物与检查点仍保留于 Activity；它们拒绝配置、控制、检查点写入和新工作。重复移除幂等。管理员可明确向已取消但仍保留的工作流添加新任务；只启动新工作，原已取消任务保留结果。工作进程不能自行重新打开已取消工作流。编辑元数据允许空描述。

轮询保留当前协作选择，移除后选择另一可用协作。任务详情直接提供移除入口，单任务依赖阻塞项可跳转到相关任务。仅运行时检查点/状态修订不会使元数据草稿失效，可编辑字段变化才会；最终请求仍使用最新修订号 CAS。已取消/已完成工作不会被描述为等待放置。禁用 Host 不计入在线 AX。整个工作流完成要求所有保留任务成功。

管理员 API 增量，均位于 `/api/distributed` 下：

- `DELETE /hosts/{id}`：移除未被引用的 Host 清单，无请求正文。
- `DELETE /workflows/{id}`：使用 `{expected_revision}` 确认原子移除。

两者成功均返回 `{accepted: true}`，要求管理员认证；未知身份或当前阻塞会被拒绝，不进行部分移除。

<a id="placement-and-policy"></a>
## 放置与策略

资格由 **AX 能力 + Host 资源**共同决定：

- 请求的每一类能力、Skill、MCP、Tool、模型匹配条件、权限和环境标签，都必须由实例公布；逻辑项目必须获准。
- 可选 `requirements.instance_id` 固定实例，否则由 Crew 选择。
- Host 与 AX 必须启用，且最近 30 秒内可见。Host 状态由其实例心跳维护；禁用 Host 会隔离其工作。
- 必须满足逐实例并发限制和共享 Host CPU/RAM/GPU 预留。优先考虑最早的合格工作，并倾向选择较空闲实例。

注册批准稳定 Host 身份、项目 ID、并发和 `can_delegate`。为兼容旧 API 客户端，资源/能力字段仍可选，但桌面注册表单不再提供它们。新 Host 在 AX 工作进程上报探测硬件前没有可调度容量。报告包含主机名、操作系统/架构、逻辑 CPU 数量/名称、物理 RAM MiB、PCI/显示 GPU 数量/名称及错误。`Host.inventory_at` 使用服务器时间；最新已知清单跨 Crew 重启与离线保留。原生探测每 60 秒在有界后台任务中执行，不占用五秒租约循环。

已认证实例只有通过有效实例化标识，才能上报自己的 Host。同 Host 所有实例共享该容量，绝不相加。未知 RAM/GPU 在清单中为 null，在可用调度容量中保守按零处理。GPU 探测包含集成/显示适配器，不仅限 CUDA GPU。资源预留表示任务请求容量，不是实测利用率、操作系统配额或 GPU 设备分配。容量刷新不驱逐仍有效的运行任务，只影响新放置。旧管理员资源端点保留；下一次工作进程清单刷新会覆盖其容量值。

首次连接后，管理员可通过实例能力端点暂存 `pending_capabilities`。活跃 `capabilities` 仍是最近一次工作进程报告，也是调度唯一使用的能力。UI 生成应合并到本地 `worker.json` 的字段；需在该 Host 安装/启用依赖并重启工作进程。匹配报告到达后清除待处理状态。启动时优先校验待处理策略，若没有则校验当前模型/Skill/MCP/profile 策略。能力选择仍是受信任本地配置，不是硬件证明或对每个外部服务的健康检查。模型凭证留在 Host 上。

工作进程获得独立凭证，作用域限定为分布式 API 与获准项目。委派要求 `can_delegate`；创建子任务和写检查点要求父任务/源代次仍有效且由当前工作进程持有。恢复的所有者可控制既有子任务。工作进程凭证不能管理 Host、注册其他实例或访问旧管理员 API。同项目工作进程可查看任务结果/产物，目录元数据可列出其他实例能力。旧版开放回环管理员行为不变。远程运行需配置现有管理员 Bearer 令牌与 TLS 反向代理；AX 拒绝非回环明文 HTTP。实际操作仍受本地运行时权限和沙箱限制。

<a id="workspace-and-artifact-contracts"></a>
## 工作区与 Artifact 约定

`project_id` 是逻辑身份，只允许 ASCII 字母/数字、`_`、`-`、`.`，最多 128 字符；绝不使用机器绝对路径作为工作区身份。每个工作进程将其映射到本地源码目录，每次执行使用位于源码之外的隔离克隆/快照。可选 `workspace_revision` 固定 Git 提交，Patch 产物传输未提交变更。结果不会自动覆盖其他工作进程，也不会自动合并回源检出。

Artifact 是独立对象，包含 ID、源任务/代次、项目、类型/名称、SHA-256 摘要与字节数。内容不可变，由 AX 校验哈希，上限 8 MiB，并按引用访问。上传要求有效租约；相同任务/代次/摘要/类型/名称的上传幂等。中断上传可能留下无引用二进制内容。任务消息只包含摘要和引用；产物/报告可能含敏感信息，受项目访问权限约束。

<a id="rest-contract"></a>
## REST 约定

所有路由均增量增加在 `/api/distributed` 下。既有 API 错误结构为 `{"error":"..."}`，校验/策略失败沿用 HTTP 400 行为。注册/Host 策略修改需要原管理员凭证；工作进程变更需要注册凭证。读取/提交/控制/检查点操作在适用时也允许管理员执行。

| 方法 / 路径后缀 | 请求 / 响应 |
|---|---|
| GET `/` | 按项目过滤的持久快照，加 `revision`、`server_time`；不含凭证哈希/回执 |
| GET `/catalog` | Hosts 与 AX 能力/资源 |
| GET `/events?after_sequence=0&limit=256` | 有序事件与下一 `cursor`；最多 1000 条事件 |
| POST `/enroll` | `host_id, host_name, name, projects, max_executions, can_delegate`；兼容旧版的可选 `resources, capabilities` → `instance, token`，令牌只显示一次 |
| POST `/instances/{id}/capabilities` | 能力字符串数组；首次连接后由管理员设置 → 待应用本地设置，不立即改变调度 |
| POST `/tasks` | `request_id, title, input, project_id`，可选 `context_summary, workspace_revision, workflow_id, requirements, dependencies, artifacts, parent_id, parent_generation, max_attempts, collaboration` → Task |
| GET `/tasks/{id}` | `task, workflow, observations, cursor`；支持事件游标查询 |
| POST `/tasks/{id}/{cancel\|retry\|pause\|resume}` | 中央任务控制 |
| GET `/workflows/{id}` | Workflow 与参与任务 |
| POST `/workflows/{id}/checkpoint` | `expected_revision, state`；工作进程还需源租约 Report → Workflow |
| GET `/worker/identity` | 在工作进程启动变更前取得已认证 `instance_id` |
| POST `/worker/start` | `incarnation` → 已认证 `instance_id`；替换旧执行纪元 |
| POST `/worker/heartbeat` | `incarnation, active:[{task_id,generation}]`，可选 `host_inventory, capabilities` → 新/未确认 `assignments`、全部持有 `leases`、`server_time` |
| POST `/worker/report` | `incarnation, task_id, generation, message_id, kind, text, artifacts`；kind 为 `completed`、`failed`、`observation`、`session` 或 `activity` |
| DELETE `/instances/{id}` | 仅管理员注销；拒绝未完成的已分配/固定 Tasks、未完成 Workflow 的明确成员身份，以及执行中的原生管理。撤销工作进程凭证，归档元数据并保留全部历史；接受重复删除 |
| POST `/{hosts\|instances}/{id}/enabled` | `enabled`，管理员 |
| POST `/hosts/{id}/resources` | `cpu, ram_mb, gpu`，管理员 |
| POST `/artifacts` | 源租约身份、`kind, name, content_base64` → Artifact |
| GET `/artifacts/{id}` | 项目权限检查后返回 `artifact, content_base64` |

Requirements 包含 `capabilities`，即仅用于匹配的字符串数组；`resources`，包含 `cpu`、`ram_mb`、`gpu`；可选 `instance_id`、`host_id`、执行 `model`（`provider`、`model`）和任务 `duty`。拒绝 `resource_limits`：此版本不执行操作系统资源配额。任务输入与摘要合计限制为 256 KiB；CPU 默认一个。新的逻辑步骤必须使用新请求 ID；相同请求重试必须内容一致。心跳响应不重复返回已确认的任务载荷。观察记录保留在有序持久 Event 流中，读取/轮询支持延迟或断线客户端。

<a id="desktop-and-operational-limits"></a>
## 桌面与运行限制

桌面使用全部可用页面宽度，不重复添加标题/操作横幅。Connect AX 只在 Nodes 出现一次，包括空节点列表；Create collaboration 位于 Workspace；刷新按钮在视图页签旁。空节点列表不显示批量选择控件。Workspace / Nodes / Activity 上方共享状态概览，数据来自当前集群快照：在线 AX（启用且最近 30 秒内可见）、运行 Tasks 与活跃协作、未移除失败 Tasks 加已启用但离线 AX，以及等待放置的 pending Tasks。禁用 AX 不计入离线问题。状态未取得时显示读取中，不伪报零；刷新失败时保留快照并显示同步错误。

Workspace 导航显示协作状态和完成数。即使没有协作，目标、工作任务、成员和近期活动区域也保持可见，使用紧凑、符合上下文的空状态。目标文本是已存描述的有界预览；旧协作回退到根输入/Goal 目标，完整输入仍在任务详情。Nodes 在展开前显示已配置执行槽位（不保证实际可用容量）、各运行尝试最新 Session 汇总的活跃数、当前/固定/曾尝试的协作与 Tasks，以及能力标签。Host 清单和实测指标与请求预留明确区分。

分布式视图/对话框的项目/AX 放置、权限、批量操作和原生管理范围等下拉框，统一使用设置风格 Select。弹出层使用应用主题、键盘导航与勾选标记；Escape 先关闭当前弹出层，再影响父对话框。Activity 提供带数量的次级页签、本地化状态筛选和清除筛选操作；Execution/Session 链、恢复历史与产物下载沿用既有端点。深浅主题共享调色 token，窄窗口将内容区域纵向排列。

工作区把已有 Workflow 组织为普通协作任务或显式 AX Goal。可创建任务、向 Workflow 添加同级工作、指定依赖、选择自动/手动放置、分配参与者职责、查看公共事件流并进入独立实时 Session。职责进入既有 AX 任务上下文；能力标签绝不变成角色提示词。整个 Workflow 的控制涵盖所有同级任务，包括并非根后代的任务。重新分配隔离旧尝试、保留原请求幂等身份，并按现有检查点和资源策略调度下一代次。

Nodes 在 Host 下组织 AX 实例，显示实测 CPU/RAM、可用 GPU/VRAM 读数、磁盘与采样网络吞吐量。清单每 60 秒刷新；未知字段保持未知，离线旧读数标为最新已知值。容量预留不等于实测利用率。实例名和右侧展开按钮均可展开 AX，状态同步，离线实例也可使用。可查看当前工作/Goal/Session、活跃/待应用能力和按作用域配置。Activity 可按 Goal、AX、Host 和任务状态筛选，展示每个 Execution 的 Session 链、事件/错误、检查点和可下载产物。下载配置为每个实例选择独立执行根目录与 AX 主目录；路径、模型凭证和能力仍需正确本地配置。

恢复保证持久控制平面状态与经过围栏隔离的结果发布。执行至少一次，远程副作用需自行保证幂等。不包含自动垃圾回收、大对象存储、复制式 Crew 高可用、网络分区共识或操作系统资源强制。已有单机与设备功能仍可独立按需使用。

验证包含持久调度/围栏/CAS 回归、桌面 UI 测试，以及使用模拟模型的真实三 AX 进程/两逻辑 Host 场景：测试失败 → 日志分析 → Patch → 复测、作用域认证、事件游标与 Crew 重启。这是在一台电脑上模拟 Host，没有验证物理网络/GPU 隔离。参见[开发文档](development/README.zh-CN.md)与 [AX 工作进程配置](https://github.com/Axium-Labs/AX/blob/main/docs/distributed-collaboration.md)。

当前快照端点和事务聚合保留完整集群元数据历史，面向小型集群；历史/回执持续增长，不自动裁剪。大规模部署需要扩展存储和分页能力。

<a id="workbench-policy-session-control-and-native-settings"></a>
## 工作台策略、Session 控制与原生设置

下列扩展均复用 `distributed_cluster`，不创建第二套 Goal、节点、Session 数据库或调度器。`orchestration/collaboration.rs` 负责限定作用域的操作者策略和收件箱命令；AX 的 `distributed_session` 桥接已有 ACP 流，`distributed_settings` 在目标主机调用既有原生 CLI 设置/能力操作。

`Workflow.collaboration` 包含 `kind`（`goal`/`task`，旧版默认为空）、`paused`、`participants`（AX ID 到工作职责，空表示自动）、能力 `requirements`、精确 `member_models`（AX ID 到 Provider/Model）和 `excluded_instances`（自动放置时也排除）。根提交在放置前原子保存策略，仅管理员可设置。策略只收窄合格 AX 范围，不修改主机权限或已安装能力。移除/排除成员时，隔离它在本 Workflow 的活跃所有权，并清除其非终态任务固定分配。仍保留的所有者继续使用已冻结的执行设置；新职责和模型在后续尝试生效。新成员任务可与策略一起原子保存。每个任务保留自己的要求、依赖、尝试历史和不可变提交摘要。AX Instance 可同时参与多个 Workflow。

配置作用域：

- Crew 应用/设备设置继续使用既有设置 UI。
- AX Instance 全局/项目原生设置影响今后使用目标主目录/项目的所有执行。写入必须明确确认范围，且当前没有活跃执行。待执行原生写入在实际执行期间阻止新放置。
- Goal 批量策略只改变该 Workflow 的参与范围、要求能力、成员职责和执行模型默认值。移除成员只隔离它在本 Workflow 的工作。已有 AX Goal 策略/预算仍冻结在检查点中。
- Session 指导、原生 Long Project 编辑和单次请求审批，指向当前某一执行代次最新记录的 Session。历史 Session 只读，退役 Session 的待处理命令明确失败；这些操作不能授予持久权限，也不能削弱主机 Sandbox。

附加管理员路由，使用既有管理员认证和错误结构：

| POST 路径后缀 | 约定 |
|---|---|
| `/workflows/{id}/settings` | `expected_revision, kind, participants, requirements`，可选 `title, objective, member_models, excluded_instances, new_tasks:[Submit]`；原子 CAS 策略/任务及成员隔离，保留检查点状态 |
| `/workflows/{id}/control/{pause\|resume\|cancel\|retry}` | 控制 Workflow 所有任务，并保留检查点/用量 |
| `/tasks/{id}/edit` | `generation, expected_title, expected_input, title, input`，可选 `remove:false`；仅管理员原子比较后保存，保留提交摘要/历史；编辑限制见下文 |
| `/tasks/{id}/reassign` | `generation, instance_id`，null 表示自动；可选精确 `model`、`duty`、`dependencies`、`host_id`、`clear_host`、`resources`；隔离旧执行，拒绝跨 Workflow 依赖/环；省略/null 模型继承新所有者 |
| `/tasks/{id}/commands` | `generation, session_id, kind, text, request_id?`；仅限有效尝试的最新 Session |
| `/plans` | `tasks:[{spec:Submit, depends_on:[earlier task index]}]`；在单事务中提交 1–64 个任务；首任务持有根策略或加入已有 Workflow；稳定请求 ID 保证重试幂等；全部任务存在后才放置 |
| `/placement` | `project_id, requirements`，可选 `workflow_id` 或 `collaboration`；返回 `[{instance_id,reasons}]`，reasons 为空表示当前合格；复用调度谓词和当前预留 |
| `/batch` | `instance_ids, confirm_instance_scope:true`，`capabilities`/`enabled` 必选其一；逐节点 accepted/error，保留部分失败 |
| `/instances/{id}/manage` | `action, scope:global\|project, project_id?, input, confirm_instance_scope`；目标必须主动启用 |

Session 命令类型为 `prompt`、`answer`、`permission`、`project_read`、`project_history`、`project_import`、`project_config`、`rotate`。执行中指导使用 AX `_ax/steer`，不启动另一个并发轮次。`answer` 使用真实待回答问题 ID 和文本/选项 ID；`permission` 要求真实 AX 请求 ID 与 `allow_once`/`reject_once`，过期选择逐项失败。未回答权限请求 90 秒后过期。原生项目命令等待空闲轮次边界；导入使用固定的执行本地输入路径，配置要求 AX Goal 处于 paused/blocked/created，轮换使用既有原生安全边界迁移。命令有 pending/executing/final 结果；过期或所有权丢失会隔离未处理命令。

仅工作进程可调用的路由使用现有凭证与实例化标识/代次租约：`POST /worker/inbox` 接受 Report；`POST /worker/commands/{id}` 接受 `source, status:executing|completed|failed, result`。工作进程上报 `session` 时带实际 `session_id`，包括后继会话；上报 `activity` 时带有界 ACP 更新/权限元数据。执行尝试记录 Session 链，不复制 AX 所有的原始 Session 存储。较大的实时详情会截断；已发布产物和本地 AX 历史保留完整可用回执。

远程原生管理默认明确关闭。管理员使用前，工作进程必须配置 `remote_management:true` 和独立 `ax_home`。`POST /worker/manage` 接受 `incarnation, enabled, completed:[{id,status,result}]`，认领命令并返回逐操作结果。支持 `settings.read/write`（现有子代理限制）、`goal.read/write`（原生 Goal 默认值）、`personalize.read/write` 与 `plugins.list/enable/disable/import`。插件类型为 skills/mcp/agents/mods；导入要求经过校验的名称，以及位于获准本地项目内的来源。个性化包含 Memory/风格开关、项目内写作样本和自定义指令，并使用原生的预期内容冲突检查。输入通过目标本地短期文件传递，成功/失败后均删除。慢速原生命令不在租约循环中执行。工作进程实例化标识变化后绝不自动重试写入；结果不确定时，先检查目标设置再重试。

原生子代理设置支持多 AX 批量操作：先读取各目标，预览真实前后值，确认全局或项目范围，再逐项提交原生写入。不可读节点带原因跳过；完成/失败结果留在同一个持久管理收件箱。

能力批量配置仍处于暂存阶段，每项结果区分已接受策略与实际工作进程报告的启用状态。预览每个节点的前后字段，并确认 AX 全局范围。能力导入只接受已知字符串数组；导出排除令牌、凭证/模型供应商文件与 Memory。原生输出也移除含凭证字段。注册时一次性下载的私有 `worker.json` 是独立连接凭证，明确标记为私有，绝不能作为可分享配置导出。

<a id="optional-long-project-inside-a-goal"></a>
## Goal 内可选的 Long Project

Long Project 默认关闭，仅在已启用的 Goal 内联显示。创建支持自定义模板与自动轮换。AX 继续负责 `PROJECT_STATE.md`、归档历史、上下文压力与 Session 轮换；`state.ax_goal_runtime[task_id].long_project_document` 是其有界投影。可查看/导出/编辑当前文档、搜索原生归档、查看历史 Session 链接、在 AX 轮次暂停边界配置，或请求原生轮换。原生文档/配置修改立即使用与运行轮次相同、带围栏隔离的 Workflow 检查点 CAS。编辑正文不构成任务完成授权，也不重置预算。所有历史 Session 共享同一 Goal/任务状态和累计用量；恢复仍受既有副作用协调限制。

专用工作台仅在桌面提供；既有 Android 构建/控制和旧 API 客户端保持兼容。在一台测试电脑上模拟逻辑 Host，不能证明物理机器网络或 GPU 隔离保证。

主动启用原生管理后，新执行只将获准源项目的 Goal/子代理/能力策略和插件定义快照到隔离检出，绝不复制源 Memory、Sessions、认证、权限或 Long Project 存储。AX 主目录设置仍为全局基底。活跃执行保留已有快照；已保存 Goal 从权威检查点保留策略。自动结果补丁排除 `.ax` 和执行输入元数据，避免把本地配置、MCP 凭证与运行时存储作为代码变更导出。

<a id="workflow-execution-and-placement"></a>
## Workflow 执行与任务放置

调度器根据 Workflow 策略、工作进程能力与当前资源报告，把就绪 Tasks 分配给合格工作进程。每次 Attempt 记录执行供应商、模型与职责。桌面计划表单原子提交 Tasks 和依赖，并在执行前显示放置原因。正文滚动时操作始终可用；表单分开呈现目标、团队设置与工作分配，提交前展示任务内容、执行选择和放置原因。返回前一步会保留草稿。

Task 在当前代次只有一个有效所有者。Attempt 冻结精确执行 Provider/Model 与职责。任务模型选择覆盖成员默认值；否则继承 AX 上报的当前模型。能力 `models` 仍是独立的全要求匹配调度谓词。工作进程把冻结选择传给该尝试的 ACP 进程，不写全局 AX 模型配置。启动前重新检查本地目录，并上报 ACP 实际解析的模型；Crew 拒绝不一致模型报告。

工作进程在自己的 AX_HOME 下调用已有 `_ax/models`，上报经凭证过滤的本地 Provider/Model 目录、当前选择与错误。既有 ACP 响应增加可选 `current:{provider,model}`。发现截止时间为 15 秒，独立于租约心跳运行，每 60 秒刷新。Crew 为接受的目录记录时间；新执行选择模型要求节点在线，且目录不超过 180 秒。重启使旧目录时间失效，直到新实例化标识报告发现结果。待应用模型默认值按活跃目录子集匹配，避免模型选择目录妨碍本地配置确认。模型目录限制为 5000 项/1 MiB；模型能力 ID 的界限独立于其他 16 KiB 能力策略字段，避免大型合法供应商列表破坏心跳。

没有新发现结果的成功心跳不会刷新目录时间。离线、过期和错误目录仍可见，但不进入选择器。这表示本地配置/目录可用性，不是远程供应商健康证明；实际推理错误仍表现为真实失败 Tasks。凭证不离开 AX。没有目录的旧工作进程仍可继承模型执行，但不能经新选择器接受精确的逐执行模型覆盖。

普通创建预留一个逻辑 CPU 槽位，不要求显式 RAM/GPU 最低值。高级选项可选择实际报告的 Skill/MCP/环境标签、最低资源或 Host/AX 固定分配。每个 pending Task 包含当前逐节点 `placement` 原因，包括未完成依赖。预览只是当前快照，不保证容量；提交后多行任务可能争用同一剩余槽位。CPU/RAM/GPU 只预留调度容量，不绑定 GPU 设备或强制进程配额。`resource_limits` 请求明确失败。真实操作系统限制和物理 GPU 隔离不在此适配器范围内。

Session 链按时间排序。桌面交互、PROJECT_STATE 导入和权限事件使用最新活跃 Session；服务器与 AX 桥拒绝历史目标。轮换时，无法投递的旧命令会失败，不会重放到其他 Session。历史选择按 Session 筛选活动，不显示消息/回答/审批控件。节点参与记录包括当前所有权、排队固定分配及所有历史尝试，因此迁移仍可见。Session/Memory 存储和完整工作区仍由 AX 持有，接管时不会静默复制。

工作台编辑/添加对话框保留打开时捕获的 Workflow ID；刷新出现新协作不会改变目标。配置草稿也检测协作策略变化，要求重新审阅，不覆盖其他操作者策略。如果策略未变，只有运行时检查点修订变化时仍可使用当前 CAS 修订。

新工作进程在首份原生目录到达前，把模型发现报告为 pending。心跳在新放置前先应用新能力/目录/清单，再在续约前隔离已过期租约。刚变为不可用的模型不能借旧报告占用刚释放的槽位。

<a id="editing-an-existing-collaboration"></a>
### 编辑既有协作

Workspace 的 **Edit collaboration** 修改协作名称、描述性目标、成员选择、职责、模型默认值与匹配要求。描述用于组织工作，不改写运行中的 AX Goal，也不广播提示词。通过 Portal 挂载的对话框使用响应式成员卡片、单一滚动正文和固定保存底栏。添加成员不必创建任务；可明确选择新增任务，并与成员策略原子保存。

成员选择器只列出当前已注册、获准访问项目的 AX 实例。已删除实例不会成为候选或计作当前成员；执行历史仍在 Activity 与折叠的历史成员区域保留。未进入任何任务尝试的归档成员也会显示名称，确保过期参与引用可追溯到具体 AX。编辑器列出保存时要清除的归档成员，因为实例虽已删除，保留参与策略仍会限制调度（`AX is outside Goal participants`），否则会无明显原因地阻塞新工作。只要仍有策略条目，即使所有成员都已消失，工作台仍显示手动成员范围，绝不退化成“自动放置”。

保存时依据当前注册快照过滤失效成员、模型默认值与新增工作草稿，包括编辑期间的删除。其他草稿编辑保留；最终保存若与删除竞争，后端校验仍会拒绝。取消勾选成员还会将其排除在本工作流自动放置之外。空选择沿用既有自动放置语义。编辑期间策略/标题/描述变化会阻止过期草稿；API 修订 CAS 拒绝最终保存竞态。保存失败保留草稿。

任务详情提供 **Edit task**，可重命名、编辑尚未开始的工作或从列表移除。Goal 任务编辑器将目标显示为文本，并保留其余 `/goal create` 配置。输入只在尚无任何尝试且非终态时可改；已启动或已完成任务保留原输入。执行要求变化时应发送当前 Session 指导或创建替代任务。名称可编辑，不重放已完成工作。预期名称/输入与执行代次共同防止覆盖其他编辑或执行。

移除必须在对话框内明确确认。任何保留的后继依赖或子任务都会阻止移除，并显示相关名称；应先调整依赖或移除这些任务。移除设置有 serde 默认值的 `Task.removed=true`，取消未完成工作并清除所有权/租约；迟到报告被隔离。完成/失败回执、产物、检查点与不可变提交身份仍可在 Activity 访问。已移除任务不能重试/恢复、成为新依赖/父任务，或参与工作流完成统计。仅含已移除任务的工作流变为 cancelled；原根任务移除后，其他保留任务仍可决定是否完成。不新增 SQL 表或 AX 运行时协议。`Workflow.objective` 可选，并具有 serde 默认值。
