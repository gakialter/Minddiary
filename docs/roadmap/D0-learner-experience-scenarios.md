# D0.1 Learner Experience Scenarios

状态：研究草案完成，供 Parent 审查；不代表 Parent Gate 通过，不授权 D0.2 或任何实现。

## Baseline

- 核对日期：2026-09-20（Asia/Shanghai）。本地分支 `main`，HEAD、本地 `main`、通过 `git ls-remote origin refs/heads/main` 读取的远端 SHA 均为 `87fef52eba451a38226b4e04e701d79c431eddfe`。未 fetch、切分支或改动 Git 历史。
- 工作开始时已有 `AGENTS.md`、`docs/roadmap/minddiary-ai-study-agent-roadmap.md` 未提交修改，以及未跟踪的 `output/`。本研究读取工作区中的约束与 roadmap，产品实现以该 SHA 为基线；不改上述文件。
- 已阅读 [AGENTS.md](../../AGENTS.md)、[AI contracts](../agents/ai-contracts.md) 和 [Phase D roadmap](minddiary-ai-study-agent-roadmap.md)。用户提供本次独立 D0.1 授权；roadmap 中“本次 refresh 未启动 D0”的描述不视为本次研究已通过 Gate。
- 选择现有 `docs/roadmap/` 保存一份研究：roadmap 的 D0 明确不默认创建新文档体系，并未明确开启 `docs/agent-next/`。本次不建立下一代设计文档系统，不需要更新已有 roadmap 状态。
- 方法：源码流程走查、数据投影核对、相关既有测试用例阅读。没有开展真人访谈、运行应用或向 Provider 发送学习数据。下文场景是代表性研究假设，不是已验证的真实用户频率、学习收益或性能结果。

### Evidence index

下列编号是每个场景的 current experience 依据。以具体函数/组件定位，避免将规划文案当成产品事实。

| 编号 | 当前代码与核对范围 |
| --- | --- |
| B1 | [AIPanel](../../src/components/AIPanel.tsx) 的 `sendMessage`、`regenerateLastAnswer`；[useAIComposer](../../src/hooks/useAIComposer.ts) 的 `applyQuickPrompt`、`clearComposer`；[AIComposer](../../src/components/ai/AIComposer.tsx) 的输入、附件、Context chips；[Quick Prompts](../../src/utils/aiQuickPrompts.ts)；[conversation builder](../../src/utils/aiConversationBuilder.ts) 的 `buildAIConversation`。 |
| B2 | [AI Context Builder](../../src/utils/aiContextBuilder.ts)：六类固定上下文、日期/数量/文本裁剪和缺少数据时的错误。 |
| B3 | [HomeDashboard](../../src/components/HomeDashboard.tsx) 的三个规划入口；[Today Action dialog](../../src/components/TodayActionSuggestionDialog.tsx) 的 `loadPlanningContext`、生成、历史反馈选择、候选编辑和确认；[Today Action projection/validation](../../src/utils/todayActionSuggestions.ts) 的 `buildTodayActionSuggestionRequest`、`validateTodayActionDrafts`；[chapter projection](../../src/utils/todayActionChapterContext.ts)。 |
| B4 | [Daily Review dialog](../../src/components/DailyReviewAgentDialog.tsx) 的 `loadDailyReviewContext`、本地预览、生成和确认；[Daily Review projection](../../src/utils/dailyReviewAgent.ts) 的 `buildDailyReviewSafeContext`、`buildDailyReviewDeterministicSummary`、`buildDailyReviewRequest`。 |
| B5 | [MistakeBook](../../src/components/MistakeBook.tsx) 的筛选和「AI 复习规划」；[Mistake Review dialog](../../src/components/MistakeReviewAgentDialog.tsx) 的 `loadSuggestions`、确认；[Mistake Review projection](../../src/utils/mistakeReviewSuggestions.ts) 的 `prepareMistakeReviewSession`。 |
| B6 | [PlanningHistoryDialog](../../src/components/PlanningHistoryDialog.tsx) 的来源处置、候选、执行归因和删除展示；[本地 history](../../electron/planningHistory.ts) 的保留上限；[Schema 7 history contract](../schema-7-history.md)；[planning feedback](../../src/utils/planningFeedback.ts)。 |
| B7 | [SearchPanel](../../src/components/SearchPanel.tsx)；[entries repository](../../electron/repositories/entriesRepository.ts) 的 `searchEntries`；[mistakes repository](../../electron/repositories/mistakesRepository.ts) 的筛选；[SubjectChapterPanel](../../src/components/SubjectChapterPanel.tsx)；[数据类型](../../src/types/index.ts) 的 `Mistake`、`PomodoroSession`、`PomodoroRangeEntry`。 |
| B8 | [Daily Review tests](../../tests/DailyReviewAgentDialog.test.tsx)、[Today Action tests](../../tests/TodayActionSuggestionDialog.test.tsx)、[Mistake Review tests](../../tests/MistakeReviewAgentDialog.test.tsx)、[History tests](../../tests/PlanningHistoryDialog.test.tsx)、[Context Builder tests](../../tests/aiContextBuilder.test.ts)：阅读本地预览、显式生成、失效、恢复等用例；本次未重跑。 |

## Research Question

用户遇到什么实际困难时，才希望小研主动寻找学习记录？能否以更少的数据准备、更可靠的依据解决困难，而不是多一个等待过程？

本文的 **Agent retrieval** 指根据当前问题选择或补充本地证据的体验，**不等同于多步循环**。`YES` 表示本场景值得主动找证据；`CONDITIONAL` 表示仅在明确缺口出现时；`NO` 表示不需 Agent 取证，仍可使用已有固定流程或一次确定性查询。读取必要性矩阵进一步区分这些路径。

除 Current Experience 与 B1–B8 外，Minimum Evidence、Ideal Interaction、敏感边界和 Success Criteria 都是待验证的体验要求，不是现有功能或最终权限策略。普通结构化数据也须处于允许的目的/范围内；“较低敏感”不等于可无条件读取或发送。用户一句学习提问不授权后台访问、敏感全文或任务写入。

## Current Experience Summary

### Ordinary AI Assistant

用户在「小研」输入问题并发送；初始 Context 为空。当前可见 UI 用 Quick Prompt 同时加入可编辑草稿和关联 Context chips，用户可以逐项移除后主动发送。没有独立的任意数据浏览式 Context 选择器。Quick Prompt 包括「总结今日日记」「错题规律分析」「考考我」「心理按摩」「制定复习冲刺」。用户要先判断哪个入口附带的数据有帮助，也可能为了取得一种 Context 而改写模板草稿。（B1）

发送时才构建所选上下文；缺少所选日记/错题等会报错并提示移除该 Context 后普通发送，不会自动补齐。回答以消息显示，可复制，当前会话内最后一条回答可用原请求快照重新生成。后续正常发送只带最近六条历史消息的可见文本，不自动重带上一轮原始应用上下文/附件；发送成功后清空输入、Context 与附件。聊天文本保存在本地，附件内容不持久化，重新生成也不等同于刷新学习记录。（B1、B2）

当前 Context 的实际范围值得单独记录：（B2）

