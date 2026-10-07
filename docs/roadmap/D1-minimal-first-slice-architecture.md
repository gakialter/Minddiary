# D1.2 Minimal First Slice Architecture & Verification Design

## Status

**D1.2 Parent Gate：PASS WITH ONE REQUIRED NARROWING；restriction 持久化 scope 已按 Parent 要求收紧，D1.2 正式锁定。** 未实现、未运行 candidate eval、未通过产品 Gate。用户已明确给定 `D0 = COMPLETE`、`D1.1 = Parent accepted`，接受本架构并说明完成该项收紧后无需整份重审。旧 roadmap / D1.1 的“D1 not started / 未开始 D1.2”是交付时状态，不覆盖本次授权，也不回写这些输入。

本文选择：**在现有 AIPanel 数据流前增加一个小的证据协调层，renderer 管澄清与展示，trusted main 管固定查询、会话有效性与出站投影。** 场景 3 完全本地回答；场景 2 先本地澄清、再一次预定取证；场景 9 零日记访问，撤回时建立新的安全对话边界，旧历史仅显示，旧快照作废。Schema 8 不变，tool calling 明确不采用。

文中的接口、查询、文件名均为未来实现设计，代码块不是已经存在的能力。本次唯一交付文件为本文；完成 Parent 要求的单项收紧后停止，不启动 D1.3、D2 或 D3。

## Baseline

- 核对日期：2026-09-25，Asia/Singapore；分支 `main`。
- `HEAD`、local `main`、local `origin/main`、实时 `git ls-remote origin refs/heads/main` 均为 **`87fef52eba451a38226b4e04e701d79c431eddfe`**。没有 fetch、切分支或更新引用。
- 已有修改：`AGENTS.md`、roadmap；已有未跟踪：D0.1–D0.4、D1.1、`output/`。全部保留，不读取 `output/` 或真实学习数据库。
- 产品代码依据当前 checkout；规范和研究依据当前工作区。源码静态核对不等于运行 enforcement。D1.1 synthetic 结果作为已接受输入继承，本次没有重跑或升级其证据等级。

## Accepted Inputs

已读取 [AGENTS](../../AGENTS.md)、[AI contracts](../agents/ai-contracts.md)、[roadmap](minddiary-ai-study-agent-roadmap.md)、[D0.1](D0-learner-experience-scenarios.md)、[D0.2](D0-evidence-retrieval-model.md)、[D0.3](D0-access-disclosure-boundaries.md)、[D0.4](D0-minimum-product-capability-eval-baseline.md)、[D1.1](D1-current-baseline-minimal-design-boundary.md)，并核对 [Electron](../agents/electron-boundaries.md) 与 [persistence](../agents/persistence.md) 边界。读取聚焦于本设计所需路径，没有全仓审计。

| 已接受事实 | 本文的设计后果 |
| --- | --- |
| S3 Direct UI 已显示 2/3 和下一章，Provider 0；从 AI 起点一次入口切换；页面附带其他学习类别读取 | 保留最强对照；目标是 Chat 精确事实入口，不声称胜过 Direct UI 或需要更聪明模型 |
| S3 ordinary Chat 无当前章节；最窄 Quick Prompt 仍宽读宽发，章节完整对象含 notes | 新查询必须在 repository 就窄化，不能复用 overview 再裁剪 |
| S2 现有图表可得到数学两期 70/140；需要切日期、记数值、回 Chat 手输 | 主要收益假设是减少正确证据准备成本，固定科目、日期、记录分钟口径 |
| S2 ordinary Chat 已能接收相同证据；真实模型质量未测 | 不宣称模型能力不足；后续保留同证据普通 Chat 对照 |
| S9 synthetic 已复现撤回后旧 assistant diary canary 继续发送，最新快照 regenerate 也继续发送 | 不能只禁止新查询；撤回轮本身、后续轮、重放和晚到结果都要失效处理 |
| current observability 不足以证明全链 hard invariants | 用 repository/IPC/fetch 边界实测；metadata 自报不算零违规证明 |

保留 D0.2 C1–C5；特别是 focus 不等于效率，章节标记不等于理解，当前 task done 不等于当期完成事件。D0.1 中 optional adaptive/task/diary 路线不是本版需求；以最新收敛范围为准。

## Current Data Flow

以下为当前代码，不是候选架构：

```text
user / Quick Prompt → useAIComposer（草稿、Context kinds、附件）
  → AIPanel.sendMessage
  → buildAIContextSections（可直接使用已加载 entry/settings 或调用学习 API）
  → buildAIConversation（system + 最近六条 visible text + 当前消息/Context/附件）
  → createAiApi.chat → preload ai.chat → main ai:chat 校验
  → aiService.chat → validateAiRequestMessages → 配置/凭据 → JSON body → fetch

localStorage visible history → AIPanel messages → history.slice(-6) → request
lastRequestRef.requestMessages → regenerateLastAnswer → aiAPI.chat 原样重发

React → DiaryContext / API context → preload → IPC → database forwarding
  → Electron repository → SQLite
```

| 现有节点 / 源码锚点 | 当前行为与最小 seam |
| --- | --- |
| [AIPanel](../../src/components/AIPanel.tsx)：sendMessage / regenerateLastAnswer / loadCachedMessages | build Context 在任何场景澄清前；这里接入本地 gate，先处理拒绝，再决定是否允许 builder 执行。所有 AIPanel send/regenerate 共用同一会话边界 |
| [Context builder](../../src/utils/aiContextBuilder.ts)：buildStudyOverviewContext | subjects.getAll + tasks.getByDate + pomodoro.getRange，再取每科章节；focus catch→[]。保留旧 builder 给其原范围，First Slice 不调用它获取窄事实 |
| [Conversation builder](../../src/utils/aiConversationBuilder.ts)：buildAIConversation | 历史只有 role/content；slice(-6) 不是来源过滤。改为先选择可复用历史、再调用现有格式化/长度校验 |
| [AI API](../../src/contexts/api/aiApi.ts)、[preload](../../electron/preload.ts)、[main](../../electron/main.ts) | ai:chat 当前接受校验后的 messages；新增小的 AIPanel 受控入口，不把 renderer 自报的 evidence/epoch 当 trusted 事实 |
| [AI service](../../electron/aiService.ts)：createAiService | main 独占凭据/网络，fetchImpl 可注入；保留 adapter 与参数，只为受控发送增加最终有效性回调 seam |
| [subjects](../../electron/repositories/subjectsRepository.ts)、[chapters](../../electron/repositories/subjectChaptersRepository.ts)、[focus](../../electron/repositories/pomodoroRepository.ts) | 当前 SELECT * / 跨科统计不能实现窄访问；在这三个现有仓储增加专用只读 projection method |
| [API types](../../src/types/api.ts)、[database forwarding](../../electron/database.ts) | 延续 typed preload / repository 转发，不另建数据访问框架 |

