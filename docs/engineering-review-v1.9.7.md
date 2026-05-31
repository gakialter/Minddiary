# MindDiary v1.9.7 前工程体检

审查日期：2026-05-31

审查范围：仅当前仓库 `gakialter/Minddiary`，基于本地 `main` 分支 `39a5d90 chore: release v1.9.6 (#70)` 做只读工程审查。本次不修改业务代码，只输出本审查文档。

验证结果：

- `npm.cmd run typecheck`：通过。
- `npm.cmd test -- --run`：通过，55 个测试文件、509 个测试全部通过。

工作区说明：审查开始时存在未跟踪的 `AGENTS.md`、`fix_pr_body.txt`、`pr_body.txt`、`release_notes.txt`。测试后工作区又出现未提交的 `README.md` 修改和 `docs/USER_GUIDE.md` 未跟踪文件，本审查未回退这些外部变更。README 相关结论以 `main` 的已跟踪内容为基线；若这些未提交文档改动是准备合入的修正，可把相关文档 issue 视为已部分处理。

## 总体结论

没有发现必须阻断 v1.9.7 的 P0 级工程问题。当前主干的安全基础比早期版本强：`electron/main.ts:createWindow()` 开启 `contextIsolation`、关闭 `nodeIntegration`，`electron/preload.ts` 没有暴露裸 `ipcRenderer`，导出路径和自动备份 ZIP 恢复都有主进程授权。

更值得在 v1.9.7 前后处理的是 P1/P2 风险：

- Electron IPC 面不是“裸暴露”，但写入型 handler 多数依赖 TypeScript 类型而不是主进程运行时 schema，`ai:chat`、`pomodoro:addSession`、`mistakes:review` 等边界应补主进程校验。
- `electron/database.ts` 已到 1082 行，混合连接、schema、migration、repository、业务服务、备份恢复、AI key 加密和图片清理，建议拆分，但应以行为保持为目标分阶段做。
- SQLite migration 当前靠 `CREATE TABLE IF NOT EXISTS`、`ALTER TABLE`、若干 `try/catch` 和 `CURRENT_SCHEMA_VERSION = 1`，缺少显式 `PRAGMA user_version`、原子迁移和真实旧库升级测试。
- AI prompt sanitization 有一个具体边界：`AIPanel.sendMessage()` 只 sanitize 当前输入，却把 raw message 写入 UI/history，下一轮通过 `messages.slice(-6)` 重新送进请求。
- Dashboard/HomeDashboard/Pomodoro 的查询已经有批量优化，但仍存在多处独立刷新状态和旧异步响应覆盖新状态的风险。

## 重点审查

### 1. Electron IPC 暴露面

正面结论：

- `electron/preload.ts:9-169` 通过 `contextBridge.exposeInMainWorld('api', ...)` 暴露固定命名空间，没有暴露通用 `send` / `invoke` / `ipcRenderer`。
- `electron/main.ts:createWindow()` 在 `webPreferences` 中设置 `contextIsolation: true`、`nodeIntegration: false`。
- `electron/exportHandlers.ts:createExportHandlers()` 使用 `allowedSavePaths`，`showSaveDialog()` 授权，`writeFile()` / `toPDF()` 一次性消费授权路径。
- `electron/main.ts:737-756` 的 `settings:selectBackupFile` / `settings:restoreBackupFromZip` 使用 `allowedBackupRestorePaths`，要求 ZIP 先由文件选择器选中。
- `electron/pathSecurity.ts:resolveLocalProtocolPath()` 对 `local://` 路径做 realpath 和 userData 内部约束。

主要风险：

- `electron/main.ts:267-289`、`579-583`、`612-627` 这类 handler 直接把 renderer payload 交给 `database.ts` / `aiService.ts`。TypeScript 不能约束运行时 IPC payload。
- `electron/main.ts:626` 的 `ai:chat` 直接调用 `aiService.chat(messages)`；`electron/aiService.ts:20-31` 会把 renderer 传入的 `messages` 原样转发到 OpenAI-compatible endpoint，没有 role、长度、system 消息数量、总内容大小校验。
- `electron/main.ts:630` 的 `notification:show` 接收任意 title/body；安全级别低于文件/DB 写入，但也应有长度限制，避免 renderer bug 导致系统通知滥用。