- 「今日日记」使用传入的当前 `entry`（名称不保证它就是本地今天），正文会进入请求，整体最多 8,000 字符。
- 「近期复盘」取截至今天最新最多七篇记录，每篇正文截取最多 600 字符；查询没有起始日期，**不能说成严格最近七个自然日**，也不是语义提炼后的反思摘要。
- 「学习概况」包含科目/章节摘要、最多 20 项今日任务、近七天专注总量；不是按用户问题选择的科目时间序列。专注读取失败会退为空数组，不能据此断言用户没有学习。
- 「错题规律」最多 40 条，「未掌握错题」最多 20 条，包含题目摘录、笔记摘录、掌握状态；不是专题完整历史，也不包含完整答案和图片。
- 「主目标倒计时」提供主目标名称、日期、剩余天数，不代表已有自动考试里程碑规划。

### Today Action

「今日执行」中的「打开 AI 规划」进入 Today Action。用户设置今日可用时间，可选规划策略，查看/刷新依据并点击生成；存在历史参考选择流程，可选择条目使用，也可不使用历史反馈生成。（B3）

固定流程准备今日任务、到期错题、科目、今日日记及受限章节上下文。请求包含活跃任务摘要、最多 12 项到期错题的题目摘录、科目、受限章节、日记编号/日期；不包含日记正文、错题答案或完整专注历史。可选历史反馈中的显式关联专注结果不等于接入通用 focus history。**可用时间按今日总预算解释，并减去已有活跃任务估时**，不应无条件当作“在所有已有安排之外再追加两小时”。（B3）

已有候选编辑、选择/移除、重复与预算检查、依据变化提示、确认创建和不确定结果恢复。用户仍需判断内容是否合适、已有任务估时是否准确、是否接受旧依据；生成本身不创建任务。它不是自由多轮聊天。（B3、B8）

### Daily Review

「今日执行」→「打开每日复盘」。打开先展示本地确定性汇总和依据，未点击生成不调用 AI。固定准备今日任务、次日任务、科目进度、今日专注总量及按科目汇总、今日日记、次日到期错题；用户设次日可用时间/策略并生成洞察和次日候选。（B4）

请求中的日记是编号、日期、标题、心情、字数，**不发送正文但也不是完全不使用敏感日记信息**；到期错题包含受限题目摘要、复习次数和到期日。专注不可用与零记录分开表示。候选有来源、编辑/选择、校验和显式确认；刷新本地预览不会改写原生成快照。这里的「每日复盘」指 AI Daily Review，区别于错题本的 DailyReviewModal 每日复习轮次。（B4、B8）

### Mistake Review

错题本→「AI 复习规划」打开后自动获取当前到期集合、科目和当日活跃复习任务，排除已掌握、失效科目和已有当日复习任务的题目，排序后最多 12 项进入生成，最多四个候选。无需手选 Context，也没有打开后的第二次“发送”要求；这是用户主动进入的固定流程。（B5）

Provider 投影只有当日日期、临时题目标识、科目名、题目短摘录、逾期天数和复习次数。没有答案、笔记、日记或附件。确认才创建复习任务；保留来源/日期失效检查，不自动复习、掌握或修改 SM-2。它已经覆盖“替用户准备必要信息”，但不回答历史专题错误原因。（B5、B8）

### Planning History / Planning Run

「最近 AI 规划」可看 Today Action / Daily Review 的有限历史、准备与请求纳入类别、保留候选、决定和结果。显示当前关联任务状态、语义变化和显式绑定的专注，不将相关性说成 AI 成效。历史保留最近 30 天且最多 100 次；可删单次/清空而不删任务或回执；重启可查看而不能恢复执行。Mistake Review 不在该持久 Planning Run 入口范围内。Today Action 的可选历史反馈不是 General Assistant 的长期记忆。（B3、B6）

### Local read is different from Provider disclosure

Today Action / Daily Review 通过 `entries.getByDate` 取得本地日记对象后再做请求投影，Mistake Review 也先取得本地错题对象再裁剪。因此上文“正文/答案不发送”**不能写成当前本地从未读取这些字段**。日记搜索本地匹配正文，错题搜索本地匹配题目、答案、笔记；即使只显示摘要，仍涉及敏感内容访问。未来本地读取与发送权限都需独立论证，本次不修实现。（B2–B5、B7）

## Scenario 1 — 剩余两小时，立即决定先做什么

### User

“今天线代状态很差，还剩两个小时，我应该怎么安排？”

### User's Actual Goal

用户现在的困难是精力与时间有限、已有安排分散，需要一个不重复任务、立即可执行的顺序，而非再列一张理想清单。

### Current MindDiary Experience

可进入 Today Action 填预算、选策略、生成并编辑候选，系统已自动准备任务、章节和到期错题。普通 Chat 可用「制定复习冲刺」加入学习概况后修改草稿，但附带倒计时且没有该固定流程的到期错题与确认能力。（B1–B3）

### Current Friction

用户必须把“剩余时间”与今日总预算含义对齐；固定策略不能直接表达“今天线代很累、优先轻任务”的自由约束。仅仅自动找任务和章节不是新价值。

### Should Agent Retrieval Happen?

**CONDITIONAL**。自然聊天缺少今日事实时值得补一次有限学习状态；若 Today Action 已满足需求，**Agent 不增加价值**。只有第一批事实暴露具体缺口，例如某个到期专题是否已安排，才值得二次取证。

### Minimum Evidence

#### Required

本地日期、用户声明的剩余时间/精力、当前未完成任务及估时、相关科目当前章节；存在复习义务时需相关到期错题数量/关联与已安排状态。

#### Optional

为识别复习内容所需的短题目摘录；用户提到考试时的目标日期；用户明确要求参考上次安排时的有限 planning history。

#### Unnecessary

全部 focus 历史、日记正文、错题答案/附件、无关科目历史。

### Sensitive Data Boundary

默认不取日记正文/答案/附件。题目文本也可能含私人信息；仅元数据无法识别要复习什么时才考虑限定摘录。用户的“累”不授权寻找心理原因。

### Ideal Interaction

1. 接受两小时与低精力约束，区分已有任务中哪些还要占用这两小时。
2. 在允许范围内取得相关今日任务、章节和到期概况；不找日记。
3. 若事实已足够，停止取证，给出保留、缩短或延后的建议顺序与理由。
4. 仅在出现具体冲突时补核相关任务/错题，明确缺少的事实。
5. 输出合计不超过用户剩余 120 分钟的安排；要落为任务时仍须用户确认。

### If Permission Is Denied

不读题目内容仍可按科目、到期数量和用户指定重点给粗粒度顺序；拒绝学习记录访问则依据用户提供的任务列表规划，说明未核对已有安排。

### Success Criteria

减少 Context 拼装；不重复已安排复习、不双重扣预算；依据可核对；不把低精力推断成心理结论。与 Today Action 比较首次可执行结果的操作量/等待，而非仅比较文字丰富度。

### Failure Modes

把已有任务时长重复计入；遍历日记“了解状态”；无冲突也连续取证；用陈旧任务状态生成重复建议。

## Scenario 2 — 数学效率下降，需要查证而非猜原因

