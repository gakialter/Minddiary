# D1.3 Implementation Contract & Eval Lock

## Status

**D1.3 文档完成，供 Parent 审查；未开始 implementation。D1 NOT COMPLETE：唯一剩余阻塞项是 Parent 接受本文的资源比较、样本/重复与收益条件锁定包。** 无需新增 D1.4；Parent 接受该包后 D1 可 COMPLETE，后续工作属于另行授权的 D2/D3/D4 gate。

输入状态按本次授权：D0 COMPLETE；D1.1 Parent accepted；D1.2 architecture accepted with one required narrowing。当前 D1.2 已有 scope 收紧，本次 Step 0 仅把其中合并的一行拆成 request 与 session 两行，明确“接下来这段不要用日记”不写成永久设置；其余架构不变。

本文冻结未来实现合同，不是运行结果。下文 TypeScript 是文档内的形状约定，不创建源码、测试、IPC 或运行模块。架构约束已锁；评估建议等待 Parent 接受，不能把本次设计授权当作 Parent 已接受评估数值或实现授权。

## Baseline

2026-09-25，Asia/Singapore，分支 `main`。实际核对：

| 位置 | SHA |
| --- | --- |
| HEAD | `87fef52eba451a38226b4e04e701d79c431eddfe` |
| local main | `87fef52eba451a38226b4e04e701d79c431eddfe` |
| origin/main | `87fef52eba451a38226b4e04e701d79c431eddfe` |
| remote refs/heads/main，git ls-remote | `87fef52eba451a38226b4e04e701d79c431eddfe` |

未 fetch、切分支、暂存或提交。开始时 AGENTS.md 与 roadmap 已修改，D0.1–D0.4、D1.1、D1.2、output/ 未跟踪；保留全部既有内容，不访问 output/ 或真实学习数据库。D1.2 在 Git 中仍是 untracked，但本次对它属于编辑已有文件，不能仅靠 git diff 检查其变化。

已读 [AGENTS](../../AGENTS.md)、[AI contracts](../agents/ai-contracts.md)、[Electron boundary](../agents/electron-boundaries.md)、[persistence](../agents/persistence.md)、[roadmap](minddiary-ai-study-agent-roadmap.md)、[D0.1](D0-learner-experience-scenarios.md)、[D0.2](D0-evidence-retrieval-model.md)、[D0.3](D0-access-disclosure-boundaries.md)、[D0.4](D0-minimum-product-capability-eval-baseline.md)、[D1.1](D1-current-baseline-minimal-design-boundary.md) 与 [修正后的 D1.2](D1-minimal-first-slice-architecture.md)。旧阶段状态是当时交付记录，不覆盖本次授权。

源码只核对下列 allowlist 及复用 seam。当前 [schema](../../electron/databaseMigrations.ts) 为 8；[aiService](../../electron/aiService.ts) 支持 fetchImpl 注入；[conversation builder](../../src/utils/aiConversationBuilder.ts) 已是纯格式化；[repository factory](../../electron/repositories/databaseRepositoryFactory.ts) 使用 ReturnType 推导接口。D1.1 synthetic baseline 为继承证据，本次没有重新测量。

## Accepted Architecture

Option B 固定：AIPanel → local classify / clarify / refusal gate → 两种固定 Evidence Request → trusted-main narrow resolver → Evidence Envelope → 本地事实回答，或独立 Disclosure Projection → existing conversation / aiService。不再比较 Option A/C。

- S3：指定科目章节事实，本地回答后停；Provider = 0。
- S2：meaning、subject、period A/B 完整后，一次预定 focus batch；先本地分钟结果；明确允许才最多一次 Provider 解释。不取 task、不二次补证。
- S9：先拒绝/撤回再回答；整个旧 user+assistant 前缀停止复用；旧 snapshot 无效；晚到结果丢弃；当前独立自述可继续。
- Schema = 8；migration / tool calling / Adaptive Retrieval / Workflow Migration / segment provenance / provenance graph/database = No。

## Production File Allowlist

以下为未来实现的**封闭上限**，不是本次修改许可，也不要求每个文件一定产生 diff。每项仅允许表中职责；不含“相关文件按需修改”。共 **11 个 existing production files + 2 个 new production modules**。

### Existing files allowed to modify

| 文件 | 必须支持的 locked behavior / 允许修改范围 |
| --- | --- |
| [src/components/AIPanel.tsx](../../src/components/AIPanel.tsx) | builder 前澄清/拒绝；本地事实；受控 send/cancel/regenerate；显示与可复用历史分开；loading 中仍接收撤回；在本组件显示限制与不可重生原因 |
| [src/types/api.ts](../../src/types/api.ts) | 本文固定 shared types、ElectronAIAPI / AIContextAPI 的 AIPanel 受控方法；不修改学习/规划持久模型 |
| [src/contexts/api/aiApi.ts](../../src/contexts/api/aiApi.ts) | 新方法转发；browser 返回 unavailable；原 chat 保留给独立调用者，不作为 AIPanel fallback |
| [electron/preload.ts](../../electron/preload.ts) | 窄 typed invoke；不暴露通用 IPC、SQL、settings 写能力 |
| [electron/main.ts](../../electron/main.ts) | 注册受控 handler、验证 sender/会话所属窗口、窗口销毁/reload、配置更改失效；不改专用 workflow handler |
| [electron/ipcValidation.ts](../../electron/ipcValidation.ts) | exact object keys、两个 variant、日期/引用/opaque token/限制范围的运行时校验 |
| [electron/database.ts](../../electron/database.ts) | 转发新只读 projection，短只读快照，连接/本地变更代次与 data_version；既有科目/章节/focus 写入、restore 成功处仅增加失效标记；复用现有 settings 读写，不改备份格式 |
| [electron/aiService.ts](../../electron/aiService.ts) | 受控请求在实际 fetch 前同步核有效性和实际 normalized destination；结果采纳前检查；保留原 adapter/参数/错误语义 |
| [electron/repositories/subjectsRepository.ts](../../electron/repositories/subjectsRepository.ts) | 精确 id/name identity、仅明细成功空集后的单科 aggregate；不改原 CRUD |
| [electron/repositories/subjectChaptersRepository.ts](../../electron/repositories/subjectChaptersRepository.ts) | 仅 title/sort_order/completed 的只读 projection，不走 SELECT * assertSubjectExists/syncSubjectSummary |
| [electron/repositories/pomodoroRepository.ts](../../electron/repositories/pomodoroRepository.ts) | 单 subjectId、两期固定分钟和记录日数聚合；现有 chart 查询不改 |

[AIComposer](../../src/components/ai/AIComposer.tsx) 不需修改：textarea 在 loading 中仍会通过 Enter 调用 onSend，AIPanel 先处理限制再做普通发送 loading 检查；指针用户所需的明确“提交限制”控制可在 AIPanel 自身显示并调用同一 gate。禁止让普通生成并发绕过 gate。这是现有对话提交行为的小接缝，不增加 permission UI。

### New files allowed to create

| 文件 | 独立必要职责 |
| --- | --- |
| `src/utils/aiFirstSlice.ts` | 当前文字/确认 slots 的 deterministic gate、语义模板、局部交互状态；不读学习集合，不拿 entry/凭据，不维护可信 epoch |
| `electron/aiFirstSlice.ts` | 固定 resolver、session/request 内存状态、restrictions、投影、历史与快照有效性；main 是唯一可信 owner |

**最终保留两个，最多两个。** renderer 的纯交互与 main 的特权状态不能合并成跨进程共享运行模块；塞入 AIPanel/main 大文件会把可单测逻辑与 UI/启动绑定。类型放已有 api.ts，不设第三个 contracts、policy、session-store、tool 或 telemetry 文件。

