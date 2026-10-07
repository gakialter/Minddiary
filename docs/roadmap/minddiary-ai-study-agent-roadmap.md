# MindDiary AI Study Planning Agent Roadmap

Status: v1.20.0 local release candidate preparation. The published baseline remains v1.19.1; current Phase D acceptance is recorded in [Phase D final closeout](phase-d-final-closeout.md). Earlier rebaseline and delivery-time status statements below are historical.

This is a planning document. It authorizes documentation alignment only. It does not authorize runtime changes, prompt changes, schema changes, migrations, implementation, a PR, merge, tag, release, or publication. Every later implementation must revalidate `main` and receive its own scope and authorization.

## Verified Release And Main Baselines

The published Release and the current development branch are separate facts. A later `main` commit does not retroactively change a published tag, Release, or its artifacts.

### Latest published Release

- Latest published GitHub Release: `v1.19.1`.
- Published at: `2026-09-11T17:31:49Z`.
- Release state: not a draft and not a prerelease.
- Release target commitish: `main`; the immutable `v1.19.1` tag resolves to commit `19465ab8872ac3a9b26b8fba75844c8ba0bb97fd`.
- Tag package version: `1.19.1`.
- Tag SQLite baseline: `CURRENT_SCHEMA_VERSION = 8`.

These values describe the published release baseline.

### Baseline used for this roadmap refresh

- Baseline commit: `87fef52eba451a38226b4e04e701d79c431eddfe`.
- Commit title: `docs: correct v1.19.1 roadmap facts`.
- Verified on: `2026-09-20`; local `main` and remote `refs/heads/main` matched via `git ls-remote`. Latest GitHub Release metadata and the peeled `v1.19.1` tag were also checked.
- Package version at baseline commit: `1.19.1`.
- SQLite baseline at baseline commit: `CURRENT_SCHEMA_VERSION = 8`.
- Schema 8 migration: `add-subject-daily-review-state`.
- Schema 8 table: `subject_daily_review_state`.

This baseline SHA was used to audit and verify product facts for this roadmap refresh. Subsequent work must fetch and revalidate `main`, package metadata, schema, migrations, and relevant release facts before work starts. Historical schema versions remain intact: v1.17.1 was published on schema 5, PR #154 introduced schema 6 (`study_task_action_receipts`), PR #159 introduced schema 7 (`planning_runs`, `planning_run_candidates`), and v1.19.0 introduced schema 8.

SQLite remains MindDiary's local authoritative source of truth. Model output remains untrusted candidate input.

## Completed Agent Foundations

### PR #152 — Unified confirmed study-task actions

- Unified the confirmed study-task action boundary used by Today Action and Daily Review.
- Both entry points continue to require explicit user confirmation.
- AI does not write directly to SQLite.

### PR #153 — Versioned confirmed operation contracts

- Introduced versioned operation contracts.
- Added session-local generation provenance.
- Kept confirmation-context refresh separate from generation context.
- Did not persist a Planning Run.

### PR #154 — Idempotent confirmed task creation

- Used schema 6 for `study_task_action_receipts`.
- Added operation IDs and canonical request digests for idempotent confirmed commands.
- Defined replay, conflict, deleted-result, integrity, date-mismatch, and transport-uncertain behavior.
- Commits a task and its receipt atomically.
- Keeps a bounded local pending-operation queue.
- Allows restart recovery only after an explicit user click; there is no background retry.
- Did not implement a generic Agent Run or feedback loop.

## Product Positioning

MindDiary provides local-first, bounded, user-triggered, evidence-driven learning assistance for long-cycle learning. Existing planning features such as Today Action and Daily Review use a candidate-to-confirmation workflow; other AI interactions may simply answer a question from available evidence or retrieve one precise fact and stop.

This direction is not a claim that every source participates in every interaction. Each source must pass a separately versioned privacy, validation, and product gate before it can be included.

Phase D First Slice does not require an Agent Loop. Stronger adaptive loops enter scope only when an independent gate establishes their necessity. AI does not own application state, run unsupervised, or mutate study data by itself.

## Existing Confirmed Planning Loop

This is the existing trusted chain for planning workflows involving AI-generated candidates and task writes, including Today Action and Daily Review. It is not a general Agent Loop that every Phase D interaction must follow. Fact-only answers, such as Scenario 3's chapter-progress question, do not require candidate actions or write confirmation.

```text
Bounded Context
  -> Study Planner
  -> Validated Candidate Actions
  -> User Review And Confirmation
  -> Idempotent Action Execution
  -> Deterministic Local Outcomes
  -> Optional Feedback For A Later User-Triggered Run
```

1. **Bounded Context** reads an explicitly limited projection of relevant local data.
2. **Study Planner** calls the configured Provider only after a user action.
3. **Validated Candidate Actions** are parsed, allowlisted, and checked by local code.
4. **User Review And Confirmation** allows editing, removal, rejection, deferral, or confirmation before a task write.
5. **Idempotent Action Execution** uses the normal trusted Electron/SQLite boundary and action receipts.
6. **Deterministic Local Outcomes** come from ordinary task, Pomodoro, diary, and mistake-review flows, not from an AI process.
7. **Optional Feedback** can affect only a later user-triggered candidate-generation cycle and must remain visible and controllable.

## Receipt And Planning Boundaries

### Action Receipt