### User

“最近数学花的时间不少，怎么感觉效率反而下降了？”

### User's Actual Goal

用户现在分不清是投入减少、任务难度变化，还是完成预期不合理，希望找出能验证的解释并决定一个调整。

### Current MindDiary Experience

普通 Chat 可手工提供近期情况，或借 Quick Prompt 的学习概况与近期复盘；学习概况只有今日任务、当前进度和跨科目近七天专注总量。Daily Review 覆盖单日；Planning History 只反映有限规划与显式关联结果，均不能直接证明跨周数学效率原因。（B1–B4、B6）

### Current Friction

用户需要自己找可比时段、数学任务和对应投入；一次附上更多日记也不能弥补结构化对比不足。

### Should Agent Retrieval Happen?

**YES**，是较强的 adaptive retrieval 候选：先核对用户所说的下降是否存在，再由具体异常决定下一份证据。不是保证能找到原因。

### Minimum Evidence

#### Required

用户对“效率”的含义、明确的近期与比较时段、数学相关任务完成/估时与实际记录的专注汇总、各数据的覆盖范围；没有科目关联的记录需注明无法归属。

#### Optional

具体变化的章节/任务难度由用户确认；相关任务显式关联 focus；限定日期的反思节选，仅在结构化证据不能解释时请求。

#### Unnecessary

全库日记、错题答案和图片、无关科目正文、完整规划历史。

### Sensitive Data Boundary

先用任务状态和投入，不默认读心情、反思正文。只有能说明“哪一个未决问题需要哪几天的反思”时才值得询问；摘要同样继承正文敏感性。

### Ideal Interaction

1. 确认用户在意的是完成量、理解程度还是时间消耗，并确定比较范围。
2. 展示数学投入、完成情况与数据缺口，区分实际记录和估时。
3. 若只是任务变难的可能性，针对有关章节/任务进一步核对，或让用户确认。
4. 如果仍无法解释，先给有限结论，再可选询问相关反思节选。
5. 给一个可尝试的调整，分别标注观察、假设和未知，停止继续扩张范围。

### If Permission Is Denied

保留结构化对比：“记录支持投入变化，但不足以解释主观效率。”可问一次用户愿意提供的短描述；不反复索要日记。

### Success Criteria

用户无需手动跨入口汇总；每个比较有时间范围和覆盖说明；新增证据解决具体疑问才有价值；不能验证下降也能诚实结束。

### Failure Modes

把分钟当学习效果、把未完成当失败、把科目无归属记录算作数学、把相关性写成原因、先读日记再找理由。

## Scenario 3 — 查一下线代进度

### User

“线代现在学到哪里了？”

### User's Actual Goal

用户现在记不清上次停在哪里，只需要恢复学习位置。

### Current MindDiary Experience

可以看科目章节界面；小研可通过学习概况得到科目完成数、下一未完成章节与有限预览，但要从 Quick Prompt 附入，再改问题。（B1、B2、B7）

### Current Friction

聊天入口为一个事实附带今日任务、专注与其他科目；用户得知道用哪个 Quick Prompt。

### Should Agent Retrieval Happen?

**NO**（不需要 Agent Loop）。一次限定科目的本地查询加直接回答即可；若当前对话已有可靠进度则无需新读。减少 Context 操作有价值，但不能据此证明多步 Agent 有价值。

### Minimum Evidence

#### Required

明确科目及当前章节完成标记/顺序；无详细章节时仅使用已有完成数量并说明精度。

#### Optional

用户特别问“下一步”时的下一未完成章节；多个同名科目的用户澄清。

#### Unnecessary

任务、错题、focus、倒计时、日记、planning history、附件。

### Sensitive Data Boundary

只需章节标题/状态，不读取正文与私人笔记。科目同名时问用户，不扫描日记猜身份。

### Ideal Interaction

1. 确定用户所指科目。
2. 只查该科目当前章节摘要。
3. 直接回答记录中的完成位置及下一未完成项，注明“未标完成”不等于从未学过，然后停止。

### If Permission Is Denied

不需要敏感权限；若连进度访问也被拒绝，指向科目界面，或按用户给出的章节信息回答。

### Success Criteria

无需手选 Context；答案与当前章节标记一致；不请求其他数据、不增加多步等待。

### Failure Modes

多次查库；根据完成数量编造具体学到的知识点；将旧聊天中的进度当当前状态。

## Scenario 4 — 今天学得怎么样

### User

“我今天学得怎么样？”

### User's Actual Goal

用户现在缺少一天的收束感，希望知道完成了什么、还剩什么，并获得适度评价；可能问执行量，也可能问理解和感受。

### Current MindDiary Experience

Daily Review 已展示任务、估时、实际专注的确定性汇总，再生成有来源的洞察与次日候选；「总结今日日记」则发送当前 entry 正文，属于另一种总结。（B1、B2、B4）

### Current Friction

两个入口对“学得怎么样”采用不同证据。仅想看事实时无需生成次日计划，也不应被引向日记全文。

### Should Agent Retrieval Happen?

**CONDITIONAL**。聊天没有今日数据时可取一次确定性摘要；已有 Daily Review 足以回答执行情况时 **Agent 不增加价值**。主观学习质量只能询问或依据用户选择的反思。

### Minimum Evidence

#### Required

今天的日期、任务状态与实际记录的专注总量/可用性；用户的评价侧重点可先按“执行情况”明示假设。

#### Optional

今天有可靠记录的复习完成情况；用户自述收获/困难；明确选中的当日反思节选。

#### Unnecessary

跨月历史、所有到期错题题干/答案、附件、完整日记；次日安排在只问今日时非必需。

### Sensitive Data Boundary

日记心情/标题也不默认作为评价证据。只有用户希望谈感受而自述不足时询问节选；当天有日记不代表应读取。

### Ideal Interaction

1. 先说明“按今天记录的执行情况来看”，避免泛化成学习质量评分。
2. 给任务与专注的事实摘要，未知数据标为未知。
3. 给有限结论和一个可选下一步，不自动生成新任务。
4. 若用户想聊理解/情绪，再邀请其自述或选择反思材料。

### If Permission Is Denied

仍完整提供执行摘要，说明不能据此评价理解深度或心情；无需为了完成复盘再次求取日记。

### Success Criteria

不用日记仍得到有用回答；区分估时、专注和实际掌握；与现有复盘同等可核对，入口更省事才算改善。

### Failure Modes

专注长就夸效率高；把不可用当零；用累计复习次数冒充今日已复习；将日记存在视作授权。

## Scenario 5 — 回忆以前下午学不进去的证据

### User

“我之前是不是也有过下午学不进去？那时怎么调整的？”

### User's Actual Goal

用户现在难以回想类似经历，希望找到具体日期和当时尝试的方法，判断是否值得再试。

### Current MindDiary Experience

可在日记搜索中输入关键词，或在无关键词时按日期等条件筛选，再打开原文；有关键词时 `handleSearch` 走 `searchEntries(query)`，不会同时应用日期筛选。当前本地关键词搜索匹配标题/正文并返回片段。普通 Chat 的近期复盘只是最近最多七篇截断内容，不是按问题查历史；Planning History 也不是全天候个人记忆。（B1、B2、B6、B7）

