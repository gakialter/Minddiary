# MindDiary v2.0 学习闭环增强路线图

> 历史说明（2026-07-05）：本文保留 v1.11.x 时点的规划内容，不再作为当前版本、schema 或产品方向基线；当前路线请见 [MindDiary AI Study Planning Agent Roadmap](./roadmap/minddiary-ai-study-agent-roadmap.md)。

审查日期：2026-06-19

正式基线：`v1.11.1`，`main` / release commit at `bc305cfe1464c713e3253c19dce0a8d8acc063b6`

状态：v1.11.1 已正式发布并保持为 latest；v1.11.2 是独立的发布卫生与文档同步补丁；v1.12.0 才进入章节与今日任务闭环方向。

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

## 4. v1.11.0 学习内容与今日任务闭环（已完成）

v1.11.0 把已有学习内容安全接入今日任务闭环，并把科目进度升级为可管理详细章节的轻量学习进度工具：

- 详细章节进度：科目可单条添加或批量粘贴章节，支持完成状态、筛选、下一未完成章节、编辑说明、排序和删除。
- 旧汇总科目兼容：没有详细章节的科目继续使用 `total_chapters` / `completed_chapters`；首次添加章节时由用户确认转换方式。
- 单题错题任务联动：只有明确 `related_mistake_id` 的 `review` 任务可在 SM-2 成功后自动结算。
- 日记任务结算：有效日记保存后，由用户确认关联 `related_entry_id` 并完成 `diary` 任务。
- AI 今日行动建议：AI 只生成结构化候选，本地严格解析和校验，用户编辑/选择/确认后通过普通 `study_tasks` API 创建。
- AI 助手 composer：快捷提示先进入可编辑草稿，受控上下文以可移除标签呈现，并在用户主动发送时读取最新数据。
- 本地附件：支持 PNG/JPEG/WebP、TXT/MD/CSV/JSON/LOG 和文本型 PDF；图片需要视觉模型能力，自定义模型需要手动声明。
- 附件隐私：附件正文、base64、PDF 提取文本和本地路径不进入 SQLite、localStorage、聊天历史、自动备份或导出，不使用 provider Files API。
- 轻量反馈：展示 AI 来源、错题/日记关联和预计时间与实际任务专注时间的克制反馈。

本阶段 `CURRENT_SCHEMA_VERSION = 4`，新增 `subject_chapters`，并继续复用 `study_tasks.related_mistake_id`、`study_tasks.related_entry_id`、`study_tasks.source`、`study_tasks.status` 和 `planned_date`。

数据保护边界：

- schema 0、1、2、3 均可升级到 schema 4；旧科目汇总进度保持原值。
- 详细章节模式下，`subject_chapters` 是进度事实来源，并在同一事务中同步 subjects 汇总字段。
- 自动 ZIP backup / restore 包含 `subject_chapters`；旧 schema 3 备份缺少章节表时仍恢复为汇总模式。
- JSON 导出导入包含详细章节，并在导入时重新映射 subject id。
- 删除科目时删除所属章节，错题、专注记录和学习任务继续解除 subject_id 而不是删除历史。

AI 边界保持不变：

- AI 不允许直接写数据库。
- AI 输出必须先展示给用户。
- 任何 AI 生成任务、错题、日记或状态变更，都必须经过用户确认后由普通本地 API 写入。

本阶段明确不做：

- 集合错题任务成员表、`focus_reviews`、FSRS、OCR、本地 RAG、云同步。
- 大型任务管理、独立大型今日执行页、大型 HomeDashboard 重构或设计系统重构。
- Office 文件、音视频、压缩包、远程图片 URL、provider Files API、流式输出或多会话 AI。
- AI 自动创建、完成、跳过、删除任务、自动调整用户计划或自动完成章节。

## 5. v1.11.2 发布卫生与文档同步

v1.11.2 只处理发布可靠性，不新增产品能力：

- 收紧 Release asset allowlist，禁止上传 `MindDiary.exe`、`elevate.exe` 和 unpacked/app bundle 内部产物。
- 验证正式资产、版本化命名、`latest.yml` / `latest-mac.yml` 的 version、path、sha512 和 releaseDate。
- 将声明 Node 20 runtime 的 workflow Action 升级到最小 Node 24 稳定 major。
- 同步 README、路线图、版本拆分和 release checklist，并明确 CI 与人工安装烟雾测试边界。
- SQLite schema 保持 4；无 migration、无 backup / restore 格式变化；不修改 v1.11.1 已发布资产。

## 6. v1.12.0 章节与今日任务闭环方向

v1.12.0 才评估把详细章节安全接入今日任务。若需要持久化 chapter-task 关系，可能升级到 schema version 5；必须独立设计 migration、旧库兼容、备份恢复和回滚风险，不在 v1.11.2 中预做。

## 7. v2.0 后续方向

v1.12.0 之后，v2 后续优先级建议：

1. 观察单题 review / diary / AI 建议转任务的真实使用反馈。
2. 评估是否需要任务历史归档或更独立的今日执行页。
3. v2.0 release candidate 回归、文档、迁移和备份恢复验收。

继续暂缓：

- 云同步。
- FSRS。
- 图像遮挡。
- 本地 RAG。
- Ollama 本地模型。
- 大型 UI 重构。
- 新设计系统。
- AI 自动建任务或自动改数据。