结论：IPC 没有“过宽到暴露底层 IPC”的问题，但主进程运行时验证不足，建议作为 P1 加固。

### 2. `database.ts` 是否过大、是否需要拆分

结论：需要拆，但不建议在 v1.9.7 前做大爆炸式重构。

证据：

- `electron/database.ts` 当前 1082 行。
- 同一个文件内包含：
  - DB 路径和初始化：`setCustomDbPath()`、`getDbPath()`、`initialize()`。
  - schema 和 migration：`initialize()`、`ensureColumn()`、`migratePomodoroDateKey()`、`migrateTagStyleColumns()`。
  - entry/tag/settings/attachment/subject/pomodoro/dashboard/mistake/template repositories。
  - AI key 加密：`getAiApiKey()`、`setAiApiKey()`。
  - 备份导入导出：`exportBackupData()`、`restoreBackupData()`。
  - 错题图片引用清理：`parseMistakeImagePaths()`、`cleanupRemovedMistakeImages()`。

风险不是“文件长”本身，而是迁移、业务 query、文件副作用和加密逻辑耦合后，局部修改更容易误伤其他闭环。建议分阶段拆成：

- `electron/db/connection.ts`：路径、连接、WAL、foreign_keys。
- `electron/db/migrations.ts`：schema version、迁移事务、旧库升级。
- `electron/db/repositories/*.ts`：entries、tags、pomodoro、mistakes、templates、settings。
- `electron/services/aiKeyStore.ts`、`backupRepository.ts`、`mistakeImageCleanupService.ts`。

拆分验收应以现有 exported API 不变为前提，让 `main.ts` 和现有测试先不大改。

### 3. SQLite migration 安全性

正面结论：

- `initialize()` 设置 `journal_mode = WAL` 和 `foreign_keys = ON`。
- `ensureColumn()` 通过 `PRAGMA table_info(...)` 做列存在性检查，`migrateTagStyleColumns()` 后续会修正非法 `variant` / `pattern`。
- `backupRestore.ts:validateManifest()` 会拒绝未来 `schemaVersion` 的 ZIP 备份。

主要风险：

- `electron/database.ts:33` 的 `CURRENT_SCHEMA_VERSION = 1` 与注释中的 “v2.0 Migration / v2.1 Migration” 不匹配，且没有写入 SQLite `PRAGMA user_version`。
- `initialize()` 中 schema 创建、列迁移、颜色迁移、模板 seed 没有被一个显式 migration transaction 包起来。`migrateColors()` 是 transaction，但整体初始化不是。
- `electron/database.ts:158-162` 对 spaced repetition 列和索引的异常直接吞掉，无法区分“列已存在”和真正的 SQLite 错误。
- `tests/database.test.ts` 主要通过 mock `better-sqlite3` 验证 SQL 调用；缺少用真实临时 SQLite 文件构造旧 schema 后执行 `initialize()` 的升级测试。

结论：现有迁移对当前小规模增量可用，但不够支撑后续 schema 演进和备份恢复兼容性。建议 P1 加 schema version 和真实旧库 migration 测试。

### 4. Browser fallback 与 Electron 模式一致性

已有一致性：

- `src/contexts/DataContext.tsx` 通过 `IS_ELECTRON` 分流；Electron 模式按需走 IPC，浏览器模式从 localStorage 初始化 mock 数据。
- tags fallback 和 Electron repository 都复用 `normalizeTag()` / `mergeTagPatch()`，这块一致性较好。
- attachments/AI 在浏览器 fallback 中明确返回 unsupported 或抛 `UnsupportedError`，没有伪装成完整功能。

主要不一致：

