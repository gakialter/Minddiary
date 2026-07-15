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

The profile must start as a newly created physical directory directly under the operating-system temporary directory. Its name binds the `minddiary-smoke-profile-` prefix to a digest of the activation token, and it must contain the matching private `.minddiary-smoke-profile` marker. Existing MindDiary databases or managed-file directories are rejected except for the second fixed `install-profile` stage, which must reuse the same token-bound physical profile after uninstall and rejects linked or unsupported managed data. The harness records and rechecks the physical directory identity, reserves a new private database with exclusive creation, and rejects marker or database links and hard links. The output must be a new `.json` file directly under that same temporary directory and its name must start with `minddiary-smoke-result-`. Missing inputs, duplicate inputs, weak tokens, existing output files, unsupported scenarios, and real user profiles fail closed before a normal application window can open.

The harness rechecks the actual Electron `userData` path at runtime and always loads the production renderer bundle, regardless of ambient `NODE_ENV`; diagnostic mode never loads the development server or opens DevTools. Results are written through a new temporary file and renamed only after the scenario finishes. A diagnostic process exits with a nonzero status when configuration, runtime checks, cleanup, or output creation fails.

## Implemented scenarios

| Scenario | Checks |
| --- | --- |
| `startup` | Hidden real production-bundle renderer, sandbox, context isolation, preload availability, application/runtime metadata, and a native SQLite query |
| `sqlite-read-write` | Every `startup` check plus a fixed settings-table write, read-back, and deletion inside the disposable profile |
| `portable-profile` | Every `startup` check plus proof of the real Windows Portable wrapper, a fixed fake diary/PNG create and read-back through the existing preload API, a real `local://` image load, and cleanup |
| `install-profile` | Every `startup` check plus a two-stage fixed fake diary/PNG retention probe: seed after Setup install, retain through normal uninstall, reopen through the existing preload and `local://` paths after reinstall, then clean up |

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
```

Adding a scenario requires a predefined handler, parser allowlist update, redaction review, unit tests, source Electron E2E, and packaged Windows/macOS E2E where applicable.

## Result schema and privacy

Successful and failed runtime scenarios produce schema version `1`. Results contain the scenario, application and Electron versions, platform and architecture, actual packaged state, boolean renderer security checks, a bounded SQLite version/query result, an overall result, and named boolean evidence checks.

Results never contain the token, profile or output path, environment variables, API keys, database contents, attachment contents, or arbitrary error text. Process stderr uses fixed diagnostic messages so validation errors do not disclose supplied paths or secrets.

## Current evidence boundary

The source Electron test and the configured Windows/macOS unpacked package jobs exercise the base harness. Windows CI additionally builds the actual Portable executable and runs `portable-profile` through that wrapper with a fresh token-bound profile. It compares metadata snapshots of the normal roaming and local application-data locations only in memory, then archives exactly `manifest.json`, `hashes.txt`, `diagnostic-result.json`, `process-log.txt`, `paths-before.txt`, and `paths-after.txt`. Those files contain artifact/evidence hashes, fixed process facts, bounded diagnostic booleans, and only the unchanged/changed path comparison conclusion—not real paths, path existence, entry counts, metadata fingerprints, tokens, raw process output, user files, database contents, or attachment contents.

Windows CI also runs the root Setup executable with the official case-sensitive NSIS `/S` flag and a last-position `/D=<absolute-disposable-path>` argument, verifies installed files, shortcuts, uninstall registration, packaged diagnostics, normal silent uninstall, a token-bound disposable diagnostic profile through uninstall/reinstall, read-back/cleanup, and a final uninstall. The package configuration explicitly locks the default user-data policy with `deleteAppDataOnUninstall: false`; the runtime probe does not claim to exercise deletion against a real default user profile. It archives exactly `setup-sha256.txt`, `install-command.txt`, `install-tree.txt`, `shortcut-before-after.txt`, `registry-before-after.txt`, `process-before-after.txt`, `diagnostic-result.json`, `uninstall-result.json`, and `retention-result.json`, without real paths, raw process output, tokens, database contents, or attachment contents.

Portable and Setup smoke prove only the CI-built candidates and exact workflow head. They are not clean-host browser-download evidence, updater download/install/restart evidence, a signature or SmartScreen reputation claim, or proof about the already-published v1.16.0 assets. The macOS DMG/ZIP user flow, notarization, Gatekeeper, and physical Apple-silicon acceptance remain separate gates.
