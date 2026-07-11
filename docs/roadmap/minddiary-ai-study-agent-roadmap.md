# MindDiary AI Study Planning Agent Roadmap

Status: current product-direction roadmap as of 2026-07-11.

This is a planning document. It authorizes documentation alignment only. It does not start a product version or authorize runtime changes, schema changes, migrations, a PR, merge, tag, release, or publication.

## Verified Baseline

- Release-prep package candidate: `1.16.0`.
- Latest published GitHub Release remains `v1.13.3` until the separately authorized tag and Release workflow complete.
- SQLite schema: `CURRENT_SCHEMA_VERSION = 5`.
- SQLite remains the local source of truth.
- MindDiary already provides diary, Pomodoro, mistake review, study tasks, Dashboard, AI assistance, backup/restore, and local SQLite persistence.
- The existing AI Today Action flow generates candidates, parses and validates them locally, and creates selected tasks only after the user confirms.
- PR #128 aligned the Agent product direction and roadmap.
- PR #130 implemented explainable Today Action planning context.
- PR #131 implemented stricter Today Action parsing, local validation, editing, stale-context protection, and partial-success retry.
- PR #132 implemented the schema-free Daily Review Agent and its modal, refresh, and date-rollover reliability fixes.
- The schema-6 v1.15.x Agent Run and feedback-loop milestones remain unimplemented and are not part of the v1.16.0 candidate.

Schema status for this roadmap update: schema unchanged.

## Product Positioning

MindDiary is a local-first AI Study Planning Agent for long-cycle exam preparation, not a generic autonomous agent platform. It starts from AI Today Action and progressively brings diary entries, Pomodoro sessions, mistake reviews, subjects, chapters, and today's tasks into a user-confirmed learning loop.

This sentence defines the product direction, not a claim that every listed input already participates in AI planning. Today, AI Today Action uses a bounded subset of local context; later inputs enter the loop only after their version gates are separately authorized and implemented.

"Agent" describes a bounded planning loop around the user's local study record. It does not mean that AI owns application state, runs unsupervised, or can mutate study data on its own.

## Agent Loop

```text
Context Collector
  -> Study Planner
  -> Candidate Actions
  -> User Confirmation
  -> Execution Tracker
  -> Feedback
  -> next Context Collector cycle
```

1. **Context Collector** reads an explicitly bounded view of relevant local study data.
2. **Study Planner** asks the configured AI provider for explainable planning suggestions.
3. **Candidate Actions** are parsed, allowlisted, and validated by local application code.
4. **User Confirmation** lets the user edit, select, reject, or defer candidates before any task is created.
5. **Execution Tracker** is the deterministic local task, Pomodoro, diary, and review flow. It is not an AI process.
6. **Feedback** is derived from user-created tasks and recorded execution results, then becomes optional context for a later user-triggered planning cycle.

## Safety Boundary

- AI suggestions must be explainable, locally validated, and user-confirmed.
- AI must not write directly to SQLite or bypass existing application APIs and validation.
- AI must not create, complete, skip, or delete tasks without an explicit user action.
- AI must not delete or rewrite diary, mistake, focus, subject, chapter, backup, or restore data.
- No Agent loop runs autonomously in the background.
- SQLite remains authoritative; model output is untrusted candidate input, not persisted truth.
- Network access remains limited to user-configured or user-triggered AI requests and existing update behavior.
- Every version keeps one core problem and requires separate implementation, schema, PR, merge, tag, and release authorization.

## Version Sequence

### v1.13.4 - Agent positioning docs and roadmap sync

**Core problem:** establish one current, accurate product direction without changing application behavior.

**Allowed scope:** roadmap documentation, concise README positioning, historical-roadmap pointers, and documentation validation.

**Forbidden scope:** product code, Electron code, AI runtime behavior, package versions, schema, migrations, backup/restore behavior, release preparation, tags, and publication.

**Schema policy:** schema unchanged; remain on schema 5.

**Validation gates:** `git diff --check`; documentation link review; negative-language review for direct AI writes, autonomous task state changes, and background execution; `npm.cmd run typecheck` when dependencies are available; verify package metadata and `CURRENT_SCHEMA_VERSION` remain unchanged.

**Rollback notes:** revert the documentation-only diff. No data or runtime rollback is required.

**Release/tag authorized:** no. A tag or release requires separate explicit authorization after review.

### v1.14.0 - Agent Context visibility and explainable planning basis

**Core problem:** users cannot yet see a coherent, reviewable summary of the local context used to produce a plan.

