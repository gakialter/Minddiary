# MindDiary v1.13.x to v2.0 Roadmap

Status: planning document based on the v1.13.0 audit set.

Current verified baseline:

- App version: `1.13.0` in `package.json`.
- Formal schema: `CURRENT_SCHEMA_VERSION = 5` in `electron/databaseMigrations.ts`.
- v1.13.0 release notes: `RELEASE_NOTES.md`.
- Current tag/release existence was verified during audit, but this document does not authorize any release action.

Schema status: schema unchanged.

## Planning Principles

- One core problem per version.
- One focused PR per version by default.
- Independent CI, acceptance, and release decision.
- Do not mix stability fixes, roadmap docs, schema changes, UI redesign, AI assistant changes, and backup restore rewrites into the same release.
- No schema 6 unless a dedicated version explicitly authorizes it.

## v1.13.1 Recommended Scope

Core problem: stabilize and document the v1.13.0 chapter-task baseline.

Recommended release type: patch.

Allowed scope:

- Audit docs created in this task.
- Fixture parity tests for SQLite vs browser fallback task ordering and `related_chapter_id` deletion semantics.
- Strengthened schema 4 to 5 migration assertions.
- Current-facing docs sync for README/release checklist if separately authorized.
- No schema change.
- No product UI expansion.

Why patch:

- The main work is tests, audit docs, and low-risk consistency verification for already-released behavior.

Acceptance:

- `npm.cmd run typecheck` passes.
- `npx.cmd vitest run` passes.
- `npm.cmd run build:electron` and `npx.cmd vite build` pass at minimum.
- Manual smoke: create chapter task, recommend on dashboard, start Pomodoro, complete task/chapter, delete chapter and confirm task survival.

Rollback:

- Revert docs/tests only. No data migration rollback required.

## v1.13.2 Recommended Scope

Core problem: clean up remaining low-risk parity and ordering consistency issues.

Recommended release type: patch.

Candidate scope:

- Decide and align subject list ordering across SQLite and browser fallback.
- Add deterministic tie-breakers for Pomodoro equal-total aggregate order.
- Add deterministic tie-breakers for mistake lists with equal `created_at`.
- Add tests that assert the chosen order in both data paths.

Why not v1.13.1:

- These are adjacent display/list consistency improvements, not blockers for v1.13.0 task semantics.

No schema change unless subject custom ordering is chosen. If custom ordering is chosen, defer to v1.14.0 because SQLite lacks a persisted `order` field for subjects.

Acceptance:

- Same subject/stat/mistake fixtures return identical order in SQLite and fallback.
- No task recommendation behavior regression.
- No UI redesign.

Rollback:

- Revert comparator/order clauses and tests. If no schema change, rollback is code-only.

## v1.14.0 Recommended Scope

Core problem: one controlled feature enhancement around learning execution clarity.

Recommended option: explicit task source and ordering contract across the daily execution system.

Why minor:

- This may change visible ordering semantics, user-facing labels, and possibly subject order product behavior.

Candidate scope:

- Decide canonical subject display order.
- If product requires custom subject order, design a small schema 6 migration for `subjects.sort_order` only after explicit authorization.
- Make `getNextTodayAction` input ordering contract explicit or move sorting into a shared deterministic selector.
- Add parity tests and UI tests for mixed ordinary tasks, chapter tasks, review tasks, and diary tasks.

Do not include:

- Cross-device sync.
- AI assistant rewrite.
- Backup restore rewrite.
- State management framework migration.
- Large dashboard redesign.

Acceptance:

- Written design note before schema decision.
- Migration impact review if schema changes.
- Old database upgrade, new database creation, backup/export/restore compatibility if schema changes.
- Full CI and focused manual smoke.

Rollback:

- If no schema change: revert code/tests/docs.
- If schema change: require explicit rollback strategy before implementation begins.

## v2.0 Strategic Direction

Core problem: long-term platform architecture, not immediate implementation.

Possible directions:

- Data model: move from ad hoc nullable relationships toward explicit activity/event model for tasks, focus sessions, diary entries, reviews, and attachments.
- Pluginization: isolate features such as Pomodoro, mistake review, AI assistant, backup, and sync behind stable local interfaces.
- AI tutor: keep local-first data boundaries; add explainable suggestions, not opaque auto-planning.
- Local-first: maintain offline-first SQLite as primary source of truth.
- Backup/restore: formalize restore previews, dry-run validation, and user-facing diff before destructive restore.
- Cross-device sync: evaluate after data model stabilizes; do not bolt sync on top of ambiguous nullable relationships.
- Security: continue local protocol, attachment, and ZIP restore hardening; add signed release evidence to release docs.

Do not do now:

- Do not start v2.0 implementation from this audit.
- Do not introduce schema 6 as a proxy for v2.0.
- Do not rewrite backup restore, AI assistant, or UI navigation in v1.13.1.
- Do not add cross-device sync until conflicts, identity, encryption, and backup semantics are designed.

## Recommended Release Sequence

1. v1.13.1: merge audit docs and focused tests.
2. v1.13.2: address subject/order/tie-breaker consistency if accepted.
3. v1.14.0: one minor feature around daily execution/order/source clarity, possibly including schema work only if explicitly authorized.
4. v2.0 planning: write design RFCs before implementation.

## Version Gate Checklist

Before starting any version:

- State the exact version.
- State one core problem.
- State whether schema changes are allowed.
- State exact files in scope.
- State validation gates.
- State whether PR creation, merge, tag, and release are authorized separately.
