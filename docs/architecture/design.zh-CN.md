<a id="ax-and-axcrew-runtime-boundary"></a>
# AX 与 AXCrew 的运行时边界

[English](design.md) | **简体中文**

AXCrew 负责任务协调与结果呈现。AX 仍是负责模型调用、工具、权限、会话、记忆和执行的 Agent 运行时。两者通过 ACP 通信；AXCrew 不解释模型输出，也不复制 AX 的会话、记忆或凭证存储。

<a id="responsibilities"></a>
## 职责

| 组件 | 负责内容 |
|---|---|
| AX | Agent 循环、供应商选择、工具执行、权限、会话历史与本地 Goal 执行。 |
| AXCrew 服务器 | 设备配对、任务/工作流调度、持久化协调状态、REST/WebSocket API 与远程传输。 |
| 桌面与 Android 客户端 | 通过 AXCrew REST/WebSocket API 提供交互，不链接服务器内部模块。 |

AXCrew 持久化任务输入与结果、工作流检查点、事件元数据和明确发布的产物等协调数据。AX 仍是会话记录与模型供应商凭证的权威来源。Crew 的工作流检查点可以保存 AX Goal 状态，用于分布式恢复；它们不会形成第二套 AX 运行时或会话数据库。

<a id="execution-path"></a>
## 执行路径

服务器通过 `api/` 和 `orchestration/` 层校验请求、分派业务操作。调度器经本地 ACP 进程或已认证的远程网关，把就绪任务分配给符合条件的 AX 工作进程。工作进程通过 AX 执行，并返回事件和结果。Crew 持久化协调状态，隔离过期工作进程的上报后再发布结果。

AX 提问、取消、权限和会话续接仍遵循 AX 的执行语义。Crew 只保存路由回答或恢复同一任务所需的等待/任务状态，不自行生成 Agent 回答。

<a id="canonical-references"></a>
## 权威参考文档

- [架构](README.zh-CN.md)：服务器模块与依赖边界。
- [分布式协作](../distributed-collaboration.zh-CN.md)：工作流、恢复、任务放置与运行限制。
- [协议](../protocol/README.zh-CN.md)和 [API](../protocol/api.zh-CN.md)：ACP、REST 与 WebSocket 约定。
- [存储](storage.zh-CN.md)：数据库与持久化边界。
- [Android 平台映射](android-migration.zh-CN.md)：各客户端的能力与限制。

<a id="local-desktop-browser-transport"></a>
## 本地桌面浏览器传输

执行本地桌面 AX 时，Crew 为受信任的 AX/ACP 进程注入每次启动专用的回环端点与密钥。AX 保留原有的 BrowserTool 注册表、HostPermissionStore、任务策略和执行循环。桌面桥只负责实际侧栏子 WebView 上的固定操作，不负责模型决策。它通过带一次性随机数的标题结果返回有界、不可信的页面数据，绝不授予远程页面 Tauri IPC 能力。SSH 和配对远程 AX 不接收该本地传输配置，用户代码子进程也不会继承其凭证。

Windows 上受 Agent 控制的页面，必须先安装原生的全来源请求过滤和 CDP 响应拦截，才能导航；安装失败或平台不支持时会拒绝执行。普通用户预览与受控网络模式相互区分。浏览器复用 Cookie 配置文件，页面路由则使用真实 AX Session ID。页面接管/重新加载、生命周期、自由浏览控件与能力限制，见[桌面浏览器行为](../desktop/README.zh-CN.md#web-preview-and-compact-change-review)。