`study_task_action_receipts` has one narrow responsibility: make a confirmed study-task command idempotent and recoverable.

It may record only what that responsibility requires:

- operation ID;
- action kind and action-contract version;
- canonical request digest;
- replay or conflict identity;
- current task-result relation;
- information required to resolve an uncertain transport result.

An Action Receipt must not become a planning-history or general event store. It must not store:

- a complete Prompt;
- a raw Provider request or response;
- planning context;
- original candidates;
- user edit history;
- rejected candidates;
- execution feedback.

Receipt retention and semantics must remain independently governed by idempotent command recovery. A future planning-history retention policy must not silently delete or redefine receipts.

### Planning Run

A Planning Run is an implemented, bounded record of one user-triggered Today Action or Daily Review lifecycle. Its responsibilities are limited to:

- a bounded lifecycle for one Today Action, Daily Review, or later approved planning entry point;
- versioned planning contracts;
- a user-explainable, bounded context summary;
- validated candidates and bounded user decisions;
- auditable links to action attempts, receipts, and resulting tasks.

Planning Run persistence is implemented under Schema 7. Its current entry-point contract covers Today Action and Daily Review, not Mistake Review or a generic Agent trajectory. A run does not claim that the Provider used specific context merely because local code prepared it, and it does not store Provider reasoning or become a generic workflow engine. See [Planning History Schema 7](../schema-7-history.md) and [the current types](../../src/types/planningHistory.ts).

Planning contracts and confirmed-action contracts evolve independently. Updating a Planning Run contract does not invalidate existing action-receipt replay behavior.

## Schema Policy and Evolution

MindDiary enforces strict, ordered, additive SQLite schema migrations. Historical schema numbers describe immutable releases and milestones, while `CURRENT_SCHEMA_VERSION = 8` represents the current active database baseline:

- **Schema 6 (`study_task_action_receipts`)**: introduced in PR #154 for idempotent confirmed study task actions and crash recovery.
- **Schema 7 (`planning_runs`, `planning_run_candidates`)**: introduced in PR #159 (Phase C2) to provide bounded, restart-surviving planning history audit (30-day / 100-run retention, backup/restore compatible, no raw prompts or responses stored).
- **Schema 8 (`subject_daily_review_state`)**: introduced in commit `87ef4ae` (v1.19.0) to persist independent daily review round progress without touching SM-2 state.

The current authoritative schema baseline is Schema 8. Historical schema descriptions remain valid historical records of earlier migration milestones. Any future schema proposal (Schema 9+) requires dedicated explicit authorization, ordered migration scripts, fresh-database and historical upgrade tests, backup/restore verification, and browser fallback handling before implementation.

## Phase C Capability Sequence

Capability gates govern incremental milestones. Each phase requires evidence-backed verification before landing.

### Phase C0 — Roadmap rebaseline

**Status:** Completed / historical milestone (captured initial Phase C foundation).

**Core problem:** correct the Phase C factual baseline, separate Action Receipt from Planning Run, and define the order and gates for later work.

### Phase C1 — Session-local planning explainability

**Status:** Completed / shipped in PR #156 (commit `125115e`).

**Core problem:** during the current Today Action or Daily Review session, users understand:

- which context categories were used or excluded;
- which candidates were generated;
- which candidates they modified, removed, did not select, or confirmed;
- whether each confirmed action was created, replayed, uncertain, conflicting, or associated with a later-deleted task.

**Delivered policy:**
- schema unchanged;
- session-local lifecycle only;
- no long-lived localStorage Planning Run ledger;
- no complete Prompt or raw Provider-response persistence;
- no background execution or automatic task write.

### Phase C2 — Minimal persistent Planning Run

**Status:** Completed / shipped in PR #159 (commit `ca0e581`).

**Core problem:** provide the smallest privacy-minimized Planning Run needed for cross-restart and backup-compatible audit.

**Delivered policy:**
- schema 7 added bounded `planning_runs` and `planning_run_candidates` history;
- all stored data is bounded and locally validated;
- Action Receipt remains the source of truth for confirmed-action execution;
- Planning Run remains an audit relation, not a command receipt or general event store;
- history survives restart and participates in backup/restore, but a run is never resumed;
- runtime retention is 30 days and at most 100 runs; users can delete one run or clear history without deleting tasks or receipts;
- Provider prompts, payloads, raw responses, reasoning, and prior Planning History remain outside this persistence contract.

### Phase C3 — Deterministic execution attribution

**Status:** Completed / shipped in PR #160 (commit `ae54bfb`).

**Core problem:** show only outcomes that local data can prove, including current task status, receipt relation, and explicitly task-linked Pomodoro sessions.

**Delivered policy:**
- correlation is not presented as causation;
- unfinished tasks are not classified as poor suggestions;
- task deletion and missing relations are shown explicitly;
- no AI process completes, skips, deletes, or otherwise updates a task.

### Phase C4 — User-triggered feedback summary

**Status:** Completed / shipped in PR #161 (commit `b125ea9`).

**Core problem:** before a later user-triggered generation, show a bounded explanation of which prior outcomes may influence new candidates and let the user decide whether to use them.

**Delivered policy:**
- user-triggered and user-visible;
- candidate-level influence only;
- users can disable, clear, or override the feedback summary;
- no background learning or invisible user profile;
- no opaque reward optimization or automatic mutations.

### Phase C5 — Mistake Review Agent

