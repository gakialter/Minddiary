# MindDiary v1.16.0

MindDiary v1.16.0 是从 v1.13.3 累积而来的 AI 学习规划功能版本，整合了产品方向说明、可解释的 Today Action 上下文、更严格的候选建议校验，以及 schema-free Daily Review Agent。

SQLite schema unchanged，仍为 schema **5**。本版本不新增 migration、`agent_runs`、依赖或后台 Agent。

## AI Study Planning direction

- MindDiary 的产品方向进一步明确为本地优先、面向长期备考的 AI Study Planning Agent，而不是通用自主 Agent 平台。
- AI 只生成可解释、可编辑的候选计划；SQLite 和现有应用 API 仍是本地数据与任务状态的唯一权威来源。
- 不运行计划外的后台 Agent，不允许 AI 绕过用户确认直接修改学习数据。

## Explainable Today Action context

- 「AI 规划今日行动」会展示受控的本地规划依据及来源说明，帮助用户理解哪些信息参与了建议生成。
- 上下文只从既有本地 API 中收集有界数据；查看规划依据不会创建、完成、跳过或删除任务。
- AI 请求前的本地上下文会经过裁剪、投影和字段限制。

## Stronger Today Action suggestions

- AI 输出必须通过严格 JSON 解析、字段 allowlist 和本地业务校验。
- 非法类型、越界时长、无效错题引用、重复 active task、预算超限及未知字段会被拒绝或标记。
- 候选任务可以在本地编辑、删除和选择；只有用户明确确认的有效候选才会通过普通任务 API 创建。
- 当本地规划依据发生变化时，第一次确认执行零写入并要求用户查看最新结果后再次确认。
- 部分创建失败不会回滚已经成功创建的任务；失败候选会保留并可单独修改、重试。
- `planned_date`、`status` 和 `source` 始终由本地代码控制，不能由模型指定。

## Schema-free Daily Review Agent

- 「每日复盘」是用户手动触发的有界复盘流程，连接当天任务、执行结果和下一日候选计划。
- 打开每日复盘只读取并展示确定性的本地复盘依据，不调用 AI，也不写入任务。
- 用户点击生成后，AI 才会基于安全上下文生成解释性观察和可编辑的下一日任务候选。
- 候选任务在用户明确确认前只存在于内存中，不持久化复盘 run 或模型输出历史。
- 每日复盘沿用严格解析、本地校验、stale-context 二次确认和 partial-success retry 边界。

## Privacy and confirmation boundaries

Daily Review 专用 AI 上下文不包含：

- 日记正文；
- 错题答案和错题笔记；
- 图片路径、附件路径或附件内容；
- API Key 或其他敏感配置；
- 现有任务 description。

原始日记、错题和任务 API 结果会先投影为 Daily Review 专用 safe DTO，再进入 React state、签名、预览、prompt 或校验逻辑。

AI 不会直接写 SQLite，也不会自动创建、完成、跳过、删除或修改任务。

## Reliability fixes

- Daily Review modal 通过 `document.body` portal 渲染，在 Dashboard 顶部、中部和底部滚动位置均保持 viewport-fixed。
- Dashboard 同日期后台刷新不再卸载已打开的 Daily Review，成功、失败、可重试候选和创建摘要会继续保留。
- `useTodayStats` 记录 `resolvedDateKey` 和 `errorDateKey`，避免本地日期切换时把前一天统计显示在新日期下。
- 新日期请求 pending、失败或请求乱序时，不会把旧日期数据或错误误标为当前日期。
- 本地日期切换后，Dashboard 会关闭旧日期的 Daily Review；待新日期数据加载完成后，用户可重新打开，旧日期复盘不会被误解释为新日期。

## Verification

- PR #128、#130、#131 和 #132 的合并范围共同构成本次累计 Release 内容。
- 当前合并后 `main` 已通过 GitHub CI 的 test、Windows build verification 和 macOS build verification。
- Daily Review 最终 focused Vitest 集合为 **107/107**。
- 日期切换 targeted suite 为 **41/41**。
- Daily Review 使用隔离 Electron profile 和本地 mock AI 完成了打开零写入、隐私 payload、stale-confirmation、成功创建、partial failure/retry、modal viewport 和回归 smoke。
- 本 release-prep 阶段尚未生成或验收 v1.16.0 packaged candidate assets。

## Compatibility

- schema unchanged；`CURRENT_SCHEMA_VERSION` remains **5**。
- migration unchanged；不新增或修改数据库 migration。
- dependency unchanged；不新增、删除或升级依赖。
- Electron main、preload 和 IPC contract unchanged。
- 不新增 `agent_runs` 或其他持久化 Agent run history。
- 从 v1.13.3 升级到 v1.16.0 时继续使用既有 schema 5 数据库和现有 migration 链。
- v1.15.x 路线中依赖 schema 6 的持久化 Agent Run 能力未实现，也不包含在本版本中。

## Windows 安装包说明

- 本版本不预先声明 Windows 资产已完成代码签名。
- Release workflow 只有在同时配置 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 时才要求并验证签名。
- 如果正式资产未配置代码签名，Windows 可能显示 Unknown Publisher，或触发 Windows SmartScreen。
- 代码签名不能保证立即建立 SmartScreen reputation。

## macOS 安装包说明

- 当前 macOS target 为 Apple silicon ARM64。
- 当前构建使用 ad-hoc signature，没有 Apple notarization。
- CI 构建成功不等同于在另一台 Mac 上通过 Gatekeeper 验收。
- DMG 和 ZIP 必须在候选资产阶段单独记录启动边界。

## Release gate

- release-prep PR 必须在精确 head 上通过 typecheck、测试及 Windows/macOS build verification。
- tag 前必须再次确认 `package.json`、`package-lock.json`、内置更新摘要和 `RELEASE_NOTES.md` 均为 `1.16.0`。
- 必须先生成并审核候选资产，完成 Windows Setup、Windows Portable、macOS DMG 和 macOS ZIP 的 packaged smoke。
- 必须验证最终资产严格符合 allowlist，且 update metadata 不指向 unpacked 或内部文件。
- tag、GitHub Release、资产发布和 latest 标记仍需要独立授权。