- `src/contexts/api/entriesApi.ts:createEntriesApi()` 在 browser fallback 中用 `data.content.length` 计算 `word_count`，而 `electron/database.ts:createEntry()` 用 `(content || '').replace(/\s/g, '').length`。
- `src/contexts/api/pomodoroApi.ts:createPomodoroApi()` 在 browser fallback 中 `addSession()` 返回 `true`，但 `getStats()` / `getStatsRange()` / `getRange()` / `getDailyTotal()` 恒定返回空或 0；这会让 Dashboard、HomeDashboard、Pomodoro 在 browser mode 下无法验证真实学习闭环。
- `src/contexts/api/todayDashboardApi.ts:createTodayDashboardApi()` browser fallback 会算 `riskPoolCount`，但 `pomodoroToday`、`lockedKnowledgeGrowth`、`focusConversionRate`、`streakDays` 都恒定为 0。
- `src/contexts/api/mistakesApi.ts:toggleMastered()` fallback 实际会翻转本地状态，但返回值恒定 `{ mastered: true }`，第二次 toggle 后返回值会和真实状态不一致。
- `DataProvider` 和 `SettingsProvider` 的 browser localStorage 初始化直接 `JSON.parse(raw)`，不像 `AIPanel.loadCachedMessages()` 那样能处理 malformed JSON。

结论：fallback 不是生产主路径，但它已经被测试和浏览器开发依赖。建议明确 fallback contract：要么对不可支持能力显式 unsupported，要么补齐与 Electron 的核心行为一致性。

### 5. AI promptTemplates / sanitizeUserInput 边界

正面结论：

- `src/utils/promptTemplates.ts:sanitizeUserInput()` 会移除 zero-width 字符，替换常见英文 prompt injection pattern 和若干 system/INST 标记。
- `buildDiarySummaryPrompt()`、`buildMistakeAnalysisPrompt()`、`buildMentalMassagePrompt()`、`buildSprintPlanPrompt()`、`buildQuizMePrompt()` 都会 sanitize 模板插入的用户内容。
- `tests/utils.test.ts` 覆盖了 null/empty、zero-width、常见注入片段、system tag 和 jailbreak keyword。

主要风险：

- `src/components/AIPanel.tsx:108-120` 只对当前 `raw` 生成 `textToUse`，但 `appendMessage('user', raw)` 保存的是未净化内容；下一次请求会把 `messages.slice(-6)` 中的旧 raw user message 和 assistant message 原样加入 `chatMessages`。
- `electron/aiService.ts:7-31` 没有对 `messages` 做运行时 schema/长度限制。即使 renderer UI 当前构造了 system prompt，主进程 IPC 仍可收到任意 role/content 数组。
- `src/utils/promptTemplates.ts:117-120` 使用 `m.note`，而 `src/types/index.ts:Mistake` 字段是 `notes`；错题 notes 在 AI 错题分析 prompt 中会被忽略。
- `sanitizeUserInput()` 没有长度上限。长日记、长错题、长历史可能造成 token 成本和请求体膨胀。

结论：这不是“sanitize 函数完全无效”，而是 request history 和主进程 AI IPC 边界还缺闭环。

### 6. Dashboard / HomeDashboard / Pomodoro 重复查询、重复状态、竞态

已有优化：

- `electron/database.ts:getTodayDashboard()` 把首页今日数据聚合在一个主进程函数内。
- `FocusDistributionChart` 已使用 `pomodoro.getStatsRange(start, end)`，避免长范围逐日 `getStats()`。
- `App.tsx:loadEntry()` 已有 `loadRequestId` stale request guard，是这个仓库可以复用的好模式。

主要风险：