**Status:** Completed / shipped in PR #162 (commit `73b5224`).

**Core problem:** generate bounded, explainable, user-confirmed review candidates for due mistakes.

**Delivered policy:**
- does not automatically change SM-2 behavior;
- does not mark a mistake reviewed or mastered automatically;
- does not create a task without explicit confirmation;
- schema unchanged;
- deleted mistakes, subjects, and stale context remain zero-write cases.

### Phase C6 — Planning modes and strategy presets

**Status:** Completed / shipped in PR #163 (commit `81770d0`).

**Core problem:** offer a small set of explicit, user-selected planning strategies with visible differences.

**Delivered policy:**
- no automatic mode switching;
- every mode uses the same local parser, allowlists, and confirmation boundary;
- no hidden personalization or generic tool runtime;
- schema unchanged.

### Phase C7 — Bounded chapter context

**Status:** Completed / shipped in PR #164 (commit `4ee1bb6`).

**Core problem:** allow Today Action planning candidates to associate bounded chapter context without unbounded token growth or schema expansion.

### Phase C8 — C8 UI/UX workspace upgrade

**Status:** Completed / shipped in PR #168 (commit `3f1cdee`).

**Core problem:** modern, calm, structured UI upgrade across all workspaces; navigation aligned to 「今日执行」, docking Pomodoro, and responsive modal viewports.

### Post-C8 Shipped Capabilities (v1.19.0 / v1.19.1)

**Status:** Completed / shipped in v1.19.0 (commit `3941c96`) and v1.19.1 (commit `19465ab`).

- **Schema 8 Custom Daily Review Rounds**: independent from SM-2, per-subject daily quota, unreturned randomized queues, cross-day continuation, explicit round restart, and zero SM-2 mutation.
- **CodeMirror 6 Live Preview**: single editing surface with live formatting, syntax reveal on cursor, and standard Markdown canonical storage.
- **AI Selection Polish**: 4 focused text actions, strictly bounded to selected continuous prose (max 4000 chars), explicit application, invalidation on document drift, and undoable.

### Local v1.20.0 Candidate Capabilities

The local v1.20.0 candidate also includes image input (PNG/JPEG/WebP), locally extracted PDF text, editable selection-polish candidates, and the Phase E template/search/focus interaction improvements. These are implemented candidate capabilities, pending release validation and publication. PDF input does not include OCR or page vision; no RAG, general Agent runtime, multi-agent expansion, or cloud sync is added.

### Future / Proposed Directions

The following capabilities remain proposals and require independent specification, review, and authorization before adoption:

- **Cross-subject workload balancing**: bounded suggestions for pacing study tasks across subjects during heavy review cycles;
- **Exam countdown milestone integration**: linking long-cycle countdown milestones to high-level weekly focus areas without automated scheduling;
- **Enhanced offline analytics**: local insights into study habits and retention curves without telemetry or cloud sync.

## Phase D — Minimum Learning Assistance First, Conditional Agent Capabilities

**Current acceptance:** the [2026-10-03 final closeout](phase-d-final-closeout.md) records D0/D1 complete and the Phase D candidate accepted, with a **CONDITIONAL PASS** Product Gate; formal human studies were waived / not run. This local release preparation does not upgrade that historical evidence to a formal human usability pass.

**Historical rebaseline status (2026-09-25): D0 completed / Parent accepted; roadmap rebaseline Parent accepted with required cleanup completed; D1 not started.** Parent explicitly accepted the original roadmap and D0.1–D0.4 in that rebaseline request. **D0 = COMPLETE; D0.5 = none.** Research documents retain their delivery-time wording; their pending acceptance statements are historical and must be read with the final closeout.

On 2026-09-25, HEAD, local `main`, local `origin/main`, and remote `refs/heads/main` (read with `git ls-remote`) all matched `87fef52eba451a38226b4e04e701d79c431eddfe`. This is a documentation rebaseline using the existing worktree research, not a new source or release audit. Parent accepted the rebaseline with minor required wording cleanup, now completed. This update authorizes no D1 design, baseline measurement, implementation, or publication.

### Authoritative D0 Inputs

| Accepted input | Responsibility |
| --- | --- |
| [D0.1 — Learner Experience Scenarios](D0-learner-experience-scenarios.md) | User problems, current experience, and scenarios 1–12. |
| [D0.2 — Evidence & Retrieval Model](D0-evidence-retrieval-model.md) | Evidence semantics, coverage, freshness, and retrieval decisions; its C1–C5 corrections refine the earlier scenario hypotheses. |
| [D0.3 — Access & Disclosure Boundaries](D0-access-disclosure-boundaries.md) | Local Access, Provider Disclosure, Derived Material Use, Action Authority, denial, and revocation. |
| [D0.4 — Minimum Product Capability & Eval Baseline](D0-minimum-product-capability-eval-baseline.md) | First Slice selection, deferred capabilities, paired eval protocol, six hard invariants, and roadmap rebaseline recommendation. |

Use these documents as design inputs, with D0.4's final scope decisions governing the First Slice. Earlier adaptive candidates remain research context, not approved First Slice capabilities. D0 delivered learner scenarios, an evidence model, an access/disclosure model, first-slice scope, an eval baseline protocol, hard invariants, and a rebaseline recommendation. Product eval has not run.

### Start With The Learner's Problem

