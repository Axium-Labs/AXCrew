<a id="desktop-platforms"></a>
# 桌面平台

[English](platforms.md) | **简体中文**

AX Crew 在 Windows、Linux 和 macOS 上共享一套 React/Tauri 客户端及 Rust 网关。前端、API、数据库与 AX ACP 协议相同；Android 的独立客户端及协议不变。

<a id="native-builds"></a>
## 原生构建

安装 Rust 1.92+、Node.js/npm 和 Tauri 2 CLI，再在 `apps/desktop` 中运行 `npm ci` 与 `npm run tauri:build`。AX 需另行安装，可放在其官方用户路径，或通过 `AX_CREW_AX` 指定。

- Windows：沿用 NSIS 安装器，附带资源 `bin/ax-crew.exe`。
- Linux：提供 Debian/AppImage 包，附带可执行资源 `bin/ax-crew`。Ubuntu/Debian 构建依赖包括 `build-essential`、`pkg-config`、`libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`、`patchelf`、`libssl-dev`。运行需要图形桌面/WebKitGTK 4.1；AppImage 可能需要 FUSE 或先解包。
- macOS：提供 `.app`/`.dmg` 包，附带可执行资源 `bin/ax-crew`，最低要求 macOS 12 和 Xcode 命令行工具。Intel 与 Apple Silicon 使用不同安装包。公开分发仍需签名/公证；本地未签名构建不属于已公证发布。

平台专用 Tauri 配置覆盖 Windows 资源与打包格式。`prepare-binaries.mjs` 准备匹配的网关；交叉编译时设置 `AX_CREW_TARGET`，并向 Tauri 传递相同的 `--target`。脚本遵循 `CARGO_TARGET_DIR`。网关与桌面构建共享自定义构建目录时，应使用绝对 `CARGO_TARGET_DIR`，因为两者的 Cargo 工作目录不同。`pack:portable` 保留 Windows ZIP，生成 Linux AppImage，并使用 `ditto` 把完整 macOS `.app` 打成 ZIP。不要分发裸 Unix 桌面可执行文件。

手动/PR 触发的 `Desktop platform builds` 工作流生成 Windows x64、Linux x64/arm64 与 macOS Intel/Apple Silicon 安装器。`stage-platform-assets.mjs` 设置规范文件名并生成 SHA256SUMS。该工作流只上传工作流产物，不发布 Release。tag 触发的 `Release` 工作流构建相同矩阵，从各平台目录收集规范名称的安装器，并发布一份统一 SHA256SUMS。只有相应原生 CI 作业实际通过，才能把 macOS/arm64 构建视为已验证。新增产物必须另行发布，才可从 Release 下载；旧 Release 不会自动出现它们。

<a id="runtime"></a>
## 运行时

Unix 终端设置提供默认登录 Shell、POSIX sh、Bash、Zsh 和 Fish。默认先解析可执行的 `$SHELL`，再尝试 macOS 的 `/bin/zsh` 或 Linux 的 `/bin/bash`，最后回退到 `/bin/sh`。PTY 在所选项目目录启动交互式登录 Shell。显式选择的 Shell 必须已安装；从其他平台保存的选项回退到当前平台默认值。Windows 保留既有选项。

GUI 子进程/PTY 保留继承的 PATH，并追加标准用户/系统路径：`~/.local/bin`、`~/.cargo/bin`、`/opt/homebrew/bin`、`/usr/local/bin` 及操作系统路径。非标准位置安装的工具必须在继承 PATH 中可见。SSH 需要本地 OpenSSH 客户端和远程 POSIX Shell。

Unix 系统设置通过 sysinfo 采集 CPU、内存、运行时间及 HOME 所在文件系统，保留可空 MiB 字段，并在 UI 中以 GiB 显示。Windows 采集器不变。NVIDIA NVML 为可选依赖；Apple/Intel/AMD GPU 指标仍不可用。macOS 从 Dock 重新打开应用时恢复主窗口。托盘与完成提醒依赖操作系统桌面支持；内嵌提示音仅用于 Windows，Unix 通知行为由平台提供。

<a id="updates-and-data"></a>
## 更新与数据

AX 使用原生官方安装器/更新器。Crew 按 SHA256SUMS 校验对应平台包。Windows 保留 NSIS 更新方式；macOS 打开下载的 DMG；Linux 使用桌面安装器关联打开 Debian 包。用户完成安装后重启 Crew。非 Debian 发行版使用 AppImage。若缺少安装器关联，会报告已保存的包路径。

网关数据库与配置仍位于 Tauri 的逐用户数据目录，与应用包分离；`AX_HOME`、`AX_CREW_AX`、`AX_CREW_BACKEND` 的含义不变。Computer Use 委托给 AX 的 Windows UIA、Linux AT-SPI 或 macOS Accessibility 适配器。Unix 运行依赖/TCC 授权及 Wayland 输入/截图限制，见 [AX Computer Use](https://github.com/Axium-Labs/AX/blob/main/docs/computer-use.md)。AX 的原生 macOS 限制执行后端仍不可用，也不会放宽限制。

<a id="verification-status"></a>
## 验证状态

Windows 前端、原生测试与网关检查已在本地通过。Linux x64 已进行原生网关/桌面测试，真实 PTY 输入/缩放/Ctrl+C 与遥测检查，并在带虚拟 X 服务器的 Ubuntu/WSL 中启动调试 Debian 包。在隔离用户数据目录中检查了打包窗口与随附网关健康状态。原生 Computer Use 也已针对独立 GTK/X11 夹具验收，包括真实读取、文本、控件、输入、截图和权限拒绝。

这些检查不属于物理 Linux 桌面验收，也不是 Release 构建。此处尚未验证 macOS、Linux arm64、macOS 签名/公证与外部 SSH；分发前需要对应原生验证。
