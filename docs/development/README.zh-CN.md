<a id="development"></a>
# 开发

[English](README.md) | **简体中文**

生产 Rust 模块/Cargo target 不依赖私有、未跟踪的测试文件。本地回归接线应放在可丢弃的源码覆盖层中；对正式文件集合另行执行构建、测试编译和静态检查。私有测试源码及生成产物保留在本地。

<a id="prerequisites"></a>
## 前置条件

- Rust 1.92+，edition 2024；Windows 使用 MSVC 工具链。
- 桌面端需要 Node.js + npm 和 Tauri 2 CLI，安装命令为 `cargo install tauri-cli --version "^2" --locked`。
- Android 客户端需要 JDK 17/21 与 Android SDK 36.1。

<a id="control-plane"></a>
## 控制平面

所有命令均在仓库根目录执行。根目录 Cargo 工作区只有 `crates/server` 一个成员，构建产物路径与以前相同，为 `target/debug/ax-crew.exe`。

```powershell
cargo build
cargo fmt --check
cargo check --workspace
cargo clippy --workspace --all-targets
cargo test --workspace
```

启动：

```powershell
$env:AX_CREW_ADMIN_TOKEN = '<long-random-admin-token>'
.\target\debug\ax-crew.exe --ax ..\ax\target\debug\ax.exe --database .\crew.sqlite3 --listen 127.0.0.1:8765
```

非回环 `--listen` 必须配置 `AX_CREW_ADMIN_TOKEN`。

<a id="desktop"></a>
## 桌面端

Windows/Linux/macOS 构建依赖、原生包配置、匹配后端的准备步骤和可选目标选择，见 [platforms.md](../platforms.zh-CN.md)。原生桌面端现要求 Rust 1.92+，与工作区一致。

```powershell
cd apps\desktop
npm ci
npm run tauri:dev     # app + Vite + the local backend
```

在 `apps/desktop` 中运行 `npm run tauri:build`，会在 Tauri 构建前准备后端。单独执行 `cargo tauri build` 不包含这一步；直接调用它时应先运行 `npm run prepare:binaries`。便携打包命令为 `npm run pack:portable`，脚本位于仓库的 `scripts/` 目录。

<a id="desktop-theming"></a>
### 桌面主题

桌面 UI 只有一套调色系统，定义在 `apps/desktop/src/styles.css`：

- Tailwind v4 的 `@theme` token（`--color-surface`、`--color-accent`、`--color-success` 等）在 `:root` 保存深色值；浅色覆盖位于 `[data-theme="light"]`。主题由 `ax-crew-ui` zustand store 选择，值为 `theme: dark | light | system`，并设置 `document.documentElement.dataset.theme`。
- Shell CSS 变量（`--shell-bg`、`--shell-panel`、`--shell-text`、`--shell-border`、`--shell-hover`、`--shell-active` 等）为普通 CSS 文件映射同一套值。
- 强调色仅使用一种低饱和鸢尾紫，用于选中、开关、焦点和主要操作。分为两类：`accent-text` / `--shell-accent` 用于文字、链接和浅色背景；`--color-accent` / `--shell-accent-strong` 用于配白字的实色填充，如主要按钮、开关、滑块和聊天发送按钮。不要再为普通控件引入第二种蓝色。
- 绿、黄褐、红只表示 `success` / `warning` / `danger` 状态，两种主题均单独定义。
- 深色为石墨色（接近黑色的蓝灰色），浅色为暖白。页面 CSS 使用 `var(--shell-*)` / `var(--color-*)` 消费 token，不在 `styles.css` 外硬编码十六进制颜色；操作系统惯例如 Windows 关闭按钮、二维码和图表配色除外。
- 形状和尺寸 token 定义在 `styles.css` 的 `:root`：`--radius-control` 为 11px，`--control-h` 为 32px，用于所有按钮、输入框、选择框触发器和搜索框；`--radius-chip` 为 12px，用于分段控件、提示和小盒子；`--radius-card` 为 16px，用于卡片、列表和行；`--radius-panel` 为 20px，用于 `.panel` 与对话框。999px 胶囊圆角只用于标签、状态小标签和开关，不用于操作按钮或选择框。`--page-title` 为 26px，统一用于顶层页面标题（`PageHead`、Settings、Connections、Artifacts）；窄布局降为 22px。
- 共享类：所有视图切换器，如列表/日历、画廊/表格、7/30 天，都使用 `.ax-segmented`，结合 `.is-active` 或 `aria-pressed`；行内提示与错误框使用 `.ax-notice` / `.ax-notice.is-error`，`.is-flush` 去掉顶部间距。输入框焦点环使用实色强调色 `--color-accent` / `--shell-accent-strong`。设置开关为 42×26，滑块为 20px，关闭时使用 `--shell-active`。对话框使用 `ui/Dialog`，手写的会话对话框也必须匹配其圆角、表面、遮罩和动画。

<a id="shared-desktop-surfaces"></a>
### 共享桌面界面

共享设计规则放在既有组件层，不为单个页面复制实现：

- `src/styles.css`：全局主题、形状、动画 token、Shell 布局和共享关键帧。功能 CSS 使用这些 token，不另建调色系统。
- `src/components/ui/primitives.css`：Button、Input/Textarea、Menu 和 Dialog 的样式。组件自行导入该文件。标准 Dialog 负责固定标题区与滚动正文；`layout="custom"` 仅供协作向导等已自行管理正文/底部布局的调用方使用。
- `src/components/ui/select.tsx` 和 `select.css`：基于 `options` 的通用、带标签单选控件。`components/shared.tsx` 中旧的原生选择实现已移除，使用方导入这个基础组件。
- `src/components/shared.tsx` 和 `shared.css`：PageHead、Empty、Field、Status、Action，以及共享的页面/面板/行/表单布局。Empty 接受可选图标、操作和功能类；各功能无需重新搭建其标记。
- `pages/management.css`、`settings.css`、`schedule.css`、`artifacts.css` 等功能样式只负责自身布局与领域样式。计划/产物紧凑布局依据容器宽度，不猜测导航之后剩余多少空间。

