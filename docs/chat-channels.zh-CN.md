<a id="chat-channels"></a>
# 聊天渠道

[English](chat-channels.md) | **简体中文**

“设置 → 聊天平台”列出 **Slack、Discord、Telegram、Webex、企业微信（WeCom）、飞书（Feishu）、Microsoft Teams、个人微信（Weixin/WeChat）、iMessage 和 WhatsApp**。选择平台后只显示该平台配置，在页面内切换会保留输入与扫码进度。选择本身不会启用或保存渠道。窄窗口使用横向滚动选择器，也支持方向键/Home/End 切换。Connections 只包含设备和 SSH 设置。

每个平台都有接收与回复适配器，但只有满足前置条件并提供凭证后才会连接。UI 将实际连接状态与已保存配置分开显示。iMessage 始终可见，但服务器不在 macOS 上运行时禁止配置。

Slack、Discord、企业微信与飞书使用出站 WebSocket；Telegram、微信与 Webex 使用出站 HTTPS 轮询。iMessage 使用本地 `imsg rpc` 子进程，WhatsApp 使用受监督的 Node.js 配套组件。**Teams 需要公网 HTTPS 回调**及单租户 Azure Bot。不使用共享 AXCrew 中转。任务执行需要 AX 与已配置模型。原生 Android 局域网配对方式不变。

<a id="configure-and-authorize"></a>
## 配置与授权

**默认项目目录**可选，供尚未选择项目的账号使用。未设置默认目录时仍可正常连接/配对，再在聊天中选择项目后发送任务。非空默认目录必须是已有绝对目录。修改默认目录不会移动已有对话，也不会覆盖账号已选项目。

- Slack：创建/安装 Slack 应用，启用 Socket Mode 并订阅 `message.im`。Bot Token 需要 `chat:write` 和 `im:history`，App Token 需要 `connections:write`。两种密钥均受保护，读取状态不会返回它们。仅接收普通私聊消息，不接收机器人/子类型/群组事件。
- Discord：在 Developer Portal 创建机器人并提供 Bot Token。网关仅使用 `DIRECT_MESSAGES` intent、心跳和确认检查。忽略服务器群组消息、Webhook 和其他机器人。回复禁用自动提及。每次重连建立新网关会话，不保证重放断线期间消息。
- Webex：创建机器人并提供 Bot Access Token。AXCrew 列出私聊房间并逐周期轮询，每周期之间暂停五秒。该有界适配器支持少于 100 个私聊房间，每次追赶最多处理每房间 100 条未读消息；超过任一限制会报告连接错误，不会静默跳过缺失消息并推进游标。首次启用从当前时间开始；忽略群组房间与机器人自身消息。
- 企业微信：创建采用长连接模式的 AI 机器人，提供 Bot ID 与 Secret。只接受 `single` 文本回调。回复使用已确认的 `aibot_send_msg` 私聊推送，受企业微信主动发送配额限制。
- Microsoft Teams：创建**单租户** Azure Bot，启用 Teams 渠道，填写 Application ID、Client Secret、Tenant ID 与公网 HTTPS origin。Azure 消息端点设为该 origin 加 `/api/messaging/teams`。部署反向代理/隧道，仅将此路由转发到本地服务器；本页面不会创建代理、监听公网或准备 TLS。服务器验证 Microsoft RS256 签名、过期/not-before、签发方、应用 audience、存在时的签名密钥背书及服务 URL 声明。仅接收配置租户内的个人会话，回复 origin 限定为 Microsoft Bot Framework/Teams 服务主机。令牌验证后状态为 `waiting_webhook`，收到有效个人消息后为 `connected`；这不是自动可达性测试。
- iMessage：在已登录 Messages 的 Mac 上运行 AXCrew，安装 `imsg`，授予 Full Disk Access 和 Messages Automation 权限。可选可执行文件/数据库路径通过参数传递，绝不拼成 Shell 文本。子进程使用 JSON-RPC watch/send，只接收明确的私人入站 iMessage 文本，不接收 SMS、群消息或出站回显。监听从当前尾部开始，不重放历史消息。Windows/Linux 不能启用此渠道。
- WhatsApp：安装 Node.js 20+ 与 npm，渠道禁用时点击 **Install / repair connection component**，再保存/连接，并在 WhatsApp → Linked devices 扫码。组件使用固定 Baileys 7.0.0-rc14 及服务器内嵌锁文件，安装在数据库旁的 `chat-runtime/whatsapp`。配套程序也已内嵌，运行时无需开发检出。可选 Node 可执行文件路径覆盖 `node`。它使用非官方 WhatsApp Web 协议，可能受平台/账号限制。只接收其他账号的新私人文本；忽略群组、状态、历史同步、媒体和出站回显。关联凭证与 Signal 密钥通过受保护渠道存储持久化，不使用明文认证文件。手机端退出登录会清除本地认证和账号绑定；Disconnect 同样清除本地认证/绑定。要同时在 WhatsApp 撤销关联，需在手机端移除该设备。应用不附带个人账号或手机号。
- 个人微信：使用腾讯公开的 iLink/ClawBot 协议。选择微信扫码登录，在微信中扫描并确认，按提示填写验证码。账号资格和接口可用性由微信决定，不安装注入式个人账号客户端或 OpenClaw 运行时。
- 飞书：需要含机器人的内部应用，具备私聊消息接收/读取与机器人发送权限，并通过长连接订阅 `im.message.receive_v1`。发布/启用应用并授权目标用户访问，填写 App ID 和 App Secret。群组 Webhook 机器人不是入站消息应用。
- Telegram：需要 BotFather Bot Token，并可访问 `api.telegram.org`。使用没有 Webhook 或其他 `getUpdates` 消费者的专用机器人。AXCrew 不会删除其他应用的 Webhook。首次连接跳过旧更新；忽略超过五分钟的消息。