逐项排除：`src/utils/aiConversationBuilder.ts` 已接受 history/contextSections，main 只传合格材料即可，无必要修改；`databaseRepositoryFactory.ts` 自动推导新增方法，无需改；`settingsRepository.ts` 已有 getSetting/setSetting，无需改；`AIMessageBubble.tsx` 已能通过省略 onRegenerate 隐藏按钮，原因在 AIPanel 显示，无需改。若实际实现证明上述复用不成立，STOP AND REPLAN，不能静默加文件。

## Protected Files / Stop-and-Replan Areas

**allowlist 以外所有 production files 禁改。** 特别保护：TodayActionSuggestionDialog、DailyReviewAgentDialog、MistakeReviewAgentDialog 及其 utils；Planning History 类型/实现/schema；confirmed action execution / receipts；Selection Polish；entriesRepository（diary）、mistakesRepository、studyTasksRepository；databaseMigrations 与备份格式；package.json/lockfiles、tsconfig、构建配置；Provider 配置 UI；无关页面、样式、Direct UI、Quick Prompt 模板、promptTemplates、aiContextBuilder、useAIComposer、附件解析器。现有通用 validator/formatter 可调用，不借机重写。

scope 更窄的手动 Context 若旧 builder 不适配，调用前停用该材料，不能为保留它修改受保护仓储。其他工作流不会自动继承 AIPanel 限制；不得声称全应用权限已统一。用户要求跨工作流 enforcement 属于 STOP AND REPLAN，不用修改 planner 来凑首版。

## Contract Definitions

### Evidence Request

类型位于 api.ts；所有字符串/数字仍须 main runtime validation，TS 品牌不产生权限。

```ts
type SubjectRef = { by: 'id'; id: number } | { by: 'exact_name'; name: string };
type Period = { startDate: string; endDate: string }; // YYYY-MM-DD, inclusive
type EvidenceRequest =
  | { kind: 'subject_progress'; subject: SubjectRef }
  | { kind: 'focus_comparison'; subject: SubjectRef; periodA: Period; periodB: Period };
type SubjectIdentity = { id: number; name: string };
type StopReason = 'enough' | 'ask_user' | 'denied' | 'insufficient'
  | 'read_failed' | 'invalidated' | 'unsupported';
```

只允许列出的 keys，拒绝 prototype/extra key、任意 fields/where/SQL/includeNotes/includeTasks/tools/categories。id 为 positive safe integer；name 为非空完整用户确认名称，不做别名/模糊/Unicode 近似替换。仅去除输入界面外围空白；实际查询精确二进制名称匹配，不以“线代”推断数据库名称“线性代数”。日期须是真实日历日，起止不倒置；A/B 不重叠，时长可不同但必须明示，不自动归一或补齐。

meaning = recorded_study_time 在 gate 已确认，由 focus variant 固定，不再允许客户端传其他 meaning。subject_progress 不接日期/历史状态参数。identity lookup 本身算学习访问；S2 slots 缺失时连 lookup 都不能发生。

解析结果为 `resolved`（main 才持有可信 envelope）、`ask_user`（只给 id/name 候选，或缺失 slot）、`stopped`（上列 stop reason）。删除 id 与不存在 id 均 unavailable，不声称能区分删除史。重名不查 notes/任务；用户无法区分则 Direct UI 后给明确 id。候选 id 仍须再次校验所属请求、当前存在与精确选择。

### Evidence Envelope

不是 generic Result/metadata 框架。两个输出结构如下，均由 main 构造；失败的 value 不伪造零。

```ts
type ProgressEnvelope = {
  semantics: 'chapter_marks';
  sourceCategory: 'subject_progress';
  scope: { subject: SubjectIdentity; observedAt: string };
} & (
  | { status: 'ok'; value: { completed: number; total: number; nextTitle: string | null };
      coverage: 'detail' | 'aggregate_only' }
  | { status: 'empty'; value: null; coverage: 'no_chapter_records' }
  | { status: 'failed' | 'unavailable'; value: null; coverage: 'unknown' }
);
type FocusPeriodResult =
  | { status: 'ok' | 'empty'; recordedMinutes: number; observedDateCount: number }
  | { status: 'failed' | 'unavailable'; recordedMinutes: null; observedDateCount: null };
type FocusEnvelope = {
  semantics: 'recorded_focus_minutes';
  sourceCategory: 'focus_comparison';
  scope: { subject: SubjectIdentity; periodA: Period; periodB: Period; observedAt: string };
  status: 'ok' | 'empty' | 'partial' | 'failed' | 'unavailable';
  value: { periodA: FocusPeriodResult; periodB: FocusPeriodResult };
  coverage: { realStudy: 'unknown'; unassigned: 'excluded_not_measured' };
};
type EvidenceEnvelope = ProgressEnvelope | FocusEnvelope;
```

subject 未解析时不造 envelope，返回上述协调结果。observedAt 是可信 main clock 的 ISO instant，仅本地说明“核对时记录”，不承诺历史回放。scope 的 dates 是请求范围；删除 observed start/end、MIN/MAX、session count 和自由 metadata。完整章节列表仅供 repository→resolver 计算，envelope 不带全标题列表、notes、排序 id。

Progress：detail 的 nextTitle 为排序后第一未标完成项；全部已标完成时 null；aggregate_only 一律 null。计数为非负整数且 completed ≤ total；矛盾值为 failed，不裁成合理数字。明细成功且零行才能查 aggregate；aggregate 0/0 是 empty，不是“全部学完”。

Focus：empty 仅 SQL 成功且 observedDateCount=0，分钟=0；有记录日期但记录总分钟为 0 仍 ok。SQL/数值异常为 failed/null；非有限或负分钟不吞成 0。两期均成功且均空 → empty；两期均成功且至少一期有记录 → ok；恰有一期可用 → partial；均不可用且存在失败 → failed，否则 unavailable。失败一期禁止差值。总 status 不能抹掉分期状态；realStudy 永远 unknown，不能用 observedDateCount 宣称完整覆盖现实。

### Session / Request Handle

```ts
type SessionHandle = string; // opaque, untrusted on IPC input
type RequestHandle = string; // opaque, untrusted on IPC input
type FirstSliceRequestInput = { session: SessionHandle; request: EvidenceRequest };
// main-only, never reconstructed from renderer payload
type RequestValidity = 'active' | 'completed' | 'invalid';
type RequestStamp = {
  requestId: string; epoch: number; validity: RequestValidity;
  destinationRevision: number | null;
  connectionGeneration: number; dataRevision: number;
  externalDataVersion: number; observedDate: string;
};
```

main 创建 session/request identity、epoch 和 stamp；session 绑定 sender webContents + frame 身份与本次会话。renderer 只得到 opaque tokens、本地 envelope、显示状态和原因。stamp、可信 evidence、有限 reusable history、sources 并集、当前有效披露决定与快照只留 main 内存。token 必须在 main 表中命中且匹配 owner/session/epoch/state；随机/跨窗口/旧 token 不导致查询或发包。客户端给 epoch、sources、verified evidence、destination revision 均不接受。

受控 transport 固定为 `openSession`、`resolveEvidence`、`send`、`restrict`、`cancel`、`regenerate`、`closeSession`；在现有 ai namespace 下新增同名 `ai:firstSlice:*` channels，不提供通用 action/工具执行。每个方法只取当前 session、必要 handle 和对应固定 payload。openSession 不接受旧 lineage；close/cancel/restrict 独立于生成 loading，不能排在网络完成之后。

