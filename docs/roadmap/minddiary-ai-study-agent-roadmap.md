# MindDiary AI Study Planning Agent Roadmap

Status: Active roadmap aligned with v1.19.1 release and current main baseline.

This is a planning document. It authorizes documentation alignment only. It does not authorize runtime changes, prompt changes, schema changes, migrations, implementation, a PR, merge, tag, release, or publication. Every later implementation must revalidate `main` and receive its own scope and authorization.

## Verified Release And Main Baselines

The published Release and the current development branch are separate facts. A later `main` commit does not retroactively change a published tag, Release, or its artifacts.

### Latest published Release

- Latest published GitHub Release: `v1.19.1`.
- Published at: `2026-09-11T17:31:49Z`.
- Release state: not a draft and not a prerelease.
- Release target commitish: `main`; the immutable `v1.19.1` tag resolves to commit `19465ab4022c0695ea48325a7a726715ae62fe99`.
- Tag package version: `1.19.1`.
- Tag SQLite baseline: `CURRENT_SCHEMA_VERSION = 8`.

These values describe the published release baseline.

### Current main baseline

- Baseline commit: `74840b85260fcba7950519807a66305e6dcca5bc`.
- Commit title: `docs: refresh README for v1.19.1`.
- Package version at baseline commit: `1.19.1`.
- SQLite baseline at baseline commit: `CURRENT_SCHEMA_VERSION = 8`.
- Schema 8 migration: `add-subject-daily-review-state`.
- Schema 8 table: `subject_daily_review_state`.

Historical schema versions remain intact: v1.17.1 was published on schema 5, PR #154 introduced schema 6 (`study_task_action_receipts`), PR #159 introduced schema 7 (`planning_runs`, `planning_run_candidates`), and v1.19.0 introduced schema 8. Every later implementation must fetch and revalidate `main`, package metadata, schema, migrations, and relevant release facts before work starts.

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

MindDiary is a local-first AI Study Planning Agent for long-cycle learning, not a generic autonomous agent platform. It starts from Today Action and Daily Review and may progressively use bounded diary, Pomodoro, mistake, subject, chapter, and task context in user-triggered planning loops.

This direction is not a claim that every source already participates in every plan. Each source must pass a separately versioned privacy, validation, and product gate before it can be included.

"Agent" means a bounded planning loop around the user's local learning record. It does not mean that AI owns application state, runs unsupervised, or can mutate study data by itself.

## Agent Loop

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

A Planning Run is a future capability for one user-triggered planning lifecycle. Its potential responsibilities are limited to:

- a bounded lifecycle for one Today Action, Daily Review, or later approved planning entry point;
- versioned planning contracts;
- a user-explainable, bounded context summary;
- validated candidates and bounded user decisions;
- auditable links to action attempts, receipts, and resulting tasks.

Planning Run persistence is implemented under Schema 7. A run does not claim that the Provider used specific context merely because local code prepared it, and it does not store Provider reasoning or become a generic workflow engine.

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

### Future / Proposed Directions

The following capabilities remain proposals and require independent specification, review, and authorization before adoption:

- **Cross-subject workload balancing**: bounded suggestions for pacing study tasks across subjects during heavy review cycles;
- **Exam countdown milestone integration**: linking long-cycle countdown milestones to high-level weekly focus areas without automated scheduling;
- **Enhanced offline analytics**: local insights into study habits and retention curves without telemetry or cloud sync.

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

These items are proposals, not current functionality or an approved schema 7 contract. A digest alone is not a user explanation; any audit UI must pair it with a bounded, understandable summary without copying full private study records.

## Long-Term Safety Boundary

- SQLite remains the local authoritative source.
- Model output remains untrusted candidate data.
- AI never directly accesses or writes SQLite.
- Every task creation requires explicit user confirmation.
- No Agent runs autonomously in the background.
- No background retry performs a write operation.
- AI does not automatically create, complete, skip, delete, or modify tasks.
- AI does not rewrite diary entries.
- AI does not modify mistake-review state.
- Provider-side persistent memory is not assumed.
- No arbitrary tool execution or generic Agent Runtime is introduced.
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

These records are historical facts. They do not reserve schema numbers or release versions for future Phase C capabilities.

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
