# AX Crew 0.2.1

- `AX-Crew-0.2.1-windows-x64-setup.exe`：Windows 64 位安装向导，安装后从开始菜单启动。
- `AX-Crew-0.2.1-android.apk`：签名 Release APK（Android 8.0 及以上）。
- `SHA256SUMS`：两份下载文件的 SHA256 校验值。

桌面正式版使用系统 AX。没有 AX 时进入设置 → 本地 AX，检查并下载安装；安装或更新后重启 AX Crew 生效。
AX Crew 自身更新在设置 → 连接与系统 → AX Crew 版本更新。

Windows EXE 尚未做 Authenticode 签名，Windows 可能显示未知发布者提示。
Android APK 使用新的正式发布签名；若手机已安装使用其他签名的开发版，需要先备份连接配置并卸载旧版，再安装此 APK。

发布签名的私钥和密码不放入仓库。维护者需要备份本机的 `~/.axcrew/release-signing/`，后续 APK 必须继续使用同一签名。
