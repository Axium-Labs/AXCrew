<a id="android-client-scope"></a>
# Android 客户端范围

[English](android-migration.md) | **简体中文**

Android 应用与桌面客户端使用相同的 REST 和 WebSocket API 控制 AXCrew Gateway。它不运行 AX Runtime，不执行远程 Shell 命令，不管理电脑上的模型供应商凭证，也不负责 AX 安装与备份管理。

<a id="available-workflows"></a>
## 支持的工作流程

| 领域 | Android 支持情况 |
|---|---|
| 会话 | 连接网关，选择设备和项目，新建或继续对话，查看实时输出与任务历史。支持相机、图片、文件和语音输入。 |
| 任务与计划 | 查看任务详情，创建、编辑、启用、暂停、执行或删除计划。可视化工作流和日历视图仍由桌面端提供。 |
| 设备 | 查看连接状态、平台、版本及上报能力；重命名设备并向其提交工作。配对与撤销仍在桌面端完成。 |
| 权限 | 查看待处理的工具请求，允许一次、允许本会话或拒绝。Android 不会自动批准请求。 |
| 活动与产物 | 浏览近期活动和任务产物，并打开对应任务。桌面端特有的产物文件夹组织方式不会共享到 Android。 |
| 设置 | 使用 Android Keystore 保护的凭证配置网关连接，退出登录，并跟随系统主题。 |

<a id="client-and-data-boundaries"></a>
## 客户端与数据边界

Android 客户端使用原生 Compose 界面，背后是 ViewModel 与仓储层。它通过 Crew API 读写数据，不直接连接服务器存储，也不链接服务器内部模块。Crew 和 Member 仍是服务器端的执行实体；Android 展示设备和工作选项，不向用户暴露内部团队模型。

Android 不提供工作区文件浏览、本地终端会话、远程 Shell 访问或桌面文件系统操作。这些能力依赖桌面本地 API，受限网关接口没有提供对应功能。Android 不会另加 Shell 或文件端点来绕过这个边界。

<a id="references"></a>
## 参考

- [平台支持](../platforms.zh-CN.md)：支持的客户端与打包方式。
- [REST 与 WebSocket API](../protocol/api.zh-CN.md)：共同使用的线上协议。
- [桌面行为](../desktop/README.zh-CN.md)：桌面端特有的工作流程。