The immediate problems are concrete: assembling broad Context for a single chapter-progress fact; answering an ambiguous “efficiency” question without first clarifying it; and continuing help after diary access is denied or withdrawn without reusing old diary-derived material. Existing chat and specialized planners remain useful comparison paths. More data, more calls, or a shared runtime are not evidence of a better learning experience.

First prove the minimum user experience and data boundaries, then implement only the technical support they require. Most primary paths in the D0 scenario set do not require an adaptive loop; this is not a measured user-frequency claim. The original two-hour planning example remains a preservation/control case: Today Action may already serve it, and remaining time must not be confused with its total-day budget.

### Phase D First Slice

**Primary scenarios: 2 / 3 / 9.** The First Slice contains exactly five product capabilities:

1. **Precise fact retrieval:** check the few requested facts within a known scope.
2. **Clarification before retrieval:** ask about ambiguous meaning, identity, or comparison periods before accessing records.
3. **Evidence-bounded answering:** distinguish records, user statements, inference, and unknowns; explain coverage and stop when sufficient or unsupported.
4. **Access/disclosure transparency:** make actual local use, intended/actual Provider disclosure, destination, and exclusions understandable.
5. **Graceful degradation after denial/revocation:** continue useful limited help using only remaining allowed material.

The first version supports no retrieval or a direct, predetermined evidence batch, with ask-user and stop choices throughout. One batch is not necessarily one SQL call and must not conceal broad underlying reads. Existing valid conversation evidence can make even a fact question a zero-new-read path. Pure local facts need not be sent to a Provider; denial of all outbound requests must not be presented as an offline AI capability.

**Adaptive Retrieval = deferred (First Slice decision: No). Specialized Workflow Migration = deferred (First Slice decision: No).** No general Agent Loop, general Tool Registry, generic data browsing, new general write authority, RAG, memory, or migration of Today Action / Daily Review / Mistake Review belongs to this slice. Scenarios 5 and 7 remain deferred; G6 is a research comparator outside First Slice capability-pass counts.

**Direct Retrieval First; Ask User When Appropriate; Stop When Evidence Is Enough; Adaptive Retrieval Only After Independent Evidence.** This does not require a read when the conversation already suffices.

### Verified Foundation To Extend

The following source anchors were inspected at the baseline above. They describe existing behavior, not Phase D deliverables:

| Foundation | Current boundary and evidence |
| --- | --- |
| Provider requests | [AI service](../../electron/aiService.ts) sends OpenAI-compatible Chat Completions from Electron main, validates requests, checks image capability, and returns text or an error. It already has an AbortController-based 30-second timeout and HTTP error handling. It does not expose streaming, tool-call responses, finish reasons, usage, or a general execution loop. D1 considers only support required by the approved First Slice; none of these missing abstractions is a mandatory platform milestone. |
| Bounded context | [Context builder](../../src/utils/aiContextBuilder.ts), [conversation builder](../../src/utils/aiConversationBuilder.ts), and [request policy](../../src/utils/aiRequestPolicy.ts) bound selected context, attachments, and messages. Ordinary chat includes at most six recent history messages; specialized planners have their own projections. These are not a generic data-grant model. |
| Candidate workflows | [Today Action](../../src/components/TodayActionSuggestionDialog.tsx), [Daily Review](../../src/components/DailyReviewAgentDialog.tsx), and [Mistake Review](../../src/components/MistakeReviewAgentDialog.tsx) provide specialized generation, local candidate handling, and explicit confirmation. Preserve and compare these workflows and regression-test their source, stale-context, date, confirmation, and recovery boundaries; the First Slice does not migrate them. |
| Versioning and provenance | [AI operation contracts](../../src/utils/aiOperationContracts.ts) define version tuples and session-local generation provenance, including a generation context signature. [Confirmed actions](../../src/utils/agentStudyTaskActions.ts) carry a separate confirmation snapshot and entry-specific validation. A future runtime must preserve that distinction. |
| Confirmed execution | [Idempotent task creation](../../electron/idempotentStudyTaskCreation.ts) validates privileged requests and references, commits task and receipt atomically, and handles replay/conflict/deleted results. [Pending operations](../../src/utils/pendingStudyTaskOperations.ts) support uncertain-result recovery without autonomous background writes. |
| Planning Runs / History | [Schema 7 contract](../schema-7-history.md), [types](../../src/types/planningHistory.ts), and [local implementation](../../electron/planningHistory.ts) provide privacy-minimized audit for Today Action / Daily Review, bounded to 30 days / 100 runs. Restart does not resume a run; receipts remain separate from history. This is not durable Agent memory. |
| AI Selection Polish | [Selection target](../../src/components/common/diaryPolishTarget.ts) and [polish interaction](../../src/components/common/useDiaryPolish.ts) constrain the selected prose, validate candidates, invalidate document drift, and require explicit application. Preserve this narrow editing contract; it does not authorize Agent diary rewriting. |

### Product And Trust Principles