`send` 分两种输入：S2 的 evidence handle + 当前解释请求/针对该摘要与当前目的地的明确分享决定；普通 Chat 的当前 userInput 与本次选定、范围可检查的既有 Context/附件。两者都不接收 renderer visible history、raw requestMessages、system override 或可信来源声明。legacy 材料按 main 可验证的类别/当前选择保守处理，未知来源为 unknown，限制冲突时整体排除。既有长度/图片 validator 仍执行。main 调用现有 builder 时自己提供合格 history；AIPanel 禁用 raw ai.chat 旁路。

`restrict` 只接受下节的负向范围及本轮直接用户指令；模型、Context 内容、旧历史不能触发授权/解除。主进程须检查当前指令与范围/lifetime 一致，不能只相信 renderer 的 durable 标记。`regenerate` 只取 session + request handle，不能携带替代 body；返回内容或固定 unavailable reason。local-only evidence 永远不能作为普通 Chat history 自动纳入。

来源变更按 D1.2 内存代次核对：database forwarding 已有 subject/chapter/focus 写入、恢复/导入/连接更换，以及外部连接 PRAGMA data_version。连接、日期或数据变更立即使相关记录请求不可延后发送/采纳；不自动重查。无法可靠读取标记则停止延后 Provider 路径。main 的来源并集取自实际材料，不把 renderer 标签或模型回答当验证。

### Restriction Scope

**temporary refusal != durable global preference。** 以下只是 AIPanel 小状态，既不授予新权限，也不是 DataGrant framework。

```ts
type RestrictionLifetime =
  | { kind: 'request'; request: RequestHandle }
  | { kind: 'session'; session: SessionHandle }
  | { kind: 'durable_preference' };
type RestrictionTarget =
  | { category: 'diary'; operation: 'use' | 'disclose' }
  | { category: 'all-outbound'; operation: 'disclose' };
type RestrictionQualifiers = {
  purpose: 'this_question' | 'this_conversation' | 'aipanel_default';
  object: 'category' | { diaryId: number };
  destination: 'all' | { normalizedEndpoint: string };
};
type Restriction = {
  lifetime: RestrictionLifetime;
  target: RestrictionTarget;
  qualifiers: RestrictionQualifiers;
};
```

这是固定负向词汇，不是第三类 evidence；diaryId 仅可用用户已明确的引用，不为设置限制访问 diary。`use` 包括本地 AI 使用及派生复用，因此也不能披露；`disclose` 单独禁止出站，不自动禁止本地。all-outbound 仅 object=category，且不暗含本地禁止。purpose/object/destination 必须符合原意，all 仅在表达未限定目的地且确为该范围时使用。特定日期/field 等上述类型表达不了的更窄拒绝，保留为当前未决交互并阻断可能冲突材料、本地问清，不伪装成更宽 durable 设置；新持久范围类型需 replan。

| 原始表达 | lifetime 与落地 |
| --- | --- |
| “这次别发日记”“这次别发给 AI” | request；main 在任何 builder 前为本轮建 handle；只约束该请求及其重放，不写 settings |
| “接下来这段不要用日记” | session；覆盖当前会话安全边界，epoch 改变不自动解除；新无关会话不变成永久全局拒绝 |
| “以后默认不要把日记发给这个 Provider” | durable_preference；diary/disclose + 精确 normalized endpoint + AIPanel 默认目的；不扩到本地或其他 Provider |
| “以后在这里一直不要发给 AI” | 仅明确长期且范围为 AIPanel 的 all-outbound/disclose 才可持久化；一次“这次别发”绝不写长期开关 |
| “不要用那段”“别再这样”且对象/期限不明 | 先阻断冲突的旧材料并本地澄清；不猜成永久偏好 |

existing settings 仅新增固定键 `aiFirstSliceRestrictionsV1`，值为经 main 严格验证的 durable negative preference 列表的 JSON 字符串（仅 target、qualifiers；不存 session/request handles、epoch、正文、provenance、allow grant、原始指令）。purpose 必须 aipanel_default；特定 object/provider 保留。普通“可以”、新 chip、模型输出不能删除它。显式用户改变相同范围才更新；本版不新增持久 allow。保存失败当前拒绝仍生效，告知长期偏好未保存；读取损坏对相关使用 fail closed，不写更宽替代值。备份继承现有 settings 机制，不改变格式/迁移；恢复后按恢复库重新读负向偏好并销毁旧 session。

短期范围自然结束不等于旧 history 获准复用：旧前缀/快照不可逆失效。reload 无法关联旧短期 scope 时，旧材料与待续发送 fail closed，但不得把不确定性写为永久 restriction；新独立请求按自身范围及 durable preference 判断。

## Clarification Contract

只锁行为 fixture/slots，不设计万能 NLP。入口仅看当前用户文字、本次已确认 slots 和限制状态，不看学习记录、entry prop、旧 diary 回答或模型分类。先处理拒绝，再判断 S3/S2，再判断普通 Chat。

| 类别 | 支持形状 / fixture | 行为 |
| --- | --- | --- |
| Supported S3 | “线代现在学到哪里？”；明确某科的章节进度请求 | intent=subject_progress，subject exact name/id；唯一命中读明细，重名本地问，不推断别名 |
| Supported S2 | “比较数学 2026-09-07 至 2026-09-13 与 2026-09-14 至 2026-09-20 的记录学习时间” | meaning=recorded_study_time + subject + 两个 inclusive Period 后 resolve |
| Ambiguous S2 | “最近数学效率下降” | 问含义与两期；所有学习 access=0，Provider=0 |
| Partial slots | 已回答“记录投入/数学”，只给 A | 只追问 B；不重问已知项；未齐仍零读零发 |
| Ambiguous dates | 最近/上次/倒置/重叠/无年份且不能明确 | 本地确认绝对日期；不静默替换成七天，不按毫秒推本地日历 |
| Supported S9 | “不看日记但帮我分析”“接下来别再用日记”“这次别把日记发出去” | 固定 diary/use 或 disclose、request/session；先 boundary；当前独立自述可继续 |
| Durable S9 | 上节明确长期默认表达 | 单独匹配长期意图/范围后才允许写负向设置 |
| Supplied sufficient | 用户已主动提供两期日期/分钟/覆盖不明的完整材料 | 不做 identity lookup，不造数据库 envelope；标 user_message，零 query，按普通 Chat 允许的材料回答 |
| Unsupported records | 效率因果、理解变化、任务历史完成、日记搜索、错题检索、第三 evidence type | 有自述则有限答；需应用事实时 Direct UI 或说明缺口，不猜、不加取证 |
| Ordinary Chat | “讲克拉默法则”及无记录需求的提问 | 当前安全边界内现有 Chat，零新增学习数据；仍守 restrictions |

含未解析的拒绝或疑似记录需求不能自动发普通 Chat 带宽 Context。未支持表达先有限说明/问清；ordinary Chat fallback 只在发送当前材料的意图明确且边界可满足时成立。不加 model classifier、embedding、regex 大词典或 NLP dependency；细微表达变体实现由固定 fixtures 验证，不声称任意自然语言覆盖。

## Repository Projection Contracts

方法名锁定为下表；同一个 main resolver 内执行预定短只读快照。SQL 文本写法由实现决定，逻辑 SELECT/WHERE/ORDER/GROUP 必须等价且测试观察实际语句与绑定值。禁止 SELECT * 后投影；匹配/排序字段也计访问。查询计划物理页扫描不等同于应用能保证的列级磁盘隔离。

### Subject Identity

