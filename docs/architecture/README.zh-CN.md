<a id="architecture"></a>
# 架构

[English](README.md) | **简体中文**

AXCrew 是一个产品，包含三个通过稳定接口交互的交付部分：控制平面（`crates/server`）、桌面客户端（`apps/desktop`）和 Android 客户端（`apps/android`）。客户端仅通过 REST/WebSocket API 与控制平面通信；两种客户端都不链接服务器内部模块。

AX 负责 Agent 执行、权限和 Session 历史。AXCrew 负责设备管理、调度与持久化协调状态。两者通过 ACP 与经过认证的 Crew 网关交换工作。

<a id="documents"></a>
## 文档

以下参考文档定义产品行为与开发约定。本页架构概述重点说明服务器职责和模块边界。

| 文档 | 内容 |
|---|---|
| [../distributed-collaboration.md](../distributed-collaboration.zh-CN.md) | 增量引入的分布式模型、存储、编排与 API 模块。 |
| [design.md](design.zh-CN.md) | AX/Crew 运行时职责与执行边界。 |
| [storage.md](storage.zh-CN.md) | SQLite WAL 数据库、持久保存的内容与权威数据来源边界。 |
| [android-migration.md](android-migration.zh-CN.md) | Android 客户端范围与桌面能力差异。 |
| [../protocol/README.md](../protocol/README.zh-CN.md) | REST、WebSocket 与 ACP 协议约定的定义位置。 |
| [../development/README.md](../development/README.zh-CN.md) | 构建、测试与打包命令。 |
| [../desktop/README.md](../desktop/README.zh-CN.md) | 桌面设置与按作用域配置的 AX 能力。 |

<a id="repository-layout"></a>
## 仓库结构

根目录只组织产品，本身不承载代码。

| 路径 | 职责 |
|---|---|
| `crates/server/` | 控制平面：REST/WebSocket API、调度、存储与传输。它是唯一的 Cargo 工作区成员。 |
| `apps/desktop/` | Tauri 2 + React 桌面客户端；`src/` 为前端，`src-tauri/` 为 Rust 外壳。它有独立的 Cargo 项目。 |
| `apps/android/` | 原生 Kotlin/Compose Android 控制客户端。 |
| `docs/` | `architecture/`、`protocol/`、`development/`、`desktop/`、`releases/`。 |
| `scripts/` | 仓库级构建与发布脚本。 |

<a id="the-control-plane"></a>
## 控制平面

`crates/server` 是唯一的 Cargo 工作区成员，内部模块按单向依赖组织：

```text
api/            HTTP boundary
  |
orchestration/  business processes
  |
storage/        persistence (the only SQLite-aware layer)
  |
domain/         pure models and schedule maths

transport/      how work reaches AX   (used by orchestration)
gateway/        the device WebSocket  (used by transport)
ax/             read-only local AX adapter (used by api and transport)
auth/ config/ error/ app.rs           cross-cutting support
```

| 模块 | 单一职责 | 何时修改 |
|---|---|---|
| `main.rs` | 解析配置、构建 `App`、启动调度循环、挂载路由并提供服务，不承担其他工作。 | 启动接线变化时。 |
| `app.rs` | `AppState` 与需要访问数据库的认证检查。 | 处理器需要新的共享状态时。 |
| `config/` | 影响启动行为的 clap 参数与环境变量。 | 新增参数或环境变量时。 |
| `auth/` | 已签发令牌存储与 `Authorization` 解析。 | 令牌格式或请求头处理变化时。 |
| `error.rs` | 统一的 HTTP 错误结构。 | 错误约定变化时。 |
| `api/` | 每个资源一个模块，遵循 `request -> validation -> orchestration -> response`。 | 端点或请求/响应结构变化时。 |
| `domain/` | 纯模型与基于墙上时钟的调度计算，不依赖 SQLite、HTTP 或 tokio。 | 持久化概念或调度规则变化时。 |
| `storage/` | `Db` 门面、`schema.sql`、迁移，以及每个聚合各自的仓储模块。只有此层编写 SQL。 | 表结构、查询或迁移变化时。 |
| `orchestration/` | 任务调度、自动化、审批代理、Crew 规则与主机工作区校验。 | 业务流程变化时。 |
| `transport/` | 以一个 `Transport` trait 统一封装本地 AX ACP、配对 AX 网关执行，以及使用 OpenSSH 工具的本地 AX。 | 连接 AX 的方式变化时。 |
| `gateway/` | 设备 WebSocket、Ed25519 握手与连接。 | 设备协议变化时。 |
| `ax/` | 只读发现本地 AX 存储并汇总用量。 | 读取 AX 自身存储的方式变化时。 |

<a id="rules-that-keep-the-boundaries-honest"></a>
### 确保边界清晰的规则

- 领域模型绝不依赖 SQLite。访问 Crew 自有数据库的 SQL 只放在 `storage/`；另一处使用 `rusqlite` 的模块是 `ax/`，它以只读方式打开 AX 存储，从不写入。
- API 处理器不执行 SQL、不调度任务，也不打开传输连接，只调用 `crate::orchestration` 或 `Db` 门面。
- 纯输入校验放在 `orchestration/`，例如 `orchestration::crew`。需要读取其他数据行的检查——Crew 是否存在、设备是否存在、依赖是否无环——必须在执行写入的同一个存储事务内完成，避免竞态。
- 桌面与 Android 仅通过 API 与控制平面通信，不导入服务器内部模块；服务器也不假设使用某种特定客户端。
- 刻意不设置 `utils`、`common` 或 `helpers` 模块。仅供一层使用的辅助逻辑留在该层；真正共享的逻辑应放入具有明确名称和单一职责的模块。
- `orchestration/` 与 `transport/` 互相引用，这是依赖图中唯一的环。调度器通过 `Transport` trait 驱动工作，传输层则从 `orchestration::approval` 取得 `ApprovalBroker`，等待工具审批。双向依赖都通过窄接口，因此是有意设计的环，而非职责纠缠。

<a id="why-one-server-crate"></a>
### 为什么只保留一个 `server` crate

`crates/server` 有意保持为单个 crate。在边界尚未证明稳定前，把 `protocol`、`storage` 或 `orchestration` 拆成独立 crate 只会增加版本管理与构建成本。`domain/` 和 `storage/` 已提供分离边界，将来可以提取 `crates/protocol`，而无需迁移业务逻辑。

连接/项目功能各有独立的领域模型、存储仓储、编排校验和带认证的 API 适配器，位于对应的 connections.rs 模块。transport/ssh.rs 负责探测远程目录并解析本地会话记录工作区；transport/ax.rs 负责本地 ACP 的更新、审批与取消生命周期。SSH 任务向该本地 AX 进程注入主机上下文。来源选择器绝不会在网关磁盘上校验远程目录。

<a id="client-behavior-references"></a>
### 客户端行为参考

桌面与 Android 的行为写在各自的产品文档中，不在本服务器架构概述中重复：

- [桌面行为](../desktop/README.zh-CN.md)：当前桌面工作流程与设置。
- [Android 客户端范围](android-migration.zh-CN.md)：平台差异。
- [聊天渠道](../chat-channels.zh-CN.md)：配置方式与支持行为。
- [分布式协作](../distributed-collaboration.zh-CN.md)与[协议参考](../protocol/README.zh-CN.md)：协调和 API 约定。
