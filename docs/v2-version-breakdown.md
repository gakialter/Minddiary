# MindDiary v1.9.9 → v2.0 分阶段任务拆分计划

> 基线版本：v1.9.8
> 目标版本：v2.0.0
> 规划目的：把 v2 产品路线拆成连续、可验收、可回滚的小版本，避免一次性把任务、番茄钟、错题、AI、Dashboard 全部耦合到同一个大 PR 中。
> 推荐文件路径：`docs/v2-version-breakdown.md`

---

## 0. 总原则

MindDiary v2.0 不应该被定义为“多加几个功能”，而应该被定义为一次产品闭环升级：

```text
今日任务 → 专注计时 → 结束复盘 → 错题/日记沉淀 → Dashboard 反馈 → AI 建议下一步
```

当前 v1.9.8 已经具备以下基础模块：

- 日记系统
- 番茄钟 / 正计时
- 错题本
- SM-2 复习调度
- Dashboard 与今日决策
- 今日行动队列 `study_tasks`
- AI 助教
- 本地 SQLite
- JSON 导入导出
- 自动 ZIP 灾备恢复

v2.0 的核心任务不是另起炉灶，而是把这些已经存在的模块从“并列功能”推进为“考研学习闭环”。

---

## 1. 版本拆分原则

### 1.1 每个小版本只解决一个主问题

不要把一个版本做成“数据库迁移 + UI 大改 + AI + Dashboard + 文档”混合 PR。每个版本都应满足：

- 有一个明确主目标。
- 有一个明确可验收结果。
- 可以单独发布。
- 出问题时可以回滚。
- 不破坏旧数据。

### 1.2 先打通确定性链路，再做 AI

AI 相关能力必须后置。原因：

- AI 输出不稳定。
- AI 结构化解析容易引入脏数据。
- 任务、番茄钟、复盘、错题这些确定性数据链路没有打通前，AI 没有可靠上下文。

因此 v1.9.9 到 v1.9.12 主要做确定性闭环；v1.9.13 以后再引入 AI 建议。

### 1.3 AI 第一阶段只“建议”，不自动入库

AI 可以生成建议，但不能直接写入 `study_tasks`、`mistakes` 或 `entries`。
所有 AI 生成结果必须经过用户确认后才入库。

### 1.4 2.0 前不做高风险长期方向

以下方向暂缓到 2.1 或更晚：

- 图像遮挡 Image Occlusion
- FSRS 替换 SM-2
- 本地 RAG
- Ollama 本地大模型
- WebDAV / S3 同步
- Markdown Mirror
- 社区模板市场
- 系统级防沉迷拦截
- 大规模知识图谱

---

## 2. 总版本路线

| 版本 | 阶段定位 | 主目标 | 是否建议发布 |
|---|---|---|---|
| v1.9.9 | M0 护栏 | v2 前置工程护栏与文档基线 | 是 |
| v1.9.10 | M1-1 | Pomodoro 绑定今日任务 | 是 |
| v1.9.11 | M1-2 | 专注结束后任务结算与一句话复盘 | 是 |
| v1.9.12 | M1-3 | Dashboard 展示任务-专注-复盘闭环指标 | 是 |
| v1.9.13 | M2-1 | 错题复习任务与今日行动队列联动增强 | 是 |
| v1.9.14 | M2-2 | AI 生成今日行动建议，但需用户确认入库 | 是 |
| v1.9.15 | M3 冻结 | v2.0 候选版、回归测试、文档与迁移收口 | 是，可标 RC |
| v2.0.0 | 正式版 | 发布“考研学习闭环系统” | 是 |

---

## 3. v1.9.9：v2 前置护栏与规划入库

### 3.1 版本目标

建立 v2 开发基线，把后续版本的工程边界、数据安全、文档路线固定下来。
这个版本不追求明显的新功能，重点是降低后续版本串联模块时的风险。

### 3.2 推荐 PR 切分

#### PR 1：新增 v2 版本拆分文档

建议文件：

- `docs/v2-roadmap.md`
- `docs/v2-version-breakdown.md`

验收标准：

- 文档明确 v1.9.9 到 v2.0.0 的版本拆分。
- 明确哪些功能进入 2.0，哪些延后到 2.1+。
- 明确 AI 不直接入库的原则。
- 明确每个版本的验收标准。

#### PR 2：主进程 IPC runtime validation 状态核查

