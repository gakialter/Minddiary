# Packaged diagnostic harness

MindDiary has a test-only diagnostic mode for deterministic source and packaged-runtime checks. It is disabled during ordinary startup and does not add renderer IPC, SQL, shell, or file-system APIs.

## Activation contract

All of these inputs are required:

```text
--minddiary-smoke-scenario=<implemented-scenario>
--minddiary-smoke-output=<absolute-result-path>
--user-data-dir=<absolute-disposable-profile>
MINDDIARY_SMOKE_TOKEN=<32-128-character URL-safe high-entropy token>
```

The profile must be a newly created physical directory directly under the operating-system temporary directory. Its name binds the `minddiary-smoke-profile-` prefix to a digest of the activation token, and it must contain the matching private `.minddiary-smoke-profile` marker. Existing MindDiary databases or managed-file directories are rejected. The harness records and rechecks the physical directory identity, reserves a new private database with exclusive creation, and rejects marker or database links and hard links. The output must be a new `.json` file directly under that same temporary directory and its name must start with `minddiary-smoke-result-`. Missing inputs, duplicate inputs, weak tokens, existing output files, unsupported scenarios, and real user profiles fail closed before a normal application window can open.

The harness rechecks the actual Electron `userData` path at runtime and always loads the production renderer bundle, regardless of ambient `NODE_ENV`; diagnostic mode never loads the development server or opens DevTools. Results are written through a new temporary file and renamed only after the scenario finishes. A diagnostic process exits with a nonzero status when configuration, runtime checks, cleanup, or output creation fails.

## Implemented scenarios

| Scenario | Checks |
| --- | --- |
| `startup` | Hidden real production-bundle renderer, sandbox, context isolation, preload availability, application/runtime metadata, and a native SQLite query |
| `sqlite-read-write` | Every `startup` check plus a fixed settings-table write, read-back, and deletion inside the disposable profile |

The SQLite round trip uses a one-way digest of the token to derive a reserved key and fixed statements. It does not store token material or accept SQL or data from command-line arguments. The transaction removes the probe row and rolls back on failure.

## Planned bounded scenarios

The following names document the remaining campaign design but are rejected until each handler and its tests are implemented:

```text
settings-redaction
attachment-local-protocol
window-security
clipboard-ipc
pdf-export
updater-status
date-rollover
portable-profile
install-profile
```

Adding a scenario requires a predefined handler, parser allowlist update, redaction review, unit tests, source Electron E2E, and packaged Windows/macOS E2E where applicable.

## Result schema and privacy

Successful and failed runtime scenarios produce schema version `1`. Results contain the scenario, application and Electron versions, platform and architecture, actual packaged state, boolean renderer security checks, a bounded SQLite version/query result, an overall result, and named boolean evidence checks.

Results never contain the token, profile or output path, environment variables, API keys, database contents, attachment contents, or arbitrary error text. Process stderr uses fixed diagnostic messages so validation errors do not disclose supplied paths or secrets.

## Current evidence boundary

The source Electron test and the configured Windows/macOS `--dir` package jobs exercise this harness. Exact-head CI is still required before this Phase 4 implementation can claim Windows and macOS coverage. Even successful `--dir` results are not evidence that the Windows Portable wrapper, Windows Setup install/uninstall flow, macOS DMG or ZIP user flow, updater download/install/restart, signing identity, notarization, Gatekeeper, or SmartScreen has passed. Those stages require their own scenarios and evidence artifacts.