AIPanel 的 generationRef 能阻止取消后的部分 UI 更新，entry 漂移也有失效逻辑；它没有撤回 epoch，也不阻止已经开始的 main fetch。历史存于 `minddiary.ai.chatHistory`，含文本、contextLabels、附件元数据；快照仅内存。contextLabels 不能证明 assistant 的来源。browser fallback 的全数组 filter 不能冒充 Electron 窄访问；候选 evidence 能力在 browser 返回 unavailable，不偷偷全读。

## Design Goals

六个边界共同兑现：repository 精确访问；歧义先于记录；交接保留语义/coverage/failure/unknown/stop；local access 与 disclosure 独立；撤回阻断混合历史及派生复用；实际执行可观察。五项产品能力仍是 D0.4 的 A–E，不增第六项产品能力。

优先缩小结论和输入，而非扩查询。一次 evidence batch 是预先固定的一组窄查询，不是一次函数调用掩盖全库读取。已有本次有效证据足够时零新增读取；旧 assistant 文本不等于当前事实。

## Non-goals

**Adaptive Retrieval = No；Specialized Workflow Migration = No。** 无 Agent Runtime、Agent Loop、Tool Registry、tool calling、DataGrant 平台、permission UI、Provider adapter rewrite、streaming、RAG、FTS、embedding、MCP、subagent/multi-agent、provenance database、Planning History 扩展或 SQLite migration。不新增聊天写入学习记录，不新增效率/任务历史事件模型，不构造通用检索/通用 Result 框架。D5 不预建设。

## Architecture Options

### Option A

扩展当前 Context builder：在其内部识别问句、读取、裁剪。名义上新文件最少，但其结果直接服务 Provider context；难以表达先澄清、零 Provider 本地答案和历史失效。为补齐这些边界，最终仍须在 AIPanel、main、history 添加判断，隐含复杂度与隐私风险较高。回滚容易恢复旧行为，却也恢复已知泄露。

### Option B

在 Context builder 前引入小的 evidence coordination，分成 renderer 交互函数和 trusted main handler；固定 Evidence Request → Envelope → local answer / disclosure projection。只把必要查询添到现有仓储。history/epoch 是这两端的小状态，不再建 Session Store 或 Policy Engine。新增概念少，但必须正面处理 IPC 与发送时有效性。

### Option C

每场景独立分支：S3 函数、S2 函数、S9 filter。最早原型代码可能最少，但三者共享拒绝、失败、send/regenerate、reload；分别实现容易有一条旁路遗漏。隐私验证需逐分支重复；回滚单个分支可能破坏其他分支的来源承诺。

| 维度 | A | B | C |
| --- | --- | --- | --- |
| Complexity | 小改动表象，职责继续耦合 | 两个小模块、两个固定 evidence variants、一个会话边界 | 初期小，失效分支重复 |
| Blast radius | builder 同时承担交互/隐私 | AIPanel 窄入口 + 三仓储只读方法 + IPC wiring | AIPanel 条件逐场景扩张 |
| Testability | 很难单独断言读与发 | 固定 SQL、envelope、fetch 分别可测 | 主路径易测，交叉撤回易漏 |
| Privacy | 仍偏出站裁剪 | 读前、发前、复用前分别检查 | 多个局部 gate 难保持一致 |
| Compatibility / rollback | 可能改变全部 Context 构建 | 旧 builder/workflows 保留；事实入口可独立关闭 | 单项关闭有交叉状态风险 |
| Optional D5 | 需要另审设计 | 可复用证据语义，不预设工具协议 | 后续也需另审，不是自动升级理由 |

**选择 B。** A/C 若要达到同样的撤回及读/发分离保证，仍需 B 所表达的共同边界。选择理由是当前必要职责可分开验证，不是“分层越多越先进”。

## Selected Architecture

```text
AIPanel（原会话 UI / composer）
  → 本地 classify / clarify / refusal gate（不接收日记 prop / 学习集合）
  → 未明确：本地澄清或有限回答 → stop
  → 明确：typed request → preload / main validation
      → main 按当前会话限制决定是否读
      → 固定 repository projections → Evidence Envelope
          → S3 本地 factual answer → stop
          → S2 本地记录比较 → 可选、已允许的 Provider 解释
      → 独立 disclosure projection + 可复用历史选择
      → existing conversation formatting / request policy
      → aiService（fetch 前再核 epoch / destination / validity）→ Provider
```

选择**两端各一小层**。renderer 的本地交互不需要 Provider 或学习记录来判断缺什么；main 才拥有 SQLite、实际 Provider 配置与最终出站时序。只放 renderer 无法建立可信查询/发前边界；只放 main 会把草稿/UI 对话状态搬进进程服务而无必要。

三个必要概念：① 两种固定请求及其 evidence envelope；② 独立出站投影；③ AIPanel 会话安全边界（epoch、拒绝类别、请求来源与失效）。后两者都是函数/小状态，不各自建立平台模块。

main 为该窗口的 AIPanel 创建内存会话标识；requestId、epoch、证据来源由 main 生成。IPC 验证 sender、会话归属、请求 variant、日期、对象引用和状态；renderer 不能提交任意 SQL、列名、预先算好的可信 evidence，或靠自增 epoch 复活旧请求。撤回更新可在普通生成被 loading 禁用时单独处理；不能等当前回答完成才接受撤回。

受控发送的输入是当前用户文本、明确选定且通过限制检查的本次材料以及 main 发出的 request handle，**不接受 renderer 提交整份 visible history 或旧 raw snapshot**。main 从自己本会话保留的有限合格消息组装 history，assistant 来源继承实际已发送 request；renderer 的存储文本不能冒充这些引用。legacy 手动材料在当前边界内可发送，但不明来源保守标为 unknown；有来源限制且无法证明可分离时整份材料停止使用。旧 ai.chat 接口保留给现有独立调用者，AIPanel 新路径不得同时保留一条 raw resend fallback。

普通 Chat / Quick Prompt 在 AIPanel 内也经过相同的拒绝、history、快照门口，不能通过“非 First Slice”分支重发旧 diary。专用规划器继续原接口/确认链，不在本设计中迁移。此边界覆盖受支持 AIPanel 路由及新 privileged evidence IPC；不是声称任意已被攻陷的 renderer、所有旧应用 API 已由本版变成沙箱。测试必须暴露旧 raw ai.chat 被 AIPanel 意外绕用的旁路。

## Evidence Request Model

**需要 typed internal contract，但只有两个固定 variants。** 放入现有 API types；main 做运行时校验，TypeScript 不能替代它。

| 内容 | subject_progress | focus_comparison |
| --- | --- | --- |
| purpose / semantics | 当前科目章节标记 / chapter_marks | 两期记录投入 / recorded_focus_minutes |
| subject | 已确认 subjectId；仅身份待解析时携带用户明确的 exactName | 同左；meaning 和两期已明确之前不能开始身份 lookup |
| period | 当前读取时的记录状态，无历史进度承诺 | A/B 的 startDate、endDate，包含首尾，按 date_key |
| fields | 固定 identity + title/order/completed；条件性 aggregate fallback | 固定 identity + date_key/subject_id/duration 的聚合与 coverage |
| exclusions | notes、task、focus、diary、mistakes、其他科目 | task、chapters、diary、mistakes、其他科目及无归属记录 |

