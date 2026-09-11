# MindDiary v1.19.1

v1.19.1 是 v1.19.0 的稳定性修复版本，包含 v1.19.0 的全部功能。

## 修复
- 修复错题本编辑表单在异步状态更新与格式工具栏快速交互时，备注等受控字段可能回退到旧值的问题。
- 移除错题本挂载时重复的数据加载，减少不必要的并发刷新。
- 稳定错题本 Markdown 格式化选择区行为。

## Compatibility
- `CURRENT_SCHEMA_VERSION = 8`。
- 本版本为稳定性修复，无新增数据迁移；与 v1.19.0 数据完全兼容。
- 历史升级链路保持稳定：正式发布的 v1.17.1 使用 Schema 5，继续沿 `5 → 6 → 7 → 8` 升级；Schema 8 新增的 `subject_daily_review_state` 与历史 `6 → 7` 迁移完全兼容。
- 现有用户数据目录继续使用，Windows Setup 保留应用数据的策略不变。

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