如果当前仓库已经完成 IPC runtime validation，则只做核查与补文档；如果未完成，则作为 v1.9.9 必做项。

重点通道：

- `ai:chat`
- `pomodoro:addSession`
- `tasks:create`
- `tasks:update`
- `tasks:complete`
- `tasks:skip`
- `tasks:delete`
- `mistakes:review`
- `entries:create`
- `entries:update`

验收标准：

- 非法 id 被拒绝。
- 非法日期被拒绝。
- 负 duration 被拒绝。
- 超长字符串被裁剪或拒绝。
- 非数组 AI messages 被拒绝。
- 非法 role 被拒绝。
- 不改变 preload API 形状。
- 有主进程边界测试。

#### PR 3：AI history sanitize 与请求上限核查

目标：

- 历史消息进入下一轮请求前必须再次 sanitize，或者保存独立 sanitized context。
- 限制 AI messages 数量。
- 限制每条 content 长度。
- 限制 system prompt 数量。
- 修复错题分析 prompt 中 notes 字段遗漏问题。

验收标准：

- prompt injection 不会通过历史消息重新进入下一轮请求。
- 超长日记 / 错题不会直接形成无限请求体。
- 错题 notes 能进入错题分析 prompt。
- 单测覆盖历史消息复用边界。

#### PR 4：SQLite migration 状态核查

目标：

- 明确当前 schema version 策略。
- 为后续 `pomodoro_sessions.task_id` 迁移做准备。
- 不在这个版本做大规模数据库拆分。

验收标准：

- 现有自动备份 manifest 的 schemaVersion 语义清楚。
- 后续新增列有明确 migration 路径。
- 真实旧库升级测试列入待办或已补充。
- 不做大爆炸重构。

### 3.3 不做事项

- 不实现任务绑定番茄钟。
- 不改 Dashboard 指标。
- 不做 AI 任务生成。
- 不做图像遮挡。
- 不重构整个 `database.ts`。

### 3.4 发布检查

```bash
npm run typecheck
npm test -- --run
npm run build
```

---

## 4. v1.9.10：Pomodoro 绑定今日任务

### 4.1 版本目标

让用户可以在开启番茄钟或正计时前，选择一个今日任务作为本轮专注目标。

这是 v2.0 闭环的第一刀。

### 4.2 数据库变更

在 `pomodoro_sessions` 增加可选字段：

```sql
task_id INTEGER REFERENCES study_tasks(id) ON DELETE SET NULL
```

建议索引：

```sql
CREATE INDEX IF NOT EXISTS idx_pomodoro_task_id ON pomodoro_sessions(task_id);
```

### 4.3 类型变更

修改 `PomodoroSession`：

```ts
export interface PomodoroSession {
  id?: number
  subject_id: number | null
  task_id?: number | null
  duration: number
  date_key?: string
  started_at?: string
  completed_at?: string
}
```

### 4.4 API 变更

需要检查并扩展：

- `pomodoro.addSession`
- Electron IPC handler
- browser fallback
- tests mock API
- backup export / restore 数据结构

### 4.5 UI 变更

Pomodoro 页面新增“本轮任务”选择区域。

推荐交互：

- 默认不绑定任务。
- 只显示今天 `todo` / `doing` 状态任务。
- 如果任务有关联科目，则自动带出科目。
- 如果用户手动改科目，不应强制覆盖任务。
- 任务选择应该是可清空的。

### 4.6 状态规则

开始专注时：

- 如果绑定任务状态为 `todo`，自动改为 `doing`。
- 如果绑定任务已是 `doing`，保持不变。
- 如果任务已 `done` / `skipped`，不允许绑定。

结束专注时：

- 只保存 `pomodoro_sessions.task_id`。
- 不在本版本自动完成任务。
- 不弹复杂结算面板。

### 4.7 测试清单

- 创建旧库时无 `task_id`，启动后自动补列。
- `pomodoro.addSession` 支持 `task_id: null`。
- `pomodoro.addSession` 支持合法 task id。
- 非法 task id 被拒绝。
- 删除 task 后，历史 pomodoro session 的 `task_id` 置空。
- Pomodoro 页面可选择今日任务。
- 开始专注后任务状态从 `todo` 变为 `doing`。
- 不允许绑定 `done` / `skipped` 任务。

### 4.8 不做事项

- 不做专注结束后自动完成任务。
- 不做一句话复盘。
- 不做 Dashboard 新指标。
- 不做 AI。

