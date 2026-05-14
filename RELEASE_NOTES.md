# v1.8.9 - Calendar Focus Markers & Inline Updater UX

## Highlights

- **Calendar Focus Markers**: Pomodoro focus achievements now appear directly in calendar cells with three visual tiers (30m/60m/120m), using `color-mix` badges and dot indicators that coexist cleanly with diary mood icons.
- **Inline Updater UX**: Update checks migrated from blocking system dialogs to a Push-based inline UI in Settings, with real-time download progress, speed display, and one-click restart install.
- **Race Condition Prevention**: Calendar data loading uses `Promise.all` for batch queries with `isCancelled` closure guards to prevent stale async overwrite on fast month switching.
- **Memory Leak Fix**: IPC `onStatusChange` now returns a proper `removeListener` cleanup function; React `useEffect` correctly unsubscribes on unmount.
- **Timer Leak Fix**: "Not-available" auto-dismiss timer extracted to independent `useEffect` with `clearTimeout` on component teardown.
- **TypeScript Fixes**: Resolved `DateMoodEntry` undefined type error and nullable object access in Calendar component.

## Validation

- `npm.cmd run typecheck`
- `npm.cmd test -- --run`
- `npm.cmd run build`
