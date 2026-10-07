# MindDiary v1.20.0

本文件记录 MindDiary v1.20.0 的用户可见更新。本地发布验证已通过，尚未发布到 GitHub Releases。

MindDiary v1.20.0 为 AI 学习辅助加入图片与 PDF 文字输入，并让日记润色候选可在应用前编辑。此次还更新了 AI Provider 模型目录，并改进编辑与 AI 请求的可靠性。

## 新增与改进
- AI 助手支持 PNG、JPEG、WebP 图片，可通过文件选择、拖入或 Ctrl+V 添加；单次最多 5 个附件，其中最多 3 张图片。自定义模型需在设置中明确启用视觉能力。
- 修复自定义 Provider 的图片能力配置在 renderer 重载或应用重启后失效的问题，已保存的开关状态与实际图片发送能力保持一致。
- PDF 可在本机提取可读取文字后随消息发送；支持多份 PDF 与文本文件组合，附件总数最多 5 个，PDF 与文本文件提取文字合计最多 20,000 字符。
- 日记润色采用「选择文字 → 生成候选 → 手动修改 → 应用」流程。应用前正文不变；重新生成失败时保留现有候选和手动编辑，成功后才替换候选。应用后可撤销。
- 改进日记模板插入与替换提示、搜索结果返回位置和任务状态文字，并减少没有待复盘项目时的干扰。
- 更新 DeepSeek、通义千问、GLM、Kimi、豆包的精选模型目录，并继续支持自定义 Provider。
- 修复“分别 / 区别 / 个别”等正常用词被误判为禁止指令、旧自动保存覆盖新正文、截断回复被当作完整结果，以及收到响应头后请求超时失效的问题。

## PDF 与附件限制
- 图片格式为 PNG、JPEG、WebP；每张最多 5 MiB，图片合计最多 10 MiB。
- 每份 PDF 最多 10 MiB、50 页。文本文件支持 TXT、MD、CSV、JSON、LOG，每份最多 2 MiB。
- PDF 仅支持可提取文字的文档；扫描版 PDF 暂不支持 OCR。PDF 中的图片、图表、版式和整页内容不会被视觉理解。
- 附件内容只随当前发送传递。PDF 二进制和本地路径不会上传；附件正文不会保存到聊天历史或本地持久化记录中。

## Compatibility
- `CURRENT_SCHEMA_VERSION = 8`。
- 本版本无新增数据迁移，继续使用现有用户数据目录和备份恢复格式。
- 历史升级链路保持稳定：正式发布的 v1.17.1 使用 Schema 5，继续沿 `5 → 6 → 7 → 8` 升级；Schema 8 新增的 `subject_daily_review_state` 与历史 `6 → 7` 迁移完全兼容。
- 现有用户数据目录继续使用，Windows Setup 保留应用数据的策略不变。

## Known limitations
- AI 润色限单行、连续正文选区（最多 4000 字符），不处理跨段落、标题、列表、表格、链接或代码等复杂结构；需在桌面应用中配置 AI Provider。
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
