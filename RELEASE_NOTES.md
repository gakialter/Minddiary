# MindDiary v1.13.0

MindDiary v1.13.0 汇总了自 v1.11.3 以来的章节任务闭环和今日执行入口改进，将详细章节、今日任务、Pomodoro 与每日复盘连接为更完整的学习执行流程。

## Highlights

- 将未完成章节直接加入今日任务，并保留科目与章节来源。
- 章节任务可进入 Pomodoro，结算时可分别决定是否完成任务和章节。
- 首页升级为轻量今日执行入口，集中展示今日进度、专注时长、章节任务和日记状态。
- 新增确定性的“推荐下一步”和今日复盘入口。

## Changed

- SQLite schema 升级为 **5**。
- 新增 nullable `study_tasks.related_chapter_id`，通过 `ON DELETE SET NULL` 安全处理章节删除。
- 新增 schema **4 → 5** migration 和章节任务查询索引。
- 推荐顺序为：活动专注 session、进行中任务、章节待办、普通待办、复盘或休息。
- 推荐任务可被选中并打开 Pomodoro，但不会自动启动计时。
- Electron SQLite 与 browser fallback 使用一致的章节任务和推荐逻辑。

## Fixed / Reliability

- 防止同一章节在同一天重复加入今日任务。
- 章节在专注期间被删除时安全降级，不破坏任务结算。
- 章节完成使用明确目标状态，避免 toggle race。
- 自动 ZIP backup/restore 保存 `related_chapter_id`；旧备份缺少该字段时安全恢复为 `null`。
- 活动 Pomodoro session 不会被新的推荐任务覆盖。
- 普通任务和原有 Dashboard/Pomodoro 流程保持兼容。

## Verification

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --run` passed: 86 test files, 963 tests.
- `npm.cmd run build` passed.
- Windows Setup、Portable 和 packaged `better-sqlite3` Electron ABI 132 本地构建校验通过。
- PR #110、PR #111 以及当前 main CI 检查通过.

## Windows 安装包说明

- 本版本不声明 Windows 安装包已经代码签名。
- 如果发布资产未配置代码签名，Windows 可能显示 Unknown Publisher，或触发 Windows SmartScreen。

## Known notes

- 本版本使用 SQLite schema **5**，并包含 schema **4 → 5** upgrade。升级前建议保留最新自动 ZIP 备份。
- 升级后的 schema 5 数据库不应使用只支持 schema 4 的旧版本直接打开。
- macOS 构建不声明已完成 Apple notarization。
- 不声明 macOS Gatekeeper 人工验收通过；该结论必须基于正式 DMG/ZIP 的后续真实验收。
- Windows Setup、Windows Portable、macOS DMG 和 ZIP 的正式人工启动结果应在发布资产生成后记录。