purpose、semantics、fields 是 variant 决定的常量，不是客户端自由传字段数组。业务请求只需 kind、subject 引用/明确名称、S2 的两个日期区间；requestId/epoch 由会话包裹，不重复塞进业务模型。不含 tool 名称、后续动作、任意 filter、模型评分或 grant 对象。

澄清中的 intent（meaning/subject/periods 的已知与缺失）不是 Evidence Request，不允许调用 resolver。日期含糊、非法/倒置、重叠却声称独立比较等情况先说明或澄清，不静默换成最近七天。连续日期以本地日历解析，不用简单毫秒减法假定用户日期含义。

身份解析的固定第一步：只按已给 id 查 id/name，或 `WHERE name = ?` 查匹配的 id/name；不取 getAll、不模糊匹配、不沿别名读其他记录。唯一命中直接继续；多个同名仅返回身份候选，不读任一章节/focus，用户选择后再继续。无法凭名称辨认时让用户在原科目界面确认对象，不拿 notes 或任务区分。身份 lookup 算 access，不能从零读统计里消失；S2 ambiguity gate 必须在它之前。SQL 条件匹配面与物理页扫描另见 Observability。

## Local Evidence Projection

选择**现有 repositories 新增 dedicated projection query methods**，不复用完整对象 API、不建 selector 后置裁剪。

| Projection | 查询在 trusted repository 的逻辑范围 | 结果与停止 |
| --- | --- | --- |
| identity | subjects 的 id/name；id 等值或用户明确名称等值匹配 | 无命中 unavailable/deleted；重名 ask，不继续；不查 color/进度等无关字段 |
| chapter detail | subject_chapters `WHERE subject_id = ?`；SELECT title, sort_order, completed；ORDER BY sort_order,id | id 仅作稳定排序的内部必要字段，必须记入访问清单；明细计算 completed/total 与第一未完成项，Provider 不接收 id |
| aggregate fallback | **只有明细查询成功且零行**，按同一 id SELECT total_chapters,completed_chapters | 原设计允许没有明细但保留汇总；只报告数量，不猜下一章；不是捕获 SQL error 后冒充 fallback |
| focus A/B | pomodoro_sessions `WHERE subject_id = ? AND date_key BETWEEN ? AND ?`，每期聚合 SUM(duration)、COUNT(*)、COUNT(DISTINCT date_key)、MIN/MAX(date_key) | 同一预定批次中的两期独立状态；不 JOIN task，不按科目名跨 id 合并，不加载完整 session |

章节明细全空与汇总 0/0 是“没有可用章节记录”，不说“全部学完”；存在明细则以明细为准，不再为双重佐证查询 aggregate。章节查询失败为 failed；详情在当前能力不可提供时为 unavailable。fallback 是固定计划的可用性分支，不是模型看结果后补找另一来源。

focus 仅读匹配目标科目/日期的 duration、date_key、subject_id；COUNT(*) 不需要额外读取 task_id、started_at、completed_at 或自由文本。两期查询都在开始前确定；某期 failed 不重试、不扩期、不读取 task 补数。已得到的另一期间可有限展示，并标整体 partial；不能计算缺失一期的差值。

**无归属处理决定：排除且数量未知，不为说明 unknown 去查询全科或 NULL 集合。** coverage 写 `unassigned = excluded_not_measured`；它不表示库中存在/不存在无归属记录。F2 中已知 fixture 另有未分类分钟，也不能把那部分并入数学，或为了评测好看偷带其数量。必要时用户自行提供独立数值是新的自述证据。

查询发生于同一短只读快照，避免章节与汇总交错修改；不得调用章节 syncSubjectSummary 等写入方法。固定两期不是历史任务完成查询，**task current state 不取**。完整 logical fields/WHERE/ORDER/GROUP 表面均纳入验证；SQLite 读包含其他列的物理页不被宣称为可由应用保证的列级磁盘隔离。

## Evidence Envelope

只为上述两种事实设计一个交接结构，不建通用事件系统：

| 字段 | 最小含义 |
| --- | --- |
| value | 进度数量/next title 或每期 recordedMinutes；不可用值为 null，不填 0 |
| scope | subjectId/name、所请求/实际观察的日期范围；当前进度带 observedAt |
| semantics | chapter_marks 或 recorded_focus_minutes；固定单位和可支持结论 |
| coverage | 查询是否完整、detail/aggregate_only、有记录日数及首尾、无归属 excluded_not_measured、现实学习覆盖 unknown |
| status | ok / empty / partial / unavailable / failed；每期保留自己的状态 |
| sourceCategory | subject_progress / focus_comparison；用户自述单独标 user_message，不能冒充库证据 |

main 另在 request 内保存 requestId/epoch/有效性引用；envelope 不携带凭据、全文历史、原始错误堆栈或权限。stopReason 是协调结果（enough / ask_user / denied / insufficient / read_failed / invalidated / unsupported），不把 denied/revoked 混成 empty。

例：数学 A 2026-09-07..13，value=70 minutes，coverage=已记录且有数学归属的 sessions、7 个有记录日、现实覆盖未知，status=ok。若 SQL 抛错：value=null，status=failed，stopReason=read_failed。7 个有记录日也不能证明七天全部学习都记下了。

## Clarification Gate

| 方向 | 判断 |
| --- | --- |
| A：模型只看当前消息澄清 | 可以不读记录，但仍增加 Provider 披露/调用；结构化 slots 还需本地验证，拒绝与含义不能依赖模型可靠性 |
| B：本地 deterministic rules | 零 Provider、易证明读前 gate；语言覆盖有限，未识别就有限答/问，不猜 |
| C：hybrid | 为首版引入模型失败、双路径状态和更多验证，尚无收益证据 |

**选择 B。** 使用当前用户消息和本次已确认的少量 slots；不使用旧 assistant、diary entry prop、全科列表猜意图。S2 先明确是 recorded study time / 投入、科目、两期；缺任何一项先本地问缺项。给出已知项后不重复问；用户选理解/原因/启动困难，走零记录自述帮助，不能将其归一成 minutes。

识别顺序固定：明确拒绝/撤回 → 已在进行的澄清 → 窄进度/投入问题 → 普通知识/自述。对可能含记录使用限制但不能可靠解释的消息，暂停 Context 和历史出站，先本地澄清；不把未知语句当同意。规则支持范围必须用 paraphrase/否定/引用文本 fixture 明确验证，不能声称任意自然语言都已理解。

S2 的 ambiguous branch 即使残留 overview/reflection chip，也**不调用**任何学习 API、identity lookup 或 Context builder；不遍历已加载学习对象。未答则有限说明后 stop。关闭这一 gate 并退回自动宽 Context 不属于失败降级。

## Local Answer vs Provider Answer

| S3 选择 | 评价 |
| --- | --- |
| A：fully local factual response | 正确标记、next chapter 可本地确定，0 Provider、无需披露，语言简单足够 |
| B：minimal evidence 给 Provider | 只改善表述，增加无必要的出站与失败面 |
| C：本地事实 + 用户要求时模型解释 | 可作为未来独立请求；若首版自动接续仍增加状态和披露 |

