# MindDiary v2.0 学习闭环增强路线图

审查日期：2026-06-12

正式基线：`v1.9.9`，`main` at `328bf918693486b648280d7a150cd1f196b58eac` (`chore: prepare v1.9.9 release (#98)`)

状态：v1.10.0 任务到专注闭环已完成实现与发布准备，等待 PR 审核；未创建 tag，未发布 GitHub Release。

## 1. 已完成基线

v1.9.9 已经完成 v2 前置护栏和近期产品基础，当前不再把 IPC runtime validation、SQLite schema version 或旧库 migration 作为下一步起点。

已完成内容：

- IPC runtime validation。
- SQLite schema version 和 `PRAGMA user_version`。
- 真实历史旧库 migration fixtures。
- AI history sanitize。
- AI role、消息数量和内容长度边界。
- Dashboard / HomeDashboard 等 stale-response guards。
- database repositories 分阶段抽离。
- Issue #91 对应工作：科目删除保留关联数据、错题主动复习、题目图片和答案图片。
- Issue #96 对应工作：中断专注保存。

当前产品基础：

- 日记、标签、附件和 Markdown 编辑。
- 科目 CRUD。
- Pomodoro、custom timer、stopwatch、Zen 和 floating widget。
- 错题本、SM-2、主动复习、题目图片和答案图片。
- 今日行动队列 `study_tasks`。
- Dashboard 与今日决策指标。
- 本地 SQLite、自动 ZIP 备份恢复、JSON 导入导出。
- Electron IPC 与 browser fallback。
- AI 助手，但 AI 只能提供建议，不允许直接写数据库。

## 2. v1.10.0 产品闭环（已完成）

原规划中的 v1.9.10、v1.9.11、v1.9.12 合并为 v1.10.0，并一次打通确定性的今日学习闭环：

```text
今日任务 → 专注 → 结算 → 复盘 → Dashboard
```

v1.10.0 的用户流程：

1. 在今日任务中选择一个可执行任务。
2. 在 Pomodoro / custom / stopwatch 开始前绑定今日 `todo` 或 `doing` 任务，也可以选择不绑定。
3. 开始专注时，绑定的 `todo` 任务进入 `doing`；`done` 和 `skipped` 任务不能启动新专注。
4. 保存专注记录时，`pomodoro_sessions` 记录可选 `task_id`，历史专注可归因到任务。
5. 专注结束后由用户明确选择是否标记任务完成，不自动完成任务。
6. 用户可以填写一句话复盘并写入今日日记；没有日记时经确认后创建今日日记。
7. Dashboard 展示今日任务完成率、任务专注覆盖率、任务实际专注时长和未闭环任务提示。

## 3. v1.10.0 工程边界

数据模型变更：

- `pomodoro_sessions.task_id INTEGER REFERENCES study_tasks(id) ON DELETE SET NULL`。
- 新增 `idx_pomodoro_task_id`。
- fresh database 直接包含新字段。
- version 0、1、2 历史数据库均可迁移到新 schema version。
- 删除 study task 后，历史 pomodoro session 的 `task_id` 自动置空。
- `task_id = null` 保持旧调用路径兼容。

备份恢复要求：

- 自动 ZIP 备份导出 `pomodoro_sessions.task_id`。
- 旧备份无 `task_id` 时仍可恢复。
- 恢复插入顺序必须满足 `study_tasks` 先于 `pomodoro_sessions`。
- 删除旧数据时使用反向依赖顺序。
- 恢复完成后执行 `PRAGMA foreign_key_check`。
- 不通过临时关闭外键掩盖恢复顺序错误。

交互边界：

- 保持 Zen Forest 低压、克制体验。
- 不把首页改成复杂项目管理工具。
- Zen 模式展示当前任务、科目、模式和进度，但不增加密集操作。
- floating widget 只在空间合适时显示简短任务标题，不做大型重构。

## 4. 后续仍未完成

以下能力不进入 v1.10.0，继续留在 v2 后续阶段：

- 错题任务联动，包括错题完成后自动回写 review task。
- 日记任务的深度自动回写。
- AI 今日行动建议。
- AI 确认转任务。
- AI 结构化任务解析。
- 任务历史归档页面。
- 独立今日执行页面。
- `focus_reviews` 独立数据表。

AI 边界保持不变：

- AI 不允许直接写数据库。
- AI 输出必须先展示给用户。
- 任何 AI 生成任务、错题、日记或状态变更，都必须经过用户确认后由普通本地 API 写入。

## 5. v2.0 后续方向

v1.10.0 之后，v2 后续优先级建议：

1. 错题复习任务与今日行动队列联动增强。
2. 日记任务沉淀与任务状态回写。
3. AI display-only 今日行动建议。
4. 用户确认 AI 建议后转任务。
5. 任务历史归档或独立今日执行页评估。
6. v2.0 release candidate 回归、文档、迁移和备份恢复验收。

继续暂缓：

- 云同步。
- FSRS。
- 图像遮挡。
- 本地 RAG。
- Ollama 本地模型。
- 大型 UI 重构。
- 新设计系统。
- AI 自动建任务或自动改数据。
