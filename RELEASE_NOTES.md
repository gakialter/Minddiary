# MindDiary v1.9.8

## Fixed

- Prevented navigation away from Pomodoro while Zen/fullscreen mode is active, avoiding a locked fullscreen state. (#75)

## Changed

- Added runtime payload validation for selected main-process IPC handlers, including AI chat, Pomodoro session writes, study task writes, mistake review, and diary entry create/update paths. (#76)

## Notes

- This is a small stability release.
- No database schema migration.
- No tag or release is created by this PR.