**Allowed scope:** a user-visible planning-context preview; source labels and inclusion/exclusion reasons; bounded local context collection from existing diary, task, Pomodoro, subject, chapter, and mistake APIs; focused UI and behavior tests.

**Forbidden scope:** autonomous planning, direct model access to SQLite, hidden background collection, new task state transitions, database writes during context preview, broad Dashboard redesign, and unrelated AI assistant changes.

**Schema policy:** schema unchanged; use existing read APIs and in-memory planning context.

**Validation gates:** unit tests for bounded context and source labeling; UI tests for loading, empty, error, and stale-response states; prove that viewing or generating context performs no task mutation; typecheck and focused manual confirmation-flow smoke test.

**Rollback notes:** remove the context preview and fall back to the current user-triggered AI Today Action flow. Existing local data remains untouched.

**Release/tag authorized:** no. Implementation, merge, tag, and release are separate gates.

### v1.14.1 - Suggestion quality and local validation enhancement

**Core problem:** candidate actions need stronger quality controls while preserving the current confirmation boundary.

**Allowed scope:** improve prompts, parsing, allowlists, duplicate detection, budget checks, explanation quality, candidate editing, and focused regression tests for the existing Today Action suggestion flow.

**Forbidden scope:** direct AI writes, auto-creation, auto-completion, auto-skip, auto-delete, background retries, opaque ranking that removes user choice, schema work, and unrelated provider changes.

**Schema policy:** schema unchanged; validation remains local and candidates remain transient until confirmation.

**Validation gates:** malformed and adversarial output tests; allowlist, duplicate, duration, stale-context, and partial-failure tests; UI proof that no task is created before confirmation; regression tests that confirmed tasks still use normal local task APIs.

**Rollback notes:** restore the previous prompt and validator while retaining the existing confirmation workflow and stored tasks.

**Release/tag authorized:** no. Implementation, merge, tag, and release are separate gates.

### v1.15.0 - Agent Run audit trail

**Core problem:** a confirmed planning run cannot yet be reviewed as a durable record of context, candidates, user decisions, and resulting task references.

**Allowed scope:** only after explicit schema 6 authorization, define a minimal local Agent Run record, provenance fields, retention behavior, repository/API boundaries, audit UI, migration, and compatibility tests.

**Forbidden scope:** storing secrets or raw provider credentials; treating model output as trusted; replaying runs automatically; autonomous execution; unrelated event-sourcing or database redesign; any schema work before a dedicated schema authorization.

**Schema policy:** blocked unless schema 6 is explicitly authorized. Authorization must separately cover migration order, old-database upgrade, new-database creation, backup/restore, JSON import/export, deployment order, and rollback risk.

**Validation gates:** schema and migration review; old schema 5 upgrade and fresh schema 6 tests; migration idempotency where applicable; backup/export/restore compatibility; retention and deletion tests; audit provenance tests; confirmation-boundary regression; full typecheck and relevant test/build gates.

**Rollback notes:** a shipped SQLite migration is not undone by reverting code. The rollback plan must preserve readable schema 6 data, disable the feature safely, and define controlled backup restoration before implementation is approved.

**Release/tag authorized:** no. Schema, implementation, merge, tag, and release each require separate explicit authorization.

### v1.15.1 - Agent feedback loop

**Core problem:** later plans do not yet use the outcomes of user-created tasks and recorded execution to improve the next suggestion cycle.

**Allowed scope:** user-triggered feedback summaries derived from confirmed Agent-created tasks, task status, attributed focus sessions, and explicit user feedback; explain how each outcome influenced new candidates.

**Forbidden scope:** background learning, silent profile building, automatic task mutation, reward optimization without user visibility, cross-user data, provider-side memory assumptions, and unrelated analytics expansion.

**Schema policy:** no schema beyond an explicitly authorized v1.15.0 schema 6 baseline. If additional persistence is required, stop and re-plan under a separate schema gate.

**Validation gates:** deterministic attribution tests; missing/deleted relation handling; no-feedback and partial-execution cases; explanation tests; privacy and context-boundary review; proof that feedback changes candidates only and never mutates task state.

**Rollback notes:** stop including feedback in planning context and retain the deterministic local execution history as ordinary application data.

**Release/tag authorized:** no. Implementation, merge, tag, and release are separate gates.

### v1.16.0 - Daily Review Agent

**Implementation status:** merged into `main` through PR #132 and included in the v1.16.0 release-prep candidate.

**Publication status:** not tagged or released. Candidate packaging, packaged smoke, asset review, tag and GitHub Release remain separately authorized gates.

**Core problem:** users lack one bounded, explainable daily review that connects today's plan, execution, and next-day candidates.