### Current Friction

用户要记得自己曾使用的措辞，并逐篇检查；“下午学不进去”可能写成“午后总走神”。关键词结果还需自行核对日期范围，不能把当前界面当作已支持限定日期的组合检索。专注日汇总不能证明下午的主观状态。

### Should Agent Retrieval Happen?

**CONDITIONAL**。需跨记录定位且得到许可才有价值。先验证限定时间的关键词/本地搜索是否足够，找到相关原文即停。仅当同义表述和跨时段回忆持续失败，才成为未来 D7 的研究依据。

### Minimum Evidence

#### Required

用户认可的检索时间范围（例如用户指定的上个月，而非全库默认）、确实描述相似经历的日期与短原文、当时自述的调整；若要声称有效，还需后续结果证据。

#### Optional

带有效时刻且可归属的 focus 记录；用户选择的后续日记片段；相关已确认计划及结果。

#### Unnecessary

完整日记库、附件、错题答案、无关科目进度。

### Sensitive Data Boundary

本地全文匹配本身也是访问正文，需要与发送节选分开理解。日期/篇数只可定位，不能回答情绪或方法；不以“只搜关键词”绕过拒绝正文访问。

### Ideal Interaction

1. 确定用户想回忆的时间段和“相似”的含义。
2. 告知需要检索相关反思内容；允许用户改为自己选几段。
3. 在允许范围内先找有明确措辞的记录，展示带日期的相关节选。
4. 只有“当时怎么调整/有没有帮助”仍缺证据时，再请求邻近日期的有限材料。
5. 区分“曾尝试”与“证据支持有帮助”；无匹配时说明本范围未找到并停止。

### If Permission Is Denied

不进行正文匹配，也不调用含正文派生信息的缓存；可教用户自己使用本地搜索，或依据其回忆讨论方法，说明未核实历史。

### Success Criteria

能回到具体日期核对；不把未找到当从未发生；减少手工翻找才算改善。关键词搜索可完成则不增加更复杂检索。

### Failure Modes

用日汇总编造下午规律；截断遗漏却声称完整搜索；找不到就扩大到全库；把历史计划当已实施有效措施。

## Scenario 6 — 在聊天中安排明天

### User

“帮我安排明天吧，上午要出门，晚上只想做轻一点的复习。”

### User's Actual Goal

用户现在想在已有安排与额外精力约束下结束当天决策，不想重复解释刚刚说过的限制。

### Current MindDiary Experience

Daily Review 已自动准备今日/次日任务、次日到期错题、科目和今日专注，用户设置次日预算和策略，生成并编辑、确认次日候选；普通聊天可以描述额外约束，但不会自动补齐这些事实或创建任务。（B1、B4）

### Current Friction

要从聊天切到复盘，并自行将“上午出门/晚上轻一点”转换为预算和候选编辑；固定策略并不等于接受任意自由约束。

### Should Agent Retrieval Happen?

**CONDITIONAL**。普通次日规划已被 Daily Review 覆盖，**Agent 不增加价值**；只有在聊天中保留额外约束、补齐真正缺失的明日安排能减轻负担时有增益。入口衔接不要求多步 Agent。

### Minimum Evidence

#### Required

明确的明日日期、用户可用时段/总时间、次日已有任务及估时、相关科目与到期复习义务。

#### Optional

今日未完成任务是否愿意延后、相关章节、用户主动选择的既往计划结果。今日 focus 不是明日规划的普遍前提。

#### Unnecessary

日记正文、心情历史、答案、附件、全部 planning history。

### Sensitive Data Boundary

用户已说“轻一点”就按约束处理，不通过日记追查原因。不要将当前 Daily Review 的元数据范围自动升级为通用助手默认范围。

### Ideal Interaction

1. 保留用户的上午/晚上限制，只补问缺失的可用时间。
2. 读取允许的明日安排与复习概况。
3. 给不冲突的轻重顺序和保留/延后说明；不自动搬动今日未完成任务。
4. 需要保存时交由明确的候选审阅与确认；跨日后重新核对目标日期。

### If Permission Is Denied

敏感材料不影响该计划；若拒绝结构化记录，则用用户提供的明日清单给草案并注明未核对现有任务。

### Success Criteria

不重复输入额外约束、不排入用户不可用时段；预算和已有任务不冲突；比直接 Daily Review 更省操作才算增益。

### Failure Modes

重新实现同一复盘流程却增加等待；遗漏聊天约束；擅自迁移未完成任务；把“帮我安排”当作写入确认。

## Scenario 7 — 行列式是不是反复错

### User

“我最近行列式是不是老错？先告诉我是不是，再看看为什么。”

### User's Actual Goal

用户现在不确定挫败感是否符合记录，需要先核实重复问题，再决定是否做针对性练习。

### Current MindDiary Experience

错题本可按科目、关键词、掌握状态或到期情况筛选。普通「错题规律分析」取得有限题目/笔记摘录，未按“行列式+最近时段”完整筛选。Mistake Review 解决到期复习安排，不分析全部历史；当前 `review_count` 是复习次数，记录不等于每次做错事件。（B2、B5、B7）

### Current Friction

用户得把“收录了几道题”“复习了几次”“实际又错几次”分开理解，还要找相关题目。直接读 due mistakes 会遗漏未到期的专题记录。

### Should Agent Retrieval Happen?

**CONDITIONAL**。统计相关记录一次查询即可；从专题样本进一步解释具体误区，且发现明确证据缺口时，才值得二次取证。不能把缺少错误事件史的问题用更多检索补成事实。

### Minimum Evidence

#### Required

“最近”的时间范围、可定位的相关题目与日期、当前掌握状态、统计口径；解释原因还需要用户实际错误步骤或明确记录的错误笔记。

#### Optional

用于辨认主题的题目短摘录、用户选定的笔记/作答片段、需要比较时的答案依据。

#### Unnecessary

日记、focus、倒计时、无关错题、全部答案或图片。复习次数不能替代错误次数。

### Sensitive Data Boundary

本地现有错题关键词搜索同时匹配答案/笔记，不能冒充“仅元数据检索”。未来只允许题目定位时不得静默搜索答案。笔记、答案、图片都应在明确的分析缺口下限定请求。

### Ideal Interaction

1. 先确定时间范围，说明能核对的是已记录错题，不一定是重复做错次数。
2. 在允许范围内定位行列式相关题，给记录数量、日期和覆盖限制。
3. 若只有复习次数，明确无法回答“又错了几次”。
4. 用户仍想分析原因时，邀请选择少量有实际错误步骤的题，不批量取答案。
5. 把有证据的错误环节与待验证假设分开，给针对性练习建议。

### If Permission Is Denied

仍报告已允许的专题记录概况，停止个体错误原因推断；可以给用户自选的常见错误检查方法，不冒充其个人诊断。

### Success Criteria

统计口径可核对；不把到期样本当完整历史；回答“是否重复错”证据不足也算成功；原因判断对应实际步骤。

### Failure Modes

把 `review_count` 当错误次数；把多道题当同题重错；只看标准答案就诊断用户错误；未经许可检索答案。

