# MindDiary Phase D — Evidence Index

检查日期：2026-10-03，Asia/Taipei。仅索引既有证据；7 个指定 Temp 根均存在，`MISSING_LOCAL_ARTIFACT` = 0。本次未复制、修改或重建 Temp 内容，未重跑评估。

最终 Candidate Fingerprint（F）：`ebaae8a9145bfc5fce4f40884ae56ab76ee9bc4a7272505d611054d59342f381`。

历史指纹：

- H：`6ddb7ffeb462a9e655047c04045344789f7ee92a7f9d8d8418b89d4a47436aab`（I5-A / A2 / 首次 B）。
- P：`12484f20df5ba9b792576e52f9fe8edb2f30997e7c416efc2ae3c3310580fef1`（B2 首次停止状态）。
- R：`b4d47dc61f77787579fb2889dbe21bd344fda315fcd8a94dc43a1a9db8806f1c`（B2 resume 根 manifest 的中间状态）。
- B2：`2b7c8d625e1e399905bc4bb55f7b70db9bd2b0eb084aef8dddcc1fbabc7ad435`（B2 正式预登记候选）。

这些是 Candidate Fingerprint，不是 commit / release SHA 或 tag。共同 committed baseline HEAD：`87fef52eba451a38226b4e04e701d79c431eddfe`。

## Stage index

共 8 个阶段条目，引用 7 个不同 Temp 根；兼容性修正与 B2 正式质量结果共享 resume 根。

| Stage | Candidate fingerprint | Evidence directory | Key result | Accepted / Historical / Partial | Limitations |
| --- | --- | --- | --- | --- | --- |
| I5-A first engineering pass | H | `%TEMP%/minddiary-i5-20260928-221145` | 81 variants mapped PASS ×3；19 UNVERIFIED；ENGINEERING CANDIDATE NOT READY；real Electron smoke 保留 | Historical / Partial；旧候选 | 缺少完整独立变体及逐项 invariant 证据；不能把 UNVERIFIED 当成 0 |
| I5-A2 engineering completion | H | `%TEMP%/minddiary-i5-a2-20260929-111856` | 合并后 100/100 variants PASS ×3；0 FAIL；0 applicable UNVERIFIED | Accepted engineering evidence / historical fingerprint | 19 个新独立证明与原 81 个结果组合；工程验证，无统计可靠性结论；不证明 F 未变 |
| I5-B first real attempt | H | `%TEMP%/minddiary-i5-b-20260929-235249` | deepseek-flash；thinking default enabled；max_tokens=2000；reasoning_tokens=2000；visible answer empty；finish_reason=length；1 call，0 complete pairs | Historical compatibility failure before formal candidate comparison | 首个 baseline 调用停止；不是 candidate answer-quality failure；其余 29 请求 NOT_RUN |
| DeepSeek correction initial stop | P（停止前 H） | `%TEMP%/minddiary-i5-b2-20261003-101218` | 新 IPC fixture 参数错误；301 PASS / 5 FAIL；真实调用 0；dispatch disabled | Historical / Partial；未认证中间状态 | stopped-report.md 保留；不得用后续通过覆写当时失败 |
| DeepSeek correction / resume | R（中间）→ B2（正式） | `%TEMP%/minddiary-i5-b2-resume-20261003-105506` | fixture 修正、delta harness 路径修正，focused/delta/native/live compatibility 通过；精确 DeepSeek host 的 thinking disabled；Parent 接受 | Accepted compatibility correction；中间停止保留 | resume-report.md 的 STOPPED 被最终报告取代；Node20 jsdom 启动错误、observer octal escape 仍留证；兼容性 PASS 不等于质量 PASS |
| I5-B2 formal model quality | B2 | `%TEMP%/minddiary-i5-b2-resume-20261003-105506` | 30/30 formal generations；S2 candidate 1/5；S9 candidate 4/5；G1 candidate 5/5；model-quality FAIL | Historical failure / superseded candidate | 当前质量证据由 B3 取代；证明需要 main-owned evidence / answer discipline；不能抹去失败 |
| I5-B3 model-quality completion | F | `%TEMP%/minddiary-i5-b3-20261003-112256` | 2 probes PASS；20/20 formal generations；S2 candidate 5/5；S9 candidate 5/5；no retry；no replacement | Current accepted candidate / PARENT ACCEPTED | 自动助手评分，非盲真人评分；G1 没有新生成，B2 G1 仅历史证据；此时报告仍保留真人 gate NOT PASSED |
| Product-value preparation / Codex preflight | F | `%TEMP%/minddiary-human-product-gate-20261003-152513` | Owner 最终指令记录 Codex 21/56 preflight；S3 无切页/转录、S2 本地 70/140、Quick Prompt UNSUPPORTED、旧 S9 route 被 Temp safety 阻断 | Supportive / Partial；PASS AS PREFLIGHT | 非真人可用性/隐私理解研究；工具耗时不是真人表现；Owner waived formal human study，最终 Product Gate CONDITIONAL PASS |

## Key local evidence locators

以下路径均相对各行 Temp 根，不执行其中脚本：

- I5-A：`candidate-manifest.json`、`freeze.cjs`、`i5-a-summary.md`、`matrix-results.json`、`hard-invariants.json`。
- I5-A2：`candidate-integrity.json`、`merged-matrix-summary.json`、`i5-a2-summary.md`。
- I5-B：`candidate-manifest.json`、`i5-b-summary.md`。
- Initial correction：`stopped-report.md`、`stopped-state/candidate-manifest.json`。
- Resume / B2：`resume-report.md`（历史中间停止）、`i5-b2-summary.md`（最终）、`preregistration-lock.json`、`quality-s2.json`、`quality-s9.json`、`quality-g1.json`。
- B3：`corrected-candidate/candidate-manifest.json`、`preregistration-lock.json`、`preservation.json`、`summary.json`、`i5-b3-summary.md`、`probe-review.json`、`quality-review.md`、`delta-r1.json` / `delta-r2.json` / `delta-r3.json`。
- Product preparation / preflight：`tasks.json`、`schedule.json`、`provenance/arms.json`、`provenance/before/candidate-manifest.json`、`provenance/after/candidate-manifest.json`、`records/56-runs.csv`、`records/28-pairs.csv`、`records/runtime/`。准备时的 blank/NOT_RUN 表格不等于已完成研究；21/56 与豁免决定依据 Owner 本次最终指令记录，不由准备表推断。

## Evidence hierarchy and interpretation

最高置信度的工程证据：I5-A matrix、hard invariants、deterministic tests、SQLite/source/destination/race tests、real Electron smoke、real DeepSeek request evidence、I5-B3 paired model-quality samples。这里的层级不把模型质量样本变成统计可靠性证明。

支持性产品证据：Codex computer-use preflight。正式 human 1+3 和 human privacy comprehension 由 Owner 豁免且 NOT RUN；multi-user usability 与 blind human answer preference study 未执行。不得宣称正式单用户/多用户可用性研究完成、普遍最快或统计可靠性。

I5-A/A2 的 H、B2 的失败以及旧停止报告均不用于证明 F 当前字节完整性。F 的身份依据 B3 manifest 与收尾时按原算法重算和逐文件比较；旧报告不修改。Temp 根存在只证明本地可定位，不代表本次重审了每项原始证据或做了新的评估。

最终 Owner 接受、Product Gate CONDITIONAL PASS、边界和停止条件见 [Final closeout](phase-d-final-closeout.md)。Release NOT AUTHORIZED；下一阶段需独立授权。
