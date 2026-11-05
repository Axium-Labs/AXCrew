<a id="axcrew-documentation"></a>
# AXCrew 文档

[English](README.md) | **简体中文**

这里记录 AXCrew 当前的功能与协议约定。各版本的变更见[版本说明](releases/)，开发流程另有专门文档。

<a id="documentation-map"></a>
## 文档导航

Windows/Linux/macOS 的构建、打包、终端默认设置、遥测、安装器更新和能力限制，见 [platforms.md](platforms.zh-CN.md)。

| 文档 | 内容 |
|---|---|
| [getting-started.md](getting-started.zh-CN.md) | 首次对话、本地/配对/SSH 执行、客户端入口与安全基础 |
| [distributed-collaboration.md](distributed-collaboration.zh-CN.md) | 分布式控制平面、工作进程作用域 API、恢复与桌面管理 |
| [chat-channels.md](chat-channels.zh-CN.md) | 聊天平台、账号授权与项目/会话导航 |
| [benchmarks.md](benchmarks.zh-CN.md) | 分布式测量工具与测量边界 |
| [architecture/android-migration.md](architecture/android-migration.zh-CN.md) | Android 能力与仅桌面端支持的功能 |
| [releases/0.3.13.md](releases/0.3.13.zh-CN.md) | 当前桌面版本 |
| [architecture/README.md](architecture/README.zh-CN.md) | 系统架构：控制平面模块、分层、边界与仓库结构 |
| [architecture/design.md](architecture/design.zh-CN.md) | AX/Crew 运行时边界与执行职责 |
| [architecture/storage.md](architecture/storage.zh-CN.md) | SQLite WAL 数据库、持久数据与实时数据、权威数据来源边界 |
| [platforms.md](platforms.zh-CN.md) | 平台支持、打包与客户端边界 |
| [protocol/README.md](protocol/README.zh-CN.md) | REST、WebSocket 与 ACP 协议约定 |
| [protocol/api.md](protocol/api.zh-CN.md) | REST/WebSocket API、认证、配对与连接 |
| [development/README.md](development/README.zh-CN.md) | 构建、测试与打包命令 |
| [desktop/README.md](desktop/README.zh-CN.md) | 桌面对话、设置、导入及按作用域配置的 AX 能力 |

历史版本说明按版本号保存在 `releases/` 中。

<a id="how-to-read"></a>
## 阅读方式

- **新用户**：从仓库 [README](../README.zh-CN.md) 开始，再阅读 [getting-started.md](getting-started.zh-CN.md)，了解配置步骤与详细指南入口。
- **贡献者**：先阅读 [architecture/README.md](architecture/README.zh-CN.md)，再查阅所修改领域的专题文档。
- **协议开发**：[protocol/README.md](protocol/README.zh-CN.md) 指向各协议的权威定义，避免约定逐渐不一致。
- **文档范围**：这些文档描述当前行为与稳定约定。具体机器上的测试结果和任务进展应记录在本地工作日志中，不放进产品文档。