**S3 选择 A，整个进度回答 Provider = 0。** 例如“记录里你已标完成 2/3，下一未标完成章节是第3章；这不代表理解程度。”只显示所问必要事实后 stop。aggregate_only 不编章节标题。本地回答也不能自动作为下一轮云端历史；它的 disclosure 默认关闭。

S2 同样先本地确定两期记录分钟及有限比较。用户只要数值时本地结束；明确要自然语言建议且允许相应事实发给当前 Provider 时，走一次普通文本解释路径，不由模型继续取证。所有事实数值/口径在本地固定结果中展示；模型解释作为可能建议，不作为新的 evidence。模型的语义合规还须真实 eval，架构本身不能证明生成文本不会误说效率。

S9 可仅用当前自述请求 Provider；如果全部出站被拒绝，则本地说明边界并给确定性的小步起始帮助/原功能入口，不伪造离线模型。

## Disclosure Projection

**Evidence acquisition 不调用 aiService。** main 内保存 evidence；给 renderer 返回本地展示结果及不含隐私正文的 request handle。Provider 分支由另一个明确的发送决定构造允许子集，而不是把本地对象整体 stringify。

| 内容 | 本地对象 | Provider-visible subset |
| --- | --- | --- |
| S3 | 指定身份、章节顺序/标记、必要标题、coverage | 默认无，整个事实回答不发；后续若明确分享该事实，作为独立有范围的发送决定 |
| S2 | id/name、两期 query 状态、日期、分钟、coverage、有效性 | 明确允许后仅科目名、两期日期/分钟/记录口径及必要 coverage/unknown；不发 id、逐 session、时刻、SQL/错误栈 |
| S9 | 当前自述、拒绝状态；零 diary evidence | 仅当前允许自述与通用建议请求；不发旧混合文字、diary 标题/日期/心情/统计 |
| 共通 | epoch/requestId/deny state/审计 metadata | 不作为模型学习上下文；UI 可说明排除了哪些类别，不必把拒绝历史/技术标识都发模型 |

发送决定绑定 normalized endpoint + model/config revision（main 当前配置，绝不把 key 下发）。用户应能在现有 Chat 中理解“本机已查什么；准备把哪份摘要发给哪个 Provider；哪些没有用”。本地查询授权不能推导出站授权；**local allowed + disclosure denied** 只返回本地结果，不发送标题、日期、命中信息或合计。

不新建 permission dialog。当前对话里用户已明确的限定分享意图即可成立；缺失时先交付本地结果，用户主动要求分享/解释再明确所发子集。拒绝之后不反复邀请开启；改 Provider 后原发送决定失效，说明新去向后才可形成新的决定。

最后校验位于 service 的实际 fetch 前：比对会话 epoch、取消状态、当前目的地和 request 有效性，且从检查到调用 fetch 之间无 await。网络准备中若发生撤回，未开始的 fetch 必须被阻止；已经开始只可声明可能已发送。response 返回后 main 和 renderer 都检查 epoch，晚到结果不显示成新的有效答案、不存入新快照/历史依据。保留当前 timeout/网络错误行为，不为此重写 adapter 或新增自动重试。

记录有效性选择保守失效：main 给 evidence 绑定数据库连接代次、本地数据变更代次与观察日。在现有 database forwarding 的科目/章节/focus 写入及导入/恢复完成处使相关待发送 evidence 失效；连接更换全部失效，外部连接变更用 SQLite data_version 变化判失效。发前/结果采纳前核对，变化即 stop，不重查补救。因此没有第二次取证，也不会在删除来源后继续发待发送旧事实。它是内存计数/标记与失效判断，不是事件总线、记录版本列或后台轮询；无法可靠取得变更标记时该 evidence 不可延后发送，只保留本地已观察结果。无关变更导致的保守失效可以接受，不能靠忽略已知漂移保连续性。

## Revocation-safe Conversation

| 方案 | 取舍 |
| --- | --- |
| A：受影响 whole-message drop | 有完整 message lineage 才能安全保留其他旧消息；历史和 legacy 来源缺失时须保守多删 |
| B：重建 safe summary | summary 本身需 lineage，可能混入旧来源，增加模型调用与持久记忆倾向；不选 |
| C：source-aware segments | 逐段可信来源难验证，UI/存储变更大；不选 |
| D：撤回后从新安全边界开始 | 丢一些连续性，但不需要拆混合消息；旧历史显示不受损；**选择** |

**具体决定比“只不发 assistant”更保守：任何来源使用撤回/披露收紧，整个撤回前的 user+assistant 会话前缀都不再复用。** 旧 user 也可能复制 diary；只删 assistant 不能保证安全。epoch 增加，旧 request/evidence/草稿依赖和全部 regenerate snapshots 作废；旧来源不得当下一次检索提示或建议排序依据。只保留撤回消息中的独立当前自述、后续新自述以及新范围下重新取得的有效证据。

先执行撤回、再构建该轮回复，因此**撤回轮自身**不能先带旧历史去请模型“忽略”。本地确认一句后，可直接基于当前自述继续；不把整段旧混合内容拿来总结或去敏。缺必要事实时说明可由用户自愿补充，不为了保留 task25 分钟而从混合 diary 回答拆字。

Independent allowed task/self-report 仍可使用：用户本轮独立提供“任务估时25分钟”即标自述；当前安全 epoch 中已知独立自述可继续。旧混合消息里的 task 字符串不保留。首版不新增任务查询能力，若用户需要当前任务核对，指向现有任务界面或由其主动给出事实；不以换成 task.title 绕过 diary 拒绝。

Quick Prompt 模板/chip 不是覆盖撤回的授权。S9 有 diary 拒绝时，current-diary/recent-reflection 在 builder 之前被排除；不会读取已加载 entry 正文或用 mood 替代。未知来源的已准备 legacy Context/附件整个作废。对不受影响、范围明确的新手动 Context 仍可沿原路径，但若它的宽读取不能符合当前限制，停用该 Context，继续零记录帮助。

## Regenerate Semantics

选择 **invalidate → regenerate unavailable**，不自动重建旧请求。重建须重新判断用户目的、证据有效性、附件与范围，复杂度远大于让用户发起新问题。

所有 AIPanel 快照绑定 requestId/epoch/destination；旧 raw requestMessages 不能自己获得发送权。撤回、取消、目的地改变、reload、已知来源变化/删除均失效；main 拒绝旧 handle，即使 UI 按钮尚未刷新。撤回之后新请求成功，产生的是新边界内的 snapshot，不包含任何旧前缀。

S3 local answer 不提供模型 regenerate；S2 使用当前数据库 evidence 的 Provider 解释也不长期保留可重放事实快照，回答完成后再次核对须新用户请求。这避免跨日/外部修改后把旧数值作为当前记录。普通自述/手动 Context 的会话快照可按现有用途保留，但任何收紧或已知漂移即作废；来源有效性不明时禁用，不自动再次读取来“修复”快照。

## Derived Material Handling