连接后，在电脑生成五分钟有效的 `/pair ...` 命令，在机器人私聊发送，再回电脑批准显示的发送者 ID。知道机器人地址不代表获准控制。命令一次有效，重启后不恢复，命令本身也不批准账号。每个平台最多保留 64 个账号绑定，待处理请求会过期。

Disable 停止连接、任务提交与回复，并丢弃排队消息。Disconnect and remove credentials 还会移除绑定与队列消息。更换凭证会清除绑定，其他机器人不能继承授权。Revoke 移除单个账号访问权。这些操作不删除会话，也不取消已经接受的工作。

<a id="first-use-guidance"></a>
## 首次使用引导

桌面首次批准新绑定时，会排队发送带实时编号主菜单的欢迎消息。平台分发器在尝试投递前，先消耗受保护的逐账号 `welcome_pending` 标记；重复点击批准、重连和重启不会重发已尝试投递的欢迎消息。尚未尝试发送的待发送标记可跨重启保留。旧绑定默认没有待发送欢迎；撤销或更换凭证会删除绑定/标记。禁用的平台会等到启用后再发送。失败或结果不明确的欢迎发送会报告投递错误，不自动重试；用户可自行发送 `菜单` 或帮助短语打开菜单。

欢迎消息先于已接收聊天输入分发。账号若已有选择菜单，保留当前菜单；若正在执行任务，则发送简短欢迎及状态/取消提示，不显示数字选择器。欢迎/帮助导航不会创建模型调用或任务。

首次普通任务没有已选/默认项目时，打开编号项目菜单，并明确告知原任务尚未提交。选择项目后需重新发送任务文本，不会静默排队或执行。新会话/项目/历史切换确认会简短提示可发送 `菜单`；普通任务回复不重复整段帮助。

<a id="natural-language-navigation-and-numbered-menus"></a>
## 自然语言导航与编号菜单

导航由确定性程序逻辑处理，不调用模型/分类器解释管理消息。识别以下完整短语，允许末尾附带中英文句末标点：

- `菜单`、`会话菜单`、`帮助`、`返回菜单`、`怎么用`、`怎么使用`、`你能做什么`：主菜单。
- `切换项目`、`换个项目`、`选择项目`、`查看项目`、`项目列表`：编号本地项目菜单。
- `历史会话`、`查看历史会话`、`查看会话`、`切换会话`、`会话列表`：编号本账号历史菜单。
- `新建会话`、`新开会话`、`新建聊天`、`开启新会话`、`新会话`、`开个新会话`：在当前项目准备新对话；没有已选/默认目录时打开项目菜单。
- `当前项目`、`查看当前项目`、`当前在哪个项目`、`查看状态`、`任务状态`：项目/任务状态。
- `取消任务`、`取消当前任务`、`停止任务`、`停止当前任务`：取消当前任务。

`切换到 项目名`、`切换到项目 项目名`、`切换项目到 项目名`、`换到 项目名`、`切换项目 项目名` 和 `新建会话 项目名` 接受已有的精确项目 ID/名称或绝对目录语法。`切换项目` 与 `新建会话` 参数形式也接受中英文冒号。这些是固定语法，不是模糊语义搜索。原斜杠命令仍可使用。不匹配的文本按普通 AX 聊天提交处理；未选工作区时打开项目选择器。仅在开发请求中提到导航，不会被拦截。