## Scenario 8 — 只讲一个知识点

### User

“给我讲讲克拉默法则，举个二元方程组的例子。”

### User's Actual Goal

用户现在不理解一个概念，希望得到条件、步骤和例子；没有请求个人学习记录分析。

### Current MindDiary Experience

直接在小研输入发送，初始无 Context；已有普通 Chat 能回答，后续可以继续追问例题。（B1）

### Current Friction

没有与本地信息获取有关的明显 friction。若草稿残留 Quick Prompt 的 Context，用户现在需移除；不应把这种负担扩大为自动“个性化”访问。

### Should Agent Retrieval Happen?

**NO。Agent 不增加价值。** 不读取 tasks、diary、mistakes、focus 或其他本地学习记录。

### Minimum Evidence

#### Required

当前问题和对话中已说明的理解程度。

#### Optional

用户主动贴出的方程或具体困惑。

#### Unnecessary

所有本地学习数据，包括科目进度。

### Sensitive Data Boundary

不因“讲得适合你”而请求个人数据；无需敏感权限。

### Ideal Interaction

1. 直接解释适用条件。
2. 按用户要求给例题和推导。
3. 根据普通对话继续澄清；不访问本地记录。

### If Permission Is Denied

没有权限请求，正常回答；用户明确说不要看记录时行为相同。

### Success Criteria

在本地学习数据零读取下回答问题，体验不比普通 Chat 多一个准备步骤。

### Failure Modes

为了推荐难度先读错题/进度；先查“你是否学过线代”；显示并未实际发生的取证进度。

## Scenario 9 — 拒绝日记后仍得到帮助

### User

“最近总是不想学习，你帮我看看为什么吧。但我不想给你看日记。”

### User's Actual Goal

用户现在想降低启动学习的困难，同时保留私人表达的边界，不想以披露日记换取帮助。

### Current MindDiary Experience

普通 Chat 能按自述回应；「心理按摩」Quick Prompt 会附上近期复盘 Context，需手动移除才不发送这些正文截取。当前没有 General Assistant 发现证据不足后分级请求日记权限的流程。（B1、B2）

### Current Friction

用户需要知道“近期复盘”包含正文；固定模板不等同于可拒绝后继续的自适应体验。结构化投入也不足以解释意愿。

### Should Agent Retrieval Happen?

**CONDITIONAL**。若用户只要支持性对话，不检索；若希望核对是否任务负荷过重且允许结构化记录，可看有限任务/投入。明确拒绝日记后不再申请同一权限。

### Minimum Evidence

#### Required

用户当下自述、明确的不看日记边界；若声称存在负荷变化，需指定时段内的任务负荷和实际记录覆盖。

#### Optional

限定时段的 focus、用户愿意手工描述的阻碍；正文仅作为另一个尚未拒绝分支的可选材料，本场景已拒绝故不读取。

#### Unnecessary

日记正文/派生摘要/心情历史、错题答案、附件、无关学习历史。

### Sensitive Data Boundary

拒绝涵盖本地读取与 Provider 发送，不用既有摘要绕过；不从少量记录推断人格或心理疾病。若先前已发出材料，不声称本次拒绝能撤回已经发送的数据。

### Ideal Interaction

1. 明确认可“不看日记”，不重复询问。
2. 提供基于用户自述的有限帮助；若其仍希望核对负荷，再在允许范围看任务/投入。
3. 指出这些记录能说明什么、不能解释什么。
4. 给一个低负担的可选起步安排，并最多邀请一次自愿补充“卡在开始还是做到中途”。
5. 用户不补充就停在有限建议，不把功能锁住。

### If Permission Is Denied

这是主路径：继续用自述和允许的事实回答，不再求取日记；连结构化访问也拒绝时仍可普通聊天。

### Success Criteria

拒绝不导致报错式结束；无隐含敏感访问；用户能得到可执行的小调整，并知道原因尚未被证实。

### Failure Modes

“不给权限就无法使用”；反复弹出授权；用心情元数据替代被拒正文；把动机不足归咎于某个无证据原因。

## Scenario 10 — 两天记录不能解释一个月

### User

“我刚用两天，帮我分析过去一个月的学习规律。”

### User's Actual Goal

用户现在想得到长期反馈，却可能误以为软件知道安装前发生的学习活动。

### Current MindDiary Experience

普通 Chat 无所选 Context 时只知道自述；学习概况提供有限近期专注与今日任务，近期复盘最多七篇；没有已实现的通用月度证据补齐流程。已有本地数据可能经导入早于安装时间，不能仅按安装天数判断覆盖。（B1、B2、B7）

### Current Friction

用户需要自己检查记录时间跨度；流畅月度总结可能掩盖样本实际不足。

### Should Agent Retrieval Happen?

**CONDITIONAL**。用户允许且有必要核对时做一次覆盖范围检查；若对话已确认只有两天记录，直接说明不足，**不需要 Agent Loop**。少数据不是不断升级权限的理由。

### Minimum Evidence

#### Required

请求的月份/日期范围，各相关记录实际覆盖天数与缺失范围；已由用户明确给出的“仅两天记录”也足以先回答限制。

#### Optional

这两天的有限任务/focus 摘要，用于明确标为短期观察；用户主动补充的较早记录。

#### Unnecessary

日记正文、全部错题内容、附件和更宽时间范围搜索。

### Sensitive Data Boundary

覆盖检查不需要阅读正文；不能以样本不足为由索要全库日记或私人文件。

### Ideal Interaction

1. 明确问题要求一个月，而当前可能只有两天记录。
2. 如有授权和必要，核对实际覆盖，区分导入记录、空白和读取失败。
3. 回答“无法可靠总结一个月”，可附已覆盖两天的事实。
4. 用户愿意再补资料才继续；否则结束，不制造趋势。

### If Permission Is Denied

直接根据自述说明限制；不补读敏感信息，仍可说明以后应观察哪些事实。

### Success Criteria

不输出无证据月度趋势；覆盖范围清楚；少量记录仍能得到有限摘要；不把安装时间视为唯一记录起点。

### Failure Modes

把两天外推成月规律；把空记录当零学习；把读取失败当不存在；为强行回答而扩大读取。

## Scenario 11 — 只调整刚才的计划

### User

“那数学少一点，我今天脑子很累。”（紧接刚给出的今日计划）

### User's Actual Goal

用户现在只想降低刚才计划的负担，希望小研记住预算与已经讨论过的安排，不必重新解释。

### Current MindDiary Experience

普通聊天带最近六条可见消息，可继续修改文本建议；上一轮完整 Context 不自动重带，原始来源也不会因助手曾说过就变成可靠证据。Today Action 则编辑候选或重新生成，不是自由对话；确认时另有最新上下文核对。（B1、B3）

### Current Friction

对话中的计划足够修改时，重新选择 Context 是多余负担；间隔较久或任务已变化时，单靠旧回答又不可靠。

### Should Agent Retrieval Happen?

**NO**（紧邻、无状态变化的主路径）。预算、偏好与刚才计划仍足够；仅当用户说已完成/删除任务、日期变化、证据缺失或要求“按现在的状态”时，转为限定刷新。

