# MindDiary Phase D — Final Closeout / Freeze

收尾日期：2026-10-03，Asia/Taipei。本文记录 Owner / Parent 的最终决定及现存证据，不启动实现、评估或发布。

## 1. Executive status

**RESULT: PHASE D CLOSED / CANDIDATE FROZEN**

Phase D First Slice：**CONDITIONALLY COMPLETE / ACCEPTED CANDIDATE**。接受继续使用与下一阶段开发的候选，但后续工作仍需独立授权，不代表正式真人可用性研究完成。

| 项目 | 最终状态 |
| --- | --- |
| D0、D1 | COMPLETE |
| I1、I2、I3、I4 | COMPLETE / PARENT ACCEPTED |
| I5-A | COMPLETE / PARENT ACCEPTED |
| DeepSeek compatibility correction | COMPLETE / PARENT ACCEPTED |
| I5-B2 | historical model-quality FAIL；保留，当前候选由 I5-B3 取代 |
| I5-B3 model quality | COMPLETE / PARENT ACCEPTED |
| Architecture / security gate | PASS |
| Engineering gate | PASS |
| Provider compatibility gate | PASS |
| Model-quality gate | PASS |
| Observed product-value preflight | SUPPORTIVE / PASS AS PREFLIGHT |
| Formal Human 1+3 study | WAIVED BY OWNER / NOT RUN |
| Formal privacy-comprehension study | WAIVED BY OWNER / NOT RUN |
| CURRENT CANDIDATE | ACCEPTED |
| PRODUCT GATE | CONDITIONAL PASS |
| RELEASE | NOT AUTHORIZED；本次没有发布 |

以上接受和豁免来自本次 Owner 最终指令。旧报告中的 NOT PASSED / NOT_RUN 保留其当时含义，不回写历史报告。

## 2. Final candidate identity

- Candidate Fingerprint：`ebaae8a9145bfc5fce4f40884ae56ab76ee9bc4a7272505d611054d59342f381`。
- Committed baseline HEAD：`87fef52eba451a38226b4e04e701d79c431eddfe`。
- 指纹是工作区候选身份，不是 Git commit SHA、release SHA 或 tag。生产候选仍含原有 dirty / untracked 文件；冻结没有创建提交。

原算法见 I5-A Temp 根的 `freeze.cjs`：对所有 tracked 文件及 `src/`、`electron/`、`tests/`、`scripts/` 下非忽略 untracked 文件形成排序的 `{path, sha256, untracked}` manifest；再计算 `SHA256(HEAD + '\n' + JSON.stringify(manifest) + '\n' + SHA256(git diff --binary HEAD --))`。

最终候选 manifest 位于 I5-B3 的 `corrected-candidate/candidate-manifest.json`。本次只新增两份 untracked Phase D 文档；原算法不纳入这些新文档。保留已跟踪路线图原文，以免改变原候选指纹。原路线图中的历史阶段状态须结合本文的最终决定阅读。

## 3. What Phase D delivered

完成有限 First Slice：科目章节进度、两个期间的记录学习时长比较，以及拒绝 / 撤回后的有限帮助。权限、证据和回答约束在 main 边界执行；没有引入 general agent/tool runtime。

Native ABI 的永久双运行时工作流已经完成并获 Parent 接受，Node / Electron native 处理使用既有永久流程；手工 ABI binary swap 不属于最终工作流。

## 4. Final architecture

```text
AIPanel
→ local intent / clarification / refusal gate
→ fixed Evidence Request
→ trusted main resolver
→ Evidence Envelope
→ local bounded answer
   OR
→ explicit bounded disclosure
→ controlled Provider send
```

只有 `subject_progress`、`focus_comparison` 两种 Evidence Request。第三种仍需 replan。

Main 拥有 SQLite narrow reads、request/session validity、restriction state、source validity、destination validity、history reuse、snapshot validity、disclosure projection 和 actual Provider boundary。Renderer 拥有 intent recognition、clarification UI、local rendering 和 user interaction。

## 5. Security / data boundaries

六个锁定不变量：

```text
unconfirmed mutation = 0
secret leakage = 0
invalid privileged reference accepted = 0
unauthorized local access = 0
unauthorized provider disclosure = 0
revoked-source reuse = 0
```

本地读取许可和 Provider 披露许可分别约束；可见 UI 历史不等于可复用证据。main 在实际发送边界校验可信引用、来源、目的地和失效状态，不能以 renderer 声明代替。

## 6. Scenario S3

问题类：“线代现在学到哪里？”精确解析科目，只投影章节，生成本地答案，Provider = 0；不读取 notes、tasks、diary 或 mistakes。合成目标为 `2 / 3 complete`，`next = 第3章`，未标完成不等于正在学习。

预检中候选无需切页或手工转录，相比 manual → ordinary Chat 避免了这些操作。Direct UI 仍可能有竞争力或更快，不声称候选普遍最快。

