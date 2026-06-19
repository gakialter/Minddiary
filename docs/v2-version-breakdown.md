# MindDiary v1.9.9 → v2.0 分阶段任务拆分计划

> 基线版本：v1.11.1
> 基线 commit：`bc305cfe1464c713e3253c19dce0a8d8acc063b6`
> 目标方向：v2.0 学习闭环系统
> 本次准备版本：v1.11.2

---

## 0. 总原则

MindDiary v2.0 的核心不是添加更多并列功能，而是把已有日记、今日任务、Pomodoro、错题、Dashboard 和 AI 从“入口集合”推进为“学习闭环”。

当前确定性产品闭环先行：

```text
今日任务 → 专注 → 结算 → 复盘 → Dashboard
```

AI 后置并保持用户确认边界：

- AI 可以生成建议。
- AI 不允许直接写数据库。
- AI 建议必须由用户确认后，才通过普通任务、错题或日记 API 入库。

---

## 1. v1.9.9 完成状态

v1.9.9 是 v2 前置护栏和稳定性基线，已完成：

- IPC runtime validation。
- SQLite schema version。
- `PRAGMA user_version`。
- 真实历史旧库 migration fixtures。
- AI history sanitize。
- AI role、数量和长度边界。
- stale-response guards。
- database repositories 分阶段抽离。
- 科目删除保留关联数据。
- 错题主动复习。
- 题目图片和答案图片。
- 中断专注保存。

Issue 状态：

- Issue #91 已完成：删除科目+错题本刷题机制相关阶段工作已经进入正式版本。
- Issue #96 已完成：专注优化建议中的中断专注保存已经进入正式版本。

---

## 2. 总版本路线

| 版本 | 阶段定位 | 主目标 | 状态 |
|---|---|---|---|
| v1.9.9 | M0 护栏 | v2 前置工程护栏、迁移、AI 边界、错题/专注基础 | 已完成 |
| v1.10.0 | M1 闭环 | 合并原 v1.9.10、v1.9.11、v1.9.12：任务绑定专注、结束结算、一句话复盘、Dashboard 闭环指标 | 已正式发布 |
| v1.11.0 | M2/M3 联动 | 详细章节进度、错题任务联动、日记保存后确认结算、AI 今日行动建议、AI 助手 composer 附件与受控上下文 | 已正式发布 |
| v1.11.1 | 稳定性热修复 | 日期 rollover、日记/任务闭环与 Pomodoro 结算一致性 | 已正式发布 / latest |
| v1.11.2 | 发布卫生 | Release asset allowlist、manifest 测试、Actions runtime 与文档同步 | 准备中 |
| v1.12.0 | M4 章节闭环 | 章节与今日任务闭环；如需持久化关系，单独评估 schema 5 | 未开始 |
| v2.0.0 | 正式版 | 学习闭环系统发布收口 | 未开始 |

---

## 3. v1.10.0：任务到专注的完整闭环（已完成）

### 3.1 版本目标

v1.10.0 已一次性打通：

1. 今日任务绑定 Pomodoro / custom / stopwatch。
2. 专注记录归因到 `study_tasks`。
3. 开始专注时 `todo → doing`。
4. 专注结束后由用户决定任务是否完成。
5. 一句话复盘写入今日日记。
6. Dashboard 展示轻量闭环指标。

### 3.2 数据库变更

新增字段：

```sql
task_id INTEGER REFERENCES study_tasks(id) ON DELETE SET NULL
```

新增索引：

```sql
CREATE INDEX IF NOT EXISTS idx_pomodoro_task_id
ON pomodoro_sessions(task_id);
```

迁移要求：

- 提升 `CURRENT_SCHEMA_VERSION`。
- 新增正式 versioned migration，不重写旧 migration。
- fresh database 直接包含 `task_id`。
- version 0、1、2 历史数据库均可升级。
- repeated migration 幂等。
- migration 后 `PRAGMA integrity_check` 为 `ok`。
- migration 后 `PRAGMA foreign_key_check` 为空。
- 不修改旧 `image_path` 数据。
- `answer_image_path` 继续 nullable。

### 3.3 备份恢复

新字段使恢复顺序变成真实依赖：

```text
基础数据 / subjects / entries / mistakes
→ study_tasks
→ pomodoro_sessions
```

删除旧数据时使用反向依赖顺序。

验收要求：

- 新备份包含 `pomodoro_sessions.task_id`。
- 旧备份无 `task_id` 时可恢复。
- `task_id = null` 可恢复。
- `task_id` 有值时，先恢复对应 study task 再恢复 session。
- 不关闭外键绕过问题。
- ZIP 恢复后 `foreign_key_check` 通过。

### 3.4 Pomodoro 交互

支持绑定任务的模式：

- work
- custom
- stopwatch

任务范围：

- `planned_date` 为今天。
- `status` 为 `todo` 或 `doing`。
- `done` / `skipped` 不可用于启动新 session。

交互规则：