### Minimum Evidence

#### Required

刚才的计划、预算、保留约束和最新的减量要求；来源事实与建议要区分。

#### Optional

状态有变化时的相关任务最新情况，而非重新加载所有类别。

#### Unnecessary

为解释疲劳读取 focus 或日记、再次读取全部章节/错题、附件。

### Sensitive Data Boundary

“累”是规划约束，不是新的敏感授权；旧资料被撤回后不得靠保留的摘要继续使用，必要时仅用计划文本/用户自述重新讨论。

### Ideal Interaction

1. 复用仍有效的对话预算与计划，降低数学负荷。
2. 说明减少/替换了哪一段，保留用户未要求改变的安排。
3. 若用户同时说明任务已变化，只刷新涉及的状态；否则不查库。
4. 如后续要保存修改，另行审阅确认，不把聊天修订当已改任务。

### If Permission Is Denied

继续修改对话草案；无法刷新时说明未核对最新任务，不宣称安排已与数据库一致。

### Success Criteria

无需重复提问预算或选 Context；无变化时零新增读取；有变化时仅核对相关事实；不以猜测填补六条历史之外的内容。

### Failure Modes

每轮全量刷新；把旧助手答复当实时事实；把疲劳升级为日记调查；改文字却声称改了任务。

## Scenario 12 — 分析一道具体错题，需要哪些原文

### User

“这道行列式题我又卡住了，看看我哪一步错了。我可以给你看这页草稿。”

### User's Actual Goal

用户现在需要定位实际推导的错误，而非得到到期提醒或标准答案复述。

### Current MindDiary Experience

普通 Chat 可以主动粘贴题目/作答或附图片、文本、PDF 后发送；图片取决于模型声明的视觉能力。错题规律 Context 只有题目/笔记摘录；Mistake Review 排复习，不读取答案或图片来诊断推导。（B1、B2、B5）

### Current Friction

用户要手工选出题目和实际作答；存储的 `answer` 可能是标准答案而非本人作答。只说“这道”也未必足以确定记录。

### Should Agent Retrieval Happen?

**CONDITIONAL**。用户已提供完整题目和步骤时不检索；只有定位明确而仍缺必要题面/作答时才请求该题限定内容。直接附件分析已可完成时 **Agent 不增加价值**。

### Minimum Evidence

#### Required

唯一明确的题目、用户实际推导步骤及其想检查的环节；不清晰的图片需用户确认，不能自行补全。

#### Optional

本题答案中的相关步骤用于对照；用户指定的一页附件；记录错误想法的笔记片段。

#### Unnecessary

日记正文、其他错题答案、整份资料附件、focus、planning history。

### Sensitive Data Boundary

日记正文完全无关；mistake answer 仅在需要对照且用户明确允许时取；attachment 仅限指定材料，不沿关联加载同题/同日全部图片。允许这页草稿不授权整份文件，也不自动授权发送其他本地内容。

### Ideal Interaction

1. 确认是哪道题，以及草稿是否就是用户实际作答。
2. 先看用户本次主动提供的限定题面/步骤，不搜索个人记录。
3. 缺题面或关键步骤时，只指出缺哪部分并请求对应材料。
4. 如需对照已存答案，解释用途并让用户选择相关片段；不读取日记。
5. 指出可验证的第一处错误，给修正与自查；看不清或证据不足就明确停止推断。

### If Permission Is Denied

拒绝答案时仍可检查已有推导；拒绝附件时可让用户手打关键几行，或提供通用检查方法。没有实际步骤就不声称已定位个人错误。

### Success Criteria

结论对应用户真实作答；只使用选定材料；不把标准答案当用户思路；与当前附件 Chat 比，只有减少定位/搬运负担才算 retrieval 增益。

### Failure Modes

自动加载答案和全部图片；读日记寻找“为什么粗心”；把模糊图像补成确定数字；把允许本地查看等同于允许发送。

## Cross-scenario Findings

### User Jobs

由场景归纳出五类任务，而不是按技术能力分类：

| User Job | 场景 | 核心用户结果 |
| --- | --- | --- |
| 在限制下决定下一步 | 1、6、11 | 可执行、不冲突、不重复解释约束的安排 |
| 核对困难并找到可试的调整 | 2、7、9 | 事实与假设分开；证据不足或拒绝后仍有帮助 |
| 找回学习位置或先前经验 | 3、5 | 找到能核对的当前位置/带日期原文 |
| 收束与理解一段学习记录 | 4、10 | 范围真实、不过度评价的回顾 |
| 理解知识与具体解题步骤 | 8、12 | 直接讲清知识或定位提供材料中的错误 |

### Retrieval Necessity

各列是可成立的路径，非互斥功能开关。“条件”必须满足对应场景的具体缺口；“不需”不表示禁止用户主动提供材料。Structured retrieval 指有限结构化事实，**不把题目/笔记/日记摘录算作无敏感性的结构化数据**；Sensitive retrieval 包括本地读取与检索，不仅是出站发送。

| Scenario | No retrieval | Structured retrieval | Sensitive retrieval | Adaptive multi-step |
| --- | ---: | ---: | ---: | ---: |
| 1 两小时安排 | 对话已足够时 | 条件：今日事实缺失 | 条件：必要题目摘录 | 条件：发现具体冲突，非主路径 |
| 2 数学效率诊断 | 仅一般建议时 | 需要：可比投入/完成记录 | 可选且获准：指定反思 | 强候选：由异常决定补证，仍可能一次即停 |
| 3 线代进度 | 已有有效事实时 | 一次查询足够 | 不需 | 不需 |
| 4 今日复盘 | 已有今日摘要时 | 一次摘要通常足够 | 可选：用户要谈反思 | 通常不需 |
| 5 历史经验 | 用户提供原文时 | 可选：日期/覆盖定位 | 条件：限定正文搜索/节选 | 条件：找到经历后仍缺调整结果 |
| 6 明日安排 | 对话资料齐全时 | 一次/固定准备通常足够 | 通常不需；识别题目时限定摘录 | 仅真实约束缺口，非入口切换本身 |
| 7 专题错误 | 用户已给样本时 | 记录概况可一次取得 | 条件：题面/错误步骤/笔记 | 条件：概况不能解释原因 |
| 8 知识问答 | 应采用 | 不需 | 不需 | 不需 |
| 9 拒绝日记 | 自述可直接帮助 | 条件：用户要核对负荷 | 本分支拒绝，不读取 | 结构化证据不足即有限回答，不追权限 |
| 10 月度证据不足 | 已知只有两天时 | 至多一次覆盖核对 | 不需 | 不需 |
| 11 紧邻追问 | 应采用 | 仅相关状态变化时刷新 | 不需 | 不需 |
| 12 单题步骤 | 材料齐全应采用 | 仅必要题目标识定位 | 条件：指定题面/作答/附件 | 仅定位后出现具体缺失，通常可直接问用户 |

因此“需要多类数据”并不推出“需要自适应多步”。Today Action / Daily Review 已一次准备多类数据。最值得进一步比较的是 2，以及 5、7 的条件分支；这不是选择了 runtime，也不是断言这些分支比人工选择材料更优。