### 4.9 建议 Codex 任务提示词

```text
目标：实现 v1.9.10：Pomodoro 绑定今日任务。

仓库：gakialter/Minddiary

要求：
1. 为 pomodoro_sessions 增加可选 task_id 字段，并保证旧库迁移安全。
2. 扩展 PomodoroSession 类型、pomodoro.addSession API、Electron IPC、browser fallback 和测试 mock。
3. Pomodoro 页面允许选择今天 todo/doing 状态的 study_tasks 作为本轮专注目标。
4. 开始专注时，如果绑定任务是 todo，则更新为 doing。
5. 结束专注时，只保存 task_id，不自动完成任务。
6. 删除任务后，历史专注记录 task_id 应 ON DELETE SET NULL。
7. 添加必要单测/组件测试。
8. 不改变现有日记、错题、AI、备份恢复行为。

验收：
- npm run typecheck 通过
- npm test -- --run 通过
- npm run build 通过
```

---

## 5. v1.9.11：专注结束结算与一句话复盘

### 5.1 版本目标

在一个绑定任务的专注结束后，让用户完成两个动作：

1. 决定任务是否完成。
2. 用一句话记录刚才的学习结果或卡点。

这一步把“时间”变成“学习证据”。

### 5.2 UI 变更

扩展 `PomodoroAlert` 或专注结束弹窗。

当本轮专注绑定了任务时，展示：

- 本轮任务标题
- 本轮专注时长
- 关联科目
- 一句话复盘输入框
- 操作按钮：
  - 标记任务完成
  - 继续保持进行中
  - 跳过本次复盘
  - 写入今日日记
  - 添加错题

### 5.3 数据策略

第一阶段不新增专门的 `focus_reviews` 表，先复用现有能力：

- 复盘文本可以追加写入今日日记。
- `pomodoro_sessions` 只负责保存结构化时间记录。
- 任务状态通过 `study_tasks.status` 变更。

原因：

- 降低 schema 风险。
- 先验证用户是否真的愿意做结束复盘。
- 后续如果使用频率高，再在 v2.1+ 新增 `focus_reviews` 独立表。

### 5.4 任务状态规则

用户点击“标记任务完成”：

- `study_tasks.status = done`
- `updated_at = CURRENT_TIMESTAMP`

用户点击“继续保持进行中”：

- 保持 `doing`

用户点击“跳过本次复盘”：

- 不写日记。
- 不改任务，除非用户同时选择完成。

### 5.5 日记写入格式

建议追加到今日日记末尾：

```md
## 专注复盘

- 时间：20:30-20:55
- 任务：线代矩阵错题复习
- 科目：数学
- 复盘：今天主要卡在特征值计算步骤，明天需要再刷 2 道同类题。
```

如果当天没有日记：

- 自动创建今日日记。
- 标题可用 `YYYY-MM-DD 学习记录`。
- mood 可为空，不强制用户选择。

### 5.6 测试清单

- 专注结束后绑定任务信息展示正确。
- 点击“标记任务完成”后任务状态变为 `done`。
- 点击“继续保持进行中”后任务保持 `doing`。
- 一句话复盘能追加到今日日记。
- 当天无日记时能创建新日记。
- 空复盘不应写入空段落。
- 未绑定任务时保持旧的 PomodoroAlert 行为。

### 5.7 不做事项

- 不新增 `focus_reviews` 表。
- 不做 AI 总结。
- 不做 Dashboard 新图表。
- 不做任务批量管理。

---

## 6. v1.9.12：Dashboard 闭环指标

### 6.1 版本目标

让 Dashboard 能看见“今日任务与专注是否真正闭环”。

当前 Dashboard 已有今日决策、专注统计、错题消灭率、风险池、稳定记忆净增、有效专注转化率等信息。v1.9.12 的重点是把今日行动队列加入统计解释中。

### 6.2 新增指标

建议新增或调整：

1. 今日任务完成率

```text
done tasks / all planned tasks today
```

2. 今日任务专注覆盖率

```text
has pomodoro task_id 的任务数 / 今日任务数
```

3. 今日复盘率

短期可用近似规则：

```text
今日专注结束后写入过复盘段落的 session 数 / 今日完成的 focus session 数
```

如果 v1.9.11 没有结构化记录复盘，可先不做严格统计，只做文本存在性提示。

4. 今日学习闭环状态

