# MindDiary v2.0 学习闭环增强路线图

审查日期：2026-06-05

基线：`main` at `553838a chore: release v1.9.8 (#77)`

状态：计划文档。本文描述 v2.0 计划，不代表相关功能已经实现。

## 1. 总体判断

当前 MindDiary 已经具备长期学习系统的关键零件：日记、标签、番茄钟/正计时、错题本/SM-2 复习、科目进度、今日 Dashboard、数据统计、AI 助手、今日行动队列、本地 SQLite、自动 ZIP 备份恢复、Electron IPC、browser fallback、单元测试和 E2E 测试。

最大产品短板是这些零件之间仍以“入口跳转”和“人工完成”为主，尚未形成稳定的“决策 -> 行动 -> 记录 -> 复盘”闭环。今日行动队列已经能承接 Dashboard 建议，但 Pomodoro、错题复习、日记沉淀、AI 建议还没有统一回写到任务状态和历史归档。

最大工程风险是未来闭环会继续扩大状态链，但当前主进程 IPC 运行时校验、SQLite schema version、真实旧库迁移测试、AI history 边界和异步 stale-response guard 仍不够稳。v2.0 应先降低状态和数据演进风险，再逐步增加跨模块联动。

v2.0 最应该解决的 3 个核心问题：

1. 让今日行动队列成为学习闭环的中心，而不是首页上的一个轻量任务表单。
2. 让 AI 从聊天入口升级为“建议生成器”，但坚持用户确认后才入库。
3. 让数据层、IPC、迁移、刷新链路足够稳，支撑后续多轮迭代。

现在不应该做的事：

- 不做一次性“大 v2.0 重构”。
- 不让 AI 自动写库或自动改用户计划。
- 不在没有 schema version 和 migration 测试前大幅改数据库结构。
- 不做复杂游戏化、成就系统、社交分享、云同步或跨设备账户。
- 不把今日首页堆成全功能工作台，避免破坏 Zen Forest 的低压体验。

投入小但收益大的事项：

- 给 `Dashboard` / `HomeDashboard` / `FocusDistributionChart` / `PomodoroContext` 补 stale-response guard。
- 修复 AI 历史消息重新进入请求前未统一 sanitize/裁剪的问题。
- 为 AI IPC 增加 role schema、消息条数和内容长度限制。
- 给今日队列增加状态/来源筛选和历史归档视图。
- 在用户指南补充“如何用行动队列备考”的实际流程。

必须拆成多 PR 的事项：

- SQLite schema version、真实 migration 测试、`database.ts` 拆分。
- Pomodoro 与任务联动，包括选择任务、开始后 doing、完成后 done、session 归因。
- 错题复习和日记沉淀回写任务状态。
- AI display-only 建议和“确认转任务”。
- 今日执行页或任务历史页的 UX 扩展。

## 2. 当前基础

### 数据层

- `electron/database.ts` 创建 `study_tasks` 表，字段覆盖 `type`、`status`、`source`、`planned_date`、`subject_id`、`related_mistake_id`、`related_entry_id`、`estimate_minutes`。
- `src/types/index.ts` 已定义 `StudyTaskType = review | focus | diary | mistake | custom`、`StudyTaskStatus = todo | doing | done | skipped`、`StudyTaskSource = manual | dashboard | ai | pomodoro`。
- `src/contexts/api/tasksApi.ts` 已为 Electron 和 browser fallback 提供任务 CRUD、完成和跳过。
- `electron/databaseBackupData.ts` 已把 `study_tasks` 纳入自动 ZIP 备份恢复。
- 主要缺口：`study_tasks` 与 `pomodoro_sessions` 暂无关联；任务没有历史归档 API；SQLite 仍缺 `PRAGMA user_version` 和真实旧库 migration 测试。

### 今日闭环

- `src/components/HomeDashboard.tsx` 已展示今日行动队列，支持手动创建、Dashboard 建议、完成、跳过、删除。
- `docs/daily-action-queue.md` 明确第一版不包含 Pomodoro 深度联动和 AI 一键转任务。
- `src/contexts/PomodoroContext.tsx` 仍只记录科目与时长，未选择或回写任务。
- `src/components/PomodoroAlert.tsx` 已有写日记、添加错题、仅保存专注的沉淀入口，但没有“完成当前任务”。
- `src/components/MistakeBook.tsx` 完成 SM-2 复习后会刷新 Dashboard，但不会回写关联任务。

