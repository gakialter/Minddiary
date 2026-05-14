# v1.8.8 - Key Date Countdown and Export Hardening

## Highlights

- Added a multi-event key date countdown system for exam, holiday, deadline, and custom milestones.
- Added Settings management for key dates with create, delete, and pinned event controls.
- Added a Dashboard key date card showing the nearest upcoming milestones without competing with study metrics.
- Kept legacy `examDate` compatible by syncing it into the built-in `考研初试` countdown event.
- Fixed countdown date math by parsing `YYYY-MM-DD` as local calendar dates instead of relying on UTC string parsing.
- Hardened Electron export writes so renderer-provided paths must first be authorized by the main-process save dialog flow and are consumed after use.

## Validation

- `npm.cmd run typecheck`
- `npm.cmd test -- --run`
- `npm.cmd run build`