## 7. Scenario S2

含义始终是 **recorded study time，NOT efficiency**。证据限于 subject、period A、period B、recordedMinutes 和 coverage limitations。

Main-owned answer discipline 禁止从记录分钟推导 motivation、willingness、intentionality、action力、efficiency、mastery、productivity、cause 或 actual total study time。可以描述 `70→140`、`+70`、`2×`，并给一个独立小行动，但必须保留覆盖限制和不确定性。

I5-B3 接受结果：S2 candidate `5/5 PASS`。

## 8. Scenario S9

Restriction / revocation 先于可复用历史处理。边界前的 user history、assistant-derived history 和 snapshots 在边界后不可复用；旧 UI 历史可继续显示，**Displayable != reusable**。

可使用新的 post-boundary self-report。Main-owned bounded-help discipline 要求 current self-report only、small actionable help first、optional new context afterward、no diary/history prerequisite。I5-B3 接受结果：S9 candidate `5/5 PASS`。

## 9. DeepSeek compatibility

只对最终 URL 的精确 hostname `api.deepseek.com` 添加：

```json
{"thinking":{"type":"disabled"}}
```

不按 model-name substring 匹配，也不推广至任意 OpenAI-compatible endpoint。保留 `temperature = 0.7`、`max_tokens = 2000` 和 non-streaming。

Controlled First Slice 拒绝 `finish_reason=length` 及 missing / null / blank visible content。没有 automatic retry、repair generation、legacy raw-chat fallback 或 reasoning reuse。

首次真实 I5-B 必须保留：`deepseek-flash`、thinking 默认 enabled、`max_tokens=2000`、`reasoning_tokens=2000`、visible answer empty、`finish_reason=length`。当时首个 baseline 调用耗尽预算，正式配对未完成；分类为 **Provider compatibility failure before formal candidate comparison**，不是 candidate answer-quality failure。

## 10. Engineering verification

I5-A 最终工程证据：`100 / 100 matrix variants PASS ×3`，`0 FAIL`，`0 applicable UNVERIFIED`。原首轮仅 81 个变体具备三次映射行为 PASS、19 个 UNVERIFIED；A2 补足独立证据后才达到最终状态。缺口和中间结果仍保留。

证据含 hard invariants、deterministic tests、SQLite/source/destination/race tests 和 real Electron smoke。后续兼容性修正及 B3 main-owned 回答约束具有各自 delta / focused 验证；旧指纹矩阵不能单独证明最终指纹未改变。

这是工程验证，不是统计可靠性结论。本次不重跑 100×3、Electron 三轮评估、模型批次或产品预检。

## 11. Real-model evaluation

I5-B2：`30/30 formal generations completed`；S2 candidate `1/5`，S9 candidate `4/5`，G1 candidate `5/5`；**model-quality FAIL**。这一结果说明需要 main-owned evidence / answer discipline，不能抹去或改称成功。兼容性修正通过不意味着回答质量通过。

I5-B3：`2 probes PASS`，`20/20 formal generations complete`，S2 candidate `5/5`，S9 candidate `5/5`，no retry、no replacement。此阶段是当前接受的模型质量证据。G1 未在 B3 重新生成，B2 G1 结果仅作为历史证据保留。

评分是 automated assistant assessment，不是 human blind rating。样本计数不证明普遍优越性、跨用户效果或统计可靠性。

## 12. Product-value preflight

Codex computer-use 执行了 21/56 个计划动作 / trials，属于 **engineering UX / product-value preflight**。它不是 human usability study、human comprehension study 或 formal human Product Gate。

观察信号：

- S3 candidate：0 page switches、0 manual transcription；manual → ordinary Chat 需要切页及转录，观测到普通 Chat 无依据推断“正在学第三章”。
- S2 candidate：本地解析 70/140，无需手工转录；手工路线需要定位两个期间并转交证据。
- Quick Prompt narrow-permission route：UNSUPPORTED，不能为完成任务而扩大权限。
- S9 retained / mixed：旧路线暴露 unsafe-history behavior，被 Temp safety protection 阻断；candidate bounded response 未复用 revoked history。被拦截的 attempt 不等于实际出站披露。

Codex 耗时包含 automation/tool overhead，不能作为真人表现数字。

## 13. Explicit limitations

锁定真人协议原要求 same human operator、7 comparisons、first-use 1、familiar-use 3、AB/BA ordering，共 28 pairs / 56 trials。Owner 没有完成此研究，并明确豁免剩余真人研究。

Formal human 1+3 与 formal privacy comprehension：WAIVED BY OWNER / NOT RUN。Multi-user usability study、blind human answer preference study：NOT RUN。没有以预检替代真人隐私理解判断，不能宣称已完成单用户或多用户正式可用性验证，也不能声称统计可靠性。

