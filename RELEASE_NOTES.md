# v1.9.0 - Focus Guard, Zen Focus, and Release Reliability

## Highlights

- **Focus Guard**: Added the Windows focus whitelist guard, violation notifications, unsupported-platform guidance, and stronger active-window detection for focused study sessions.
- **Zen Focus Mode**: Added a full-screen Pomodoro focus experience and exits it cleanly when a timer completes.
- **AI Chat Continuity**: Preserved AI assistant conversation history across sidebar and navigation changes.
- **Image Upload Reliability**: Hardened mistake-image upload, display, and local asset handling.
- **Pomodoro Date Accuracy**: Unified local-date keys for Pomodoro totals and remaining dashboard/progress statistics lookups.
- **Release Reliability**: Fixed Windows updater artifact naming so `latest.yml` references the uploaded installer asset exactly, and ensured the release workflow can read `RELEASE_NOTES.md`.

## Stability And Tests

- Stabilized Windows unit tests around timers, local assets, image workers, Focus Guard, and Pomodoro flows.
- Expanded coverage for Focus Guard hooks, platform hints, image galleries, AI history persistence, date keys, and Pomodoro behavior.

## Validation

- `npm.cmd run typecheck`
- `npm.cmd test -- --run`
- `npm.cmd run build`
- `npm.cmd run test:e2e`
- `git diff --check`
- GitHub CI: `test`, `build-verification (windows-latest)`, `build-verification (macos-14)`