| 用途 | 撤回后行为 |
| --- | --- |
| UI historical display | 可继续显示旧文本，明确旧边界历史仅供查看；不删除、不改写来掩盖曾披露事实 |
| Provider history | 撤回前所有消息不发送，不仅被识别的 diary 句子 |
| Later evidence / suggestion ranking | 不使用旧回答、摘要、envelope 或旧建议优先级；依独立当前材料重新形成有限帮助 |
| Regenerate | 旧快照失效，不重建、不重放 |
| 本地搜索提示 / locator | 不允许用旧日期、主题、canary、旧归因引导查询；首版没有搜索扩展 |
| 已创建任务 / 回执 / Planning History | 不删除、不回滚；不成为本版证据来源，来源拒绝不等于动作撤销 |

允许保存历史不表示保留 evidence 资格；UI 收藏/复制历史也不能由程序自动当作重新授权。用户主动独立重述事实是新的自述，不能通过引导其复读旧 diary 来洗成许可。

## Minimum Source Lineage

**不做 segment 或 graph；需要 evidence-level category/scope，加 request-level 来源并集与 epoch；message 只需关联其 request/epoch 与可复用性。** request-level 单独不足以描述 S2 两期 failure/coverage；message-level 单独不足以拦截未发送快照或晚到请求。

- evidence：由固定 resolver 标记 subject_progress / focus_comparison，日期/对象、状态、观察时间。非模型生成。
- request：sources 是实际纳入的 evidence、current user material 和可复用历史来源的保守并集；assistant 的 dependencies 继承整个 request，并沿当前 epoch 的历史传递，不按输出里是否看见 canary 猜来源。
- message：本次 session 的 message → request 引用；用户新文本来源为 user_message，但引用旧不明来源材料时保守 unknown。legacy 手动 Context 映射到 diary/mistakes/study_overview/attachments 等类别；无法证实时 unknown，不默认为 clean。
- S3 的本地结果也关联 evidence request，默认 display-only，不能被普通 history.slice(-6) 自动披露。S2 的记录事实只在本次回答有效；后续 current-state 问句需新明确请求或说明未知，不能把旧 assistant 当证据。

**Lineage 不持久化。** main 只保留当前活动请求、必要的有限历史引用与一个有效快照，随会话销毁；不建 provenance DB，不把 raw prompt 长期写审计。AIPanel 现有 localStorage history 格式可继续保存展示文本；reload 后全部恢复消息默认 display-only / unknown，不能恢复 Provider history、evidence、允许范围或 snapshot。告知从新上下文继续，保留旧记录可见性。

**Restriction 本身必须保留原始 scope；只有明确的 durable preference 才写入 settings。** 拒绝不能因 reload 被视为同意，短期拒绝也不能被升级成永久全局偏好。按用户表达保留 object、time、field、purpose、session、destination 的适用限定，以及拒绝的是本地/派生使用还是出站；未明确的维度不自动扩大。

| 用户表达的范围 | 有效性与持久化决定 |
| --- | --- |
| 当前请求，如“这次别把我的日记发出去” | request-scoped refusal 只约束该请求及其重放，不扩大为本地读取拒绝、其他请求限制或永久类别 block；在内存维护，不写 durable settings |
| 当前会话安全边界，如“接下来这段不要用日记” | session-scoped refusal 只约束该段会话；purpose/object/provider 限定按原表达保留，不扩大为永久全局 category block；在内存维护，不写 durable settings |
| 一次性全部出站拒绝，如“这次别发给 AI” | 仅当前 scope 的 all-outbound；不得写成永久开关，不自动禁止新的无关聊天 |
| 明确长期 / 默认偏好，如“以后默认不要把日记发给这个 Provider” | 可用现有 settings 保存最小 restriction preference，但必须保留 diary、disclosure、指定 destination 和默认适用范围，不扩大到全部 Provider 或本地使用 |
| 范围/期限含糊 | 暂停可能冲突的使用，必要时本地澄清；不能推断为永久或全局偏好 |

durable preference 由 main 验证并保存，不含原文、历史、凭据、证据或允许 grant；现有简单存储若不能表达用户给定的 scope，就不持久化成更宽的类别开关。只有明确的长期 all-outbound 意图才允许保存对应持久限制。历史 tags 或普通 chip 不能清除适用中的拒绝；用户明确改变边界时只更新其所指范围。这是用户直接设置偏好，不是模型写入，也不要求完整 permission lifetime system。

reload 后，原 request/session scope 若仍能可靠关联，就在原范围内继续执行；若无法可靠恢复，相关旧历史保持 display-only，旧 evidence、snapshot 和相关待续发送 fail closed，不恢复旧允许，也不靠扩大 restriction 来补偿。原 scope 确认结束后的新请求按自己的目的、材料、去向及适用 durable preference 判断；不会仅因旧的一次性拒绝就永久禁用 Provider，旧材料也不会因此重新获得复用资格。

明确 durable preference 保存失败时，当前适用范围仍立即受限，并说明长期偏好未保存。持久限制读取损坏/失败时，对无法确认的相关使用 fail closed，不默认为允许，也不生成更宽的永久设置。上述降级不改变 restriction 的原始 scope，仍无需 schema migration 或权限平台。

## Failure Semantics

| status | 定义 | 数值与回答 |
| --- | --- | --- |
| ok | 成功取得请求内完整可用记录 | 数字仅陈述记录口径，不代表真实活动全覆盖 |
| empty | 查询成功、匹配范围确实无记录 | focus 可以说“该范围已归属记录合计0分钟”，并说不代表没学习；章节无记录不等于已完成 |
| partial | 已知只得到部分必要 evidence，或 coverage 已知不完整 | 保留已知值/子状态；缺失部分 null，不计算完整比较/趋势 |
| unavailable | 无对象/对象已删、平台不支持或能力无法提供 | 不读替代来源，不填0；可提供自述/原界面路线 |
| failed | 查询/处理失败 | value=null、可理解的失败说明；不传播敏感错误正文、不退空数组 |

“现实学习是否完整被记录”总可为 unknown，与成功查询的 ok 不矛盾；若用户说明仅两天样本，则明确样本覆盖，不外推整月。拒绝/撤回属于 authority/validity 与 stopReason，不是 failed 或 empty。Provider 失败是 answer 阶段状态，本地已成功 evidence 保留其真实状态供本地查看；无自动重试/扩大 context。

## Observability Design

**Test observability 与 product persistence 分开。** main 可为当前 request 返回/注入短生命周期 metadata：requestId、epoch、intent/stopReason、允许范围、resolver 实际调用、query outcome、准备/实际发送类别、excluded categories、destination revision、invalidated/late-result-discarded。生产只需当前交互的事实/范围说明，不建审计表，不保存 raw prompts/私密全文/隐藏推理。

未来 eval 的最小观测组合：