- `src/components/Dashboard.tsx:52-90` 的 `loadDashboardData()` 同时拉 `pomodoro.getRange(startWeek,endWeek)`、`pomodoro.getRange('2000-01-01',endWeek)`、`todayDashboard.getData(endWeek)`、`mistakes.getAll({})`、`dashboard.entryDatesRange(...)`。其中 `todayDashboard.getData()` 内部又会查询今日 pomodoro summary 和 streak。
- `src/components/Dashboard.tsx:331` 又挂载 `FocusDistributionChart`，默认再请求一次 `pomodoro.getStatsRange(today,today)`。
- `src/contexts/PomodoroContext.tsx:369-378` 的 `loadTodayStats()` 每次先 `getStats(dateKey)` 再 `getDailyTotal(dateKey)`；`handlePhaseComplete()` 和 `finishStopwatchSession()` 保存后还会再单独 `getDailyTotal()` 更新 alert。
- `src/hooks/useTodayStats.ts:31-47`、`Dashboard.loadDashboardData()`、`FocusDistributionChart.loadData()` 都没有 request id / abort guard。快速刷新、快速切换 range 或组件卸载时，旧 promise 可能覆盖新状态。

结论：当前测试覆盖了“调用次数不爆炸”和刷新信号，但还没有覆盖“旧响应晚到不覆盖新响应”。建议把 stale guard 和 shared refresh contract 作为 P2。

### 7. 测试覆盖关键闭环

现状强项：

- 当前 unit/integration 覆盖面较宽，`npm.cmd test -- --run` 通过 509 项。
- Pomodoro 持久化、暂停、跨本地午夜、时钟跳变、stopwatch 保存等在 `tests/PomodoroContext.test.tsx` 覆盖较充分。
- `tests/backupRestore.test.ts` 覆盖 ZIP path traversal、manifest schemaVersion、media rollback。
- `tests/electronExportHandlers.test.ts` 覆盖 export path 授权和一次性消费。
- `tests/FocusDistributionChart.test.tsx` 覆盖范围统计不退回逐日查询。

关键缺口：

- 缺少主进程 IPC handler 运行时非法 payload 测试，尤其 `ai:chat`、`pomodoro:addSession`、`mistakes:review`、`entries:create/update`。
- 缺少 AI “历史消息重新进入请求前必须 sanitize/裁剪”的回归测试。
- 缺少真实 SQLite 旧 schema 文件升级测试；现有 migration 测试偏 mock SQL 调用。
- 缺少 Dashboard/HomeDashboard/FocusDistributionChart 旧异步响应晚到时不覆盖新状态的测试。
- `DataContext` fallback 测试只验证了 toggle mastered 一次，没有覆盖第二次 toggle 的返回值与存储状态一致性。

### 8. README 与实际功能一致性

以 `main` 已跟踪 README 为基线，存在以下漂移：

- `README.md` 的 AI 文案写“7 大国产供应商一键切换”，而 `src/data/aiProviders.ts:23-98` 实际是 6 个预设供应商加 `custom` 自定义入口。
- `README.md` 的“JSON 全量备份”容易和自动 ZIP 灾备混淆。实际有三类入口：
  - 顶部 `ExportModal` 的 JSON：`src/components/ExportModal.tsx:60-99` 只收集 entries、subjects、mistakes；`src/utils/exportUtils.ts:86-112` payload 也没有 tags、settings、pomodoro。
  - Settings 的 JSON 导出：`src/components/Settings.tsx:181-198` 包含 entries、tags、subjects、mistakes、pomodoro、sanitized settings。
  - 自动 ZIP 灾备：`electron/backup.ts` / `electron/backupRestore.ts` 覆盖 database payload 和媒体目录。
- `src/components/Settings.tsx:221-239` 的 JSON import 入口仍保留“ZIP 当前不能直接导入；后续版本会提供恢复入口”的旧提示，但同文件 `restoreAutomaticBackupZip()` 已提供专用 ZIP 恢复入口。该提示如果用户从 JSON import 入口选择 ZIP，容易误导。

工作区出现的未提交 `README.md` 和 `docs/USER_GUIDE.md` 已经在方向上修正了部分上述问题。建议把这类文档调整作为单独文档 PR 合入，而不是混进 v1.9.7 代码修复。

## GitHub Issue 草案

### Issue 1：为主进程 IPC handler 增加运行时 payload 校验