按钮与字段保留语义变体和键盘焦点状态。对话框关闭后，应恢复之前仍连接在文档中的控件焦点，除非调用方自行处理焦点恢复。共享组件规则在 CSS 层叠中位于调用方工具类之下。扩展组件时保留减少动画处理与主题变量，并删除已被替代的规则，不叠加覆盖层。

<a id="shared-single-selection-control"></a>
### 共享单选控件

从 `components/ui/select` 导入 `Select` 与 `SelectOption`。组件管理弹出层行为并自动加载样式，不依赖设置页 CSS。提供 `label`、`value`、`onChange` 与 `options`；选项包含 `value`、`label`，以及可选的 `group` / `disabled`。可选的 `className`、`id`、`name`、`placeholder`、`disabled` 用于适配布局。空字符串是合法选项/筛选值；真实 ID 不会与内部编码冲突。分组标题、选中标记、键盘选择、滚动、弹出层避让和 Escape 行为均共享。Escape 先关闭弹出层，再关闭父对话框。`SettingsSelect` 是同一实现的兼容导出，没有独立行为。

分布式视图与对话框的协作、AX、Host、状态、项目、操作、权限、放置和 Long Project 选择器均使用该控件。设置中的外观、模型/供应商、能力、Goal 和主机权限调用方也共享这一实现。页面 CSS 只控制宽度/布局；通用选择样式在 `components/ui/select.css` 修改。

<a id="android"></a>
## Android

```powershell
cd apps\android
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :app:assembleDebug :app:lintDebug
```

连接与发布签名细节见 [apps/android/README.md](../../apps/android/README.md)。

<a id="repository-level-scripts"></a>
## 仓库级脚本

| 脚本 | 用途 |
|---|---|
| `scripts/prepare-binaries.mjs` | 构建 Release 后端，并准备到 `apps/desktop/src-tauri/bin/`。 |
| `scripts/pack-portable.mjs` | 生成 `dist-pack/AX-Crew-<version>-win-x64-portable.zip`。 |
| `scripts/start-workspace.ps1` | 启动工作区构建，不替换已安装的 AX。 |

<a id="documentation-upkeep"></a>
## 文档维护

- 模块职责变化：更新 [architecture/README.md](../architecture/README.zh-CN.md)。
- REST、WebSocket 或 ACP 约定变化：更新 [protocol/README.md](../protocol/README.zh-CN.md) 和 [protocol/api.md](../protocol/api.zh-CN.md)。
- 新命令或脚本：更新本页。
- [AGENTS.md](../../AGENTS.md) 保持为简短导航，详细说明放在这里。

<a id="local-validation"></a>
## 本地验证

独立测试套件、测试工具和工作日志在本地维护，不随公开仓库发布。公开构建命令不依赖这些文件。源码内嵌 Rust 单元测试仍可通过 `cargo test --workspace` 执行。

工作台验证覆盖共享 AX/多 Goal 任务放置、共享 Host 容量、完整 Workflow 暂停/恢复、CAS 与实例化标识/代次围栏隔离、按作用域配置的原生设置、部分批量结果、真实 ACP 指导与单请求审批，以及原生 Long Project 检查点连续性。本地进程场景使用真实 AX 工作进程和 Crew，配合受控模型端点；UI/浏览器交互场景覆盖两种主题和窄/宽布局。这些本地测试源码/结果不是公开构建依赖。原生管理路径必须针对目标 AX 命令验证，不能只测试 HTTP 模拟。

<a id="shared-disclosure-control"></a>
### 共享展开控件

可展开信息和高级表单区域使用 `components/ui/disclosure`。`Disclosure` 接受 `title`、`children`，以及可选 `defaultOpen`、`className`，并自行加载样式。共享 Button 提供 Enter/Space、`aria-expanded`、`aria-controls`、旋转的 Lucide 箭头及键盘焦点样式。折叠时隐藏子节点而不卸载，从而保留表单草稿。分布式视图及相关对话框使用它，而非浏览器原生 details/summary 控件。

服务器工作区还编译基于 reqwest、tokio-tungstenite 和 prost 的出站聊天适配器。Windows 渠道旁路存储通过 windows-sys 使用当前用户 DPAPI。原生出站适配器无需 Node 或入站中转；WhatsApp 和 iMessage 的配套前置条件见下文，Teams 则需要经过认证的 HTTPS 入站接口。详见[配置与平台前置条件](../chat-channels.zh-CN.md)。

<a id="optional-whatsapp-companion"></a>
### 可选 WhatsApp 配套组件

服务器在编译时嵌入 `apps/channel-bridge/whatsapp.mjs`、`package.json` 和 `package-lock.json`，源码分发必须包含这三个文件。编译 Rust 无需 Node 构建步骤。运行时，WhatsApp 需要 Node.js 20+，并由用户在设置中触发依赖安装。本地开发可在 `apps/channel-bridge` 执行 `npm ci --omit=dev`；`node_modules` 不纳入源码管理。iMessage 使用 macOS 上另外安装的 `imsg` 二进制程序。