1. **User goals first.** Users should not need to understand Tool Calling, context windows, RAG, Agent loops, subagents, or MCP. They should understand what 小研 checked and why its suggestion fits their situation.
2. **Information seeking is delegated; authority is not.** Any future model-directed evidence request must remain within the approved capability gate; the First Slice does not dynamically expand an evidence batch. It cannot decide “what may I access?” Local application policy and user-permitted scope determine capabilities, available data, and permitted disclosure. Tool arguments and results remain untrusted input, not authority or instructions.
3. **SQLite remains authoritative; model output remains untrusted.** AI never directly reads or writes SQLite. Typed domain operations run through trusted local code. A model statement cannot establish a fact, validate a reference, or report a successful write.
4. **Preserve the trusted action chain.** Candidate → deterministic local validation → user review/edit → explicit confirmation → idempotent action → receipt → SQLite remains the conceptual boundary. Task and receipt are committed atomically in the current implementation. A future shared execution foundation must preserve parsers, allowlists, operation versions, generation provenance, confirmation signatures, stale checks, replay/conflict/uncertain semantics, and receipt compatibility; it must not turn a model tool call into confirmation.
5. **Increase automation by risk.** Within a user-triggered session and permitted scope, Read may retrieve bounded information automatically, Analyze may derive findings locally or through an authorized Provider, and Propose may produce candidates automatically. Mutate always requires explicit user confirmation of the concrete operation followed by trusted local execution. No unattended background execution or automatic learning-data writes.
6. **Local-first / privacy-first.** Permission to read locally is not permission to send to a Provider. Apply a separate, bounded projection and disclosure check before every outbound request, including follow-ups, retries, summaries, and retained session state. Diary bodies, mistake answers, and attachments are not implicitly authorized by enabling tools. Secrets never enter model context; provider credentials stay in the trusted networking boundary described in [AI contracts](../agents/ai-contracts.md).
7. **Progressive capability, proven need.** Use the minimum support for the approved user capability within the existing Electron + TypeScript architecture. No SDK or Agent framework is selected here. LangGraph, vector databases, RAG, MCP, multi-agent/subagents, and autonomous background execution are not starting dependencies. Optional later capabilities need a demonstrated user problem and eval evidence; background autonomy remains outside Phase D.

### Capability Sequence And Gates

The product order is **D0 complete → D1 minimal design and current baseline → D2 bounded facts with D3 enforcement → D4 integration and paired eval**. D1/D2/D3 are scoped gates, not three complete platforms that must be built first. Boundary design and observation move into D1; D2 can validate local facts under controlled fixtures, but **production model-directed data access must not open before D3 passes**. D2 and D3 evidence must both hold before First Slice product acceptance.

D5–D9 are independent, deferred / conditional gates. Completing D1–D4 does not automatically start any of them. Model Runtime, typed tools, a policy engine, provider capability abstraction, and streaming remain possible technical choices only when an approved user capability needs them, and only to the minimum extent needed by its gate. Each next stage requires its own scope, recorded evidence, and authorization; this rebaseline starts none.

#### D0 — Product / Evidence / Access / Eval Baseline

- **Status:** Completed / Parent accepted; no D0.5.
- **Delivered:** D0.1 scenarios; D0.2 evidence semantics and retrieval decisions; D0.3 access/disclosure and derived-use boundaries; D0.4 First Slice, eval protocol, hard invariants, and rebaseline recommendation.
- **Gate meaning:** the research decisions are accepted. Runtime behavior, user understanding, resource costs, and product benefits remain unmeasured; completion is not product success.

#### D1 — First Slice Design & Baseline Measurement

- **Status:** Not started; requires separate authorization after this rebaseline's Parent Gate.
- **User problem:** the desired improvements are known, but the smallest change within current Electron boundaries and the measured current experience are not.
- **Minimum capability:** design only what the five capabilities require; define minimal data projections and observable actual local access / Provider disclosure, including derived material and revocation. Measure the best current paths, user preparation burden, latency, calls, context, and actual access/disclosure scope.
- **Explicitly not:** no complete Model Runtime, Agent Loop, general Tool Registry, adaptive retrieval, workflow migration, RAG, or memory. Small runtime design is eligible only when justified by the First Slice; this roadmap selects no architecture.
- **Gate evidence:** a reviewable minimal design and observation method, measured current baseline, and Parent-locked resource ceilings, sample/repeat conditions, and benefit criteria **before candidate comparison**. D0.4's behavioral oracles are already fixed; do not invent milliseconds, token budgets, or improvement percentages, or change acceptance after seeing candidate scores.

#### D2 — Minimal Direct Evidence Capability

- **User problem:** Scenario 3 needs one precise progress fact; Scenarios 2/9 may need a bounded, explicitly defined record comparison.
- **Minimum capability:** only First Slice projections justified by D0.4: selected subject/chapter facts and necessary, allowed task/focus facts. Prove actual object/date/field scope, coverage, current-state semantics, and no-retrieval / direct-retrieval / ask-first / stop behavior.
- **Explicitly not:** no general database browser, arbitrary SQL/file access, new write path, blanket candidate-source catalog, or production model-directed access before D3. A typed operation/tool abstraction may support this scope but is not a general registry mandate.
- **Gate evidence:** controlled local fixtures establish precise facts, zero unrelated access, truthful missing/failed/partial results, identity clarification, invalid/deleted-reference handling, and stopping. Reading a broad object then trimming it is not bounded access. These checks do not by themselves authorize production exposure.

#### D3 — Access / Disclosure Enforcement