| 项目 | 合同 |
| --- | --- |
| Operation / input | subjectsRepository.resolveFirstSliceSubject(ref: SubjectRef) |
| Logical fields | subjects.id、name，仅这两个；id/name 在 WHERE 中也计入 |
| WHERE / order | id=? 或 name COLLATE BINARY =?；无 LIKE、alias、JOIN；同名候选按 id 稳定排序 |
| Output | zero / one / multiple 的 id/name；多命中不得读取其余内容，返回 ask_user |
| Failure | 无命中 unavailable；SQL error failed；非法 ref 在进入仓储前拒绝 |
| Forbidden | getAllSubjects、SELECT *、color、进度字段、notes、task relation、其他名称探索 |

重名身份确认是暂停同一预定 batch，不是第二轮 adaptive evidence；恢复必须检查新选择/来源有效性。报告每次 identity SQL，不能隐藏重名带来的操作成本。

### Subject Progress

| 项目 | 合同 |
| --- | --- |
| Operation / input | subjectChaptersRepository.getFirstSliceProgressRows(subjectId) |
| Logical fields | subject_id 用于匹配；title、sort_order、completed；id 仅 ORDER BY 稳定排序内部使用 |
| WHERE / order | subject_id=?；ORDER BY sort_order ASC, id ASC；不 JOIN subjects 或其他表 |
| Output | 仅 title/sort_order/completed 行，main 计算计数与 first incomplete title |
| Failure | SQL error failed；不吞空、不 fallback；非法 completed/计数关系 failed |
| Fallback operation | subjectsRepository.getFirstSliceProgressAggregate(subjectId)，**仅明细成功且零行**；SELECT total_chapters,completed_chapters WHERE id=? |
| Fallback output | counts 或 unavailable/failed；aggregate_only 无 nextTitle；0/0 empty；不 sync/修复数据库 |
| Forbidden | notes、其他 subjects、task、mistake、diary、focus；现有 assertSubjectExists SELECT *；所有写入 |

身份+detail（条件 aggregate）为一个预定 batch。成功 detail 不再读 aggregate 佐证；read failure 不变成汇总成功。S3 不返回“实际学到/已掌握”，只报告标记。

### Focus Comparison

| 项目 | 合同 |
| --- | --- |
| Operation / input | pomodoroRepository.getFirstSliceFocusComparison(subjectId, periodA, periodB) |
| Logical fields | 仅 subject_id、date_key、duration |
| WHERE / GROUP | A/B 在开始前固定；各自 subject_id=? AND date_key BETWEEN start/end；两条同快照聚合，无 JOIN、无跨科 GROUP |
| Aggregates | COALESCE(SUM(duration),0) 与 COUNT(DISTINCT date_key)；保留日数为 sparse coverage 和 empty 区分，不保留 COUNT(*)、MIN/MAX |
| Output | 两个 FocusPeriodResult；日期从已验证输入附上，不返回 session rows |
| Failure | 每期独立 failed/null；能继续另一预定期则执行，不重试、不扩日期；连接不可用则 unavailable；整体状态按 envelope 规则 |
| Forbidden | task_id、started_at/completed_at、session id、notes、diary、mistakes、chapter、无归属集合计数、其他科目、task JOIN |

无归属始终 excluded_not_measured，不查 NULL group 验证数量。有记录日期数为 7 也不能说七天完全覆盖；0 分钟不是没学习。A/B 不等长时只比较记录合计并说明期长不同，不派生日均效率或 productivity score。

## Local Answer Contract

语义模板可改措辞，不可改变事实强度。每次说明本机核对的科目/期间、未使用的类别、是否有资料待发送；S3 明示本地回答未调用 Provider。

| 状态 | 必须表达 | 禁止表达 |
| --- | --- | --- |
| S3 detail | “记录里已标完成 2/3；下一未标完成是第3章”；全部标完则“没有未标完成项” | 现实进度/理解程度已证实 |
| S3 aggregate_only | 仅当前计数；没有足够章节明细确认下一项 | 从数量猜章节标题 |
| S3 empty | 没有可用章节记录 | 0/0 意味全部完成或没学习 |
| S3 failed/unavailable | 未能核对/对象不可用；可查看 Direct UI；停止 | 错误填 0/0，自动重查其他类别 |
| S2 ok/empty | A/B 日期及 recorded minutes，分期 observedDateCount/请求日数，现实覆盖未知、无归属排除且未测 | efficiency improved/worsened、理解变化、因果、productivity score |
| S2 partial/failed | 可用期照实列；另一期间未能核对、值未知；停止 | 把失败当 0，计算差值/翻倍或暗示效率变化 |

本地 S2 先交付事实，后有明确请求才解释。两期成功可描述分钟增减，必须同时说明 recorded study time, not efficiency。unknowns 至少包括未记录学习、理解/产出、真实原因；不为补 unknown 查询其他表。当前自述与数据库记录分开标；Provider 超时不抹掉已有本地结果。

## Provider Disclosure Contract

S3 evidence disclosure **none**，其本地结果不进 reusable Provider history。S9 仅当前独立自述与通用帮助请求；零 diary 及派生元数据。First Slice 唯一数据库 evidence disclosure 是 S2 的可选解释摘要，默认不发送。

```ts
type FocusDisclosurePeriod = {
  startDate: string; endDate: string;
  recordedMinutes: number | null;
  limitation: 'recorded_only' | 'no_records' | 'read_failed' | 'unavailable';
};
type FocusDisclosureSummary = {
  subjectDisplayName: string;
  periodA: FocusDisclosurePeriod;
  periodB: FocusDisclosurePeriod;
  semantics: 'recorded study time, not efficiency';
  coverageLimitations: {
    realStudy: 'unknown'; unassigned: 'excluded_not_measured';
  };
};
```

只由 main 投影/序列化为现有 conversation 的数据段，不 stringify raw envelope。成功空期明确 no_records；失败明确 null/read_failed。两期都不可用不发 evidence 解释；partial 仅用户明确接受该有限摘要才发送。**不发 session count、observedDateCount、MIN/MAX、observedAt、subject id、handle/epoch、SQL、错误栈、原始 session 或内部 restriction。** 记录日数留本地；Provider 解释该合计无需具体日数，稀疏局限以 unknown/recorded_only 表达。

当前用户请求与上述摘要可发；不得自动捎带 Quick Prompt 的宽 Context、旧本地回答或其他证据。发送决定绑定此 handle、精确 summary 内容、当前 normalized endpoint + model/config revision；endpoint/model/key/vision 配置变化均使旧决定失效（不把 key 放进标识）。用户应清楚这份摘要将发给哪个 Provider；既有配置不构成披露许可。拒绝后不反复求权。

main/aiService 在 fetch 前再次同步检查 epoch、cancel、限制、来源代次与实际 URL/model/revision；检查和 fetch 之间不得 await。采用真实最终 JSON body 测试，不仅断言准备 DTO。不可观测/失效则停止，不用 ordinary chat raw resend 绕过。S2 每次明确解释请求最多一次 generation，无自动 retries/repair requests。

## History Boundary Contract

Before revocation：只复用 main 本 session/current epoch 内、来源仍有效且符合当前范围的历史；再执行现有最近六条/长度限制。renderer 缓存、local-only 输出、无可信 lineage 的材料不参与。

On revocation，受控 handler 必须按以下顺序完成，再开始本轮回答：

1. 应用原 scope 的 restriction；即使 durable 写盘失败，当前拒绝先在内存成立。
2. 增加安全 epoch / invalidate boundary；session 限制跟随会话，不能随 epoch 自行消失。
3. 作废 outstanding evidence、request、snapshot 与依赖旧材料的待续草稿；旧 token 无法复活。
4. 排除全部 pre-boundary user+assistant Provider history，不仅 diary 句子。
5. 本地确认；只用当前独立自述生成有限帮助，或全部出站拒绝时本地停止。

