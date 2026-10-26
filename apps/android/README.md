# AX Crew Android

会话和语音通话会显示 AX 提供的模型连接/重连次数，最多 5 次请求；模型无法连接时显示具体连接失败信息。最终失败次数保存在任务输出中，重新打开会话仍可查看。需要匹配的新版 AX 和 AXCrew 后端。

AX Crew 的原生 Android 控制客户端。Kotlin、Compose Material 3、Navigation Compose、ViewModel/StateFlow、Coroutines、OkHttp 和 Kotlin Serialization。最低 Android 8.0 / API 26。

手机控制的是电脑端同一个 Crew Gateway，或单独部署的 Crew Gateway；不会启动 AX Runtime、执行 SSH、打开远程 shell 或保存模型提供商密钥。架构及桌面功能对应关系见 [Android 客户端范围](../../docs/architecture/android-migration.md)。

## 开发与构建

使用 Android Studio 打开本目录，安装 Android SDK Platform **36.1** 与 Build Tools **36.1.0**，设置 JDK 17 或 21。项目使用 AGP 9.1.0 内置 Kotlin 2.2.10，Compose/Serialization 插件使用同一版本；Gradle Wrapper 固定 9.3.1。版本兼容参考 [Android 官方 AGP 文档](https://developer.android.com/build/releases/agp-9-1-0-release-notes)。

```powershell
cd apps\android
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

macOS/Linux 使用 `./gradlew`。也可以在本地（不提交）的 `local.properties` 中设置 `sdk.dir`。首次构建需要访问 Google Maven、Maven Central 和 Gradle 下载服务。若公司网络需要代理，在个人 `~/.gradle/gradle.properties` 中配置代理，不要把凭据提交到项目。

输出：`app/build/outputs/apk/debug/app-debug.apk`。安装到已允许 USB 调试的设备：

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r .\app\build\outputs\apk\debug\app-debug.apk
```

Release APK 需要使用自己的发布签名；本仓库不包含发布私钥。公网 API 使用 HTTPS/WSS；局域网私网地址兼容 HTTP，不提供跳过证书校验开关。

## 连接正在运行的电脑端 Crew

启动直接进入会话首页，不强制先登录。左上角打开侧栏，包含 Gateway 连接、设备切换、新建会话与历史会话。未连接时可以先写草稿，点击发送会打开连接面板并保留草稿。连接后，底部输入框使用所选 Agent 创建并开始真实 AX 任务；已有会话可以继续发送消息。

1. 在桌面端 **连接 → 控制此电脑** 打开添加设备。局域网模式提供本机地址和一次性配对二维码。
2. 手机侧栏打开连接电脑，扫码后在电脑端确认授权。配对码五分钟有效；手机领取独立设备凭证并通过 Android Keystore 加密保存，可在电脑端撤销。
3. 手机的 `local` 设备指 Gateway 所在电脑的 AX。电脑需保持开机并运行 AXCrew；退出电脑端会断开连接。

已移除 IPv6 专用直连和共用中转。旧测试版保存的异地地址不会自动重连，请在同一局域网重新扫码；原有会话和局域网凭据不删除。通过飞书、微信或 Telegram 发任务使用电脑端的 [聊天渠道](../../docs/chat-channels.md)，无需安装此手机 App。

手机登录设备凭证、手机一次性配对码和 AX Runtime 设备配对码用途不同，不混用。

## 会话、计划与附件

- 启动进入会话首页。左上角侧栏顶部是电脑名称和切换菜单，中间按日期分组显示会话，底部可管理 Gateway 连接。手机不再显示「团队」入口；Crew/Member 仍作为后端执行实体使用。
- 底部导航为「会话 / 计划 / 设备 / 更多」。计划复用桌面 `/api/automations`：创建、编辑、暂停/启用、立即运行、删除、七日计划概览及执行记录。支持固定间隔、每天、每周，以及静默、严格计划、隐藏会话和精简上下文。新计划默认询问工具权限。
- 新会话点击输入框里的模型名称，从所选电脑工作目录的能力目录选择模型；不会在手机保存模型 API Key。已有 AX 会话继续使用创建时的模型，更换模型需新建会话。
- 点击麦克风调用系统语音识别；结果加入草稿，确认后发送。不自动发送识别结果，设备需要安装可用的语音识别服务。相机与文件选择器采用 [Android Activity Result API](https://developer.android.com/reference/androidx/activity/result/contract/ActivityResultContracts)。
- 加号提供拍照、选择图片、添加文件。使用系统相机和文件选择器，不申请全盘存储权限。附件以标签显示，可点击移除；每条消息最多 4 项，单项最多 8 MB，App 总计最多 16 MB。图片支持 PNG/JPEG/WebP/GIF；普通文件原样上传，不由 App 自动执行。
- 附件目前支持 Gateway 所在电脑（`local`）的工作区；其他配对设备尚无文件传输接口，客户端明确报错并保留草稿。普通文件需要本次更新后的 Gateway，`/api/settings` 返回 `session_files: true`；旧版 Gateway 仍能使用文字和图片，App 会阻止静默丢失普通文件。
- 消息提交到现有 `/api/sessions`，图片使用原 `images` 字段；普通文件添加可选 `files: [{name, data}]`，其中 data 为 Base64。两种附件保存在工作区 `.ax/crew-attachments/`，使用随机文件名、防路径穿越、大小限制，原有 Permission 系统继续生效。
- 会话显示 running/completed/failed、流式输出，支持停止、重试和继续会话。审批入口支持 Allow Once / Allow Session / Reject。

任务依赖通过原 `dependencies` 字段提交，前置输出通过 `include_dependencies` 传递，由后端调度。手机没有另写调度器。

## 同步、存储与权限边界

- HTTP/WebSocket 使用 `Authorization: Bearer`。HTTPS 校验证书，不跟随重定向，不自动重试修改请求。
- Token 和地址使用 Android Keystore AES-GCM 加密，密钥不可导出，SharedPreferences 只保存密文和随机 IV；关闭 App 备份。允许正常截图、录屏和最近任务预览，不再全局设置 `FLAG_SECURE`。登出删除本地密文，**不代表服务端撤销凭证**；遗失手机应在电脑端撤销该设备。
- 手机独立设备凭证受手机接口白名单约束，不能管理配对授权、聊天渠道配置、SSH、分布式管理或获取 `/api/xfy` 密钥；使用手机凭证的直连也应用同一规则。需要 `/api/xfy` 的共享语音服务配置不向手机下发。权限是配对电脑的工作区级信任，尚无逐项目/会话隔离。撤销使后续请求失效并关闭事件流；已经受理的任务继续。旧的管理员 Token 直连仍为管理员权限。
- WebSocket 以 20 秒 Ping 检查连接，异常时指数退避加抖动，最大约 30 秒重试；事件按 `event_id` 去重。缓冲溢出会重连，不静默丢弃。
- `ProcessLifecycleOwner` 控制前后台连接。后台不保活、不启动前台服务，不保证后台通知；远程任务继续，五分钟审批超时仍按原协议拒绝。回到前台恢复 socket，并重新获取设备、任务、成员、会话绑定和待审批列表。
- 活跃前台每 8 秒校准 REST 状态，补偿现有创建/编辑接口未发事件的情况。打开的活跃会话每 15 秒读取 AX 历史，重连和结束后再读取。事件索引已脱敏，不能当作完整输出回放。当前协议无增量游标，断线期间的输出依靠 AX 历史恢复；无法确认的片段不盲目拼接，可能等下一次历史同步后才完整显示。
- 实时事件保留最近 300 条；内存保存最多 30 个任务的流、每任务最多 500 段、合并文本最多 200,000 字符。完整历史仍在 AX，未引入 Room。进程重启不会恢复未提交草稿或本地日志；任务和历史从 Gateway/AX 重新读取。
- 如果提交时断线，请刷新任务列表确认是否已被受理，再决定是否重发。当前 API 没有幂等键，客户端不会擅自重试 POST 造成重复执行。

## 验证

`ProtocolTest` 使用 TLS MockWebServer 验证认证头、协议 JSON、三种审批值、HTTPS 限制、重定向拒绝、WS 事件、重连/前台恢复、去重、Ask/Deny、历史合并、模型/图片会话请求、文件能力协商及计划更新协议。测试证书只存在于测试进程，生产网络没有测试信任配置。

后端回归（在仓库根目录）：

```powershell
cargo test
cargo build --target-dir target/android-validation
python tests/gateway_socket.py target/android-validation/debug/ax-crew.exe
python tests/smoke.py C:/path/to/ax.exe target/android-validation/debug/ax-crew.exe
cd apps/desktop
npm run build
npm run test:ui
cargo build --manifest-path src-tauri/Cargo.toml
```

Windows 上现有桌面进程可能占用 `target/debug/ax-crew.exe`，可用独立 `--target-dir` 完成构建验证，无需关闭或替换用户正在运行的服务。

真机验收：HTTPS 登录 → 选择本机及远程设备 → 提交任务 → 观察流输出 → 分别审批/拒绝 → 切换后台 → 恢复 → 关闭网络再恢复 → 最终状态/历史一致。没有连接手机或模拟器时，编译与协议测试不能代替这个真机验收。
