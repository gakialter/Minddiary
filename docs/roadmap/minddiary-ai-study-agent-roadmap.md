# MindDiary AI Study Planning Agent Roadmap

Status: Phase C0 roadmap rebaseline captured on 2026-08-02.

This is a planning document. It authorizes documentation alignment only. It does not authorize runtime changes, prompt changes, schema changes, migrations, implementation, a PR, merge, tag, release, or publication. Every later implementation must revalidate `main` and receive its own scope and authorization.

## Verified Release And Main Baselines

The published Release and the current development branch are separate facts. A later `main` commit does not retroactively change a published tag, Release, or its artifacts.

### Latest published Release

- Latest published GitHub Release: `v1.17.1`.
- Published at: `2026-07-26T09:39:17Z`.
- Release state: not a draft and not a prerelease.
- Release target commitish: `main`; the immutable `v1.17.1` tag resolves to commit `c4c8d94b2da606e98bc3b0b2119e6961e2f53ed7`.
- Tag package version: `1.17.1`.
- Tag SQLite baseline: `CURRENT_SCHEMA_VERSION = 5`.

These values describe the published historical baseline. Development after the tag does not alter them.

### Phase C rebaseline of `main`

- Capture commit: `a8d7bf10f28e52f275b2371f8bff3f2fe2d9168d`.
- Commit title: `feat(ai): make confirmed study task creation idempotent (#154)`.
- Package version at the capture commit: `1.17.1`.
- SQLite baseline at the capture commit: `CURRENT_SCHEMA_VERSION = 6`.
- Schema 6 migration: `add-study-task-action-receipts`.
- Schema 6 table: `study_task_action_receipts`.

This SHA is the Phase C capture baseline after PR #154 merged, not a permanent claim about the latest `main`. Every later implementation must fetch and revalidate `main`, package metadata, schema, migrations, and relevant release facts before work starts.

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

Planning Run persistence is not implemented at this baseline. A run must not claim that the Provider used specific context merely because local code prepared it, and it must not store Provider reasoning or become a generic workflow engine.

Planning contracts and confirmed-action contracts evolve independently. Updating a Planning Run contract must not invalidate existing action-receipt replay behavior.

## Schema Policy After PR #154

Schema 6 is already used by `study_task_action_receipts`. It is not available or reserved for Planning Run persistence.

A durable Planning Run may require schema 7 only if the product first confirms a need for cross-restart history, backup/restore, or long-term audit. Schema 7 requires separate explicit authorization and a dedicated review of:

- ordered migration and fresh-database creation;
- schema 6 upgrade behavior and future-schema rejection;
- transaction and failure boundaries;
- backup/restore compatibility and old-backup handling;
- retention and user deletion policy;
- browser-fallback behavior;
- feature disablement and rollback limits.

Phase C0 does not authorize schema 7 and does not freeze its data model. Table names, table count, fields, SQL, indexes, foreign keys, retention duration, record count, and JSON size limits remain undecided proposals until a later schema review.

A shipped SQLite migration cannot be undone by reverting application code. Any future schema proposal must distinguish feature disablement, forward-readable data, restoration of a pre-migration backup, and unsupported database downgrade.

## Phase C Capability Sequence

Future stages are capability gates. They are not assigned to release versions until separately planned and authorized.

### Phase C0 — Roadmap rebaseline

**Status:** target of this documentation change; docs-only, schema unchanged, runtime unchanged.

**Core problem:** correct the Phase C factual baseline, separate Action Receipt from Planning Run, and define the order and gates for later work.

**Allowed scope:** this roadmap and documentation-only validation.

**Excluded scope:** runtime, Prompt, schema, migration, package metadata, tag, Release, and publication changes.

**Rollback:** revert the documentation-only change. No data rollback is involved.

### Phase C1 — Session-local planning explainability

**Core problem:** during the current Today Action or Daily Review session, users should understand:

- which context categories were used or excluded;
- which candidates were generated;
- which candidates they modified, removed, did not select, or confirmed;
- whether each confirmed action was created, replayed, uncertain, conflicting, or associated with a later-deleted task.

**Policy:**

- schema unchanged;
- session-local lifecycle only;
- no new long-lived localStorage Planning Run ledger;
- no complete Prompt or raw Provider-response persistence;
- no background execution or recovery;
- no automatic task write.

The user-facing semantics of this stage must be validated before durable Planning Run design is approved.

### Phase C2 — Minimal persistent Planning Run

**Implementation status:** locally implemented on the dedicated Phase C2 branch; awaiting independent review and landing. This does not describe a published release.

**Core problem:** after C1 semantics pass user validation, provide the smallest privacy-minimized Planning Run needed for cross-restart and backup-compatible audit.

**Implemented policy:**

- schema 7 adds bounded `planning_runs` and `planning_run_candidates` history;
- all stored data is bounded and locally validated;
- the Action Receipt remains the source of truth for confirmed-action execution;
- the Planning Run remains an audit relation, not a command receipt or general event store;
- complete feedback history is excluded from the first persistent version;
- history survives restart and participates in backup/restore, but a run is never resumed;
- runtime retention is 30 days and at most 100 runs; users can delete one run or clear history without deleting tasks or receipts;
- Provider prompts, payloads, raw responses, reasoning, and prior Planning History remain outside this persistence contract.

### Phase C3 — Deterministic execution attribution

**Core problem:** show only outcomes that local data can prove, including current task status, receipt relation, and explicitly task-linked Pomodoro sessions.

**Policy:**

- correlation is not presented as causation;
- an unfinished task is not automatically classified as a poor suggestion;
- task deletion and missing relations are shown explicitly;
- no AI process completes, skips, deletes, or otherwise updates a task;
- preserving outcome snapshots after source deletion requires its own data and privacy decision.

### Phase C4 — User-triggered feedback summary

**Core problem:** before a later user-triggered generation, show a bounded explanation of which prior outcomes may influence new candidates and let the user decide whether to use them.

**Policy:**

- user-triggered and user-visible;
- candidate-level influence only;
- users can disable, clear, or override the feedback summary;
- no background learning or invisible user profile;
- no opaque reward optimization;
- no automatic task, diary, or mistake mutation;
- no assumption of reliable Provider-side memory.

### Phase C5 — Mistake Review Agent

**Core problem:** generate bounded, explainable, user-confirmed review candidates for due mistakes.

**Policy:**

- do not automatically change SM-2 behavior;
- do not mark a mistake reviewed or mastered automatically;
- do not create a task without explicit confirmation;
- schema unchanged by default;
- deleted mistakes, subjects, and stale context remain zero-write cases.

### Phase C6 — Planning modes and strategy presets

**Core problem:** offer a small set of explicit, user-selected planning strategies with visible differences.

**Policy:**

- no automatic mode switching;
- every mode uses the same local parser, allowlists, and confirmation boundary;
- no hidden personalization;
- no generic tool registry, downloadable executable plugin, or arbitrary tool execution;
- schema unchanged by default.

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