### AI 助手

- `src/components/AIPanel.tsx` 已支持聊天、快捷 prompt、历史缓存、软取消。
- `src/utils/promptTemplates.ts` 有基础 sanitize 和多个学习 prompt。
- `electron/aiService.ts` 调用 OpenAI-compatible chat completions，但未对 IPC 传入的 `messages` 做运行时 role schema、数量和长度限制。
- 主要缺口：AI 仍是聊天层；生成今日行动建议、结构化建议确认入库、历史消息统一 sanitize/裁剪都还未完成。

### UI / UX

- 首页已有今日决策、指标和行动队列，但队列继续扩展后可能使首页过载。
- 当前入口是“今日决策 -> 任务列表 -> 跳转 Pomodoro/错题/日记”，还没有独立的“今日执行页”或“任务历史页”。
- Zen Forest 视觉基调应继续保持：低压、克制、少打扰，不把首页做成密集项目管理工具。

### 测试

已有覆盖：

- `tests/database.test.ts` 覆盖 `study_tasks` schema 创建、任务 CRUD 和校验。
- `tests/DataContext.test.tsx` 覆盖 browser fallback 任务存储和坏 TASKS localStorage 恢复。
- `tests/HomeDashboard.test.tsx` 覆盖队列渲染、建议任务、手动创建、完成、跳过、删除。
- `tests/databaseBackupRestore.test.ts` 覆盖 `study_tasks` 进入 ZIP 备份恢复数据。
- `tests/PomodoroContext.test.tsx` 覆盖活跃 session 恢复、暂停、自定义时长、stale session 丢弃。

关键缺口：

- 主进程 IPC 非法 payload 测试。
- 真实 SQLite 旧 schema migration 测试。
- AI 历史 sanitize/裁剪回归测试。
- Dashboard/HomeDashboard/FocusDistributionChart/Pomodoro 旧响应晚到不覆盖新状态的测试。
- Pomodoro task binding、错题复习任务闭环、日记任务闭环的集成测试。

## 3. 可选路线比较

### 推荐：稳定性先行 + 队列中心化

先补 IPC、migration、AI history、stale guard，再把 Pomodoro、错题、日记逐步接入今日行动队列。优点是每个 PR 小、回滚容易、能保护本地数据。缺点是用户可感知的大功能要到第二个 milestone 才明显。

### 备选：产品闭环先行

先做 Pomodoro 选择任务和完成回写，再补底层稳定性。优点是用户很快看到“任务 -> 专注 -> 完成”的变化。缺点是状态链会先变长，后补校验和迁移时风险更高。

### 备选：AI 助理先行

先做 AI 生成今日行动建议，再接队列和确认入库。优点是 v2.0 的差异化明显。缺点是 AI 输出边界、请求长度、历史 sanitize 和用户确认模型都未稳定，容易把不可控建议误导成产品承诺。

建议采用“稳定性先行 + 队列中心化”。这是最符合当前代码状态和本地数据产品风险的路线。

## 4. 四条主线

### 主线 A：学习闭环

目标：把今日行动队列、Pomodoro、错题复习、日记沉淀串成可验证闭环。

计划能力：

- Pomodoro 页面可选择今日 `todo / doing` 的 `focus / review / diary / mistake / custom` 任务。
- 开始专注后，选中的任务进入 `doing`。
- 专注保存成功后，`PomodoroAlert` 可标记任务完成，也可保留未完成。
- `pomodoro_sessions` 后续可计划性增加任务归因字段，用于统计“任务实际投入”。
- 错题复习完成后，如果存在关联 `related_mistake_id` 或今日 review 任务，可回写任务状态。
- 日记沉淀保存后，如果存在今日 diary 任务，可回写任务状态。
- 今日行动队列提供历史归档，避免当天结束后任务状态丢在首页上下文里。

### 主线 B：AI 学习助理

目标：让 AI 从聊天工具变成建议生成器，但不越过用户确认边界。

计划能力：

- AI 可生成“今日行动建议” display-only 结果，只显示，不自动入库。
- 建议先用自然语言卡片或结构化但不强制解析的格式展示。
- 用户确认后再把建议转成 `study_tasks`，source 标为 `ai`。
- 生成建议时可读入错题风险池、科目进度、今日/近期 Pomodoro 统计和今日日记状态。
- 在进入结构化 JSON 前，先完成历史消息 sanitize、消息数量/长度限制和 role schema 限制。