背景：`electron/preload.ts` 没有暴露裸 IPC，但 `electron/main.ts` 多数 handler 仍直接信任 renderer 传入的类型，例如 `entries:create`、`tags:setEntryTags`、`pomodoro:addSession`、`mistakes:review`、`ai:chat`。

风险：renderer bug 或 XSS/供应链问题一旦进入渲染进程，就能用畸形 payload 写入 SQLite、触发主进程异常、消耗 AI API 或产生不一致数据。

建议修改文件：

- `electron/main.ts`
- `electron/database.ts`
- `src/types/api.ts`
- `tests/electronIpcValidation.test.ts`（新增）

验收标准：

- `ai:chat`、`pomodoro:addSession`、`entries:create/update`、`mistakes:review`、`notification:show` 有主进程运行时 schema 校验。
- 非法 id、非法日期、负 duration、超长字符串、错误 role、非数组 messages 均被拒绝并返回一致错误。
- 保留现有 preload API 形状，不引入新依赖，除非明确证明本地 schema helper 不够。

推荐优先级：P1

### Issue 2：修复 AI 历史消息 sanitize 边界，并给 AI 请求加长度/角色上限

背景：`AIPanel.sendMessage()` 在 `src/components/AIPanel.tsx:108-120` 对当前输入调用 `sanitizeUserInput(raw)`，但 UI/history 保存的是 raw；下一轮 `messages.slice(-6)` 会把历史 raw 内容重新送入 `aiAPI.chat()`。`electron/aiService.ts:20-31` 又会把 messages 原样发给 OpenAI-compatible endpoint。

风险：用户首次发送的 prompt injection 会被当前轮过滤，但可能在下一轮通过历史消息重新进入请求；超长历史也可能造成成本和请求失败。

建议修改文件：

- `src/components/AIPanel.tsx`
- `src/utils/promptTemplates.ts`
- `electron/aiService.ts`
- `tests/AIPanelHistory.test.tsx`
- `tests/utils.test.ts`

验收标准：

- AI 请求中的历史 user message 在进入 `chatMessages` 前再次 sanitize 或保存独立的 sanitized context。
- 主进程 `aiService.chat()` 限制 messages 数量、每条 content 长度、允许 role 集合和 system prompt 数量。
- `buildMistakeAnalysisPrompt()` 正确读取 `Mistake.notes`，并有测试覆盖 notes 被纳入 prompt。
- 超长日记/错题输入会被裁剪并保留可理解提示，不会直接生成无限请求体。

推荐优先级：P1

### Issue 3：引入显式 SQLite schema version 和原子 migration 流程

背景：`electron/database.ts:33` 的 `CURRENT_SCHEMA_VERSION = 1` 与文件内 v2.0/v2.1 migration 注释不一致；`initialize()` 没有使用 `PRAGMA user_version`，迁移步骤也未统一包在一个顶层 transaction 中。

风险：未来 schema 演进、自动 ZIP restore 的 `schemaVersion` 判定、旧库升级失败排查都会变脆；吞异常会掩盖真实 migration 失败。

建议修改文件：

- `electron/database.ts`
- `electron/databaseBackupData.ts`
- `electron/backup.ts`
- `electron/backupRestore.ts`
- `tests/databaseMigration.test.ts`（新增真实临时 DB 测试）

验收标准：

- 使用 `PRAGMA user_version` 记录已完成 schema version。
- 每个 migration 有明确版本号、幂等逻辑和 transaction 边界。
- “列已存在”以显式检查处理，不用宽泛 `catch {}` 吞掉 SQLite 错误。
- 测试用真实临时 SQLite 文件覆盖：旧 tags 表、旧 pomodoro_sessions 无 `date_key`、旧 mistakes 无 SR 字段、重复运行 migration。
- 自动备份 manifest 的 schemaVersion 与 DB schema version 语义一致。

推荐优先级：P1

### Issue 4：分阶段拆分 `electron/database.ts` 的 repository/service 边界