**Allowed scope:** a user-triggered daily review assembled from existing local day data; explainable observations; editable candidate actions for the next planning cycle; explicit confirmation before task creation.

**Forbidden scope:** scheduled background runs, automatic end-of-day completion, automatic diary writing, automatic next-day task creation, direct database writes by AI, and broad calendar or notification redesign.

**Schema policy:** schema unchanged by default. Any new persisted review record requires a separate schema proposal and authorization.

**Validation gates:** day-boundary and timezone tests; empty and partial-day states; explanation/source tests; confirmation-flow tests; proof that opening or generating a review does not mutate local data.

**Rollback notes:** remove the Daily Review entry point and continue using existing Dashboard, diary, task, and Pomodoro records unchanged.

**Release/tag authorized:** no. Implementation, merge, tag, and release are separate gates.

### v1.17.0 - Mistake Review Agent

**Core problem:** users need a bounded plan for due mistakes that explains selection without changing established review semantics.

**Allowed scope:** user-triggered candidate review plans using due-mistake allowlists, existing subject context, and recorded review outcomes; explanations and editable candidate tasks; focused integration with the existing mistake review flow.

**Forbidden scope:** changing SM-2 behavior without separate scope, marking mistakes reviewed or mastered automatically, creating review tasks without confirmation, exposing answer images beyond existing user flows, and schema changes by default.

**Schema policy:** schema unchanged by default. Any persistence change requires separate schema review and authorization.

**Validation gates:** due-date and allowlist tests; duplicate active-review prevention; deleted subject/mistake handling; confirmation-boundary tests; regression tests for existing SM-2 scoring and image access behavior.

**Rollback notes:** remove the planning entry point and preserve the existing deterministic mistake review and scheduling flows.

**Release/tag authorized:** no. Implementation, merge, tag, and release are separate gates.

### v1.18.0 - Agent planning modes and strategy presets

**Core problem:** one planning strategy cannot represent different exam phases, available time, and user preferences transparently.

**Allowed scope:** a small set of explicit, user-selected planning modes; visible strategy rules; bounded prompt/context differences; local validation that applies identically to every mode.

**Forbidden scope:** open-ended plugin execution, downloadable code, mode-specific safety bypasses, autonomous mode switching, hidden personalization, direct database writes, and broad settings redesign.

**Schema policy:** schema unchanged by default. Prefer existing settings boundaries; any new persistence requirement must be separately reviewed and authorized.

**Validation gates:** per-mode contract tests; mode-switching and default/fallback tests; identical safety-validator tests across modes; accessibility and manual usability checks; confirmation-boundary regression.

**Rollback notes:** fall back to one default planning strategy without changing existing tasks or study history.

**Release/tag authorized:** no. Implementation, merge, tag, and release are separate gates.

### v2.0 - Unified Agent architecture and release-candidate stabilization

**Core problem:** converge the proven planning loops behind one maintainable local Agent contract and stabilize it for a major-version release candidate.

**Allowed scope:** architecture RFCs; shared contracts for bounded context, candidates, confirmation, execution tracking, feedback, and audit provenance; compatibility cleanup required by those contracts; complete regression and release-candidate validation.

**Forbidden scope:** a generic autonomous-agent platform, arbitrary tool execution, background agents, direct AI database access, unrelated feature accumulation, unreviewed migration, and release publication before all gates pass.

**Schema policy:** freeze the schema before release-candidate validation. Any schema change must be designed and authorized before the RC, with complete migration, backup/restore, import/export, deployment, and rollback evidence.

**Validation gates:** approved architecture and data RFCs; contract tests across every Agent loop; full typecheck, tests, Electron build, and renderer build; schema and backup/restore gates when applicable; accessibility, performance, failure-recovery, offline, and manual end-to-end acceptance; explicit negative tests for autonomous execution and direct AI writes.

**Rollback notes:** retain the last supported v1.x local data path and define forward-compatible downgrade limits before the RC. Do not claim downgrade safety without migration evidence.

**Release/tag authorized:** no. RC creation, tag, GitHub Release, assets, and publication require separate explicit authorization and audit.

## Gate Checklist For Every Version

Before work starts, record:

- the exact version and its one core problem;
- exact files and behavior in scope;
- explicit exclusions;
- schema, migration, backup/restore, and import/export policy;
- automatic and manual validation gates;
- rollback constraints;
- separate authorization state for implementation, PR, merge, tag, and release.

If evidence requires a second core problem, a new schema boundary, or a broader runtime capability, stop and re-plan instead of expanding the version.