- **User problem:** useful help must respect what may be read, sent, reused, and acted on.
- **Minimum capability:** enforce D0.3's **Local Access / Provider Disclosure / Derived Material Use / Action Authority** for the First Slice, before access and at every outbound send. Include history, regenerate snapshots, retries, mixed summaries, source changes, revocation, and affected late results.
- **Explicitly not:** no full permission platform, blanket grants, model-created authority, new action authority, or promise to retract previously sent bytes. Preserve existing confirmed actions separately.
- **Gate evidence:** observable actual local access and actual outbound requests, not UI labels alone; `unauthorized local access = 0`, `unauthorized provider disclosure = 0`, and `revoked-source reuse = 0`, alongside all six invariants. Denial must preserve useful limited help; local-only permission must not silently send statistics or derived facts. Production model-directed access remains closed until this gate passes.

#### D4 — First Slice Integration & Paired Eval

- **User problem:** separately correct facts and boundaries do not yet prove a better complete experience.
- **Minimum capability:** integrate the five capabilities and run D0.4 Golden / Adversarial / paired eval for Scenarios 2, 3, 9 and negative controls, against the D1 current baseline under the pre-registered conditions.
- **Explicitly not:** this is not the old Bounded Agent Loop stage and does not migrate planners or introduce dynamic second-evidence retrieval.
- **Gate evidence:** all applicable behavioral oracles and six hard invariants pass per case/repeat; primary scenarios show reproducible benefit, controls have no unexplained regression, and Parent accepts the resource comparison. Report behavioral compliance and experience benefit separately; only both support the First Slice product Gate.

#### D5 — Adaptive Retrieval Research Gate

- **Status:** Deferred / conditional; not triggered by completion of D1–D4.
- **User problem:** only a real scenario where direct retrieval, asking the user, and stopping cannot meet the justified goal can reopen adaptive retrieval.
- **Minimum capability:** independent comparison must show that a second, dynamically selected evidence item reproducibly improves the result within allowed scope. D0.4 G6 may seed this research, but is neither implementation authorization nor a First Slice requirement.
- **Gate evidence:** demonstrate the specific evidence gap and benefit over direct user-provided material before authorizing a separate design. The old bounded-loop proposal survives only here as a future candidate: foreground user trigger, bounded calls/steps/context/time/recovery, cancellation and invalidation, and explicit stop. No background autonomy, mutation tools, or unlimited loops.

#### D6 — Specialized Workflow Migration Gate

- **Status:** Deferred / conditional. **Preserve and compare; do not migrate yet.**
- **User problem:** only a demonstrated gap in a particular Today Action, Daily Review, or Mistake Review experience can justify changing its implementation.
- **Minimum capability:** any future migration must be scoped to one entry point, preserve its contracts, and compare on equivalent allowed evidence. There is no approved migration order; the original Mistake Review → Today Action → Daily Review proposal is not an authorized route.
- **Gate evidence:** independent user-experience benefit, no safety regression, relevant regression checks, and demonstrated rollback preserving receipts, history, and recovery before any migration. No automatic SM-2/mastery changes or weakening of confirmation.

#### D7 — Context / Search / Memory Gate

- **Status:** Deferred / conditional; combines the original D6 context and D7 search/memory possibilities.
- **User problem:** only measured context pressure or an actual unresolved historical-information need justifies research.
- **Minimum capability:** evaluate compaction only for observed pressure; consider bounded structured search before FTS/local search, user-visible durable memory, or semantic retrieval as appropriate to the demonstrated need. These are alternatives to justify, not a mandatory construction sequence.
- **Gate evidence:** simpler options demonstrably fail; paired evidence supports quality, source fidelity, privacy, latency, and cost. Any future compacted/durable material must preserve source/time/permission lineage, conflict handling, deletion and revocation, and user control. No preapproved RAG, embedding, storage migration, invisible profile, or Provider-side memory.

#### D8 — External Interoperability Gate

- **Status:** Deferred / conditional.
- **User problem:** only a concrete cross-application learning workflow justifies an external boundary.
- **Minimum capability:** MCP remains optional and for external interoperability only, never an internal runtime dependency. Exposing limited read capabilities and consuming an external service require separate scope.
- **Gate evidence:** a validated scenario, destination/identity/data-flow boundaries, revocation and hostile-result checks, and value over a simpler integration. This permits a separately authorized design, not automatic integration or external write authority.

#### D9 — Multi-agent Research Gate

- **Status:** Deferred / conditional; **default = no implementation**.
- **User problem:** only a task that the best simpler single-agent approach cannot adequately solve is eligible.
- **Gate evidence:** independent, repeatable eval must establish necessity and benefit sufficient to justify latency, tokens, and coordination, while preserving or narrowing access, disclosure, budgets, and confirmation boundaries. Research does not automatically authorize design or implementation; no speculative teams or background autonomy.

### Existing Capability Preservation

Today Action / Daily Review / Mistake Review explicitly remain **preserve / compare / regression test**, not “replace after the runtime is built.” Their preparation, budget semantics, candidate editing, confirmation, stale/date checks, and recovery remain intact. Preserving them does not assert that current paths satisfy every new access requirement; record known differences and never route the First Slice through a noncompliant path to evade D3.

Planning History remains bounded Today Action / Daily Review audit (30 days / 100 runs), separate from receipts, with no resumed run, generic Agent trajectory, First Slice data-source expansion, or durable memory. AI Selection Polish retains its selected-prose, drift-invalidation, validation, and explicit-application responsibility. The confirmed action chain remains candidate → local validation → review/edit → explicit confirmation → trusted idempotent execution → receipt → SQLite; the First Slice adds no writing authority.