```text
未开始 / 已计划 / 已专注 / 已复盘 / 已完成
```

### 6.3 Dashboard 建议逻辑

建议规则：

- 如果今日没有任务：提示创建今日任务。
- 如果有 `todo` 任务但没有专注记录：提示开始第一个专注。
- 如果有 `doing` 任务且有专注记录：提示结算任务或补复盘。
- 如果有待复习错题但没有 review 任务：提示生成错题复习任务。
- 如果今日无日记：提示生成学习沉淀任务。

### 6.4 数据查询建议

避免在前端重复拼接过多异步请求。优先在主进程聚合：

- `todayDashboard.getData(date)` 扩展 task summary。
- 或新增 `tasks.getTodaySummary(date)`，由 Dashboard 单独调用。

推荐字段：

```ts
interface TodayTaskSummary {
  total: number
  todo: number
  doing: number
  done: number
  skipped: number
  linkedPomodoroCount: number
  linkedTaskCount: number
}
```

### 6.5 测试清单

- 无任务时 Dashboard 提示创建任务。
- 有任务无专注时提示开始专注。
- 有待复习错题但无 review 任务时提示生成复习任务。
- 任务完成率计算正确。
- 删除 task 后历史 pomodoro 不导致 Dashboard 崩溃。
- browser fallback 与 Electron 结果尽量一致，不能一致时明确 unsupported。

### 6.6 不做事项

- 不做复杂图表。
- 不做长周期趋势预测。
- 不做 AI 自动推荐。
- 不引入新的云端能力。

---

## 7. v1.9.13：错题复习任务联动增强

### 7.1 版本目标

让“今日待复习错题”真正进入今日行动队列，而不只是 Dashboard 的一个数字。

### 7.2 功能范围

#### 功能 1：生成今日错题复习任务增强

当前已有“根据待复习错题生成建议任务”的方向。v1.9.13 做增强：

- 生成任务时带上待复习数量。
- 任务类型为 `review`。
- 如果待复习错题有科目分布，则按科目拆分或在描述中说明。
- 避免重复生成同类 review 任务。
- 支持从任务跳转到错题本的“今日待复习”筛选状态。

#### 功能 2：任务与错题筛选联动

点击 review 任务：

- 打开错题本。
- 自动筛选 `due=true`。
- 如果任务有关联科目，则自动筛选该科目。
- 如果任务有关联单个错题，则定位到该错题。

#### 功能 3：复习完成后任务状态建议

当今日 due 错题清空后：

- 如果存在今日 `review` 任务，提示用户标记完成。
- 第一阶段只提示，不强制自动完成。

### 7.3 测试清单

- 有 due mistakes 时生成 review task。
- 没有 due mistakes 时不生成空任务。
- 同一天不重复生成同类 review task。
- 点击 review task 能跳转到错题本 due 筛选。
- 科目筛选传递正确。
- 清空 due pool 后出现完成任务提示。

### 7.4 不做事项

- 不把 SM-2 替换成 FSRS。
- 不做图像遮挡。
- 不做 AI 自动出题。
- 不重写错题本 UI。

---

## 8. v1.9.14：AI 今日行动建议，用户确认后入库

### 8.1 版本目标

让 AI 基于今天的真实学习数据生成“行动建议”，但必须由用户确认后才能变成 `study_tasks`。

### 8.2 输入上下文

AI 可读取的摘要上下文：

- 今日任务摘要
- 今日专注总时长
- 今日已完成任务
- 今日未完成任务
- 今日待复习错题数量
- 近 7 日专注趋势
- 近 7 日错题更新情况
- 今日日记摘要或字数/mood
- 用户手动输入的目标

### 8.3 输出格式

AI 第一阶段可以返回自然语言 + 可解析建议块。

推荐结构：

```json
{
  "suggestions": [
    {
      "title": "复习 12 道数学待复习错题",
      "description": "今天风险池里数学错题较多，建议先处理高频错误。",
      "type": "review",
      "estimate_minutes": 45,
      "reason": "待复习错题积压"
    }
  ]
}
```

但不强依赖 AI 必定输出合法 JSON。
如果解析失败，则只展示文本，不入库。

### 8.4 用户确认流程

- AI 生成建议后，先展示卡片。
- 每条建议有“加入今日行动队列”按钮。
- 用户点击后才调用 `tasks.create`。
- 入库 source 为 `ai`。
- 用户可以编辑标题、预计时间、类型后再加入。