### Data Need Matrix

“Commonly”仅指本组场景中反复出现，不是用户频率统计。默认候选仅描述**问题相关且已有相应权限**时的 UX 候选范围，不定义最终 permission policy。

| Data | Commonly needed | Sometimes needed | Sensitive | Default retrieval candidate? |
| --- | --- | --- | --- | --- |
| tasks | 1、2、4、6 的状态/估时 | 9 负荷、10 覆盖、11 刷新 | 标题/描述可能敏感 | 是：仅相关日期/科目的有限事实，非默认全文 |
| subjects | 1、2、3、6、7 的身份/归属 | 4 分科目复盘 | 名称可能暴露目标 | 是：仅用于定位，非全科目倾倒 |
| chapters | 无普遍必要性 | 1、2、3、6 | 标题/笔记需区分 | 是：进度问题中的状态/标题；不含笔记 |
| mistakes metadata | 无普遍必要性 | 1、6、7；4 有当日有效记录时 | 学习弱项本身属个人数据 | 是：相关主题/到期/关联事实，不能伪造错误事件 |
| mistake question | 否 | 1、6 辨认复习内容，7 分类，12 解题 | 是，文本/图像均可能敏感 | 非通用默认；仅目的必要的限定片段 |
| mistake answer | 否 | 7、12 对照具体步骤 | 是 | 否，选择性授权，不能假定是实际作答 |
| Pomodoro/focus | 否 | 2 投入对比、4 日汇总、5 有效时刻证据、9 负荷、10 覆盖 | 个人活动时间敏感 | 仅投入问题的有限汇总候选，不是每个计划必需 |
| countdown | 否 | 1、6 用户明确涉及考试期限 | 目标日期可能敏感 | 非通用默认，仅期限决策需要 |
| planning history | 否 | 1、2、5、6 明确涉及先前计划 | 候选文字/结果可能敏感 | 否；不是长期记忆或效果评分 |
| diary metadata | 否 | 5 定位、10 覆盖 | 标题、心情尤其敏感 | 仅必要日期/覆盖可研究；标题/心情非默认 |
| diary body | 否 | 2、4、5 限定反思；9 已拒绝 | 高敏感，节选/派生摘要也继承 | 否 |
| attachments | 否 | 12 用户指定材料 | 高敏感，可能含他人信息 | 否 |

mistake notes 在 7 的原因分析中可能有用，但不是元数据，也不能借“题目已允许”顺带读取。仅返回元数据的搜索若内部匹配正文/答案，仍计入相应敏感访问。

### Current Feature Coverage

以下“覆盖良好”是对现有行为与场景任务匹配的源码判断，不是用户满意度实测。

| 覆盖 | 场景/子问题 | 当前能力 | 真正剩余问题 |
| --- | --- | --- | --- |
| Already solved well | 8；11 对话信息齐全；12 主动附材料 | Ordinary AI Assistant 的问答、最近消息和附件 | 不应因 Phase D 加自动记录访问 |
| Already solved well | 1 无额外复杂约束的候选规划 | Today Action 自动准备、预算、去重、确认 | 剩余时间语义和自由约束不应被忽略 |
| Already solved well | 4 执行摘要；6 标准次日候选 | Daily Review 本地事实、洞察、候选、确认 | Chat 衔接与主观质量不是同一任务 |
| Already solved well | 7 中“接下来复习哪些到期题”子问题 | Mistake Review 自动准备到期集合与安全确认 | 不覆盖历史错误频率和原因 |
| Partially solved | 3；1、6 自由聊天请求 | 科目界面、学习概况、固定规划入口 | 精确取一项事实、保留自由约束；未证明需要循环 |
| Partially solved | 5 明确关键词；7 有合适摘录 | 本地搜索、错题规律 Quick Prompt | 限定范围、匹配口径、主动定位与有用的补证 |
| Partially solved | 9、10 | 普通 Chat 可有限回应，数据已有部分汇总 | 一致的拒绝后继续与覆盖说明尚非通用产品保证 |
| Poorly solved | 2 跨时段数学诊断；5 模糊历史经验；7 有实际作答的原因比较 | 无对应的通用按问题取证流程 | 优先研究真实缺口，不能以此跳过授权或先建架构 |

### When Not To Use Agent

#### Agent Non-Goals From UX Evidence

- 纯知识解释（8）；知识问题不默认个性化读取。
- 当前对话/用户提供材料已足够（11、12，及 1/6 的完整自述分支）。
- 一次确定性查询即可答复（3、10 的覆盖核对、7 的记录统计）；可以改善查询入口而不启动 Agent Loop。
- 固定 specialized workflow 已满足目标（1、4、6 的常规路径、到期复习安排）；不为架构统一重做。
- 用户明确禁止访问（9）；拒绝不能用派生摘要、替代敏感字段或反复追问绕过。
- 本地根本没有所需证据（7 的错误事件史、10 的月度历史）；再检索不能制造事实。
- 只是要解释或调整一个草案，不意味着要确认创建、完成、删除、迁移任务（1、6、11）。

### Surprises / Hypotheses Revised

1. “普通聊天让用户自由选择任意 Context”不准确：当前实际是 Quick Prompt 关联类别，再允许移除；这让简单事实查询的准备成本更具体。（B1）
2. “主动准备数据是 Agent 独有价值”被现有实现推翻：三个 specialized workflow 都已经做了固定准备，Mistake Review 甚至在打开后就生成。（B3–B5）
3. focus 不是规划的普遍前提：Today Action 不接入通用 focus history，而仍有完整候选流程；本文中它主要在诊断和复盘有用，不足以证明学习效率。（1、2、4）
4. 不需要日记正文也能做今日执行复盘；但现有元数据及本地对象加载不能被说成“完全没有日记访问”。（B3、B4）
5. “近期复盘”不是严格七天，“复习次数”不是做错次数，“历史执行结果”不是建议质量。这些语义误读会比缺少技术能力更早破坏信任。（B2、B6、B7）
6. 12 个场景中的多数主路径不要求自适应多步；这是本研究集的结论，不是用户需求比例，也不构成取消未来能力的量化证据。

## Experience Principles

| 候选原则 | 场景结论 | 适用限制 / 可被推翻的条件 |
| --- | --- | --- |
| Progressive Retrieval | 2、5、7 支持先取得直接证据，再按明确缺口升级 | 8、11 无需第一步；12 已提供必要材料时无需仪式性元数据查询。额外读取未改变答案或可靠性就停止 |
| Minimum Necessary Context | 3、8、12 强支持限定问题范围 | 裁剪不能掩盖必要证据丢失；统计、趋势要明确范围/覆盖，不能只追求少字符 |
| Evidence Before Advice | 1、2、4、7、10 支持建议附可核对依据 | 9 可以先基于自述帮助；不能以没给本地权限为由拒绝一般建议，也不能把自述说成数据库事实 |
| Graceful Degradation | 9 为主用例，5/12 为验证分支 | 降级允许改为有限答案/自述；缺实际步骤时停止个人诊断，不假装质量等价 |
| No Retrieval By Default | 8、11、12 材料完整分支支持；3 已知有效进度同理 | 不是忽视用户明确要求的当前事实；过期/删除/撤回的来源不能无条件复用 |
| Specialized Workflow Preservation | 1、4、6 和到期复习支持 | 只有在同等数据、相同确认/失效边界下，用户可观察结果确有改善，才值得单独讨论迁移 |