每页菜单最多显示八个编号选项。回复 `1`、`选择1`、`选1`、`第一个` 或全角数字可选择；`上一页`/`下一页` 翻页，`返回`/`返回菜单` 打开主菜单，`取消选择` 关闭菜单。明确的 `取消菜单`、`关闭菜单`、`退出菜单` 也会关闭；`取消`/`不选了` 仅关闭已打开菜单，绝不取消任务。取消任务应使用 `取消任务`。

编号只能在同一已批准的平台/发送者/聊天菜单中选择。选项是显示时的目录/会话 ID 快照；目录排序变化不会重排已显示菜单的编号。每次打开的页面五分钟有效。无效编号保留菜单并提示；有效选择只消耗一次，仍执行既有工作区、所有权、活跃任务与审批检查。代次、当前对话或所选目录变化会令菜单失效。目录或历史条目缺失时返回错误，不移动会话。

其他普通文本或斜杠命令会关闭待选择菜单；没有菜单时数字按普通聊天文本处理。菜单仅保存在内存，服务器重启后丢弃；项目选择/历史仍持久保存。过期或失效菜单回复会提示刷新，不执行任务。当前会话有执行中工作、问题或审批时不能打开导航菜单；菜单打开后若出现问题/任务，会丢弃菜单，并让数字文本进入既有任务/回答流程，保留问题选项回答功能。

<a id="commands-and-scope"></a>
## 命令与作用域

只接受已批准的私人文本聊天，忽略群组、机器人消息与媒体。每个平台/发送者/聊天绑定拥有独立的当前会话。普通文本会启动本地 AX 会话或继续该对话；项目选择也按每个绑定独立保存。授权允许在 AX 权限下选择已有本地项目/目录；不同对话不等于逐账号文件系统沙箱。

- `/help`、`/start`：命令帮助。
- `/projects [page]`：列出可用本地 Crew 项目、已注册本地 AX 工作区、默认目录与本账号所选目录。每页八条，并提供可复制的选择命令；不列出远程项目或缺失目录。
- `/project`：显示当前项目。`/project <project ID, exact name or
  existing absolute directory>` 选择项目并准备新对话。列表中的 ID 稳定；名称有歧义时必须使用 ID。支持带空格的引号路径。`default` 选择配置的默认目录。
- `/new [project ID, exact name or existing absolute directory]`：在当前项目准备新对话，或选择给定项目。首条普通文本创建首个任务；已有对话仍可访问。
- `/sessions [page]`：只列出该账号经本渠道创建、跨其项目的会话，每页八条。升级前已有当前绑定采用懒保留；升级前已丢弃的历史无法恢复。
- `/session <conversation ID>`：切换到本账号历史条目，并恢复其原工作区。稳定会话 ID 是其首个已存任务 ID；后续轮次只更新最新任务，不重复添加条目。不能选择仅在桌面创建的对话或其他账号的 ID。
- `/status`：当前项目/目录、任务、终态文本与待回答问题/审批。
- `/cancel`：取消本账号当前任务。
- `/allow <request_id>`：允许此对话中的一个待审批工具操作。
- `/deny <request_id>`：拒绝此对话中的一个待审批工具操作。

新建/项目/历史切换要求当前工作先结束或取消，包括待回答问题和审批。同一绑定对话内的活跃桌面轮次也会阻止离开。切换不会取消或移动工作。已删除的历史任务不显示；选择此类任务或缺失工作区会返回错误。项目与历史命令由 Crew 直接处理，不传给模型。

会话/问题 API 与 ApprovalBroker 仍为权威。渠道轮次将 Allow 环境收窄为 Ask，保留 Deny 环境。没有用于全部允许、会话级审批、信任管理、模型/平台密钥访问或选择他人任务的聊天命令。审批必须仍待处理，并对应当前任务事件索引。工作中收到其他文本只返回状态/取消提示；等待用户的问题使用既有回答流程。

最终结果、问题和审批提示通过轮询返回纯文本。回复按 1,500 字符分块，总上限 12,000 字符；完整输出保留在桌面。本版本不逐 Token 流式发送、不传文件、不支持群组，也不支持在聊天中选择远程环境或切换模型。

<a id="reliability"></a>
## 可靠性

