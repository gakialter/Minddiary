# MindDiary v1.18.0

MindDiary v1.18.0 重点升级了本地优先的 AI 学习规划：Today Action、Daily Review 和错题复习现在共享更清晰、可追溯且可恢复的任务确认流程，并加入本地 Planning History。SQLite schema 升级到 **7**；本次新增的 Schema 7 migration 在 Schema 6 上增加持久化规划历史，现有有序 migration 也会把正式发布的 v1.17.1 Schema 5 数据依次升级到 Schema 6 和 Schema 7。

## AI 学习规划更可控

- Today Action 和 Daily Review 会展示本次规划所使用的受控上下文及其纳入或排除原因、候选保留或移除状态，以及确认后的结果，便于在创建任务前核对。
- 两个入口都可选择「均衡规划」「深度专注」或「轻量推进」策略；策略只影响候选任务的规划偏好，不会改变 Daily Review 对事实的复盘判断。
- Today Action 可在生成前预览并选择近期已确认任务的完成、跳过和专注结果作为历史参考，也可以明确选择不使用历史反馈。
- 候选任务仍由用户选择、编辑和确认；AI 建议不会自动创建学习任务。

## Planning History

- 新增本地 Planning History，可回看 Today Action 与 Daily Review 的规划时间、受控上下文摘要、最终候选和已观察到的确认结果。
- 历史记录仅保留最近 30 天且最多 100 次规划，并可由用户清空；清空历史不会删除学习任务、日记、错题、科目或专注记录。
- Planning History 是审计与回看界面，不是工作流恢复点；重启应用后不会从历史记录继续生成、编辑、选择或确认。
- 历史记录只保存受限摘要和最终候选，不保存 Provider prompt、原始响应、推理内容、完整日记或错题正文、附件、凭据、原始错误或堆栈。

## Today Action 与章节上下文

- Today Action 现在可以使用经过数量和长度限制的只读章节进度，帮助建议贴近当前科目进展。
- 章节上下文不会自动创建章节关联、修改章节、完成章节或改变章节顺序。
- 在生成到确认之间如果章节状态发生变化，界面会重新校验；无法安全确认时会要求重新生成，避免用过期章节信息创建任务。

## Daily Review 与错题复习

- Daily Review 的次日候选与任务创建使用统一的确认契约，并记录每个候选的确定结果。
- 错题本新增「AI 错题复习规划」，可从到期且尚无今日活跃任务的错题中生成最多 4 条复习建议；用户确认后才创建任务。
- 错题建议在确认后会刷新，避免继续展示已经处理的旧候选。

## 任务创建可靠性与恢复

- Today Action、Daily Review 和错题复习的已确认任务创建使用稳定的 operation ID 与幂等 receipt，重复确认或不确定响应不会静默创建重复任务。
- Today Action 与 Daily Review 对结果不确定的操作提供本地恢复区，MindDiary 不会自动重试：Daily Review 可复用原确认请求核对结果，Today Action 重启后只读检查已提交状态。错题复习在当前对话框中保留 operation ID，供用户点击重试以核对结果，但不提供跨重启恢复。
- 规划候选与最终任务结果使用确定性归因；失败、冲突和过期状态会保留可见提示，而不是把不确定结果显示为成功。

## 桌面与更新可靠性

- Windows 已增加真实安装版 NSIS 更新链路的 CI 覆盖，包括检查、下载、校验、安装、自动重启和用户数据保留，以及无更新、损坏 metadata 和校验失败路径。
- 标题栏移除了旧的「考研日记」标签与重复日期，保留 MindDiary 品牌和窗口拖动区域。
- Tag-triggered Release workflow 仍会分别构建并验证 Windows 与 Apple silicon macOS 资产，两个平台构建成功后才创建 GitHub Release。

## Compatibility

- 本版本 `CURRENT_SCHEMA_VERSION` 为 **7**。Schema 7 migration `add-persistent-planning-history` 新增 `planning_runs` 和 `planning_run_candidates`，不会重建或清空已有业务数据。
- 当前仓库中的 Schema 6 数据会通过现有 `6 → 7` migration 升级；正式发布的 v1.17.1 使用 Schema 5，会沿连续 registry 按 `5 → 6 → 7` 升级，先建立 Schema 6 的 `study_task_action_receipts`，再进入 Schema 7。
- Migration 按版本分别在 transaction 中执行；失败时该次 migration 的 schema 与数据修改会回滚，已有任务和 action receipts 保持不变。
- Schema 6 备份没有 Planning History 区段时会恢复为空历史；Schema 7 备份包含规划历史，并继续在恢复前校验、在单个 restore transaction 中导入。
- 现有用户数据目录继续使用；Windows Setup 覆盖安装预期保留应用数据。
- macOS target 仍为 Apple silicon ARM64，最低系统版本为 macOS 12.0。

## Known limitations

1. Planning History 不能恢复未完成的生成、编辑、选择、确认或任务执行流程。
2. Today Action 的章节进度仅是有界、只读辅助上下文，不建立任务与章节关系。
3. Windows 安装版 updater 已有 CI 端到端覆盖，但这不等于已证明生产签名、SmartScreen reputation 或所有真实用户环境中的 GitHub-hosted 更新场景。
4. 如果未配置 Windows 代码签名，安装包可能显示 Unknown Publisher，并可能触发 Windows SmartScreen。
5. macOS 资产仅面向 Apple silicon ARM64，使用 ad-hoc signing，未进行 Apple notarization；不支持 Intel macOS 或 universal 资产。
6. CI 的 macOS 构建和代码完整性验证不等于已在另一台 Mac 上通过所有 Gatekeeper 场景。

## Windows 安装包说明

- Release workflow 在配置 Windows signing credentials 时会验证 Authenticode 签名。
- 未配置签名凭据时，workflow 会明确生成 unsigned Windows assets。
- Unsigned Windows assets 可能显示 Unknown Publisher 或触发 Windows SmartScreen。
- 代码签名不等于已经建立 SmartScreen reputation。

## macOS 安装包说明

- Tag-triggered Release workflow 生成 ARM64 DMG、ZIP 和 update metadata。
- macOS assets 使用 ad-hoc signing，不是 Developer ID 签名，也未进行 Apple notarization。
- 当前没有另一台 Mac 的完整人工 Gatekeeper 验收证据。
- 不提供 Intel 或 universal assets。

## Verification

- 发布前验证覆盖 package/lock/内置 notes/发布说明版本一致性、TypeScript typecheck、完整 Vitest、Electron 主进程构建、Vite renderer 构建和 diff whitespace 检查。
- 数据库验证覆盖连续 migration registry、Schema 6 到 7 的原位升级、已有任务与 action receipts 保留、migration 失败回滚，以及 Schema 6/7 备份恢复。
- Windows installed updater E2E 位于 CI；正式 tag workflow 会在 Windows 和 macOS 构建均成功后才发布资产。
- 不声称 Windows 生产签名、SmartScreen reputation、macOS notarization 或完整 Gatekeeper 验收已经完成。
