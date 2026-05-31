# MindDiary v1.9.7

本次更新发布“今日行动队列”：把今日 Dashboard 的判断转换为当天可执行任务，并补齐本地持久化、备份恢复和 browser fallback 覆盖。

## Highlights

- Daily Action Queue：今日决策页新增轻量任务区域，支持把 Dashboard 决策转化为可执行任务。
- Dashboard-generated review / diary suggestions：HomeDashboard 可根据风险池和今日日记状态生成错题复习 / 学习沉淀建议任务。
- Local-first `study_tasks` persistence：新增本地 SQLite `study_tasks` 表，支持 `review / focus / diary / mistake / custom` 任务类型和 `todo / doing / done / skipped` 状态。
- Backup / restore coverage：`study_tasks` 已纳入自动 ZIP 备份恢复。

## Changes

- 支持手动新增今日任务。
- 支持完成、跳过和删除任务。
- browser fallback 使用 localStorage 保存任务队列，并对坏 TASKS localStorage 做容错恢复。
- README 和 `docs/daily-action-queue.md` 已记录当前实现边界。

## Validation

- `npm.cmd run typecheck`
- `npm.cmd test -- --run`
- `npm.cmd run build`
- `npm.cmd run test:e2e`
- `git diff --check`

## Notes

- No new dependencies.
- No Pomodoro task linkage yet.
- No AI one-click task ingestion yet.
- Windows 安装包如果未进行代码签名，仍可能出现 Unknown Publisher 或 Windows SmartScreen 提示。