背景：`electron/database.ts` 已有 1082 行，并同时承担连接、schema、migration、多个 repository、AI key 加密、备份导出恢复、错题图片清理等职责。

风险：后续改某个业务闭环时容易误改 migration、备份或图片清理逻辑；review 成本高，测试定位也变慢。

建议修改文件：

- `electron/database.ts`
- `electron/db/connection.ts`（新增）
- `electron/db/migrations.ts`（新增）
- `electron/db/repositories/*.ts`（新增）
- `electron/services/aiKeyStore.ts`（新增）
- `electron/services/mistakeImageCleanupService.ts`（新增）

验收标准：

- 第一阶段只移动代码，不改变 `module.exports` 的外部 API。
- `electron/main.ts` 不需要大规模改调用点。
- 现有 `tests/database.test.ts`、`tests/databaseBackupRestore.test.ts`、`tests/backupRestore.test.ts` 全部通过。
- 拆分后每个 repository 文件职责单一，migration 不再和业务 query 混排。

推荐优先级：P2

### Issue 5：补齐 browser fallback 与 Electron 模式的核心行为一致性

背景：browser fallback 目前有多处和 Electron 行为不同：`entriesApi.create()` 字数统计用 `content.length`，`pomodoroApi` 不保存 session 且统计恒空，`todayDashboardApi` 多个指标恒 0，`mistakesApi.toggleMastered()` 返回值恒 true，localStorage JSON 解析缺少容错。

风险：浏览器开发和 fallback 测试会给出误导性结果，部分 UI bug 只在 Electron 出现，或 fallback 自身出现异常。

建议修改文件：

- `src/contexts/DataContext.tsx`
- `src/contexts/SettingsContext.tsx`
- `src/contexts/api/entriesApi.ts`
- `src/contexts/api/pomodoroApi.ts`
- `src/contexts/api/todayDashboardApi.ts`
- `src/contexts/api/mistakesApi.ts`
- `tests/DataContext.test.tsx`
- `tests/SettingsContext.test.tsx`

验收标准：

- browser fallback 的 entry `word_count` 与 `electron/database.ts:createEntry()` 一致。
- malformed localStorage 不会使 provider 崩溃，会落到默认数据并记录 `initErrors` 或明确日志。
- `toggleMastered()` 连续调用两次时，返回值、localStorage、`getAll()` 三者一致。
- Pomodoro fallback 要么真正持久化 sessions 并能驱动 `getDailyTotal/getRange/todayDashboard`，要么明确返回 unsupported，不再静默返回成功但统计恒空。

推荐优先级：P2

### Issue 6：为 Dashboard/HomeDashboard/FocusDistributionChart/Pomodoro 刷新流加 stale-response guard

背景：`App.tsx:loadEntry()` 已用 request id 防止旧请求覆盖新状态；但 `useTodayStats.refresh()`、`Dashboard.loadDashboardData()`、`FocusDistributionChart.loadData()`、`PomodoroContext.loadTodayStats()` 没有同等保护。Dashboard 同时触发多组聚合查询，Pomodoro 保存后也会多次刷新今日统计。

风险：快速切换日期范围、快速触发 refresh、组件卸载后旧 promise 可能覆盖新状态；同时重复 IPC 也让统计链路更难定位性能问题。

建议修改文件：

- `src/hooks/useTodayStats.ts`
- `src/components/Dashboard.tsx`
- `src/components/FocusDistributionChart.tsx`
- `src/contexts/PomodoroContext.tsx`
- `tests/useTodayStats.test.ts`
- `tests/Dashboard.test.tsx`
- `tests/FocusDistributionChart.test.tsx`
- `tests/PomodoroContext.test.tsx`

验收标准：

- 每个异步加载器都有 request id、abort signal 或 mounted guard，旧响应晚到不会覆盖新数据。
- Dashboard 首页和统计页共享一个明确的 refresh contract，保存 Pomodoro / 复习错题后只触发必要刷新。
- 测试模拟“第一次请求慢、第二次请求快”，断言最终状态来自第二次请求。
- 保留 v1.9.6 的 `getStatsRange()` 范围查询优化，不退回逐日查询。