- 默认不绑定任务。
- 任务选择可清空。
- 展示任务标题、状态、关联科目和预计时长。
- 任务有关联科目时自动建议科目。
- 用户手动修改科目后，不再被任务强制覆盖。
- 切换任务时可以建议新科目，但不能覆盖用户明确手动选择。
- 启动失败不得留下半启动状态。

### 3.5 活动 session 持久化

活动 session 需要保存并恢复：

- `task_id`
- `subject_id`
- mode
- duration / elapsed
- running / paused 状态
- `startedAt`
- pause 数据和既有字段

兼容要求：

- 旧 localStorage/session 无 `task_id` 时恢复为未绑定。
- task 已被删除时恢复为未绑定。
- task 已变成 `done` / `skipped` 时，已运行 session 可继续恢复，但新 session 不允许绑定。
- stale session 丢弃规则保持有效。

### 3.6 专注结束结算

绑定任务时，结算展示：

- 任务标题。
- 关联科目。
- 实际专注时长。
- 当前任务状态。
- 一句话复盘输入框。

允许操作：

- 标记任务完成。
- 保持任务进行中。
- 跳过复盘。
- 写入今日日记。
- 仅保存专注记录。
- 保留现有添加错题入口。

状态规则：

- 不自动完成任务。
- 用户点击“标记任务完成”才写 `done`。
- 用户点击“继续进行”保持 `doing`。
- task 已删除时降级为无任务状态。
- task 已经 `done` 时操作幂等。
- 任务状态重试不得重新创建 pomodoro session。

### 3.7 一句话复盘

第一阶段不新增 `focus_reviews` 表。

复盘文本写入今日日记，推荐格式：

```md
## 专注复盘

- 时间：HH:mm
- 任务：任务标题
- 科目：科目名称
- 专注：N 分钟
- 结果：用户输入的一句话复盘
```

要求：

- 有今日日记时追加，不覆盖原内容。
- 无今日日记时，经用户确认后创建今日日记。
- 空复盘不写空区块。
- 多次复盘按时间顺序追加。
- 写入失败可重试。
- 不重复追加同一次 settlement 的复盘。

### 3.8 Dashboard 指标

新增轻量指标：

- 今日任务完成率：`done / (todo + doing + done)`。
- skipped 不进入完成率分母，但保持可见。
- 今日任务专注覆盖率：今天至少拥有一条有效 `task_id` pomodoro session 的任务数 / 今日有效任务数。
- 今日任务实际专注时长：今天关联 `task_id` 的 pomodoro session duration 总和。
- 未闭环任务提示：`doing` 但无专注记录、有专注记录但未完成、`todo` 仍未开始。

边界：

- Dashboard 只使用结构化数据。
- 不改变已有统计口径。
- 无 `task_id` 的历史专注不归因。
- 删除 task 后历史 session `task_id` 为 null，不进入任务指标。
- 无今日任务时显示空状态，不能出现 NaN 或除零。
- 不加入 AI 建议。

---

## 4. v1.10.0 不做事项

本版本明确不做：

- 错题完成后自动回写 review task。
- `related_mistake_id` 的新闭环逻辑。
- 日记任务自动完成。
- AI 今日行动建议。
- AI 自动建任务。
- AI 直接写数据库。
- AI 结构化任务解析。
- 任务历史归档页面。
- 独立今日执行页面。
- `focus_reviews` 新表。
- FSRS。
- 图像遮挡。
- 本地 RAG。
- 云同步。
- 大型 HomeDashboard 重构。
- 大型 Pomodoro UI 重构。
- 新设计系统。
- v2.0 发布。

---

## 5. v1.10.0 发布准备检查（已完成）

本阶段已完成 v1.10.0 文档和版本元数据准备：

- `package.json` / `package-lock.json` 版本更新到 `1.10.0`。
- `RELEASE_NOTES.md` 改写为 v1.10.0。
- `README.md` 更新今日任务绑定专注、结束结算、一句话复盘和 Dashboard 闭环指标。
- `docs/USER_GUIDE.md` 增加完整操作流程。
- `docs/v2-roadmap.md` 和 `docs/v2-version-breakdown.md` 标记本阶段完成。

发布结果：

- v1.10.0 已完成正式 tag 与 GitHub Release。
- Release workflow 发布 v1.10.0 资产后，v1.10.0 保持为当前 latest，直到 v1.11.0 正式发布。

---

## 6. v1.11.0：学习内容与今日任务闭环（已完成）

### 6.1 版本目标

v1.11.0 把学习内容进一步接入今日任务，并把科目进度升级为详细章节管理，同时保持 MindDiary 的低压、克制体验：

```text
科目进度 → 详细章节 → 勾选完成 → 大盘同步
错题复习 → SM-2 成功 → 精确关联任务结算
日记保存 → 有效内容 → 用户确认任务结算
学习数据 → AI 建议 → 本地校验 → 用户确认创建任务
快捷提示 → 可编辑草稿 → 可移除上下文 → 用户主动发送
本地附件 → 本地校验/提取 → 用户主动发送 → provider
```

