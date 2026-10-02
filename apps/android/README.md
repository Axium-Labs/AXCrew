# AX Crew Android

AX Crew 的原生 Android 控制客户端。Kotlin、Compose Material 3、Navigation Compose、ViewModel/StateFlow、Coroutines、OkHttp 和 Kotlin Serialization。最低 Android 8.0 / API 26。

手机控制的是电脑端同一个 Crew Gateway，或单独部署的 Crew Gateway；不会启动 AX Runtime、执行 SSH、打开远程 shell 或保存模型提供商密钥。架构及桌面功能对应关系见 [桌面实现与 Android 对应关系](../../docs/architecture/android-migration.md)。

## 开发与构建

使用 Android Studio 打开本目录，安装 Android SDK Platform **36.1** 与 Build Tools **36.1.0**，设置 JDK 17 或 21。项目使用 AGP 9.1.0 内置 Kotlin 2.2.10，Compose/Serialization 插件使用同一版本；Gradle Wrapper 固定 9.3.1。版本兼容参考 [Android 官方 AGP 文档](https://developer.android.com/build/releases/agp-9-1-0-release-notes)。

```powershell
cd C:\Users\14181\Desktop\axlab\ax_crew\apps\android
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

macOS/Linux 使用 `./gradlew`。也可以在本地（不提交）的 `local.properties` 中设置 `sdk.dir`。首次构建需要访问 Google Maven、Maven Central 和 Gradle 下载服务。若公司网络需要代理，在个人 `~/.gradle/gradle.properties` 中配置代理，不要把凭据提交到项目。

输出：`app/build/outputs/apk/debug/app-debug.apk`。安装到已允许 USB 调试的设备：

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r .\app\build\outputs\apk\debug\app-debug.apk
```

Release APK 需要使用自己的发布签名；本仓库不包含发布私钥。Debug 也强制 HTTPS/WSS，不提供明文或跳过证书校验开关。

## 连接正在运行的电脑端 Crew

启动直接进入会话首页，不强制先登录。左上角打开侧栏，包含 Gateway 连接、设备切换、新建会话与历史会话。未连接时可以先写草稿，点击发送会打开连接面板并保留草稿。连接后，底部输入框使用所选 Agent 创建并开始真实 AX 任务；已有会话可以继续发送消息。

1. 使用包含本次修改的桌面端和后端版本。在桌面端 **设置 → 连接与系统 → Android 控制客户端** 点击「显示 Android 连接信息」。
2. 面板显示本次桌面启动的本机 Gateway 上游地址及 Token。Token 只保留在组件内存，60 秒后或页面隐藏时收起。原有后台 `backend_connection` Tauri 命令供本地 UI 使用，不新增公开凭据接口。
3. 使用 HTTPS 反向代理，把手机能访问的域名映射到这个本机上游。必须原样传递 `Authorization`，支持 WebSocket Upgrade，并将空闲超时设为大于 60 秒。使用 Android 系统信任的有效证书；App 不接受自签名证书或关闭验证。这里不自动更改防火墙、公开端口或部署代理。
4. 手机点击左上角侧栏 →「连接电脑 / Gateway」，输入 HTTPS 根地址（例如 `https://crew.example.com`，不带 `/api`）以及面板中的 Token。App 验证受认证保护的 `/api/settings`、协议版本与 `/api/devices` 后加密保存。
5. 手机上的 `local` 设备指 **Gateway 所在电脑的 AX**，不是手机。配对的其他 AX 电脑也会显示在设备列表中。

例如已有 Caddy 和可签发证书的域名时，代理配置可为（端口替换成桌面面板的真实上游端口）：

```caddyfile
crew.example.com {
    reverse_proxy 127.0.0.1:12345
}
```

桌面端首次启动会生成端口和 Token，并保存到应用数据目录的 `gateway.json`；后续重启沿用连接配置。只有主动更换端口或 Token 后才需要更新代理和 Android 连接。关闭桌面窗口只会隐藏到托盘，Gateway 继续运行；退出桌面进程则断开。不要将手机连接到另一个空数据库的服务后误认为这是同一个桌面工作区。

如果需要固定地址，可以按根 README 单独运行 Crew，设置稳定的 `AX_CREW_ADMIN_TOKEN`、数据库路径和监听端口，再通过 HTTPS 代理连接。不要让两个后端同时打开同一数据库；独立服务的任务不会自动合并到桌面端自带服务。

**手机登录 Token 与 AX 设备配对码不同。** `/api/pairing` 用于把 AX Runtime 电脑注册到 Gateway；Android Control Client 不兑换配对码，也不注册成 AX 执行设备。

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

- HTTP 和 WebSocket 都用 `Authorization: Bearer`，Token 不放进 URL。HTTPS 强制校验；拒绝 URL 内凭据、查询、片段和子路径；不自动跟随重定向，也不自动重试修改请求。
- Token 和地址使用 Android Keystore AES-GCM 加密，密钥不可导出，SharedPreferences 只保存密文和随机 IV；关闭 App 备份。截图及最近任务预览受 `FLAG_SECURE` 保护。登出删除本地密文，**不代表服务端撤销 Token**；遗失设备需在 Gateway 端轮换 Token。
- 现有 Gateway 只有管理员 Bearer Token，没有用户登录或细粒度客户端角色。此版本沿用该权限模型，不声称实现服务端手机专属最小权限 Token。App 不提供 AllowAll/YOLO 配置：新 Agent 仅 Ask/Deny；对已有 Allow Agent 的手机提交增加 Ask 覆盖；Deny 保持不变。所有审批仍经过 `ApprovalBroker` 和 AX PermissionStore。
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