因此 Product Gate = CONDITIONAL PASS，接受继续使用和另行授权的下一阶段开发；不声称 unconditional formal usability PASS。Temp 证据可能随系统清理失效，本文仅索引现存证据，不迁移、不复制、不补造。

## 14. Deferred capabilities

仍延期：Adaptive Retrieval、Agent Loop、general Model Runtime、Tool Registry、model tool calling、general DataGrant platform、RAG、vector DB、FTS、embeddings、fine-tuning、long-term AI memory、context compaction、MCP runtime、subagents / multi-agent、Today Action migration、Daily Review migration、Mistake Review migration。

Phase D 完成不授权上述能力。

## 15. Stop conditions retained

出现 third evidence type、adaptive second retrieval、general permission system、task/diary/mistake repository expansion、third production module、new schema/index/migration、broad-read-then-trim、provider classifier framework、raw ai.chat fallback 或 unsafe reusable snapshot 时，停止受影响扩展并交 Parent replan。

原 [D1 implementation contract / eval lock](D1-implementation-contract-eval-lock.md) 的停止条件继续有效，包括新 dependency、specialized workflow / confirmed chain / Planning History 扩展、持久 provenance/history lineage、allowlist 外实现，以及无法在发送前可靠校验。任何范围扩展需明确重新授权。

## 16. Evidence index and closeout integrity

见 [Phase D evidence index](phase-d-evidence-index.md)：7 个现存 Temp 根、8 个阶段条目，区分 historical failure、superseded candidate、current accepted candidate 和 partial evidence。

本次仅新增本文和证据索引。收尾前后按原算法重算指纹，并逐文件比较原工作区状态；检查 HEAD、`git status --short --branch`、`git diff --check` 和指定生产 / 测试路径的 Git diff。原有 production / test / tool dirty changes 保留，新增文档不构成生产修改。任何意外候选差异均要求 RESULT: STOPPED，不能修复后冒充原冻结候选。

## 17. Handoff to next phase

当前候选接受且冻结。没有新实现、新评估、computer-use 产品测试或 human experiment；本次 real Provider calls = 0、paid calls = 0、GitHub writes = 0、commit = 0、push = 0、release = 0。

不 bump version、tag、build 发布产物、merge 或 publish。Release 需独立 Owner 指令；下一阶段不会自动开始。

## Closeout check results / preserved Git state

实际轻量检查：HEAD 匹配；原算法重算 fingerprint 匹配；452 个候选 manifest 文件没有差异，收尾开始时的 463 个 tracked / non-ignored untracked 文件逐字节未变；仅新增本文及证据索引。`git diff --check` exit 0；Git 的 LF/CRLF 提示未作修复。指定生产/测试路径 diff 已读取，保持原候选修改。本次未运行测试、构建或评估。

以下为收尾后的完整 `git status --short --branch`，原有 dirty / untracked 状态全部保留：

```text
## main...origin/main
 M .github/workflows/ci.yml
 M AGENTS.md
 M docs/roadmap/minddiary-ai-study-agent-roadmap.md
 M electron/aiService.ts
 M electron/database.ts
 M electron/ipcValidation.ts
 M electron/main.ts
 M electron/preload.ts
 M electron/repositories/pomodoroRepository.ts
 M electron/repositories/subjectChaptersRepository.ts
 M electron/repositories/subjectsRepository.ts
 M package.json
 M src/components/AIPanel.tsx
 M src/contexts/api/aiApi.ts
 M src/types/api.ts
 M tests/AIPanelHistory.test.tsx
 M tests/database.test.ts
 M tests/databaseBackupRestore.test.ts
 M tests/electronAiService.test.ts
 M tests/ipcValidation.test.ts
 M tests/releaseAssets.test.ts
?? docs/roadmap/D0-access-disclosure-boundaries.md
?? docs/roadmap/D0-evidence-retrieval-model.md
?? docs/roadmap/D0-learner-experience-scenarios.md
?? docs/roadmap/D0-minimum-product-capability-eval-baseline.md
?? docs/roadmap/D1-current-baseline-minimal-design-boundary.md
?? docs/roadmap/D1-implementation-contract-eval-lock.md
?? docs/roadmap/D1-minimal-first-slice-architecture.md
?? docs/roadmap/phase-d-evidence-index.md
?? docs/roadmap/phase-d-final-closeout.md
?? electron/aiFirstSlice.ts
?? output/
?? scripts/native-runtime.mjs
?? src/utils/aiFirstSlice.ts
?? tests/aiFirstSlice.test.ts
?? tests/aiFirstSliceIntegration.test.tsx
?? tests/aiFirstSliceIpc.test.ts
?? tests/aiFirstSliceRepositories.test.ts
?? tests/electronAiFirstSlice.test.ts
?? tests/nativeRuntime.test.ts
```