### User-visible Evidence, Not AI Theater

Show what helps a learning decision: which data categories were actually read, which were included in the Provider request, which were excluded and why, the current concrete activity, evidence for advice, and the action requiring confirmation. Distinguish local facts from model suggestions. Local telemetry can prove a tool read or an outbound inclusion; it cannot prove what the Provider internally attended to. Preserve that distinction from existing Planning History.

For Scenario 3, explain only the selected subject facts actually checked, whether they were sent to the Provider, and what remains unknown; do not imply tasks or due mistakes were also read. For Scenario 9, distinguish excluded diary-derived material from history that may remain visible. These are information requirements, not a new UI design. Keep progress subordinate to learning content and preserve cancellation and the existing candidate-confirmation boundary.

Avoid walls of “Thinking…”, “Reasoning…”, “Planning…”, or autonomous-agent animation. Display evidence and concise user-facing explanations, not hidden chain-of-thought. Do not request, display, or persist hidden model reasoning. Any execution diagnostics must be bounded and privacy-minimized; a trajectory eval does not authorize storing raw personal prompts, tool payloads, or Provider responses in Planning History.

### Eval Gate From The Start

[D0.4](D0-minimum-product-capability-eval-baseline.md) supplies the authoritative Golden / Adversarial cases, fixtures, denominators, observation rules, and paired protocol; these are defined but not executed. D1 measures the current baseline first, and Parent locks resource ceilings and benefit criteria before comparing a candidate. Include actual preparation/clarification burden, time to the first correct useful result and final answer, Provider calls including failures/retries, evidence batches and underlying reads, context size, actual local access and disclosure. Separate measured usage from estimates; missing observations are unknown, never zero.

Paired runs use the same question, synthetic snapshot and changes, visible history, Provider/model, local date, user constraints, and separate local-access/disclosure permission ceilings. Compare the strongest applicable current path, including direct chapter UI and ordinary Chat, not an artificially burdensome baseline. Include manual preparation on both sides and a same-evidence Chat comparison; do not give the candidate extra evidence. Report each scenario and repeat, not only averages.

#### Primary Scenario Gates

| Primary scenario | Mandatory First Slice evidence |
| --- | --- |
| **3 — “线代现在学到哪里？”** | One precise, predetermined subject/chapter evidence batch if needed; no unrelated records; answer the recorded marks and stop. Existing valid facts require no new read; missing details permit only a bounded summary, not invented learning/understanding. |
| **2 — “最近数学效率下降。”** | Clarify meaning and comparison periods before retrieval; compare only the agreed limited records when needed. Focus minutes are not efficiency; current task state is not historical completion. Do not add more data to manufacture a causal explanation. |
| **9 — “不看日记，但帮我分析。”** | Exclude diary content, metadata, and derived material; remain helpful from allowed evidence/self-report without repeatedly seeking permission. Old summaries, mixed answers, and regenerate snapshots must not smuggle revoked facts into later use or disclosure. |

#### Negative Controls And Regression Categories

- **No retrieval knowledge question:** Scenario 8 / G1, zero new learning-record reads.
- **Existing workflow better:** standard planning/review / G7, preserve original entries and confirmation/recovery without a General Agent detour.
- **Insufficient coverage:** Scenario 10 / G5, describe only supported records, do not extrapolate or enlarge permissions.
- **Conversation sufficient:** Scenarios 11/12 with complete visible draft/steps, use provided material without database personalization.

Retain D0.4's local-allowed/disclosure-denied case G8 and adversarial checks for injection, invalid references, secrets, failed reads, stale/deleted records, cancellation, revocation timing, cross-day changes, semantic traps, and attachment scope. Deferred sources in adversarial cases test refusal or supplied material; they do not authorize new retrieval. G6 remains a deferred comparator, outside First Slice capability-pass counts.

**Hard invariants — exactly these six, checked per case, per repeat, and per relevant event:**

- `unconfirmed mutation = 0`;
- `secret leakage = 0`;
- `invalid privileged reference accepted = 0`;
- `unauthorized local access = 0`;
- `unauthorized provider disclosure = 0`;
- `revoked-source reuse = 0`.

Any violation is Gate fail; average quality, another successful case, or low frequency cannot offset it. **Unobserved is UNVERIFIED, not zero violations or pass.** Repair and rerun affected checks before progression. Other errors such as fabricated evidence, failure reported as zero, unnecessary retrieval, or wrong evidence semantics remain mandatory case failures without adding global invariants.

Behavioral compliance alone does not establish product benefit. D4 must also show reproducible primary-scenario gains, no unexplained control regressions, and an accepted resource tradeoff under the previously locked criteria. Run relevant contract regressions only when implementation/eval is separately authorized; this documentation task runs no application tests, baseline measurement, or product eval.

### Historical Design Lenses And Remaining Conditional Questions

**Original proposal before D0 rebaseline:** Pi (minimal core, context engineering, compaction), DeepSeek Harness (registry, loop, policy seams), Codex (capability/approval separation and observability), Claude Code (layered skills/hooks/subagents), Anthropic agent engineering (simple patterns and eval), and MCP (external interoperability) were reference lenses. They remain historical inspiration, not adopted frameworks, verified comparisons, or platform requirements. Review exact sources only if a later scoped decision needs them.