### 8.5 安全规则

- AI 不允许直接调用写入 API。
- AI 输出必须经过本地 schema validation。
- title 长度限制。
- description 长度限制。
- estimate_minutes 必须为正整数并设上限。
- type 必须属于允许枚举。
- planned_date 固定为用户选择日期，不能让 AI 自由指定任意日期。

### 8.6 测试清单

- AI 文本建议能展示。
- 合法 JSON 建议能渲染成待确认卡片。
- 非法 JSON 不崩溃。
- 用户确认后才创建任务。
- source 正确写为 `ai`。
- 超长 title / description 被裁剪或拒绝。
- AI 不能创建非法 task type。
- 没有 API Key 时展示不可用状态。

### 8.7 不做事项

- 不做自动入库。
- 不做长期 RAG。
- 不做本地大模型。
- 不让 AI 直接修改错题、日记或任务状态。

---

## 9. v1.9.15：v2.0 RC 冻结与发布准备

### 9.1 版本目标

把 v1.9.10 到 v1.9.14 的闭环能力收口，作为 v2.0 候选版。

### 9.2 功能冻结

进入 v1.9.15 后，不再新增产品功能，只做：

- bug fix
- 测试补齐
- 文档更新
- 迁移验证
- 备份恢复验证
- release checklist

### 9.3 必测闭环

#### 闭环 1：今日任务 → 番茄钟 → 完成任务

1. 创建今日任务。
2. 在 Pomodoro 选择该任务。
3. 开始专注。
4. 专注结束。
5. 标记任务完成。
6. Dashboard 任务完成率更新。

#### 闭环 2：今日任务 → 专注 → 写入复盘

1. 创建今日任务。
2. 绑定任务开始专注。
3. 专注结束后输入一句话复盘。
4. 写入今日日记。
5. 今日日记展示复盘内容。

#### 闭环 3：待复习错题 → 生成 review 任务 → 跳转错题本

1. 创建或导入待复习错题。
2. Dashboard 显示风险池。
3. 生成今日错题复习任务。
4. 点击任务跳转错题本 due 筛选。
5. 完成复习后提示完成任务。

#### 闭环 4：AI 建议 → 用户确认 → 创建任务

1. 配置 AI。
2. 点击生成今日行动建议。
3. 展示 AI 建议卡片。
4. 用户确认加入今日行动队列。
5. 任务 source 为 `ai`。
6. 不确认则不入库。

#### 闭环 5：备份恢复

1. 生成包含新字段的自动 ZIP 备份。
2. 从 ZIP 恢复。
3. `study_tasks`、`pomodoro_sessions.task_id`、错题、日记、附件均正常。
4. 旧版本数据库升级后不丢数据。

### 9.4 文档更新

建议更新：

- `README.md`
- `docs/USER_GUIDE.md`
- `docs/daily-action-queue.md`
- `docs/release-checklist.md`
- `docs/v2-roadmap.md`
- `docs/v2-version-breakdown.md`

### 9.5 测试要求

```bash
npm run typecheck
npm test -- --run
npm run test:e2e
npm run build
npm run build:win
```

如果 macOS 构建环境可用：

```bash
npm run build:mac
```

### 9.6 发布判断

满足以下条件才允许发布 v2.0：

- 没有 P0/P1 bug。
- 旧库迁移测试通过。
- 自动 ZIP 备份恢复通过。
- AI 失败不会影响非 AI 主流程。
- Browser fallback 不阻断测试。
- README 与实际功能一致。
- 用户指南覆盖新闭环。
- release checklist 完成。

---

## 10. v2.0.0：正式发布

### 10.1 版本定位

MindDiary v2.0.0 的一句话定位：

```text
从“本地优先考研日记与效率工具”升级为“本地优先考研学习闭环系统”。
```

### 10.2 Release Note 主标题

```text
MindDiary v2.0：今日任务、专注计时、复盘沉淀与错题复习正式打通
```

### 10.3 Release Note 核心卖点

#### 1. 今日学习闭环

- 今日任务可以绑定到番茄钟。
- 专注记录可以回溯到具体任务。
- 专注结束后可以完成任务或写入复盘。
- Dashboard 可以展示今日任务执行情况。

#### 2. 错题复习进入行动队列

- 今日待复习错题可以生成 review 任务。
- review 任务可以跳转到错题本 due 筛选。
- 错题复习不再只是独立模块，而是进入今日计划。

