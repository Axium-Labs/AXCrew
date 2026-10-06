# 2026-10-04 22:40

Task: Restructure the root README as a public-facing control-plane homepage

Changed:
- README.md (rewritten)
- docs/README.md (docs map: added api.md / storage.md / desktop/README.md)
- docs/protocol/README.md (canonical API description now points to protocol/api.md; fixed two pre-existing broken links to ../architecture/design.md)
- docs/protocol/api.md (new: REST/WebSocket API, auth, pairing, storage boundary)
- docs/architecture/README.md (added Repository layout section + storage.md/desktop docs rows)
- docs/architecture/storage.md (new: SQLite WAL, durable vs live data, source of truth)
- docs/development/README.md (added smoke-test coverage; doc-upkeep contract link now points to protocol/api.md)
- docs/desktop/README.md (new: desktop settings, imports, subagents, scoped capabilities)

Summary:
- 根 README 重写为公开产品首页，定位为 "control plane for AX agents"，结构：
  Hero → Screenshot/Topology → What is AX Crew → Why → How it works → Quick Start →
  Security → AX vs AX Crew → Architecture → Docs → Development → License。
- 突出 Laptop / Server / GPU Server / Cloud VM 多机运行 AX 的跨机器通信、任务委派、
  协作与统一控制；Skill/MCP/Memory/Provider 仅作 AX/Crew 边界说明，不作为卖点。
- 从 README 移出 Repository layout、完整 Build 流程、REST API、SQLite、测试、
  Desktop Settings、Capabilities 细节到 docs/，README 只留摘要与链接。
- 删除全部本机绝对路径与开发过程记录；全文统一英文。
- 使用 docs/images/session.png 作主截图、docs/images/Schedule.png 展示自动化、
  docs/images/connect.png 展示设备配对；拓扑图为等宽 ASCII（已程序化校验列对齐）。

Tests:
- 全量相对链接校验：ALL LINKS OK（8 个 md 文件）
- ASCII 拓扑图列对齐校验：竖线 8/22/37/54 与 └┴┴┘ 吻合，▼/┬ 对齐于 col 29
- README 全文通读校对通过
- 无本地路径残留（grep 仅命中 "Desktop client" 等英文正文）

Issues:
- docs/images/session.png 截图内嵌开发机路径（C:\Users\14181\Desktop\axlab，
  位于截图底部工作目录栏），属截图内容而非文本；如需彻底无痕，后续需重新截图替换。

Commit / push (用户要求提交推送):
- 7955a35 "Rework README into a public control-plane homepage and move details into docs"
- 已推送 origin main（https://github.com/Axium-Labs/AXCrew），与远端 0 分叉
- 附带提交了工作区中同方向的存量文档改动（apps README 去本机路径、AGENTS.md
  链接修正、.gitignore 环境/OS 忽略规则、docs/releases 0.2.6-0.3.0、docs/images）
- 按流程 logs/ 未入库；README 增加与 AX 的互相引用

第二轮（中文版 README）:
- 新增 README.zh-CN.md（完整中文版），README.md 顶部加
  "**English** | [简体中文](README.zh-CN.md)" 语言切换
- 提交为 61bab26 "docs: add Chinese README"，已推送 origin main（7955a35..61bab26）
- ax 侧同步新增 README.zh-CN.md（提交 b92d312）并修复其原有 benchmark/README.md
  死链（benchmark/ 目录不存在，改为纯文本路径引用）

Next:
- 如需同步官网（axium-site）文案可在此基础上调整；本次为文档重构，产品行为未变，
  官网无需强制同步。
