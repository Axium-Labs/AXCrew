# 2026-10-05 02:50

Task: 设置页语言/主题下拉与整体暗色风格统一

Changed:
- apps/desktop/src/pages/Settings.tsx
- apps/desktop/src/pages/settings.css
- apps/desktop/src/styles.css
- apps/desktop/e2e/shell.spec.ts（5 处 selectOption 改为 menuitem 点击）
- docs/desktop/README.md

Summary:
- 问题：设置 → 显示 里的"语言"和"主题"选择器是原生 <select>，Windows/WebView2
  弹出的是系统白底菜单，和暗色 shell 不统一（截图确认）。
- 修复：两个选择器改用应用统一的 Menu 组件（Radix ax-menu，随主题变色），
  触发器用新的 .settings-select-menu 样式（与原 select 同尺寸/圆角/边框，
  含 focus/data-state=open 的紫色描边），ChevronDown 图标。
- 兜底：styles.css 增加 select option/select optgroup 全局规则，把仅剩的
  原生 select（模型选择、导入导出范围、移动会话项目、AX 能力页两个）的
  选项列表也铺成应用表面色，避免在暗色界面里闪白列表。
  注：WebView2 上 option 背景可生效，整弹窗圆角/阴影仍受系统限制，
  这几个低频 select 保留原生控件是权衡，未逐一重做。
- 移除 Settings.tsx 不再使用的 type Theme 导入。
- e2e：5 处 `getByLabel('主题'/'语言').selectOption(...)` 改为点击触发器 +
  getByRole('menuitem') 点击（浅色 / English exact）。

Tests:
- npm run check（tsc -b）：PASS
- npx vitest run：111/111 PASS
- npx playwright test --project=desktop：34/34 PASS
- 截图验证：主题下拉（深色/浅色/跟随系统）与语言下拉均为暗色面板，
  test-results/appearance-theme-open.png、appearance-lang-settled.png

Issues:
- 语言菜单第一次截图发虚是 ax-menu pop-in 动画中间帧，等待 400ms 后正常，
  非缺陷。

Next:
- 无。
