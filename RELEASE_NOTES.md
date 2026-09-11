# MindDiary v1.19.0

本次更新带来独立的错题日常复盘、可直接查看格式效果的日记编辑器和需要明确确认的 AI 选区润色，并统一桌面各工作区的界面与交互。SQLite schema 升级到 **8**，日记仍以原有 Markdown 保存。

## 日常复盘

- 错题本分开提供「到期复习」和「日常复盘」：前者继续使用 SM-2，后者按科目设置每日题量，独立记录进度，不改写 SM-2 状态。
- 每轮使用不放回队列，默认纳入该科目的已掌握错题；达到每日题量后停止，次日从原进度继续。完成一轮后需明确开始下一轮，不会自动循环。
- 每科配置、当前轮次和完成进度会持久保存，重启后可继续；轮次开始后新增的错题留待下一轮。

## 日记编辑体验

- 日记采用 CodeMirror 6 单一编辑面，加粗、下划线、高亮和文字颜色可实时预览；格式语法标记平时隐藏，编辑相关范围时显示。
- 支持格式开关、键盘快捷键和撤销／重做，减少编辑与预览之间的切换。
- 原有 Markdown 仍是唯一的正文存储格式，已有日记内容保持兼容，无需日记 schema migration。

## AI 选区润色

- 选中正文后，可使用「润色表达」「精简」「纠正语病」「保持原意改写」四种操作。
- AI 仅返回候选文本，必须点击「应用」才会替换选区；原文已变化时禁用应用，应用后可一步撤销。
- 发送给已配置 Provider 的日记内容仅限所选正文，不附带整篇日记、相邻段落或其他学习数据。

## 界面与交互

- 主导航、日记、今日任务、统计和次级工作区使用更安静、清晰的桌面布局与内容层级。
- 错题本、AI 工作区、番茄钟及相关弹窗的控件、间距、焦点与滚动体验更加一致。
- 改善浅色／深色主题和紧凑桌面窗口下的视觉一致性与可用空间，调整动效与交互反馈。

## Compatibility

- `CURRENT_SCHEMA_VERSION = 8`。Schema 8 新增 `subject_daily_review_state`，仅保存各科当前日常复盘配置和轮次进度，不覆盖已有错题或 SM-2 状态。
- v1.18.0 的 Schema 7 数据通过 `7 → 8` 升级；正式发布的 v1.17.1 使用 Schema 5，沿 `5 → 6 → 7 → 8` 升级。更早受支持数据库继续沿已有连续 migration registry 升级；每步在 transaction 内执行，失败回滚该步修改。
- 旧备份缺少日常复盘状态时按空状态恢复；新备份保留当前轮次。现有用户数据目录继续使用，Windows Setup 保留应用数据的策略不变。

## Known limitations

- AI 润色目前限单行、连续正文选区（最多 4000 字符），不处理跨段落、标题、列表、表格、链接或代码等复杂结构；需在桌面应用中配置 AI Provider。
- 日常复盘是独立练习，不调整到期复习时间或掌握度；新增错题不会插入已经开始的轮次。
- Windows 安装版 updater 已有 CI 端到端覆盖，但不等于已证明生产签名、SmartScreen reputation 或所有真实用户环境的更新行为。

## Windows 安装包说明

- 提供 Setup 与 Portable。未配置签名凭据时，workflow 会明确生成 unsigned Windows assets，可能显示 Unknown Publisher 或触发 Windows SmartScreen。
- 配置完整签名凭据时会验证 Authenticode；代码签名不等于已经建立 SmartScreen reputation。

## macOS 安装包说明

- Tag-triggered Release workflow 生成 ARM64 DMG、ZIP 和 update metadata，面向 Apple silicon，最低 macOS 12.0；不支持 Intel macOS 或 universal 资产。
- 使用 ad-hoc signing，不是 Developer ID 签名，也未进行 Apple notarization。构建及签名完整性检查不能替代另一台 Mac 的 Gatekeeper 验收。

## Verification

- 本地发布门槛包括版本与内置摘要一致性、TypeScript typecheck、完整 Vitest，以及包含 Electron native rebuild、Windows 打包和 packaged native/security 检查的 release build。
- 数据兼容性检查覆盖新库、历史版本连续升级、迁移幂等性与回滚、日常复盘的 SM-2 隔离，以及浏览器 fallback 和备份恢复。
- Tag-triggered workflow 仅在 Windows 与 macOS 必需构建和验证步骤全部成功、资产 manifest 校验通过后发布。
- 人工下载安装、SmartScreen 和另一台 Mac 的 Gatekeeper 验收尚未完成，不将自动构建成功视为这些人工验收通过。