各平台有独立的接收/重连与分发循环。保存某个平台只重启该平台。配置代次防止旧连接在凭证更换后继续接受消息或持久化旧凭证。Telegram offset 与微信 cursor 持久保存。飞书在本地有界接收后确认。收件箱最多 128 条消息，去重窗口保留 4,096 个 ID。

接收先持久化，再确认/推进供应商游标。处理时先从收件箱移除消息，再提交其变更，以优先避免重复；在此窗口崩溃可能丢失一次提交/确认。变更和结果不明确的出站发送不自动重试，失败通知也不反复重发。重新提交前先检查 `/status` 或桌面状态。这不是聊天平台与 Crew 之间事务性的恰好一次投递。

<a id="storage-and-management-api"></a>
## 存储与管理 API

Crew 数据库旁的 `chat-channels.dat` 包含配置、凭证、绑定、各账号所选目录与会话书签、游标和有界收件箱。旧旁路文件加载时，项目/历史字段为空。先持久写入，再修改内存。Windows 对整个文件使用当前用户 DPAPI；Unix 上 JSON 旁路文件以仅所有者可读写的 0600 模式创建，目录/备份也应保护，绝不可上传。状态接口不返回应用密钥、Bot Token 或微信上下文/登录令牌。

只有桌面管理员令牌能管理渠道：

- `GET /api/channels`：十个平台的脱敏状态。
- `PUT /api/channels/{platform}`：`{enabled,cwd,app_id?,secret?,app_token?,tenant_id?,public_url?,bridge_path?,database_path?}`；省略或留空 secret/App Token 会保留已有凭证。状态还返回 `available`、`app_token_configured`、非密钥桥/租户/公网 URL 字段，以及仅供桌面查看的当前 WhatsApp 扫码挑战。启用需要凭证；`cwd` 可为空。非空默认目录必须是已有绝对目录。
- `POST /api/channels/whatsapp/install`：桌面管理员安装/修复固定版本的可选配套依赖，需要 Node.js/npm 和网络访问。
- `POST /api/messaging/teams`：由 Microsoft 认证的公开 Bot Framework 入站接口，正文上限 256 KiB，**不使用** Crew 管理员令牌认证。
- `DELETE /api/channels/{platform}`：断开并移除凭证/绑定。
- `POST /api/channels/{platform}/pairing`：一次性命令及过期时间。
- `POST /api/channels/{platform}/peers/{id}/approve` 和 `DELETE /api/channels/{platform}/peers/{id}`：批准/撤销账号。
- `POST /api/channels/weixin/login`：临时扫码挑战。
- `POST /api/channels/weixin/login/status`：`{id,verify_code?}`；确认后保存凭证，只返回登录状态。

微信重定向/API origin 必须是 `weixin.qq.com` 下的 HTTPS；发现的飞书 Socket 必须是允许的 Feishu/Lark 主机上的 WSS。不跟随 HTTP 重定向；TLS 证书校验始终启用。

消息、命令、审批摘要与回复会经过所选聊天平台，这不是通过该平台建立的端到端加密 Crew 隧道。本地适配器/流程验证不代表真实账号投递成功；微信资格、飞书发布/权限和 Telegram 凭证仍需用户账号验证。新适配器验证采用本地协议夹具；真实投递、账号资格和 macOS 权限均需实际账号/设备验收。仅编译成功不能证明某个真实账号可用。

<a id="source-references"></a>
## 源码参考

- [腾讯微信协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)
- [飞书官方 SDK](https://github.com/larksuite/oapi-sdk-python/blob/v2_main/lark_oapi/ws/client.py)
- [Telegram Bot API](https://core.telegram.org/bots/api)

微信遵循公开的 2.4.10 客户端线上协议，并声明 AXCrew 自己的 bot-agent 标识。飞书帧遵循官方 protobuf 协议。新平台应使用独立适配器，复用本地授权和正常会话 API。

上游 MIT 声明保留在 `licenses/feishu-sdk-MIT.txt` 和 `licenses/tencent-weixin-MIT.txt`。

其他协议参考：
- [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [Discord Gateway](https://discord.com/developers/docs/events/gateway)
- [Webex 消息](https://developer.webex.com/messaging/docs/api/v1/messages)
- [企业微信官方 SDK](https://github.com/WecomTeam/aibot-node-sdk)
- [Teams 认证](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication)
- [imsg JSON-RPC](https://github.com/openclaw/imsg/blob/main/docs/rpc.md)
- [Baileys](https://github.com/WhiskeySockets/Baileys)