D0's product scope, evidence semantics, access/disclosure model, and eval protocol are settled inputs, not an invitation to reopen D0. D1 may resolve the minimal Electron design, observable projections/enforcement, and measured baseline before Parent locks resource ceilings. Adaptive evidence needs belong to D5, per-entry migration/rollback to D6, and context/search/memory pressure to D7; none is a prerequisite for this First Slice.

No new runtime modules, prompts, schemas, dependencies, UI, or documentation system are created here. **The Parent-accepted roadmap rebaseline is effective after the required wording cleanup. Stop here; do not start D1, write a D1 design document, or measure the baseline.**

## Privacy Boundary

Future audit work must default to data minimization.

The following must not be persisted by default:

```text
API Key
Provider credentials
Authorization header
complete Prompt
complete raw Provider response
complete diary body
complete mistake answer
image or attachment contents
Provider internal reasoning
hidden chain of thought
local absolute paths
unbounded errors or network logs
```

A later schema proposal may consider only bounded, purpose-specific data such as:

- a planning version tuple;
- context categories and bounded counts;
- fixed inclusion or exclusion reasons;
- a cryptographic digest of a canonical bounded projection;
- bounded candidate decisions;
- confirmed-action outcome categories;
- nullable task and receipt relations.

This list is a minimization envelope, not a claim that every item is persisted or a new schema authorization. Existing bounded context summaries, final retained candidates, decisions, and outcome relations are governed by the implemented [Schema 7 contract](../schema-7-history.md); extending that contract for Phase D requires a separate proposal. A digest alone is not a user explanation; any audit UI must pair it with a bounded, understandable summary without copying full private study records.

## Long-Term Safety Boundary

- SQLite remains the local authoritative source.
- Model output remains untrusted candidate data.
- AI never directly accesses or writes SQLite.
- Every task creation requires explicit user confirmation.
- No Agent runs autonomously in the background.
- No background retry performs a write operation.
- AI does not automatically create, complete, skip, delete, or modify tasks.
- AI does not autonomously rewrite diary entries; existing Selection Polish requires explicit user application to a validated selection.
- AI does not modify mistake-review state.
- Provider-side persistent memory is not assumed.
- No arbitrary tool execution or general-purpose autonomous runtime is permitted. Phase D prioritizes the First Slice; any stronger domain runtime requires independent evidence and authorization, and this documentation update introduces none.
- No vector database, embedding infrastructure, cloud telemetry, account system, or cross-device synchronization is implied by this roadmap.
- Prompt, schema, implementation, commit, push, PR, merge, version bump, tag, and Release remain separate authorization gates.

## Historical Milestones

Historical schema numbers remain valid when they describe an immutable tag, Release, completed migration boundary, or contemporaneous milestone. They must not be presented as the current `main` schema.

- PR #128 aligned the Agent product direction and roadmap.
- PR #130 implemented explainable Today Action planning context.
- PR #131 implemented stricter Today Action parsing, local validation, editing, stale-context protection, and partial-success retry.
- PR #132 implemented the schema-free Daily Review Agent and its modal, refresh, and date-rollover reliability fixes.
- Daily Review Agent was included in the published v1.16.0 Release.
- The v1.17.0 tag did not produce a GitHub Release. The published v1.17.1 recovery Release preserved that product scope and remained on schema 5.
- Schema 5 remains the correct historical baseline for the v1.17.1 tag and the source side of the later schema 5 to schema 6 migration.
- PR #152 unified confirmed study-task actions across Today Action and Daily Review.
- PR #153 introduced versioned confirmed operation contracts.
- PR #154 implemented Schema 6 (`study_task_action_receipts`) for idempotent confirmed task creation.
- PR #156 implemented Phase C1 session-local planning explainability.
- PR #159 implemented Phase C2 and Schema 7 (`planning_runs`, `planning_run_candidates`) for persistent planning history.
- PR #160 implemented Phase C3 deterministic execution attribution.
- PR #161 implemented Phase C4 user-triggered planning feedback summary.
- PR #162 implemented Phase C5 Mistake Review Agent.
- PR #163 implemented Phase C6 planning strategy presets.
- PR #164 implemented Phase C7 bounded chapter context for Today Action.
- PR #165 prepared and published v1.18.0.
- PR #168 completed Phase C8 UI/UX workspace upgrade.
- Commit `87ef4ae` introduced Schema 8 (`subject_daily_review_state`) for independent daily review rounds.
- Commits `22c1626` and `dcab2ff` added CodeMirror 6 Live Preview and AI selection polishing.
- Releases v1.19.0 and v1.19.1 were published on Schema 8 as the current stable release.

These records are historical facts. They do not reserve schema numbers or release versions for future capabilities.

## Gate Checklist For Every Phase

Before later work starts, record:

- the exact fetched `main` SHA and relevant release facts;
- one core problem;
- exact files and behavior in scope;
- explicit exclusions;
- Prompt and context-projection policy;
- schema, migration, backup/restore, import/export, browser, and retention policy;
- privacy and deletion behavior;
- automatic and manual validation gates;
- rollback and downgrade constraints;
- separate authorization state for implementation, commit, push, PR, merge, version bump, tag, and Release.

If evidence introduces a second core problem, new persistence, broader AI data transmission, or an autonomous capability, stop and re-plan instead of expanding the phase.