#### 3. AI 生成行动建议

- AI 可以根据本地学习摘要生成今日行动建议。
- 建议必须由用户确认后才会创建任务。
- AI 不会绕过用户直接修改本地数据。

#### 4. 本地优先不变

- 核心数据仍存储在本地 SQLite。
- AI 仅在用户配置和触发时联网。
- 自动 ZIP 灾备恢复继续覆盖新数据结构。

### 10.4 v2.0 不包含的内容

必须明确告诉用户以下内容不在 v2.0：

- 多端实时云同步
- 图像遮挡复习
- FSRS 替换 SM-2
- 本地 RAG
- Ollama 本地模型
- 社区模板市场
- Markdown Mirror
- 知识图谱

这不是能力不足，而是产品克制。v2.0 的重点是先把核心学习闭环做稳。

---

## 11. v2.0 后续路线预留

### v2.1：复习算法与错题体验强化

候选功能：

- FSRS 调度替换或并行试验
- 错题复习历史记录独立表
- 错因标签
- 错题复习周报
- review session 概念

### v2.2：图像错题卡与遮挡复习

候选功能：

- 截图粘贴成错题卡
- 本地图片遮挡块
- 遮挡坐标 JSON 存储
- 图片错题复习模式
- 数学公式 / 英语长难句截图复习优化

### v2.3：AI 周复盘与本地上下文增强

候选功能：

- 基于任务、番茄钟、错题、日记的周报
- 错因聚类
- 薄弱点总结
- 下周学习计划建议
- 本地向量索引试验

---

## 12. 推荐开发顺序总表

| 顺序 | 版本 | 任务 | 优先级 | 风险 |
|---|---|---|---|---|
| 1 | v1.9.9 | 文档与护栏核查 | P0 | 低 |
| 2 | v1.9.10 | `pomodoro_sessions.task_id` | P0 | 中 |
| 3 | v1.9.10 | Pomodoro 选择今日任务 | P0 | 中 |
| 4 | v1.9.11 | 专注结束任务结算 | P0 | 中 |
| 5 | v1.9.11 | 一句话复盘写入日记 | P1 | 中 |
| 6 | v1.9.12 | Dashboard 任务闭环指标 | P1 | 中 |
| 7 | v1.9.13 | due 错题生成 review 任务增强 | P1 | 中 |
| 8 | v1.9.13 | review 任务跳转错题 due 筛选 | P1 | 中 |
| 9 | v1.9.14 | AI 今日行动建议展示 | P1 | 中 |
| 10 | v1.9.14 | 用户确认后创建 AI 任务 | P1 | 中 |
| 11 | v1.9.15 | 回归测试与文档收口 | P0 | 中 |
| 12 | v2.0.0 | 正式发布 | P0 | 中 |

---

## 13. 每个版本的标准 PR 模板

```md
## Summary

本 PR 实现 vX.X.X 的核心目标：<一句话说明>。

## Scope

- [ ] 数据结构
- [ ] Electron IPC / API
- [ ] Browser fallback
- [ ] UI
- [ ] 测试
- [ ] 文档

## Out of scope

- 不做 <明确排除项>
- 不做 <明确排除项>

## Validation

- [ ] npm run typecheck
- [ ] npm test -- --run
- [ ] npm run build

## Risk

- 数据迁移风险：
- UI 回归风险：
- 备份恢复风险：
- AI 失败降级：
```

---

## 14. 最终判断

v2.0 最稳的路径不是“大版本一次性重构”，而是从 v1.9.9 开始连续发布小版本：

```text
v1.9.9   稳住工程护栏
v1.9.10  打通任务和番茄钟
v1.9.11  打通专注结算和复盘
v1.9.12  让 Dashboard 看见闭环
v1.9.13  把错题复习纳入行动队列
v1.9.14  让 AI 生成建议，但用户确认入库
v1.9.15  冻结回归，作为 v2.0 RC
v2.0.0   正式发布考研学习闭环系统
```

这样做的好处：

- 每个版本都有清晰卖点。
- 每个版本都可独立测试和发布。
- 出问题时容易定位。
- 不会让 AI、Dashboard、SQLite migration、Pomodoro 状态同时爆炸。
- 最终 v2.0 的产品叙事足够清楚：MindDiary 已经从记录工具升级为考研学习闭环系统。
