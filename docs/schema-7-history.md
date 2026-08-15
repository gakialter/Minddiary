# Planning History Schema 7

MindDiary schema 7 adds a privacy-minimized, local-only Planning History for Today Action and Daily Review. It is an audit surface, not a workflow ledger: restarting the app can show history but cannot resume generation, editing, selection, confirmation, or task execution.

## Tables

`planning_runs` stores the run identity, `planning-history.v1` contract version, entry point, planning and target dates, whether generation returned an empty valid result or a candidate set, a canonical bounded context summary, trusted timestamps, and an optional observed close pair. The recent index is `(created_at DESC, id DESC)`.

`planning_run_candidates` stores at most six retained candidate positions per run. It contains the final normalized candidate snapshot, admission origin, original Provider ordinal, priority, logical source IDs, canonical net-edit baselines, selection/confirmation disposition, optional operation correlation and bounded trusted outcome. Only `planning_run_id` is a hard foreign key (`ON DELETE CASCADE`). Source IDs intentionally remain logical references so deleting current source data does not rewrite history. Non-null operation IDs are unique.

`study_task_action_receipts` remains unchanged and authoritative for idempotent confirmed task execution. Planning History never stores receipt digests or task IDs; current task availability is dynamically resolved through a validated operation receipt.

## Backup and retention

Schema 7 backups require both planning sections. A schema 6 backup may omit them and restores to empty Planning History. Restore validates planning data before destructive replacement, imports in one transaction, applies runtime retention, repairs AUTOINCREMENT high-water marks for preserved logical references, then runs foreign-key and integrity checks.

Runtime retention keeps only runs from the most recent 30 days and at most the newest 100 runs. It runs after successful creation and restore. Clearing Planning History never deletes tasks, receipts, diary entries, mistakes, subjects, or Pomodoro sessions.

## Privacy boundary

Planning History stores category-level inclusion/exclusion semantics and final retained candidates. It does not copy Provider prompts, requests, raw responses, reasoning, full diary or mistake content, attachments, credentials, receipt digests, raw errors, stacks, or removed candidates.
