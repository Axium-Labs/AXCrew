<a id="protocol"></a>
# 协议

[English](README.md) | **简体中文**

协议由下列权威文档定义。本页只提供入口，不重复定义，避免约定逐渐失去一致性。

可选的 Goal 持久化使用已有、带围栏隔离的 Workflow 检查点约定，并保留 `ax_goal_runtime` 状态键，详见下方分布式文档。桌面 `ax_goal_settings` 调用 AX 自身的 `goal-settings` CLI，不新增 REST/Android 设置 API。绑定主机的 ACP 导入是 AX 工作进程适配器的接入边界，不允许用户借此覆盖远程 Session 的所有权。

| 协议约定 | 权威说明 | 实现 |
|---|---|---|
| 分布式 Tasks、Workflow State、Events、Artifacts 与工作进程租约 | [distributed-collaboration.md](../distributed-collaboration.zh-CN.md) | `api/distributed.rs`、`orchestration/distributed.rs` |
| Crew REST API 与 `CrewEvent` WebSocket 流 | [api.md](api.zh-CN.md) | `crates/server/src/api/` |
| ACP：通过 stdio 及路由网关信封传输的 JSON-RPC 2.0 | [api.md](api.zh-CN.md)与[运行时边界](../architecture/design.zh-CN.md) | `crates/server/src/transport/` |
| 设备网关握手与心跳 | [api.md](api.zh-CN.md)与[分布式协作](../distributed-collaboration.zh-CN.md) | `crates/server/src/gateway/` |

<a id="compatibility-commitments"></a>
## 兼容性承诺

以下内容属于协议约定，不是可随意变化的实现细节：

- **REST**：扩展 API 时保留已有、受支持的路由和字段类型。已移除的实验性接口不属于受支持端点，以当前 [API 参考](api.zh-CN.md)为准。新增可选字段时应保持已有调用方兼容。
- **WebSocket 事件**：`event_id`、`kind`、`task_id` 和 `payload` 信封保持稳定。`payload.sessionUpdate` 的取值（`agent_message_chunk`、`agent_thought_chunk`、`agent_question`、`tool_call`、`tool_call_update`、`turn_changes`）与 ACP 适配器共享。
- **子代理活动**：增量增加的 `payload.sessionUpdate: "subagent"` 在绑定的父任务/会话内，以 `kind: "subagent.update"` 广播。它携带稳定的 `agentId`、可选 `parentAgentId`、`title`/`task`、`childSessionId`、`status`（`running`、`completed`、`failed`、`cancelled`）、可选 `summary`/`error`，以及可选的嵌套 ACP `update`，用于子代理文本、工具调用/结果或模型连接状态。嵌套内容绝不会追加到父任务的助手输出中。Crew 持久事件索引只保留 ID、状态和嵌套更新类型；重放的子代理内容来自已有且经过认证的父会话 `session/load` 历史，该历史由 AX 持有。
- **模型连接更新**：增量增加的 `payload.sessionUpdate: "model_connection"` 携带 `status`（`connecting`、`retrying`、`connected`、`failed`）、从 1 开始的 `attempt`、`maxAttempts`（最多 5 次）和可选 `error`。这些帧是实时状态，不是助手消息。最终失败帧作为可选的 `output.model_connection`，保存在失败任务及其最终事件中，客户端重连后可恢复具体失败原因。任务状态机与 REST 路由保持不变。
- **ACP**：按行分隔的 JSON-RPC 2.0，包含 `initialize`、`session/new`、`session/load`、`session/resume`、`session/prompt`、`session/cancel`、权限响应、只读 `_ax/*` 目录扩展，以及向当前轮次补充指导的 `_ax/steer` 扩展。接受指导时返回确认，不取消正在执行的 prompt；`user_message_chunk` 包含 `_ax.steering` 与稳定消息 ID，供重放使用。
- **数据库**：SQLite 文件格式保持不变。`schema.sql` 幂等，已有数据库无需转换即可打开。

修改其中任一约定，都必须同步更新上面的相关文档，以及本地维护、未随仓库分发的进程级测试。

<a id="related-contracts"></a>
## 相关约定

- [分布式协作](../distributed-collaboration.zh-CN.md)负责注册、能力、Workflow 检查点、任务放置、实例/Host 移除、CAS 编辑、原生管理和 Session 路由。端点及生命周期细节应保留在那里，不在本索引重复。
- [API](api.zh-CN.md#connections-workspaces-and-projects)负责连接、项目、工作区和本地历史端点。SSH 使用本地 AX 推理/历史，加上远程 Shell 上下文。
- [桌面设置](../desktop/README.zh-CN.md)负责仅由 Tauri 提供的配置命令，包括 Goal 和按作用域配置的委派；它们不是 Android REST API。
- [聊天渠道](../chat-channels.zh-CN.md)负责渠道传输、账号授权、项目/会话命令和菜单有效期。管理端点列在 [API](api.zh-CN.md#chat-channel-management) 中。