1. AIPanel → API spies：记录每次学习 API 和 Context builder 使用，包含从 entry prop 取数据等无新增 SQL 的本地使用。模拟其他 App 预读，用目的/request 归因区分，不把“新 API 数0”当“无使用”。
2. 合成 SQLite + repository wrapper：实际执行 query/params，与固定 SELECT/WHERE/JOIN/ORDER/GROUP allowlist 对照；排除列访问由 SQL/authorizer 或等价语句拦截断言，排除对象由 predicates + fixture 干扰行断言。记录身份 lookup 和底层两期查询，不只数 resolver 一次。
3. main IPC integration：验证 sender/request handle、旧 epoch、伪造 id、非法日期/额外字段被拒；deterministic metadata 必须与执行 spies 一致。
4. 沿现有 `createAiService(..., fetchImpl)` 捕获**最终序列化 body 和实际目标**，包括 follow-up、regenerate、失败后的人工重试；不采集 Authorization。body 用可回收的纯合成 canary，逐次与 disclosure allowlist 比较，不能仅相信 sources 标签。
5. 用受控 promise/latch 暂停在 query 返回、准备出站、fetch 已开始、response 返回四处，插入撤回/取消/目标变化；核对没有后续访问/发送/晚到采纳。

scope 的“只目标记录”指 SQL 逻辑取数/匹配范围与返回/计算用途，不承诺 SQLite 物理页不含其他行。检测器不足以证明某项时写 UNVERIFIED，不能把空日志当0。产品诊断 metadata 不含全文/secret；测试合成 bodies 可作为 eval artifact，真人材料不落长期日志。

## Scenario 3 Design

自然问句 → 本地确定“查记录进度” → 精确身份定位（重名先问）→ main 校验本地范围 → 单科章节必要字段 → 成功无明细才取单科数量 → envelope → 本地答案 → stop。F3 oracle：2/3，第3章，Provider 0，notes/task/focus/diary/mistakes/无关科目均不使用。全部完成报标记全部完成而非已经掌握；失败/缺失说未知。

刚取得且仍属于本次交互的有效 envelope 可直接用于格式化，不重复查；新的“现在”问题不以旧缓存代替记录。用户更正“我其实已学完但没勾选”作为自述说明，不写回。Direct UI 原样保留。

## Scenario 2 Design

“最近数学效率下降” → 本地问含义/两期，无学习访问、无 Provider → 用户明确“比较数学 9/7–13 与9/14–20 的记录投入” → 精确身份 → 固定 A/B focus batch → 每期 envelope → 本地显示70/140及限制 → 用户已允许此摘要给当前 Provider 且确需建议时才解释 → stop。

不取 task；不推出理解、难度、因果或历史任务完成量。无归属未知且排除。缺一期不报差值；partial 不推总体效率。已有用户给定同证据则标自述，零查询，不偷偷再“验证”。最多这一批预定 evidence，无看完结果后的第二 retrieval；可以结束在记录事实而不请求 Provider。

paired eval 必须给普通 Chat **相同的最小 envelope 事实**。D1.1 manual fixture 另含任务/后补完成自述，本 candidate 不取 task；不能拿较宽手工材料与较窄 candidate 混称“完全同证据”。保留原 baseline 原始测量，并为最小同证据对照另登记准备步骤/输入，候选比较前冻结。

## Scenario 9 Design

fresh “不看日记，但帮我分析” → 本地更新 diary 本地/派生/出站拒绝 → 在 Context 构建前排除 diary → 当前自述可给有限帮助；没自述时可给通用起步建议，原因未知。diary API、entry prop 正文使用、标题/心情替代都为0；有宽 chip 也不例外。

若之前已用 diary：撤回提交 → main epoch 增加、旧历史使用边界关闭、全部旧快照作废 → 撤回轮不含旧材料 → 可用当前独立自述继续。后续普通问句/Quick Prompt/regenerate 都走同一边界；不重复请求 diary 权限。允许的当前自述/任务事实不因拒绝 diary 被整体禁用。只需比较 focus 时沿 S2，同样不增加 diary；任务查询不在本版。

撤回在 fetch 前：阻止发送；fetch 已开始：说可能已发送，不保证追回；晚到响应：拒绝采纳。新目的地不承接旧出站决定。reload：旧文字仅显示，restriction 按原 scope 判断；无法恢复的旧 scope 对相关材料/待续发送 fail closed，明确 durable preference 才跨会话持久执行。新会话不复活旧快照，也不继承一次性全局禁发开关。

## Existing Components Preserved

| 组件 | 保留内容 / 必要接缝 |
| --- | --- |
| AIPanel / current conversation UI | 保留 composer、消息显示、copy、附件和清空历史；接入本地结果/澄清、受控 send、不可重生成原因及历史边界说明，不重做页面 |
| aiService / Provider config | main 网络/密钥、endpoint 归一、模型视觉能力、超时/错误继续；仅增加受控请求的最终有效性 seam |
| request policy | role/content/长度/图片限制保持；新增 typed evidence IPC validation 不替代这些限制 |
| Quick Prompts / Context builder | 模板与范围本身不重写；受限/First Slice 路径在调用前拦截不适配的宽 Context，不默认转换成另一宽读取 |
| Ordinary Chat | 普通知识和主动提供文本继续；历史复用受安全边界约束，旧 local-only 结果不能随六条 slice 漏出 |
| Today Action / Daily Review / Mistake Review | 原入口、context、生成、候选/确认/失败恢复均保留，不迁移或接入 evidence coordinator |
| confirmed action chain | 无新写路径；既有候选校验、显式确认、可信幂等执行及回执保持 |
| Planning History / AI Selection Polish | 不作为本版 evidence/lineage 存储，不扩展、不改协议 |

保留旧功能不等于它们已满足全应用来源撤回；本版承诺范围是 AIPanel First Slice 与其后续/重放链。拒绝若明确要求其他工作流或全应用也生效，需要阻止相冲突的自动使用并明确范围，不能在未验证时对外宣称全应用已实现统一权限。

## Candidate File Boundaries

**未来最多新增两个小生产模块；本次不创建它们。** 文件名是本设计的实现边界建议，不能扩成数十个模块。

| 未来路径 | 责任 |
| --- | --- |
| `src/utils/aiFirstSlice.ts`（new） | 纯本地 intent/clarification、固定事实显示与 AIPanel 协调 helpers；不读 SQLite、不拿凭据、不接收完整 entry |
| `electron/aiFirstSlice.ts`（new） | scoped resolver orchestration、内存 epoch/request metadata、restriction preference、disclosure/history/snapshot 验证；固定分支，无工具注册表 |
| [AIPanel.tsx](../../src/components/AIPanel.tsx) | send 前 gate，接本地答复/澄清、历史显示与复用分开，撤回/取消与 regenerate 状态 |
| [aiConversationBuilder.ts](../../src/utils/aiConversationBuilder.ts) | 仅组装已通过过滤的材料；给新 main 路径复用纯格式化，禁止自行恢复 display-only 历史 |
| [api.ts](../../src/types/api.ts)、[aiApi.ts](../../src/contexts/api/aiApi.ts)、[preload.ts](../../electron/preload.ts)、[main.ts](../../electron/main.ts)、[ipcValidation.ts](../../electron/ipcValidation.ts) | 两个固定请求的 shared types、受控 AIPanel transport / 会话限制更新；main runtime validation，不暴露任意查询 |
| [database.ts](../../electron/database.ts) | 转发新 narrow methods；相关写入/导入/恢复处更新内存有效性标记，提供外部数据库变更标记；仅对用户明确的 durable restriction 使用已有 getSetting/setSetting，保留原 scope；不更改 schema |
| [subjectsRepository.ts](../../electron/repositories/subjectsRepository.ts) | 精确 identity 与条件 aggregate 查询；不替换 getAll |
| [subjectChaptersRepository.ts](../../electron/repositories/subjectChaptersRepository.ts) | 纯只读单科 title/order/completed projection，避免现有 assertSubjectExists 的 SELECT * |
| [pomodoroRepository.ts](../../electron/repositories/pomodoroRepository.ts) | 单科两期记录分钟/coverage projection；原 chart 统计保持 |
| [aiService.ts](../../electron/aiService.ts) | 受控请求的 fetch 前 validity hook 和目标绑定；旧调用默认行为保持，不换 adapter |

