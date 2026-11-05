<a id="storage"></a>
# 存储

[English](storage.md) | **简体中文**

Crew 使用独立于 AX 的 SQLite WAL 数据库，保存编排元数据和任务最终结果。可选的分布式协作还保存部分工作流检查点、观察记录和产物字节，包括明确发布的日志/会话记录。不会复制完整 AX 会话与记忆存储；模型供应商凭证仍留在本机。

<a id="what-is-stored"></a>
## 保存哪些数据

- 设备身份、公钥、状态、能力，以及经过哈希处理的配对码
- Crew 与成员
- 任务、依赖、运行记录与会话绑定
- 已脱敏的事件索引
- 自动化与自动化运行记录
- 应用设置
- 可选的分布式集群状态、工作流检查点与产物二进制内容

任务最终输出会作为结果保存。消息增量、工具参数和权限请求输入通过事件流实时广播，但不写入持久载荷。

子代理事件信封也仅用于实时传输：标题、任务、摘要、错误以及嵌套文本/工具内容都不会写入事件索引。只保留执行 ID、父 ID、子会话标识、生命周期状态和嵌套更新类型。详细子代理历史通过 AX 的父会话存储重放。

<a id="source-of-truth"></a>
## 权威数据来源

AX 自身的安装/主目录存储，仍是会话对话与记忆的权威来源。独立 AX 默认使用 `<install-dir>/.ax`；Crew 为本地运行时传入 `AX_HOME`，默认值为 `~/.ax`。项目子目录、旧存储和显式覆盖的说明见 [AX 存储](https://github.com/Axium-Labs/AX/blob/main/docs/storage.md)。ACP 会话 ID 就是 AX 会话 ID；Crew 只保存绑定关系。模型供应商凭证保存在 AX 主目录下，不会进入 Crew 数据库。

<a id="schema-and-migrations"></a>
## 表结构与迁移

表结构的权威定义位于 [`schema.sql`](../../crates/server/src/storage/schema.sql)，数据库打开与状态规范化逻辑位于 [`migrations.rs`](../../crates/server/src/storage/migrations.rs)。启用外键，依赖和状态更新均在事务中进行。打开数据库时应用幂等表结构，并把中断的任务状态恢复为 `ready`；SSH 设备在再次探测前标记为离线。表结构版本保存在 `PRAGMA user_version` 中。聊天渠道密钥使用独立、受保护的旁路存储，详见[聊天渠道](../chat-channels.zh-CN.md)。