推荐优先级：P2

### Issue 7：为 Dashboard 相关 SQLite query 增加索引/查询计划保护

背景：`electron/database.ts:getStudyStreak()` 会读取 entries 和 pomodoro_sessions 的所有 distinct date；`getTodayDashboard()` 中 `DATE(updated_at)` 参与 locked/action 统计；`getAllMistakes()`、`getDueForReviewCount()`、`getRandomDueMistake()` 依赖 mastered、next_review_date、subject_id 过滤。

风险：数据量增长后，首页和统计页可能成为启动/切页瓶颈；函数包裹列如 `DATE(updated_at)` 也可能让索引无法生效。

建议修改文件：

- `electron/database.ts`
- `tests/database.test.ts`
- `tests/databaseMigration.test.ts`（如 Issue 3 创建）

验收标准：

- 为 due-review 查询、mistake updated_at/date 查询、pomodoro date_key+subject 聚合增加必要索引或改写查询。
- 对关键 query 增加最小 explain/SQL shape 回归测试，确认没有回到逐日 N+1。
- 不改变 `getTodayDashboard()`、`getStudyStreak()`、`getPomodoroStatsRange()` 的返回契约。

推荐优先级：P2

### Issue 8：补齐关键闭环测试缺口

背景：现有测试数量充足且全量通过，但仍缺少主进程 IPC payload、AI 历史 sanitize、真实 DB migration、Dashboard stale response、ZIP 恢复 UI 闭环等测试。

风险：安全边界和迁移类问题容易在单元测试绿灯下漏掉，v1.9.x 的功能闭环越多，这类盲区越影响 release confidence。

建议修改文件：

- `tests/electronIpcValidation.test.ts`（新增）
- `tests/databaseMigration.test.ts`（新增）
- `tests/AIPanelHistory.test.tsx`
- `tests/DataContext.test.tsx`
- `tests/Dashboard.test.tsx`
- `tests/FocusDistributionChart.test.tsx`
- `tests/e2e/settings-persistence.spec.ts` 或新增 ZIP restore e2e

验收标准：

- 至少覆盖一条 main-process IPC 非法 payload 拒绝路径。
- 覆盖 AI 历史消息不会绕过 sanitize。
- 覆盖真实旧 SQLite schema 升级到当前 schema。
- 覆盖 Dashboard/FocusDistributionChart stale response 不覆盖新状态。
- 覆盖 browser fallback 连续 toggle 和 malformed localStorage。

推荐优先级：P2

### Issue 9：合入并校准 README / 用户指南 / 备份恢复文案

背景：`main` README 中 AI provider 数量、JSON 全量备份、自动 ZIP 恢复边界有漂移；工作区未提交的 `README.md` 和 `docs/USER_GUIDE.md` 看起来已在修正方向上推进，但尚未成为 main 的一部分。`src/components/Settings.tsx:221-239` 的 JSON import ZIP 提示仍是历史 wording。

风险：用户把 ExportModal JSON、Settings JSON 合并导入、自动 ZIP 灾备恢复混为一谈；AI provider 数量和实际 `AI_PROVIDERS` 不一致会降低文档可信度。

建议修改文件：

- `README.md`
- `docs/USER_GUIDE.md`
- `src/components/Settings.tsx`
- `src/components/ExportModal.tsx`
- `src/utils/exportUtils.ts`
- `src/data/aiProviders.ts`

验收标准：

- README 明确区分：顶部 PDF/Markdown/JSON 导出、Settings JSON 备份/合并导入、自动 ZIP 灾备恢复。
- provider 文案与 `AI_PROVIDERS` 实际列表一致：预设供应商数量和 `custom` 入口不混称。
- JSON import 入口选择 ZIP 时提示用户使用“从 ZIP 恢复”入口，而不是说后续版本才支持。
- 用户指南只描述当前已实现功能，不承诺不存在的恢复/导出能力。

推荐优先级：P3