旧历史可 display；禁止 summarize-for-Provider、locators、旧建议排序、复制旧 task 字符串洗来源。已开始 fetch 只能说可能已发送，可尽力取消但不承诺追回；返回后 main 与 renderer 双检查，晚到不进入新消息/快照/可复用历史。失效通知也须有 request 归属，不能误清后来的新请求。撤回路径独立于普通发送 loading。

## Regenerate Contract

revoked / cancelled / destination changed / reload / source changed / invalid snapshot → unavailable。UI 不提供可用按钮并说明“上下文范围已变化，请重新发送问题”；即使按钮竞态仍调用，main 拒绝旧 handle。禁止自动 rebuild、重新取证、回放 raw requestMessages。

S3 本地事实没有模型 regenerate。S2 数据库解释完成后不保留可重复发事实的快照；再次核对须新的用户请求。普通 Chat 的当前有效快照可重生，仍绑定 epoch、destination 和来源有效性；local-only S3/S2 不因后续聊天成为可重生历史。

## Reload Contract

display history 可从原 localStorage 恢复；**不恢复 Provider-reusable lineage、request/evidence snapshot、allow grant**。renderer reload 打开新 main session，旧 token/会话闭合，旧 history 一律 display-only。main 若尚能确定原短期范围，旧 request/session 相关续传继续阻断；不能恢复则旧材料及旧待续发送 fail closed，不移植旧允许。

明确 durable negative preferences 从现有 settings 恢复，严格保留原 scope。session/request refusal 不静默升级为 durable/global。新独立请求可按新范围继续，不重新启用旧 snapshot。storage 读失败/损坏如上节降级，不能当空数组放行。restore/数据库切换同样清内存、重读该库偏好；不持久化 lineage。

## Observability Contract

仅 test-only/injectable observation；不新增生产日志平台、raw prompt 留存或 audit 数据表。测试 fake fetch 捕获合成请求，不打印鉴权 header。运行模块采用现有注入模式，所需 test seams 留在两个新模块和 aiService 内，不建第三模块。

| seam / exact facts | 测试方法与证据边界 |
| --- | --- |
| renderer gate | 当前 slots、缺失 slot、返回 intent/stop；builder/API spy；已加载 entry 的正文/标题/mood getter spy；拒绝在 builder 前且学习访问=0 |
| main resolver | 被调用 repository method、精确 params、返回 status、请求归属与内部 epoch/validity transition；假 clock/目的地/来源代次注入 |
| repository | synthetic SQLite 的实际 prepared + executed SQL 与绑定参数，SELECT/WHERE/ORDER/GROUP 字段；只观察执行不能把 prepare 初始化算读取；排除 canary 字段无访问 |
| outbound | aiService.fetchImpl 捕获最终序列化 body、实际 URL/model、调用次数；main 同一次请求的 validity、sources/excluded categories；不记录 secret headers |
| revocation | 读前/读后/fetch前/fetch后/response前闩锁；epoch 失效、snapshot rejection、late response discarded；旧 canary 不在 body/locator/排名输入 |
| persistence | 只 spy 固定 settings key；临时拒绝 writes=0；durable 值仅负向 scope；reload 新 session、旧 cache 仍仅显示 |

canary 不出现不足以证明没读：必须同时检查 SQL 的匹配/返回字段、API 调用和内存来源使用。metadata 自报不算 enforcement。App 为普通页面预载与 AIPanel AI 目的使用分列，不能把预载称 AI 零触及。集成从实际 typed adapter/preload invoke 到 main handler/resolver/service/fetch，不能只在 AIPanel mock 返回理想 envelope。

生产用户可见仅“本机核对什么、准备发送什么/去向、未使用什么、停止或重生不可用原因”；不显示 SQL、内部 IDs、raw audit event、chain of thought。

## Test Asset Allowlist

只允许以下未来测试文件修改/新增，不新增 eval framework、不改测试配置/依赖。当前全部 NOT_RUN，本文不创建测试。

| existing 可修改 | 限定目的 |
| --- | --- |
| `tests/AIPanelHistory.test.tsx` | local S3/S2、gate、S9 chip/history/reload/regenerate/loading、普通 Chat 的受控调用迁移 |
| `tests/AIPanelClipboard.test.tsx` | 只调整受控 API mock，保持现有 copy/clipboard 行为断言 |
| `tests/electronAiService.test.ts` | fetch 前后 validity/destination、final body/secret、legacy caller 兼容 |
| `tests/ipcValidation.test.ts` | exact shapes/非法引用/extra keys/scope |
| `tests/database.test.ts` | forwarding、只读 snapshot 与变更代次 |
| `tests/databaseBackupRestore.test.ts` | restore 使旧会话/来源失效及 durable preference 继承，备份格式不改 |

| new 可新增 | 限定目的 |
| --- | --- |
| `tests/aiFirstSlice.test.ts` | 纯 slots/语义模板/supported-ambiguous-unsupported |
| `tests/electronAiFirstSlice.test.ts` | main session、resolver、disclosure、restrictions、history/race、settings failure |
| `tests/aiFirstSliceRepositories.test.ts` | 三仓储真实 synthetic SQLite 与实际窄 SQL/字段/参数、读失败/干扰项 |
| `tests/aiFirstSliceIpc.test.ts` | typed adapter、browser unavailable、preload/main 注册与实际 handler 校验，sender/token 负例 |
| `tests/aiFirstSliceIntegration.test.tsx` | 串联 AIPanel→adapter→preload/main→repository→service fake fetch，fixture 与资源观测内联；不引入额外 fixture 平台 |

测量输出仅合成证据，存单独本机 Temp 目录并在未来报告列绝对路径/hash/命令；不覆盖既有 output/。本文件足以重建 fixtures，不依赖 D1.1 Temp 仍存在。新增测试内联 fixtures；如果需要第六个新文件/配置/依赖，先 replan。

以下 existing **只运行，不修改** 的针对性回归：`tests/aiConversationBuilder.test.ts`、`tests/aiContextBuilder.test.ts`、`tests/aiQuickPrompts.test.ts`、`tests/useAIComposer.test.tsx`、`tests/aiRequestPolicy.test.ts`、`tests/databaseRepositories.test.ts`、`tests/subjectChapters.test.ts`、`tests/pomodoroStats.test.ts`、`tests/StudyProgress.test.tsx`、`tests/FocusDistributionChart.test.tsx`。控制组选 `tests/TodayActionSuggestionDialog.test.tsx`、`tests/DailyReviewAgentDialog.test.tsx`、`tests/MistakeReviewAgentDialog.test.tsx`、`tests/todayActionIdempotentV2.test.ts`、`tests/agentStudyTaskActions.test.ts`、`tests/planningIpcSurface.test.ts` 的相关生成/确认/非法引用用例。不是全仓 suite；受保护流程出错不能改测试降低要求。

## Required Test Matrix

沿用 D0.4 G/A oracle，按 D1.2 缩窄为无 task 查询。统一 synthetic 日期 2026-09-21、本地时区固定 Asia/Singapore（UTC+8）。F3：id=1 唯一“线代”，三章前两章 completed，第三章未完成，notes 含排除 canary；另科英语干扰。F2：数学 A=2026-09-07..13 每日10分钟=70，B=09-14..20 每日20分钟=140；每日另有英语10分钟、无归属5分钟，均不计数学。F9：diary canary“我每天晚上会戴紫色潜水帽学习。”；旧 user 与 assistant 都放派生变体/混合 task，自述新事实独立。