新 lineage 不加入 `AIChatMessage` 持久格式；session map 关联现有 message id 即可。仅在 UI 现有 props 无法显示禁用原因时调整原组件 props，不借此重构。预计新增/扩展测试围绕上述 seam，具体文件归属在 D1.3 锁定；本次不建生产测试或 harness。

## Schema Decision

**Schema 8 unchanged；migration = No。** 当前 [databaseMigrations](../../electron/databaseMigrations.ts) 明确 `CURRENT_SCHEMA_VERSION = 8`。记录事实使用现有表；lineage/request/audit 和短期 restriction 内存；历史展示使用现有 localStorage；只有明确 durable restriction 复用现有 [settings 键值存储](../../electron/repositories/settingsRepository.ts) 并保留原 scope，无新表/列/索引。

不把 request/session refusal 写成全局偏好，不保存授权 grant、证据或 provenance。产品安装/备份现有语义保持；还原/切换数据库后销毁内存会话，重读该库 durable 限制并检查适用范围；无法恢复的旧 scope 不恢复相关材料/发送，旧缓存历史仍 display-only。无需 SQLite downgrade。

## Tool-calling Decision

**First Slice 完全可以没有 tool calling；决定 absent。** 两种固定 Evidence Request 由本地交互确定；模型只能收到已允许的最终材料，不能选择对象/字段/下一工具/第二证据批次。No Retrieval、Direct Predetermined Retrieval、Ask User、Stop 均可兑现。没有任何 Primary Scenario 要求 function calling，不为 D5 留 registry 或执行 loop。

## Verification Design

以下均为**未来 NOT_RUN**；本次只验证设计覆盖。沿用 D0.4 fixture/oracle，D1.1 characterization 作为差异对照，不把旧 failure 测试通过当 candidate pass。

| Case | 操作 / 故障注入 | 必须断言与观察点 |
| --- | --- | --- |
| S3 / G2 | F3，两科、目标三章2完成，notes canary | SQL 必要列、仅目标；身份 lookup 单列计数；答案2/3、第3章；notes/task/focus/diary/mistakes0；fetch0；stop |
| S3 identity | exactName 无命中/同名/伪造id/删除id | 未确认前无 chapters/focus；无 getAll；不凭 notes 消歧；非法id拒绝，删除unavailable |
| S3 coverage | detail空但summary有值；detail SQL throw；全部完成；0/0 | 仅成功空可读summary；throw不能退数量；不编next/理解；空不是全部完成 |
| S3 G8 | 允许本地，禁止出站，再发普通追问 | 本地可显示；最终body不含章节标题/数量/日期；本地答复不会被recent history偷带 |
| S2 / G3 | ambiguous + 残留overview/reflection；仅补一部分slots | 意义/subject/periods未齐前所有学习API/identity/Context使用0；Provider0；不猜日期；已有slots不重复问 |
| S2 fixed batch | F2明确投入及A/B，其他科/无归属干扰 | exact subjectId/date_key；70/140；无tasks/notes/日记、无unassigned查询；两期固定batch后无第二retrieval |
| S2 failure / G5 / A4 | A failed/B ok；空集；两天样本；导入早期记录 | null与0区分、整体partial；不比缺失值；记录分钟不是效率；不按安装日排除合法旧记录；不外推月度 |
| S2 source supplied | 用户已给同等最小事实 | 零新增查询；来源user_message；普通Chat同材料对照，不把旧模型文本当库事实 |
| S9 fresh / G4 | 拒绝日记但保留相关chip/entry prop | diary API及内存正文使用0；body无标题/心情/摘要；有限帮助，无重复求权 |
| S9 A5 mixed | 合成diary回答混task，发送撤回，follow-up，再regenerate | 撤回轮即无旧user/assistant前缀；旧canary不出站/作hint；旧snapshot拒绝；当前独立task自述仍可用 |
| S9 A7 timing | 暂停于读前、读后、fetch前、fetch中、response后撤回 | 对应阶段无后续越权读/发/采纳；fetch中只报可能已发；不能晚到写回snapshot |
| S9 scoped refusal / reload | “这次别把日记发出去”或“这次别发给AI”→重挂载/重启→续旧请求或发起无关新聊天 | durable settings写入0；原scope可恢复时继续限制，不能恢复时旧历史display-only、相关待续发送fail closed；旧允许/snapshot不复活；不把短期diary/all-outbound升级为永久禁用 |
| S9 durable preference | “以后默认不要把日记发给这个Provider”→重启→改变目的地；另测明确长期all-outbound | 仅明确长期偏好持久化，保留类别/处理方式/目的地等原scope；不自动扩大到本地使用或其他Provider；新目的地仍须自己的披露决定；存储失败/损坏不默认放行相关使用或生成更宽永久设置 |
| S9 destination/cancel | 准备后改endpoint/model、取消再重发旧handle | 最终fetch目标匹配有效决定；旧handle拒绝；不向新Provider静默发旧事实 |
| A10 drift | 取得evidence后改/删章节或科目、导入/恢复、外部连接写入、跨日 | 待发送/晚到记录结果失效；无第二retrieval；不把观察时旧值说成现在，不复活删除来源 |
| G1 / G7 | 知识问答；现有三个workflow独立入口 | 新增学习读取0；成熟流程与确认链不绕入First Slice；无新写入 |
| A1/A8/A9/A12 | 注入命令、伪造引用、secret canary、限制页附件、Provider失败 | 无学习mutation；非法privileged ref拒绝；body/日志无secret；不调用不适配的全页提取；无自动扩读/无限重试 |

未来验证顺序：纯 gate/envelope/SQL fixtures → preload/main/service 集成与时序注入 → 实际 Electron AIPanel send/追问/撤回/reload → Parent 冻结条件下 paired eval。每次变更只跑受影响验证；现有 confirmed-action 反例选适用的相关用例证明保留，不要求无关全仓测试。真实模型输出语义/拒绝后帮助质量与真人准备负担单列，mock 无权替代。

## Hard Invariants

