# Electron package integrity threat model

The bounded, default-off runtime validation entry is documented in [Packaged diagnostic harness](./packaged-diagnostics.md).

## Scope

This document defines what MindDiary's packaged-code controls protect, what remains intentionally writable, and what each automated check proves. The policy applies to the Electron package produced from the current repository; it does not retroactively alter an existing Git tag or GitHub Release.

The design follows Electron's [fuse guidance](https://www.electronjs.org/docs/latest/tutorial/fuses), [ASAR integrity guidance](https://www.electronjs.org/docs/latest/tutorial/asar-integrity), and electron-builder's [`electronFuses` configuration](https://www.electron.build/app-builder-lib.interface.configuration#electronfuses).

## Asset classification

| Asset | Expected location | Integrity policy |
| --- | --- | --- |
| Main, preload, renderer, and packaged JavaScript | `resources/app.asar` | Must remain inside ASAR. Embedded ASAR integrity validation and `OnlyLoadAppFromAsar` are enabled. |
| `better_sqlite3.node` | `resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` | The only approved unpacked application file. It is required for native loading but is not protected by the ASAR integrity hash. |
| Electron executable and helper binaries | Package/application directory | Fuse state is embedded in the executable. Publisher authenticity depends on OS code signing, which is a separate control. |
| SQLite database, attachments, mistake images, and settings | Electron `userData` | Intentionally mutable user data. These files must never be treated as packaged code. Existing path-containment and database controls protect this boundary. |
| Backups and user-selected exports | User-selected paths | Intentionally mutable and outside package integrity. Backup manifests and import validation are separate data-integrity controls. |
| `app-update.yml`, `latest.yml`, `latest-mac.yml`, blockmaps, and release assets | Package resources or release output | Full distributable builds must contain exact GitHub provider metadata. `electron-builder --dir` intentionally omits `app-update.yml`, so its runtime must report `auto-update-not-configured`. Release metadata and asset-manifest checks remain separate. |
| Temporary PDF export HTML and generated PDFs | OS temp or user-approved save path | Governed by the export authorization boundary and print-window isolation, not ASAR integrity. |

No JavaScript package, source map, fallback application directory, or extra native module may appear in `app.asar.unpacked`.

## Fuse policy

| Fuse or builder control | State | Reason |
| --- | --- | --- |
| `RunAsNode` | disabled | The packaged executable is not a supported Node CLI and the application does not use `child_process.fork`. |
| `EnableNodeOptionsEnvironmentVariable` | disabled | Prevents environment-controlled `--require` and other Node startup injection into the packaged executable. This also means `NODE_EXTRA_CA_CERTS` is not a supported packaged-app configuration surface. |
| `EnableNodeCliInspectArguments` | disabled | Prevents packaged main-process Node Inspector activation through CLI flags. |
| `EnableEmbeddedAsarIntegrityValidation` | enabled | Makes supported Electron runtimes validate the embedded ASAR integrity metadata. |
| `OnlyLoadAppFromAsar` | enabled | Prevents fallback loading from `resources/app` when the expected ASAR is missing. It is paired with embedded validation. |
| `EnableCookieEncryption` | disabled | MindDiary has no packaged-cookie secret contract. Changing cookie encryption semantics is outside this package-integrity change. |
| `LoadBrowserProcessSpecificV8Snapshot` | disabled | MindDiary does not ship a browser-process-specific custom V8 snapshot. |
| `GrantFileProtocolExtraPrivileges` | enabled | The production renderer is intentionally loaded with `BrowserWindow.loadFile`; the existing CSP, navigation, permission, and custom `local://` controls remain the trust boundary. |
| `WasmTrapHandlers` | enabled | Retains Electron's current runtime safety default. The verifier fails closed if the fuse wire grows or changes unexpectedly. |
| `resetAdHocDarwinSignature` | enabled | Allows fuse mutation on Apple Silicon and restores an ad-hoc signature. An ad-hoc signature is not Developer ID signing or notarization. |

`asar.smartUnpack` is disabled and `asarUnpack` names the single required `better_sqlite3.node` path. This prevents dependency heuristics from moving entire JavaScript packages outside ASAR.

## Verification layers

| Check | Evidence it provides | Evidence it does not provide |
| --- | --- | --- |
| `verify:electron-package-security` | Exact fuse wire, `app.asar` presence, no fallback app, and exact unpacked-file allowlist | Application launch, installer behavior, publisher identity, or user-data persistence |
| `verify:electron-native:packaged` | `better-sqlite3` JavaScript is loaded through the packaged `app.asar`, resolves the unpacked native binary, and executes a real SQLite query under the pinned Electron runtime | Full UI behavior or installed/portable launch |
| `test:e2e:packaged-security` | Launches the real unpacked packaged executable, observes an ASAR-backed renderer, sandbox/context isolation, CSP, pinned Electron and app versions, preload/IPC writes, native SQLite persistence across restart, attachment persistence, `local://` loading, and updater configuration state consistent with metadata presence | Setup/Portable/DMG/ZIP installation, updater download/install, main-process diagnostic internals, or signing reputation |
| `test:e2e:portable-smoke` | Launches the actual Windows Portable wrapper with a token-bound disposable profile, verifies the packaged renderer/preload/native SQLite path, fixed fake data and `local://` round trip, cleanup, unchanged default app-data metadata, and bounded archived evidence | Setup install/uninstall, updater install/restart, signing identity, SmartScreen reputation, or the already-published Portable asset |
| `test:asar-integrity:packaged` on Windows | Disabled Run-as-Node, `NODE_OPTIONS`, and Node Inspector surfaces; rejection of a changed ASAR and a `resources/app` fallback; exact ASAR restoration | Resistance to a local administrator replacing both executable and resources, or macOS Gatekeeper behavior |
| macOS `codesign --verify --deep --strict` in build CI | Internal consistency of the current ad-hoc package signature | Developer ID identity, notarization, stapling, quarantine, or Gatekeeper acceptance |

The packaged smoke opens a random loopback-only Chromium DevTools endpoint solely for the test-launched process. Production launches do not receive that argument. Electron's Playwright launcher is intentionally not used because it requires a Node Inspector endpoint that this fuse policy disables.

The ASAR mutation probe changes a dependency source-map filename while preserving a valid JSON header. A copied executable with embedded ASAR validation disabled must start from that changed archive before the real fused executable is required to reject it. This counterfactual distinguishes integrity enforcement from generic malformed-archive rejection. A timeout while either rejection probe is still running is a failure, not a pass.

## Development, source maps, and crash diagnosis

- Fuses are applied only to packaged executables. `electron .`, Vite development, and the source-tree Electron Playwright suite remain available; CI rebuilds the native dependency for Electron and runs that suite separately from packaged smoke.
- The current TypeScript and Vite production configurations do not enable first-party source maps, so `electron-dist` and `dist` do not emit application `.map` files. Dependency source maps may remain inside `app.asar`, where the same ASAR integrity policy applies; no source map may be unpacked.
- Disabling Node CLI inspect arguments deliberately removes packaged main-process `--inspect` crash debugging. Production `warn` and `error` diagnostics still go to stderr through the existing logger. The application does not currently configure `crashReporter`, persistent crash upload, or a durable log file, so this change does not claim automated crash capture.
- Renderer CDP remains an explicit opt-in Chromium surface. The packaged smoke enables a random loopback-only endpoint for its own child process; ordinary production launch does not.

## Residual risks and non-claims

- Unsigned Windows artifacts do not establish publisher identity and can show Unknown Publisher or SmartScreen warnings. SmartScreen reputation is not proven by ASAR validation.
- An administrator, malware with equivalent privileges, or a user running a Portable build from a writable directory can replace the executable and the unpacked native module. Replacing both the executable and ASAR can also replace the embedded trust root.
- The unpacked `better_sqlite3.node` remains a native-code integrity gap until OS signing and installation permissions provide an authenticated boundary.
- An ad-hoc macOS signature is not Developer ID signing, notarization, stapling, browser quarantine, or Gatekeeper evidence.
- CI `electron-builder --dir` output is an unpacked packaged application. It is not evidence that the Windows Setup or Portable executable, macOS DMG, or update ZIP installed and launched successfully.
- `--dir` updater-status smoke proves only the expected `auto-update-not-configured` fallback. Full-package verification checks exact `app-update.yml` provider metadata, and its runtime smoke rejects an unconfigured status or package-load-shaped updater error. Ordinary network errors remain outside this Phase 3 control. Download, signature verification, installation, rollback, and relaunch still require a separate controlled updater E2E.
- User data is intentionally mutable. ASAR integrity must never be used to reject, sign, or overwrite the user's database, attachments, images, backups, or exports.