| 用例组 | 必须执行的变体 | 通过 oracle / 首要测试文件 |
| --- | --- | --- |
| S3 identity | unique id/name；重名；missing/deleted；伪造/跨请求 id | identity 仅 id/name；重名只问不取记录；未找到不可用；Repositories/Ipc |
| S3 facts | detail；aggregate fallback；0/0；全部标完；并列 sort_order；detail SQL fail | 2/3+第3章；aggregate 无下一章；失败不 fallback；稳定排序；Repositories/aiFirstSlice |
| S3 local-only | Provider 配置有/无、disclosure denied、之后普通 follow-up | Provider calls=0；本地答案不混入下轮 history；History/Integration |
| S2 clarification | 初始含糊、partial slots、已有 slots、未回答、重叠/非法日期 | gate 完整前连 identity 都零读；Provider=0；只问缺项；aiFirstSlice/History |
| S2 fixed batch | exact A/B，其他科/无归属/边界外日期、期长不同 | 70/140；两期预定；不取 task；无第二 retrieval；Repositories/Integration |
| S2 states | A fail/B ok；反向；均 fail；empty vs failed；0分钟有记录日；稀疏日数 | 分期 null/0 区分，partial 不比较；不外推效率；Repositories/aiFirstSlice |
| S2 supplied | 完整同证据自述、含 review_count/任务历史陷阱 | zero query 含 identity；标自述、不认作数据库验证；aiFirstSlice/Integration |
| S2 disclosure | 明确允许、拒绝、本地允许出站拒绝、目的地改变 | exact summary；拒绝时 bytes/calls=0；无 count/min/max/id；Service/Integration |
| S9 fresh | diary chip 保留、已加载 entry、没有 chip、全部出站拒绝 | builder/内存 diary 使用=0；自述帮助或本地有限结果；History/Integration |
| S9 prefix | mixed user+assistant、撤回轮、follow-up、regenerate | whole-prefix drop；旧 canary/改写/locator 均停用；当前独立自述可继续；Main/History/Integration |
| S9 timing | fetch-before、fetch-after revocation、cancel、late result | 未开始的不发；已开始只报可能已发送；晚到不采纳；Main/Service/Integration |
| S9 lifetime | request/session/durable；临时 all-outbound；object/purpose/provider 限定 | 短期 settings writes=0；不扩大范围；session 跨 epoch；durable 精确恢复；Main |
| S9 reload | renderer reload、main restart、损坏/失败 settings、恢复备份 | display-only、无旧允许/snapshot、不生成永久拒绝、durable 恢复；History/Main/databaseBackupRestore |
| Drift/destination | 删除/修改章节或科目、focus变化、外部连接写入、跨日、连接/Provider改变 | 发前/结果采纳失效；新去向重判；无自动刷新；Main/Integration |
| G1/G7 | 知识问答；三成熟 workflow；Direct UI/Quick Prompt/copy | G1零学习读；旧入口/参数/确认行为保留；无 forced First Slice；只读回归清单 |
| Controls | injection、学习写入 spy、secret canary、无效 token/sender/ref、限制页附件 | 六不变量各自观察；附件范围不适配在读取前停止；Ipc/Main/Integration/现有 confirmed-chain 负例 |

表中 Main=electronAiFirstSlice、Service=electronAiService、History=AIPanelHistory、Repositories=aiFirstSliceRepositories、Ipc=aiFirstSliceIpc，均为上一节 exact path。每个“变体”独立 case，禁止用一个成功 case 代替整组。

## Implementation Sequence

以下顺序是未来技术切分，**implementation sequence ≠ roadmap phase authorization**。本次不启动任一步。

| 顺序 | 允许的工作与独立验证 | 可达性 / roadmap 对应 |
| --- | --- | --- |
| I1 | shared contracts、三仓储窄 operations、main envelope；运行 validator/真实 SQLite fixtures，证明 scope 与失败 | 不接生产 AIPanel，不注册可调用 production evidence 入口；D2 局部能力 |
| I2 | 两模块纯 renderer gate/local templates 与 main session/restriction/disclosure/history/snapshot；注入时序测试 | 仍仅测试装配，不能暴露未受控路径；D2 + D3 准备 |
| I3 | main/preload/adapter/service validity 接线、变更标记、durable/reload；IPC/fetch 集成证明先读后发边界 | 默认 production dispatch 不可达；D3 enforcement 证据，旧功能不被宣称已修复 |
| I4 | AIPanel 接入，普通发送/Quick Prompt/撤回/重生同门；受控 synthetic UI 及 Electron smoke | 仅另行允许的 candidate 环境；guards 全部成立后才允许整体验证，无 raw fallback |
| I5 | 针对性回归、全矩阵、测量记录、Parent 锁定条件下 paired comparison | D4 准备/验证；报告 candidate ready，不自动发布/产品 Gate |

每步只动相应 allowlist；中间不注册一个可被 renderer 越过 gate 的半成品 privileged capability。需要 dispatch 隔离时用现有装配/测试注入或模块内默认关闭开关，不新增 settings UI/第三配置模块。D2 完成不授权 D3/D4，若下一次授权仅 D2，到其 stopping point 停止。

## Behavioral Resource Ceilings

这是 architecture contract，不是性能目标：

| 情况 | 硬上限 |
| --- | --- |
| S3 | Provider calls=0；evidence batches≤1；unrelated local categories=0 |
| S2 ambiguous/partial slots | learning-data access=0，Provider calls=0，包括 identity lookup |
| S2 resolved 且需数据库事实 | evidence batches=1 predetermined；A/B 两次固定聚合；adaptive second retrieval=0；automatic retries=0 |
| S2 supplied sufficient | 数据库查询=0（不是强制1 batch） |
| S2 optional explanation | 每次明确用户请求最多1次 Provider generation；无 classifier/repair/summarizer 附加调用 |
| S9 revocation | pre-boundary Provider history reused=0；revoked snapshot replay=0；受影响 late result adoption=0 |
| G1 / fresh self-report | 新增学习数据访问=0；普通 Chat 成功路径最多1 generation，无自动重试 |

SQL 分开数：正常 S3 identity+detail 为2，固定 aggregate fallback 最多3；S2 identity+两期为3。重名暂停/选择的 identity 复验另记，不称零成本，也不读候选全部内容。失效检查/settings 读取与学习证据批次分列；不能用“one batch”隐藏多余学习读取。已有材料够用时不强制取证。

## Numeric Measurements Still Required

D1.1 已观察的 synthetic 基线：S3 Direct UI Provider0；最窄 Quick Prompt 5个学习API reads，body 545 chars/1045 UTF-8 bytes；F2 manual 同证据原案例 body 446/952；A5 撤回及 regenerate body 417/829、零新 Context API 仍有 diary canary。fake fetch 共18次，真实 Provider calls0。这些是继承的输入，不是本次重测、资源阈值或新 candidate 成绩。

原 F2 manual 文本含 task 自述；本版不取 task。**952 bytes 不能成为新最小同证据对照的等量预算或改善分母。** paired comparison 新增的最小共同材料固定为：数学、A/B 日期、70/140 recorded minutes、recorded study time not efficiency、realStudy unknown、unassigned excluded_not_measured；不带 daily count、任务历史或额外原因。两侧使用相同文字/语义与同一个问题，先冻结再测。

供 Parent 一次性接受的比较条件包如下。样本数是小型工程评估协议建议，不来自性能实测，不声称统计显著性：