### 主线 C：工程稳定性

目标：降低未来功能迭代风险。

计划能力：

- 为写入型 IPC handler 增加运行时 payload validation，优先覆盖 `ai:chat`、`pomodoro:addSession`、`tasks:*`、`mistakes:review`、`entries:create/update`。
- 引入显式 SQLite schema version 和 `PRAGMA user_version`。
- 增加真实临时 SQLite 文件 migration 测试，覆盖旧 tags、旧 pomodoro、旧 mistakes、无 study_tasks、重复 migration。
- 对 Dashboard、HomeDashboard、FocusDistributionChart、PomodoroContext 增加 stale-response guard。
- 分阶段拆分 `electron/database.ts`，先迁出 migration/backup helpers，再拆 repository，不在一个 PR 内改业务行为。

### 主线 D：用户可理解性

目标：让普通考研用户知道每天该做什么、为什么做、做完后系统如何记录。

计划能力：

- 优化 HomeDashboard 队列密度，显示任务来源、状态和下一步动作。
- 增加任务状态、来源、类型筛选。
- 评估并计划“今日执行页”：专注、错题、日记沉淀以任务为中心组织。
- 增加任务历史归档页或轻量历史区域。
- 用户指南补充“如何用行动队列备考”：早上生成计划、执行专注、复习错题、晚上沉淀、次日查看。
- v2.0 release checklist 明确数据迁移、备份恢复、AI 边界、任务闭环和文档验收。

## 5. Milestone 计划

### Milestone 1：v1.9.9 稳定性修复

目标：先修风险，不加大功能。

包含：

- IPC runtime validation。
- AI history sanitize 修复。
- AI 请求长度和 role schema 限制。
- SQLite schema version。
- 真实 migration 测试。
- Dashboard stale-response guard。
- `database.ts` 第一阶段拆分准备。

用户可感知变化：应用更稳定，AI 更可控，快速切换和刷新更少出现旧数据覆盖；大部分变化是可靠性提升。

### Milestone 2：v1.9.9 任务与专注闭环

目标：Pomodoro + 今日任务联动。

包含：

- Pomodoro 选择今日任务。
- 开始专注后任务进入 `doing`。
- PomodoroAlert 标记任务完成。
- Pomodoro session 任务归因。
- HomeDashboard / 今日队列 UX 优化。

用户可感知变化：从今日任务开始专注，结束后能直接完成任务，今日队列开始成为执行中心。

### Milestone 3：v2.0-beta AI 建议闭环

目标：AI 生成建议，但用户确认后才入库。

包含：

- AI 生成今日行动建议 display-only。
- 用户确认 AI 建议转任务。
- 错题复习任务闭环。
- 日记沉淀任务闭环。
- 队列筛选和历史归档。

用户可感知变化：AI 会基于数据给出可操作建议，用户确认后进入任务；错题复习和日记沉淀会回写闭环。

### Milestone 4：v2.0 release

目标：文档、迁移、稳定性、发布准备。

包含：

- 用户指南补充行动队列使用法。
- v2.0 release checklist。
- 数据备份恢复和 migration 复核。
- 必要的 E2E 或集成测试补齐。

用户可感知变化：v2.0 作为完整学习系统发布，文档能解释每天如何使用系统，而不是只列功能。

## 6. 风险与非目标

主要风险：

- 任务与 Pomodoro 建立关联会改变数据模型，必须先有 schema version 和 migration 测试。
- AI 建议如果过早自动入库，会把不确定输出变成用户数据污染。
- 首页如果继续承载所有执行功能，会变重，影响现有 Zen Forest 体验。
- browser fallback 如果继续和 Electron 偏差过大，会让测试和演示结果误导真实行为。

v2.0 非目标：

- 不做云同步、账户系统、移动端同步。
- 不做自动学习计划全权代理。
- 不做大型 UI 改版或设计系统重写。
- 不引入新依赖，除非某个后续 issue 单独证明技术必要性。
- 不修改 package version、tag、release 或发布流程，直到 release 阶段明确批准。

## 7. 推荐下一步

第一个 PR 建议从 Milestone 1 的 IPC runtime validation 开始，范围控制在主进程边界和测试，不改变用户可见业务行为。它会为后续 Pomodoro task binding、AI 建议入库和任务状态回写提供更稳的安全边界。
