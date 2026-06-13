# MindDiary v1.11.0

MindDiary v1.11.0 在 v1.10.0 的“今日任务 → 专注 → 结算 → 复盘 → Dashboard”基础上，继续打通学习内容闭环：错题复习可以精确结算单题任务，手动保存有效日记后可以确认完成日记任务，AI 可以生成经过本地校验的今日行动建议，并在用户确认后转为普通今日任务。

## 本版亮点

- 今日决策页的“生成今日错题复习任务”改为轻量选择器：每条到期错题创建一个独立 `review` task，并写入 `related_mistake_id`。
- manual、active、break 复习共用同一提交协调器：先确认 SM-2 保存成功，再按精确关联结算任务。
- 手动保存有效日记后，应用会提示关联并完成一个 `diary` task；自动保存和一句话专注复盘不会触发日记任务完成。
- AI 今日行动建议使用专用上下文、严格 JSON parser、schema 校验、allowlist 关系引用和用户确认后逐条创建。
- 今日任务卡片展示 AI 建议来源、关联错题、关联日记 badge，并新增计划预计时长 / 实际任务专注时长对比。
- Phase 0 修复了 browser fallback 删除关联清理、SM-2 假成功风险、entry patch update 和统一 word count 契约。

## 错题复习任务联动

- 可自动结算的错题复习任务必须是单题任务：`type=review`、`related_mistake_id=<错题 ID>`、`planned_date=<复习日期>`、`status=todo/doing`。
- 无 `related_mistake_id` 的旧 review task 会保留为手动任务，不通过标题、描述或科目猜测关系。
- 评分成功后，0 个匹配任务只保存 SM-2；1 个匹配任务自动置为 `done`；多个 active 匹配会显示冲突反馈并让用户选择一个任务。
- 任务更新失败时，已保存的 SM-2 不回滚，用户可只重试任务结算，不会重复评分。
- 同一天同一错题已有 active review task 时，选择器会提示已存在并避免重复创建。

## 日记任务联动

- 手动保存日记后，如果正文达到有效内容门槛，会查找精确关联的 active `diary` task；没有精确关联时，再查找同日未关联的 active `diary` task。
- 有效内容门槛集中定义为至少 20 个有效非空白字符，并复用统一字数计算口径。
- 只有用户确认后才会把任务更新为 `related_entry_id=<entry ID>` 且 `status=done`。
- 多个候选任务时显示轻量选择器；任务失败时日记保存仍保持成功，并可只重试任务结算。
- 自动保存、MoodPicker、图片上传前创建 entry、标签保存和专注复盘追加不会触发日记任务结算。

## AI 今日行动建议

- AI 入口位于今日行动队列附近，使用独立 dialog，不扩张成大型任务管理界面。
- AI 只接收裁剪后的本地上下文：日期、可用时间、今日 active task、科目 allowlist、到期错题 allowlist 和今日日记引用。
- AI 返回内容必须通过严格 parser 和 schema 校验；支持纯 JSON、单层 code fence、前后少量说明文字；多个 JSON 对象、不完整 JSON、非法字段和非法引用都会被拒绝或标记。
- 用户可以编辑标题、类型、科目、时长、理由，删除单条，选择部分建议。
- 创建任务前重新校验上下文，逐条调用普通 `study_tasks` API，强制 `planned_date=today`、`status=todo`、`source=ai`。
- browser fallback 明确显示 AI provider unsupported；不会把 API Key 或网络请求移到 renderer/browser。

## Dashboard 闭环指标

- 今日任务完成率：`done / (todo + doing + done)`，`skipped` 不进入分母。
- 今日任务专注覆盖率：今天至少拥有一条有效 task_id 专注记录的任务数 / 今日有效任务数。
- 今日任务实际专注时长：今天归因到今日任务的 pomodoro session duration 总和。
- 今日计划预计时长 / 实际任务专注时长：用于低压比较计划投入和实际专注。
- 未闭环提示会指出进行中但无专注记录、已有专注但未完成的任务。
- 无今日任务时显示空状态，不出现 NaN 或除零。

## 数据模型与备份

- SQLite schema version 仍为 3。
- 不新增表、不新增 migration、不新增 `focus_reviews`、不新增 AI suggestion 持久化表。
- 继续复用 `study_tasks.related_mistake_id`、`related_entry_id`、`type`、`source`、`planned_date` 和 `status`。
- 自动 ZIP 备份格式不变；v1.10.0 的 `pomodoro_sessions.task_id` 备份与恢复顺序继续保留。
- browser fallback 删除错题或日记后，会把相关任务的 relation id 置空，并保持任务状态不回退。

## 兼容性

- v1.10.0 用户升级后，旧无关联 review task 继续作为手动任务存在，不会被错误自动完成。
- 旧 diary task 没有 `related_entry_id` 时，用户手动保存有效日记后可以确认关联。
- AI 建议不会持久保存草稿；关闭 dialog 前已成功创建的任务不会因重试而重复创建。
- Electron 与 browser fallback 在任务查询、relation 清理、entry patch update、SM-2 成功契约和最终 task create/update 方面保持一致。

## 明确不做

- 不做集合错题任务、集合成员表或批量静默完成。
- 不做 schema version 4、`focus_reviews`、FSRS、OCR、本地 RAG、云同步或大型项目管理模块。
- 不让 AI 直接写数据库、自动创建任务、自动完成/跳过/删除任务或后台持续运行。
- 不创建 v1.11.0 tag，不创建 GitHub Release，不触发正式发布。
- 不修改 v1.10.0 tag 或 v1.10.0 Release。