1. 全部 Required Test Matrix 变体，在重置 synthetic DB/session 的条件下各3次；race 使用确定性闩锁重放读/发/返回的各排列，不靠随机等待。六不变量逐次判，保留每次失败。
2. 真实模型同证据 S2、S9 帮助质量及 G1 控制各5组成对 generation；同 Provider/确切模型标识、参数、网络环境、输入证据、日期/时区、权限上限、输出要求。交替 baseline/candidate 次序，记录缓存冷热；无额外尝试挑最好回答。该5对仅工程样本，不能推总体可靠率。
3. 用户操作比较：同一名经同意的操作者完成 S3 三对路线（Direct UI/current Chat/Quick Prompt 分别与 candidate）、S2 manual→Chat 对 candidate、S9 fresh/retained/mixed 对 candidate；每对首次使用1次、熟悉后3次，熟悉轮AB/BA交替。只报告单人任务观察；另做多人研究须另行定样本，不自动安排。
4. 每次统一从 AIPanel 提问前开始，记录页面切换、必要点击/手工转述/抄写、澄清轮次、准备时间、首个正确有用结果时间、最终结果时间、UI澄清响应、main准备/SQL/service等待、请求UTF-8 bytes、Provider calls、实际 usage/tokens/输出长度。缺 usage 标 UNVERIFIED，不由 chars 伪称 tokens；不采集 hidden reasoning。
5. paired input、fixture、脚本、评分 oracle、样本/重复数、Provider/model/参数与候选 SHA 在正式比较前登记；当前未产生 candidate，不虚构其 SHA。测试只能使用 synthetic 材料；不得为云端重复、支出或真人测试推定外部授权。
6. 不设 `<500ms`、`<1000 tokens`、任意改善百分比。当前服务8 messages、单条30,000/总40,000 chars、max_tokens=2000、timeout=30s 作为既有兼容硬限制保留，不作为性能成功阈值。Provider call ceilings 采用上一节，不能比 baseline 多无必要调用。
7. **Parent 接受的分期条件应明确为：数值 latency/token/bytes/UI/preparation 暂以如实测量和逐对权衡 Gate，不能按它们宣布 pass。** candidate 产生后先做非评分资源校准，再由 Parent 预登记接受区间/权衡，之后运行正式 paired product comparison；校准数据不得挑选成正式成功样本。若 Parent 不接受这种分期，则先补授权的 current-baseline 实测、锁数字，再比较；不能事后按 candidate 得分调成功标准。

其中3次/5对/1+3为待 Parent 接受的条件，不是声称已 Parent locked。本文件接受前不正式比较；可在未来明确授权下做非评分 candidate measurement，不把结果写作产品收益。该条件包是 D1 唯一剩余审批，不形成新的架构研究任务。

## Benefit Criteria

所有适用 oracle 和六项不变量必须先逐次通过，控制组无未解释退化；收益与安全分别报告，不能用平均分抵消越权。

| 场景 | 足以继续的可观察收益 / 对照 | 失败或必须如实披露的情况 |
| --- | --- | --- |
| S3 | 同样正确的标记/下一章；Provider0；相比手工回 Chat 少准备或页面切换，查询范围更窄；必须同时列 Direct UI、current Chat、Quick Prompt | Direct UI 更快就明确说更快；不因胜过宽 Quick Prompt 就声称最佳路线；窄权限旧 Quick Prompt 不适配记 unsupported，宽许可 characterization 另表 |
| S2 | 对同一最小证据语义，减少手工统计/转述必要步骤，disclosure 不扩大；相同 evidence 的模型质量不退化 | 70/140 不证明效率；不能额外给 candidate task/context；关键事实/局限错误任一例 fail，建议质量逐对审阅，不要求模型更聪明 |
| S9 | fresh/retained/mixed 拒绝后仍有自述小步帮助或诚实本地降级；无 diary reuse/disclosure；不要求用户清历史/逐chip检查 | 只显示“已拒绝”而没有可用有限帮助不足以证明收益；不以速度为主要成功条件；all-outbound 时真实本地功能即合理降级 |

S2 同证据质量非退化按预定逐主张事实/语义 oracle，无新增关键错误；盲序人工比较是否保留至少一个可执行小建议、原因未知、无需敏感求权。少量样本不足以声称统计非劣效，结果矛盾则报告 inconclusive，不能平均成“更聪明”。

产品 Gate 至少一个主场景有跨熟悉重复可复现的具体准备减少，或 S9 拒绝缺口修复且帮助保留；其余主场景不掩盖退化，资源权衡获 Parent 接受。如果三场景均无可观察收益，即使架构/测试通过也不通过产品 Gate。用户是否理解“读了什么/发了什么/没用什么”须实际任务复述验证；文案审查不能冒充真人理解。

## Hard Invariant Verification

本阶段六项运行值均 **UNVERIFIED / NOT_RUN**；下表是未来 exact proof obligations，不是“security tests pass”。每 case/repeat/event 保留观测。

| 不变量 | implementation test location | integration observation / fail | 之后仍须验证的边界 |
| --- | --- | --- | --- |
| unconfirmed mutation = 0 | aiFirstSliceRepositories、electronAiFirstSlice；现有 todayActionIdempotentV2/agentStudyTaskActions | SQL写入 spy 与 DB前后学习表对比；模型注入不写；短期拒绝settings写0；只有明确 durable negative preference 允许固定键写。任何未确认学习写入 fail | 实际 Electron 受控路径、既有确认反例未跑则 UNVERIFIED；聊天缓存不混作学习写入 |
| secret leakage = 0 | electronAiService、aiFirstSliceIntegration | 合成鉴权/材料credential canary 在最终body、输出、历史、错误与测试日志正文不得出现；仅鉴权用途单独检查，不打印 headers；出现即 fail | 不声称能识别用户主动粘贴的所有未知秘密；真实端点/日志面未测保持 UNVERIFIED |
| invalid privileged reference accepted = 0 | ipcValidation、aiFirstSliceIpc、electronAiFirstSlice、既有 confirmed-chain 负例 | malformed/extra keys、错sender/session/epoch、伪造/删除/错选择id在读/发前拒绝；接受一个非法引用即 fail | 不能以无动作接口声称既有动作链已验证；实际 preload sender/window 生命周期须 smoke |
| unauthorized local access = 0 | aiFirstSliceRepositories、AIPanelHistory、aiFirstSliceIntegration | 实际SQL/params/逻辑字段 + 内存entry getter + API；歧义前任一学习读、notes/diary/其他科/宽builder访问即 fail | SQLite物理页非列级隔离；普通页面预载另列，未观测的AI目的使用不能算0 |
| unauthorized provider disclosure = 0 | electronAiService、electronAiFirstSlice、aiFirstSliceIntegration | 每次最终body与实际destination、有效决定对照，包括history/重生/失败尝试；未允许统计/标题/派生片段任一字节即 fail | mock证明客户端拟出站，不证明Provider内部保留；真实请求尚未执行时明确标注 |
| revoked-source reuse = 0 | AIPanelHistory、electronAiFirstSlice、aiFirstSliceIntegration | 撤回轮就whole-prefix drop，旧snapshot拒绝、late discard、reload display-only；旧来源进入body/locator/排序依据/新快照即 fail | canary+可信来源并集与时序证据共同使用；不承诺Provider遗忘或已发字节追回 |

上述简称均对应 Test Asset Allowlist 中 tests/ 路径。有效性、no-query/no-fetch 必须动态断言，不只静态搜字符串；现有测试失败先定位是否本次引入，不能修改受保护流程来掩盖冲突。

## Implementation Stop Conditions

任一出现立即停止受影响实现、保留当前证据并交 Parent replan：需要新 SQLite schema/索引/migration；tool calling；general permission/DataGrant 平台；修改 specialized workflows/confirmed chain/Planning History；Primary 需 diary/mistake/task repository；第三 evidence type；adaptive second retrieval；持久 provenance/history lineage；第三 production module；allowlist 外文件；新 dependency（即使 trivial test-only 也须单独批准）；Provider classifier/NLP 框架；只能靠宽读后裁剪；不能在发送前可靠校验；需要以放开 raw ai.chat/旧 snapshot 恢复功能。