### 6.2 数据模型边界

本阶段升级到 schema version 4，并新增规范化章节表：

- `CURRENT_SCHEMA_VERSION = 4`。
- 新增 `subject_chapters`，字段包含 `subject_id`、`title`、`notes`、`completed`、`sort_order`、`created_at`、`updated_at`。
- schema 0、1、2、3 均可升级到 schema 4，旧科目 `total_chapters` / `completed_chapters` 保持原值。
- 没有详细章节的旧科目继续使用汇总模式，不自动生成占位章节。
- 首次添加详细章节时由用户确认转换方式；详细章节模式下，章节表是进度事实来源，并同步 subjects 汇总字段。
- 自动 ZIP backup / restore 和 JSON 导出导入包含详细章节；旧备份缺少章节表时仍可恢复。
- 复用 `study_tasks.related_mistake_id` 表达单题 review 任务。
- 复用 `study_tasks.related_entry_id` 表达 diary 任务与真实日记关联。
- 复用 `study_tasks.source = ai` 标记经用户确认创建的 AI 建议任务。
- 不新增集合任务成员表、`focus_reviews`、AI suggestion 持久化表或 `completion_source` 字段。

### 6.3 产品与安全边界

详细章节进度：

- 科目卡片保持概览，只展示进度、已完成 / 总章节、下一未完成章节、今日专注和错题概况。
- 章节管理位于轻量展开区域，支持单条添加、一行一个章节批量粘贴、完成状态、筛选、重命名、notes、上移 / 下移和删除。
- 输入会 trim 并限制长度；同一次批量输入的重复行会明确反馈。
- 清空全部详细章节时，明确保留当前详细进度为汇总进度并回到汇总模式。

错题任务：

- 只自动结算明确关联单个 `related_mistake_id` 的 `review` 任务。
- 无关联的旧 review 任务保留手动完成能力，不通过标题、科目或描述猜测关系。
- SM-2 更新必须先成功，任务结算失败不得回滚已保存的复习数据。

日记任务：

- 只有有效日记保存成功后，才允许提示用户确认完成 diary task。
- 专注一句话复盘可写入日记，但不自动完成 diary task。
- 删除日记后，关联任务的 `related_entry_id` 置空，任务状态不回退。

AI 建议：

- AI 只生成候选建议，不能直接写数据库、调用 SQL、创建/完成/跳过/删除任务。
- 结构化建议必须经过本地 JSON parser、schema validation、allowlist relation 校验和用户确认。
- 用户确认后才通过普通 `study_tasks` API 逐条创建，强制 `source = ai`、`status = todo`、`planned_date = today`。

AI 助手 composer：

- 五个快捷入口只填入可编辑草稿并添加可移除上下文标签；点击快捷入口不触发 AI 请求或上下文预取。
- 上下文在发送时读取最新本地数据，且进入最终 user message；附件和上下文不会拼进 system role 或历史 assistant role。
- 支持 PNG/JPEG/WebP、TXT/MD/CSV/JSON/LOG 和文本型 PDF；图片使用 OpenAI 兼容 multipart message，并由模型视觉能力门控。
- 附件正文、base64、PDF 提取文本和本地路径不进入 SQLite、localStorage、聊天历史、自动备份或导出。

### 6.4 非目标

本阶段不做：

- FSRS、OCR、图像遮挡、本地 RAG、Ollama 深度集成、云同步。
- Office 文件、音视频、压缩包、远程图片 URL、provider Files API、流式输出或多会话 AI。
- 大型任务历史归档页、独立大型今日执行页、大型 HomeDashboard 重构或大型项目管理模块。
- AI 自动写库、自动建任务、自动完成/跳过/删除任务或后台持续运行。
- AI 自动完成章节、章节权重、截止日期、甘特图、看板或多级章节树。

## 7. v1.11.2：发布卫生与文档同步

本版本是独立 patch，不承载产品功能：

- Release workflow 只上传版本化正式根目录资产，禁止 `MindDiary.exe`、`elevate.exe`、`win-unpacked/**` 和 macOS app bundle 内部产物。
- release asset manifest 测试覆盖 allowlist、禁止资产、版本化文件名和 latest metadata 基本结构。
- 只升级明确触发 Node 20 runtime warning 的 Action major；项目 Node 22 不变。
- README、路线图、release notes 与 release checklist 同步到 v1.11.2。
- SQLite schema 保持 4；无 migration、无 backup / restore 格式变化；不修改既有 tag 或 Release 资产。

## 8. v1.12.0：章节与今日任务闭环方向

v1.12.0 才处理章节加入今日任务。若持久化 chapter-task 关系确有必要，可在该独立版本中评估 schema version 5，并同步设计 migration、旧库升级、自动 ZIP 备份恢复和 JSON 导入导出兼容；v1.11.2 不预建表或字段。

## 9. v2 后续预留

v1.12.0 后建议顺序：

1. 基于真实使用反馈评估是否需要任务历史归档或更独立的今日执行页。
2. v2.0 RC 回归与正式发布准备。