| Invariant | 本设计的 enforcement / 未来证明 |
| --- | --- |
| unconfirmed mutation = 0 | 新 resolver 只读、模型无动作调用；spy断言无学习写入。只有用户明确长期/默认限制才写durable preference，短期拒绝不写全局settings；既有学习写入仍过独立确认链 |
| secret leakage = 0 | 凭据只在main鉴权；evidence查询不含settings，错误/metadata不带secret；合成鉴权canary在最终body/历史/日志均不得出现；不声称能识别用户主动粘贴的所有未知秘密 |
| invalid privileged reference accepted = 0 | 新IPC运行时校验、句柄归属/epoch、对象存在与精确范围；无新动作接口；原confirmed chain保留并以适用反例证明 |
| unauthorized local access = 0 | clarification gate + main固定投影 + 禁止宽Context旁路；实际SQL/params/API/内存来源使用与允许清单核对，不只看输出 |
| unauthorized provider disclosure = 0 | 独立projection、默认local-only、新目的地失效、fetch前核验；捕获每次最终body，不豁免history/重放 |
| revoked-source reuse = 0 | 全旧前缀/快照失效、旧lineage不复活、晚到拒绝、reload仅展示；用canary + 时序 + 无旧hint/排序输入验证 |

六项均逐 case / 逐重复成立，缺观测为 UNVERIFIED，不能写0。生成文本的猜测/证据外推另按语义 oracle 失败；无法观测 Provider 内部遗忘，不承诺追回已披露资料。

## Rollback

候选事实能力失败时，关闭 First Slice intent/evidence dispatch，恢复普通知识/当前自述 Chat 与原手动 Quick Prompt 入口；Direct UI 和三个 workflows 从未迁移，继续原路径；无 SQLite downgrade，历史文本不删除。

**不能把恢复已知 unsafe history replay 当作安全 rollback。** 撤回/history/snapshot guard 与窄事实入口分开，可保留前者关闭后者；已拒绝来源在原 restriction scope 内继续受限，宽 Quick Prompt 不适配则不可调用。若 guard 自身不可靠，AIPanel 降级为无旧历史、无记录Context的当前消息路径；适用scope内全部出站拒绝时仅本地功能。旧快照一律失效；回退不把短期拒绝升级为durable preference。

若整个候选代码回退到不认识限制的旧版本，只能明确视为恢复旧 baseline failure，不能宣称仍有撤回保证；这种情况下不可开放涉及旧历史/被拒来源的 AI 路径。settings 小键可留存被忽略但不得删除用户拒绝；受支持安全回退需保留最小阻断，不能要求用户自行检查每个旧回答。

## Resource Impact

继承 D1.1：F3 Direct UI 0 Provider、6个学习API reads（两科fixture）；最窄overview仍5个reads、body545 chars/1045 UTF-8 bytes；F2手工同证据body446/952；A5撤回/其regenerate body417/829、0新Context reads仍含canary。全部网络为synthetic拦截，真实Provider calls0，不能当实际用户latency或模型成本。

本设计通过S3本地回答、S2本地澄清、无自动重试/第二证据批次、排除宽Context/旧前缀避免明显增加不必要调用/context。**S3 Provider0和ambiguous分支零访问是行为定义，不是自行锁定跨场景candidate资源上限。** 身份lookup、两期SQL、用户澄清时间、少量restriction偏好读写必须计入，不用“一个batch”隐藏底层成本。

不锁latency/token/call count ceiling、改善百分比、repeat count或收益阈值。真实模型同证据回答质量、首次正确有用结果、准备负担和端到端耗时仍UNVERIFIED；Parent在candidate比较前锁条件。S3要与Direct UI比较，不能只挑最宽Quick Prompt当弱对照。

## Implications For D1.3 / D2

本设计及单项收紧已按Parent结论锁定，无需整份重审。建议下一Gate为 **D1.3：锁实现allowlist及验证fixture/资源比较条件**，继承两模块边界、保守历史连续性损失、仅明确durable restriction持久化且保留原scope、main发前时序与同证据S2对照。不是重开adaptive/migration研究，也不是等待完整平台设计。

另行授权后，D2可先实现并验证两种固定projection与本地结果；D3所需访问/披露/撤回guard必须和生产开放一起满足，不能先把宽旧路径接上再声称以后补隐私。D4再做集成/paired eval；D2通过不自动通过产品Gate或开启D5。本文没有开始任何后续阶段。

## Non-decisions

已锁architecture option、进程职责、两种typed请求、envelope、S3本地、S2本地澄清、独立disclosure、整段旧历史边界、snapshot作废、三层最小lineage、lineage不持久化/仅明确durable restriction按原scope持久化、observability、五种状态、Schema8、无tool calling、候选文件和rollback。

留待实现阶段的是函数精确命名、局部UI呈现/文案、规则的完整语言覆盖表、现有测试文件归属和具体race注入写法；这些不能改变核心决策。未锁资源数字；未改Prompt、生产代码、测试、任何输入文档或发布状态。没有实现Runtime/Loop/Registry、permission UI或工作流迁移；无commit/push/PR/Issue mutation/merge/release。

## Validation Record

本节只记录文档和静态核对，不把设计推演称为运行验证。

- 开始与交付前四处Git SHA均一致，均为 `87fef52eba451a38226b4e04e701d79c431eddfe`；远端经实时 ls-remote 复核，未更新本地引用。
- 已继承D1.1 observed findings及其限制：S3 Direct UI优势、S2准备负担与同证据质量未知、S9混合历史和最新snapshot实际失败、缺统一观测；没有重跑测量或把mock升级为模型证据。
- 34个required二级章节检查通过，无遗漏/重复；17项设计决定在对应章节给出明确选择。Scenario2/3/9分别覆盖澄清/投影/停止、local/provider、revocation/history/regenerate/reload/late response。
- 静态设计检查：Adaptive Retrieval No、Migration No；query不先读全对象；local/disclosure独立；failed/partial/unavailable不变成0；三项新增invariants有实际观察位置；Schema8和tool calling absent明确；rollback不暗中恢复泄露路径。
- 八份指定输入文件SHA-256前后相同；Git状态相对开始仅新增本文，`git diff --name-only -- src electron tests` 无输出。既有 `output/` 未读取或修改。
- 36个相对链接全部存在，行尾空白0；`git diff --check` 返回0。新增未跟踪本文另用 `git diff --no-index --check -- NUL docs/roadmap/D1-minimal-first-slice-architecture.md` 检查，返回1表示与空文件有差异，无空白错误，仅既有LF/CRLF转换提示。
- 未运行无关测试、构建、应用、Provider或真实数据库访问；未来Verification Design全部NOT_RUN。没有生产实现、Prompt修改、测试新增、暂存或提交。

- Parent单项收紧：restriction保留原scope；只有明确长期/默认偏好持久化；一次性all-outbound不成为永久开关；reload无法恢复scope时只对相关旧材料/待续发送fail closed。已同步Minimum Source Lineage、Scenario9、文件边界、Schema、Verification、Hard Invariants和Rollback表述；其余已接受架构保持不变。新增验证条目仅为设计，未执行产品测试。

停止点：**D1.2 Parent要求的单项收紧已完成，设计正式锁定；不启动D1.3或生产实现。**