新增更窄持久 scope 表达、shared builder 无法复用、database 失效 seam 不足也属于边界冲突，不能把“实现细节”当作扩大授权。测试失败本身允许在 allowlist 内修复后重跑受影响检查；证据不足则保留 NOT_RUN/UNVERIFIED，不放宽 oracle。

## Rollback Contract

可以关闭 First Slice intent dispatch 与新事实查询，Direct UI、Quick Prompt、Ordinary Chat、Today Action、Daily Review、Mistake Review、confirmed action chain、Schema8 保留原职责。关闭查询不要求降级数据库或删除用户内容。

用户依赖过的 revocation guard、explicit durable negative preferences、safe snapshot invalidation **必须保留**。普通 Chat/Quick Prompt 仅在安全边界内可用；不适配 restriction 的 Context 停用。guard 自身不可证明时，降级为无旧历史、无记录Context的当前独立消息；当前范围 all-outbound 则仅本地功能。保留历史显示不能恢复复用。

不能简单 checkout 旧版并称安全 rollback，因为 D1.1 已证明旧 history replay failure。若必须退旧运行版本，涉及被拒来源/旧前缀的 AI 路径不可开放，不能删除 durable restrictions 或要求用户逐条检查。临时拒绝不会因为 rollback 变成永久设置。

## Candidate Completion Definition

下一阶段只有满足以下条件才能报告 implementation complete / ready for Parent candidate review；该措辞仍不等于产品 Gate/发布授权：

1. changes 仅 production/test allowlist，两个新 production modules 上限；无 schema/dependency/tool calling 变更。
2. S3 本地路径与 Provider0、S2 clarify-before-access/fixed batch/limited output 均真实运行。
3. S9 whole-prefix、读/发时序、late discard、regenerate invalidation、reload 与 request/session/durable scope 均通过。
4. 动态 repository/IPC/fetch observability 存在；六不变量按适用case/repeat逐项测试；未覆盖处清楚标 UNVERIFIED，不报全链零违规。
5. targeted regressions 通过，specialized workflows/确认链没有本次引入退化；受保护文件未改。
6. typecheck 与受影响测试通过；实际 Electron AIPanel 发问/撤回/loading/reload smoke 有证据。mock/源码检查不得替代该 runtime seam。
7. candidate measurements 记录 fixture/版本/参数/次数/失败/字节/准备与等待；性能与模型/真人未测项不伪造通过。正式产品比较须 Parent 锁条件及独立授权。
8. rollback 可关闭事实入口且保留 guard，生产广告/交付描述不超过已验证范围；Parent 获得具体 diff、命令、逐场景结果和限制。

## D1 Exit Decision

**D1 NOT COMPLETE because Parent 尚未接受本文的 evaluation lock 包。** 这是唯一剩余 Gate 项，不是额外架构工作。

| D1 要求 | 当前证据 |
| --- | --- |
| minimal design | D1.2 accepted + Step0；本文具体 contracts/allowlists |
| observation method | repository/内存/IPC/fetch/时序与六不变量位置已冻结 |
| measured current baseline | D1.1 accepted synthetic baseline；真实模型/真人资源缺口如实保留 |
| Parent-locked resource ceilings | 行为 ceilings 来自已接受架构；数值分期/不虚构阈值的比较条件等待 Parent 接受 |
| sample/repeat conditions | 本文3次 deterministic、5对模型、单操作者首次1+熟悉3方案，待 Parent 接受 |
| benefit criteria | 三场景与最强对照/同证据/拒绝帮助 criterion 已定义，待 Parent 接受 |

Parent 接受资源分期、样本/重复与收益条件包后即可记录 **D1 COMPLETE**；没有 D1.4，不再重开 Option B。若 Parent 要求数值在 D1 内先有实测，按其决定补 baseline 测量而非无限拆设计。candidate 性能和产品有效性尚待 D4，不是这里可以宣布的事实。

## Next Authorized Gate Recommendation

仅推荐：Parent 审查/接受本文后，另行授权 **D2 — Minimal Direct Evidence Capability**，范围从 I1 起，在生产不可达条件下验证 narrow repositories/envelopes/local gate；D3 enforcement 与 D4 integration/paired eval 按各自 Gate 授权继续。不要把 I1–I5 当一次性全项目开工许可。本次在 D1.3 可供审查处停止。

## Non-decisions

没有 production/test implementation、Prompt 修改、UI/IPC/repository method 实现、runtime module 创建、依赖安装、schema/migration、RAG/FTS/embedding/MCP、Agent Loop、workflow migration、Planning History 扩展、durable provenance、subagent/multi-agent。没有 commit、push、PR、Issue mutation、merge、release；没有新建 D1.4，没有启动 D2/D3。

不重新定义 D1.2 Option B/evidence variants/whole-prefix/regenerate/lineage。D1.3 只在允许的具体合同层删除不必要 count/MIN/MAX 字段、收紧 candidate allowlist；不把这些改写回 D1.2。数值资源条件/重复方案是审查提案，不冒称 Parent 已锁或测试通过。

## Validation Record

以下为本次实际文档级检查；所有未来实现/产品测试仍为 NOT_RUN：

- 开始及交付前四处 Git SHA 一致，均为 Baseline 所列值；远端用 git ls-remote 只读核对。
- D1.2 仅将 restriction 表的一行改为 request/session 两行。以逆向还原这一个替换的全文计算 SHA-256，等于修改前 `8AF65E4A5BE518564D274A6DF9DB76149906969FC3519CF331AEDC5EB9091B11`；因此 Option B、evidence、whole-prefix、regenerate、lineage、schema、tool calling、candidate files 等其他字节未变。
- AGENTS、AI contracts、roadmap、D0.1–D0.4、D1.1 共8份输入的前后 SHA-256 逐项一致，既有用户修改保留。未访问 output/ 内容。
- 用户要求的36个标题（含 H1/H2/H3）全部存在；24项 required decisions 均落在对应段落。11个现有 production 文件有直接职责依据；两个新增模块各有独立进程职责；原 builder/factory/settings repository/AIComposer 不需修改。
- 6份可修改 existing tests 和16份只读 targeted regression 文件均实际存在；5份计划新增 tests 当前均不存在；未创建 runtime modules/tests。未引入通用 metadata/SQL/fields/where escape hatch。
- 人工逐项合同复核：原 scope 不扩大；S3 Provider0；S2 clarify-before-access/固定两期/无task；S9 whole-prefix；无 tool calling；Schema8/no migration；六项不变量的观察与失败位置；rollback 保留 guard；D1 仅余 Parent evaluation-lock 接受，均已写明。
- 相对链接：D1.2 36个，本文27个，全部存在；两文档行尾空白0。新增模块/测试作为未来路径用 code span 标示，不伪造文件链接。
- `git diff --check` 返回0；两份 untracked 文档分别用 `git diff --no-index --check -- NUL <path>` 检查，返回1仅表示相对空文件有内容，无空白错误，只有 LF/CRLF 转换提示。
- `git diff --name-only -- src electron tests package.json package-lock.json` 无输出；工作区状态相对开始只新增本文，D1.2 的既有 untracked 状态不变但内容按上述单点修改。未暂存、commit、push 或外部写入。
- 未运行应用测试、typecheck、build、candidate eval、真实 Provider、真人任务或无关 suite；没有 subagent。文档合同完整性不等于 runtime enforcement、资源目标或产品收益通过。

停止于 **D1.3 Implementation Contract & Eval Lock 可供 Parent 审查**。
