# MindDiary v1.10.0

MindDiary v1.10.0 打通“今日任务 → 专注 → 结算 → 复盘 → Dashboard”的学习闭环。用户可以把今日任务绑定到 work、custom 或 stopwatch 专注，专注记录会归因到任务，结束后由用户明确决定任务是否完成，并可把一句话复盘追加到今日日记。

## 本版亮点

- Pomodoro 页面新增今日任务选择，支持不绑定任务，也可以随时清空选择。
- 绑定的 `todo` 任务开始专注时进入 `doing`；`doing` 保持进行中；`done` / `skipped` 不允许启动新专注。
- `pomodoro_sessions` 新增 nullable `task_id`，历史专注记录可以安全归因到学习任务。
- 专注结束结算支持“标记任务完成”“保持任务进行中”“跳过复盘”“添加错题”和“仅保存专注记录”。
- 一句话复盘会按时间追加到今日日记；没有今日日记时，经用户确认后创建。
- Dashboard 新增今日任务完成率、任务专注覆盖率、任务专注分钟和未闭环任务提示。
- Electron 与 browser fallback 保持同一契约，包含 task_id 存储、任务删除后置空、旧 localStorage 和旧 backup 兼容。

## 今日任务与专注

- work、custom 和 stopwatch 模式都可以绑定今日 `todo` / `doing` 任务。
- 任务选择会展示任务标题、状态、科目和预计时长。
- 任务有关联科目时，会在用户尚未手动选择科目的情况下建议该科目；用户手动改科目后不会再被任务覆盖。
- 活动 session 会持久化 `task_id`、科目、模式、时长、运行/暂停状态、开始时间和暂停相关数据。
- 页面刷新或应用重启后会恢复绑定任务；如果任务已删除，会安全降级为未绑定。
- Zen 全屏专注会展示当前任务、科目和模式，提前结束保存时保留任务归因。

## 结束结算与复盘

- 自然完成、提前保存、stopwatch 保存和恢复后的活动 session 保存都会携带 `task_id`。
- 专注记录保存成功后，任务完成状态由用户明确选择，不会自动完成任务。
- 任务状态更新失败时，不会重复写入 pomodoro session，用户可以重试结算动作。
- 复盘写入格式：

```markdown
## 专注复盘

- 时间：HH:mm
- 任务：任务标题
- 科目：科目名称
- 专注：N 分钟
- 结果：用户输入的一句话复盘
```

- 空复盘不会写入空区块，同一次结算不会重复追加复盘。

## Dashboard 闭环指标

- 今日任务完成率：`done / (todo + doing + done)`，`skipped` 不进入分母。
- 今日任务专注覆盖率：今天至少拥有一条有效 task_id 专注记录的任务数 / 今日有效任务数。
- 今日任务实际专注时长：今天归因到今日任务的 pomodoro session duration 总和。
- 未闭环提示会指出进行中但无专注记录、已有专注但未完成的任务。
- 无今日任务时显示空状态，不出现 NaN 或除零。

## 数据模型与备份

- SQLite schema version 升至 3。
- `pomodoro_sessions` 新增 `task_id INTEGER REFERENCES study_tasks(id) ON DELETE SET NULL`。
- 新增索引 `idx_pomodoro_task_id`。
- fresh database 直接包含新字段；version 0、1、2 旧库可升级到 current。
- migration 保持幂等，升级后通过 `PRAGMA integrity_check` 和 `PRAGMA foreign_key_check` 验证。
- 自动 ZIP 备份导出包含 `pomodoro_sessions.task_id`。
- 恢复顺序调整为先恢复 `study_tasks`，再恢复 `pomodoro_sessions`；删除旧数据使用反向依赖顺序。
- 旧 backup 不含 `task_id` 时仍可恢复；任务删除后历史 session 的 `task_id` 自动置空。

## 兼容性

- v1.9.9 用户升级后，无 `task_id` 的历史专注记录保持未绑定，不会被错误归因。
- `task_id = null` 的旧调用路径继续兼容。
- `answer_image_path` 继续 nullable，旧 `image_path` 数据不会被改写。
- browser fallback 与 Electron 在任务筛选、todo → doing、专注保存、复盘、Dashboard 指标和任务删除置空方面保持一致。

## 明确不做

- 不做错题任务回写或 `related_mistake_id` 新闭环。
- 不做日记任务深度自动回写。
- 不做 AI 今日行动建议、AI 建任务或 AI 直接写数据库。
- 不新增 `focus_reviews` 表。
- 不做大型 HomeDashboard / Pomodoro UI 重构。
- 不创建 v1.10.0 tag，不创建 GitHub Release，不触发正式发布。
