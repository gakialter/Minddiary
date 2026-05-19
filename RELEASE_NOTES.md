# v1.9.2 - Search Performance, Refresh Consistency, and UI Layering

## Highlights
- Refactored image preview triggers into a shared ClickableImage component across diary, search, mistake book, and break review image surfaces.
- Optimized SearchPanel metadata loading with batch APIs for tags and attachments, reducing 2N per-entry metadata requests to 2 batch calls.
- Fixed stale today dashboard / “今日决策” review-count behavior after mistake review actions.
- Improved Pomodoro mode labels so work, short break, long break, and custom modes show the correct start text.
- Normalized modal / overlay / toast / focus z-index layers with semantic CSS tokens.

## User-facing Fixes
- Today dashboard and related review metrics now refresh after mistake review completion.
- Due mistake counts are unified around the today dashboard data path.
- Break review and mistake book review actions trigger shared data refresh.
- Pomodoro button text now matches the active mode:
  - work: 开始专注
  - short break: 开始短休
  - long break: 开始长休
  - custom: 开始计时
- “跟随系统” theme mode now follows OS dark/light preference and responds to system theme changes.

## Performance
- SearchPanel now batch-loads entry tags and attachments.
- Search metadata loading is reduced from 2N per-entry requests to 2 batch requests.
- Batch entry IDs are filtered, deduplicated, and queried with parameter binding.
- Existing single-entry metadata APIs remain available for compatibility.

## Refactoring
- Introduced shared ClickableImage for image preview triggers.
- Added semantic z-index tokens:
  base < dropdown < floating < focus-notice < overlay < modal < image-preview < toast
- Preserved ImagePreviewModal above normal modals.
- Preserved Toast above modal and image-preview layers.

## Reliability
- Added shared data refresh signal through dataRefreshVersion/requestDataRefresh.
- Replaced UTC-prone local date usages with getLocalDateKey where local calendar date is required.
- Preserved existing local-first storage behavior.
- Preserved request-race protection in search result enrichment.

## Validation
- npm.cmd run typecheck
- npm.cmd test -- --run
- npm.cmd run build
- npm.cmd run test:e2e
- git diff --check