## Candidate Problems For D0.2

仅形成问题，不选择实现：

1. General Assistant 哪些提问需要“今日学习状态”，哪些只需要一个科目事实？
2. 科目进度怎样表达才不混淆汇总完成数、详细章节和实际理解？是否需要一致的 bounded projection？
3. 剩余可用时间和已有活跃任务估时如何让用户不重复计算？
4. Focus summary 在何种比较口径下提供独立价值，何时只增加噪声？
5. 如何让用户区分本地反思搜索、选定节选和发送给 Provider，同时保留拒绝后的帮助？
6. 哪些明确缺口值得第二次 retrieval，哪些应直接向用户问一句或停止？
7. 专题错题记录能回答哪些频率问题，缺少实际错误步骤时应怎样限定原因分析？
8. Chat 接入既有规划体验能否先解决入口切换负担，而无需通用多步流程？
9. 追问时哪些事实仍有效，哪些变化应让用户看见一次必要刷新？
10. 历史经验的关键词搜索何时已足够，什么失败证据才值得进一步研究 D7？

## Open Questions

- 真实学习者最常遇到哪些场景、当前入口切换实际占用多少精力？本研究没有访谈或行为频率数据。
- 用户说“效率”“最近”“又错”时使用的口径是否一致？应怎样最少打断地澄清？
- 精确题目定位、同义历史描述和跨日安排对首次有用结果的等待影响多大？尚无性能测量。
- 用户是否知道当前 Quick Prompt 会附什么、发送成功后清空什么？标题/心情是否被误认为不敏感？
- 所需科目/时刻关联在真实记录中是否足够完整？缺失不能通过推断伪造，是否仍能产出有用对比？
- Parent 后续如何选择最小配对样本与验收阈值？本次只提供以下人工研究复现基线，不建立完整 eval 系统。

### Proposed comparison protocol (not executed)

后续如获授权，以合成或用户明确批准的最小材料，在同一日期、问题、任务状态、数据覆盖和权限条件下，分别走当前入口与拟议体验。当前路径中的手工 Context 选择/粘贴要计入用户操作；拟议路径不能靠获得更多未授权材料占优。记录首次可用结果、上下文准备操作、必要澄清、读取/发送类别、证据正确性、重复或预算冲突，以及停止/拒绝行为；未来实现后再量取延迟/调用成本，不在本文编造正式数值阈值。

| 场景 | 最小合成条件 | 当前对照操作 | 预期观察点 |
| --- | --- | --- | --- |
| 1 | 剩余 120 分钟，已有活跃任务和到期线代题 | Today Action 填预算、查看依据、生成 | 不重复扣预算/新增重复复习；自由约束是否减少手工编辑 |
| 2 | 两个可比时段，数学投入与完成量不一致 | Chat 手动提供跨时段事实 | 第二次取证是否确实排除一个假设，而非仅增加文本 |
| 3 | 线代有已完成/未完成章节 | 科目界面；Chat 学习概况 | 一次事实回答即可，无其他类别访问 |
| 4 | 今日任务、focus；有日记但不许读正文 | Daily Review 本地预览/生成 | 无正文仍有用；区分估时与实际记录 |
| 5 | 时间段内两篇相似经历，另有无关私人篇目 | 本地日记关键词搜索并选节选 | 找到日期；未找到不扩权；尝试与有效分开 |
| 6 | 明日已有任务、上午不可用、晚上轻量 | Daily Review 预算/策略/候选编辑 | 不漏额外约束，不自动移动今日任务 |
| 7 | 多道专题题，只有 review_count，没有重错事件 | 错题筛选/错题规律 Quick Prompt | 不报虚假的重错次数；仅有实际步骤才分析个人原因 |
| 8 | 无 Context 的知识问题 | 普通 Chat | 本地学习记录零访问，无额外准备 |
| 9 | 允许任务事实，拒绝日记 | 普通 Chat 自述；移除近期复盘 chip | 不再求权、不读派生摘要，仍有有限帮助 |
| 10 | 请求一月，实际只有两天；另设有导入历史分支 | 用户手动检查记录/告知 Chat | 以真实覆盖为准，不凭安装时间或空白造趋势 |
| 11 | 紧邻计划追问；另设已删任务或日期变化 | 普通 follow-up；规划候选编辑 | 主路径零读取，变化分支只刷新相关事实 |
| 12 | 一页实际推导，未允许其他答案/图片 | 普通 Chat 主动附件 | 只分析指定材料，缺失处停止猜测 |

跨场景还应保留以下反例供后续评估，并非本次已执行测试：1/6/11 的失效或已删除来源与跨日；2/5 的读取失败不冒充空记录；5/9/12 的取消/撤销后停止新增访问与结果使用；任何场景的无效来源引用不作为证据；Provider 失败时保留有用本地事实而不谎称生成成功。所有场景均不因自然语言请求直接写任务。

## Non-decisions

本次没有决定或实现：

- Agent Runtime architecture、Model Runtime。
- Tool names、Tool schemas、Provider API format。
- Tool Calling implementation、Agent Loop implementation、Tool Registry。
- Data Grant implementation、最终 permission policy。
- Prompt design、Context compaction、Memory architecture。
- FTS / RAG / embedding、MCP、LangGraph。
- Subagents、Multi-agent。
- schema changes、migration、dependencies、UI implementation。

也没有批准 runtime 迁移次序、正式性能阈值或 D7；没有 commit、push、PR、Issue mutation、merge、release。本文中的交互步骤不是技术架构或 UI 实现方案。

## Validation Record

- 已核对当前本地/远端 main SHA；当前实现文件没有工作区改动，文档规则来自已有工作区版本。
- 12 个场景均按统一模板包含 User、Goal、Current Experience、Friction、YES/NO/CONDITIONAL、Required/Optional/Unnecessary、敏感边界、3–8 步交互、拒绝后处理、成功标准、失败模式。
- 覆盖：no-tool（8）、permission denied（9）、insufficient evidence（10）、historical pattern（5）、adaptive retrieval 候选（2，5/7 条件分支），以及 diary body / mistake answer / attachment 必要性（12，另有 2/5/9）。
- 每个 Current Experience 已与 B1–B8 逐项交叉核对；尤其复核 Context 的真实入口、近期复盘时间口径、Today Action 预算、Daily Review 元数据、Mistake Review 自动生成、Planning History 范围和复习次数含义。
- 代码事实与理想交互明确分隔；没有把 proposed Phase D 读取/分级权限/循环写成 current behavior。
- 文档级检查：12 个场景结构、每场景 3–8 步交互、32 个相对链接检查通过；`git diff --check` 与新增未跟踪文档的单独 diff 空白检查通过。仓库 package scripts 和 CI 未配置独立文档检查。本次不运行无关应用测试，不声称已有测试或人工运行通过。
- 此处是研究可审查状态，不是用户验证、性能验证或 Parent Gate 结论。
