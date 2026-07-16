# MindDiary Release Checklist

This checklist separates CI build acceptance from manual installer acceptance for GitHub Releases. It applies to v1.11.2 and later; it does not authorize modifying assets on an existing Release.

## Before Pushing a Release Tag

- Confirm `package.json` and root `package-lock.json` have the intended version.
- Confirm the pushed tag is exactly `v${package.json.version}`.
- Confirm `RELEASE_NOTES.md` starts with `# MindDiary v${package.json.version}`.
- Confirm `CURRENT_SCHEMA_VERSION` matches the intended release baseline and `RELEASE_NOTES.md`; record explicitly whether the schema changed.
- If the schema changed, verify new-database creation, every supported old-database upgrade, migration idempotency, browser fallback normalization, JSON import/export, and automatic backup/restore compatibility.
- If the schema is unchanged, confirm no migration was added and current fallback plus backup/restore compatibility remains covered.
- Confirm the bundled current-version notes match `RELEASE_NOTES.md` and `package.json`.
- Confirm an available update shows remote notes when present and the fallback message when notes are absent.
- Confirm browser fallback renders the bundled current-version notes without an Electron updater API.
- Run the required local gate:
  - `npm.cmd run typecheck`
  - `npm.cmd test -- --run`
  - `npm.cmd run build`
- Confirm `release/`, `dist/`, `electron-dist/`, logs, screenshots, test databases, certificates, private keys, and generated signing files are not staged.

## Release Asset Manifest

The workflow must stage only these root-level public assets for the package version:

- `MindDiary-Setup-<version>.exe`
- `MindDiary-Portable-<version>.exe`
- `MindDiary-Setup-<version>.exe.blockmap`
- `MindDiary-<version>-arm64.dmg`
- `MindDiary-<version>-arm64-mac.zip`
- `MindDiary-<version>-arm64.dmg.blockmap`
- `MindDiary-<version>-arm64-mac.zip.blockmap`
- `latest.yml`
- `latest-mac.yml`

The following are packaging internals and must never be uploaded as standalone GitHub Release assets:

- `MindDiary.exe`
- `elevate.exe`
- anything under `win-unpacked/**`
- anything inside `mac*/**/*.app/**`
- any other unpacked directory or app bundle content

`scripts/prepare-release-assets.mjs` owns the shared allowlist. Build jobs copy only those names from `release/` to an empty staging directory. The publish job validates the combined downloaded manifest before `softprops/action-gh-release` sees it. Upload and publish globs must remain root-level and non-recursive.

## Update Metadata Verification

CI runs:

```bash
npx tsx scripts/verify-release-metadata.ts --platform win --release-dir release --package package.json
npx tsx scripts/verify-release-metadata.ts --platform mac --release-dir release --package package.json
```

The checks require:

- `version` equals `package.json.version`.
- `path` points to the versioned root Windows Setup asset or root macOS update ZIP, never an unpacked directory.
- every metadata file entry points to an allowlisted root installer, DMG, or ZIP.
- top-level and file-entry `sha512` values are present.
- `releaseDate` is present and parseable.
- packaged `app-update.yml` targets GitHub owner `gakialter` and repository `Minddiary`.

## Signing Boundaries

The Windows release workflow passes `CSC_LINK` and `CSC_KEY_PASSWORD` to `electron-builder`:

- Both present: Setup and Portable must pass Authenticode verification.
- Only one present: fail before packaging.
- Both absent: unsigned Windows assets are allowed, but the workflow summary and Release Notes must state the Unknown Publisher / Windows SmartScreen risk.

Do not print or commit signing secrets or certificate files. Code signing identifies the publisher; it does not guarantee immediate SmartScreen reputation.

macOS builds currently use an ad-hoc signature and are not Apple-notarized. Do not describe them as notarized. A successful CI build does not prove Gatekeeper acceptance on a separate Mac.

## CI Build Acceptance

CI acceptance proves only that:

- typecheck, unit/integration tests, and build complete;
- Windows and macOS packages are produced;
- configured Windows signing policy is enforced;
- the newly built Windows Portable wrapper launches with a disposable profile, exercises packaged preload/native SQLite/fake data/`local://`, exits cleanly, leaves default app-data metadata unchanged, and emits bounded evidence;
- the newly built Windows Setup candidate silently installs to a disposable path, launches installed diagnostics, preserves a token-bound disposable diagnostic profile through normal uninstall, reopens and cleans it after reinstall, removes files/shortcuts/registry/processes on final uninstall, and emits bounded evidence; `deleteAppDataOnUninstall: false` separately locks the default user-data retention policy;
- the Windows unpacked package runs Daily Review across a renderer-local logical midnight without changing host time, closes the old-date dialog, proves the main/SQLite transaction rejects a stale old-date IPC, records zero business writes during rollover, sends only to a loopback mock endpoint with correct old/new date provenance, creates one explicitly confirmed new-date task, cleans it, and emits the bounded five-file rollover evidence set;
- update metadata and the exact Release asset manifest pass validation;
- the publish job receives only allowlisted root assets.

CI installs and uninstalls its own newly built Windows Setup candidate on a disposable hosted runner. It does not browser-download or execute the published Setup/Portable assets on a clean user-managed host, mount the DMG on a user Mac, or evaluate SmartScreen, macOS Gatekeeper, or notarization behavior. The automated Setup and Portable smoke gates do not replace the manual downloaded-candidate checks below.

## Manual Install Smoke Tests

Run these during release acceptance after candidate artifacts exist. Record OS version, architecture, asset name, result, and any warning shown.

1. Windows Setup — manual acceptance
   - Download `MindDiary-Setup-<version>.exe` from the candidate Release.
   - Install on a clean or disposable Windows profile.
   - Confirm expected Unknown Publisher / SmartScreen behavior when unsigned.
   - Launch the installed app and confirm the main window loads.
2. Windows Portable — manual acceptance
   - Download `MindDiary-Portable-<version>.exe`.
   - Launch without installation and confirm the main window loads.
3. macOS DMG — manual acceptance
   - Download and mount `MindDiary-<version>-arm64.dmg` on Apple silicon.
   - Copy/launch the app and record the ad-hoc, non-notarized Gatekeeper boundary exactly.
4. macOS ZIP — manual acceptance
   - Download and extract `MindDiary-<version>-arm64-mac.zip` on Apple silicon.
   - Launch the extracted app and record the ad-hoc, non-notarized Gatekeeper boundary exactly.

These are manual release gates, not claims made by CI. Do not publish if an expected artifact is missing, an unexpected internal asset appears, metadata points to an unpacked path, or a basic launch boundary fails without an understood release note.

## v1.16.0 Candidate AI Planning Smoke

在 tag 或正式 Release 前，必须使用候选 packaged build、一次性用户数据目录和本地 mock AI endpoint 完成记录。不得使用真实用户 profile、真实 API Key、真实学习数据或真实云端模型。

至少记录：

- 操作系统、架构、候选资产名称和文件哈希；
- 一次性 user-data 路径与 mock endpoint；
- 请求次数、任务写入次数和测试前后数据库任务记录；
- 每项验收结果及任何错误或系统安全警告。

### Opening and privacy boundary

- 打开 Today Action planning context 和 Daily Review 不自动调用 AI。
- 打开 Daily Review 不创建、完成、跳过、删除或修改任务。
- 在可识别的测试字段中放入 diary-body、mistake-answer、mistake-notes、image-path、attachment-path、API-key 和 task-description sentinel。
- 检查 mock server 收到的请求，确认上述 sentinel 均未发送。
- 确认 safe preview 只显示允许的摘要、计数、标题或引用字段。

### Parsing and confirmation boundary

- 验证一个合法响应可以生成可编辑候选。
- 验证 prose、malformed JSON、unknown field、model-provided `planned_date` / `status` / `source`、非法类型和无效引用均被拒绝。
- 修改本地上下文后执行第一次创建确认，确认任务写入数仍为 0。
- 第二次明确确认后，只创建选中且有效的候选。
- 检查创建结果为本地控制的下一日期、`status=todo` 和 `source=ai`。

### Partial failure and retry

- 仅在一次性 profile 中注入一个可恢复的单候选创建失败。
- 确认成功候选保持 created，失败候选保持可编辑、可重试。
- 重试时只创建失败候选，已经成功的候选不得重复创建。
- 完成后恢复 IPC/mock handler 并关闭候选应用。

### Modal and refresh lifecycle

- 在 Dashboard 顶部、中部和底部滚动位置打开 Daily Review。
- 确认 modal 完整位于 viewport，header、footer 和内部滚动可用。
- 关闭后 Dashboard 保留原滚动位置。
- 创建完成触发 Dashboard 后台刷新时，Dialog DOM 和候选状态不得被重置。

### Local-date rollover

- 自动化只允许在 token-bound disposable profile 中使用 renderer-local clock 和 loopback mock endpoint；不得更改 runner 或日常使用主机的系统时间。
- 保持日期 A 的 Daily Review 打开并生成内存候选，推进逻辑午夜后确认旧 dialog 关闭、旧候选 control 已 detached、固定旧日期 IPC 被 main/SQLite transaction guard 拒绝，且业务表 row-count snapshot 完全不变。
- 在日期 B 重新打开 Daily Review，确认 mock request 的 `reviewDate` / `candidateDate` 分别来自日期 A/B 的正确本地日期链。
- 用户明确确认后只允许新增 1 条日期 B 对应的下一日 task；验证 `status=todo`、`source=ai`，随后清理并恢复业务表 baseline。
- 归档仅允许 `business-write-count.txt`、`database-before-after.json`、`date-rollover-result.json`、`mock-request-log.json`、`ui-event-sequence.json`；不得归档 request body、API key、数据库行内容或路径。
- 日期 A 成功加载后切换到日期 B，并让日期 B 请求保持 pending，确认日期 A 统计不再显示在日期 B 下。
- 让日期 B 请求失败，确认显示日期 B 的整页错误而不是保留日期 A Dashboard。
- 让日期 B 请求成功，确认只显示日期 B 数据。
- 验证日期 A 的迟到请求不能覆盖日期 B 的数据或 date provenance。

### Candidate acceptance boundary

自动 CI 的 Portable wrapper smoke 已覆盖本次构建 EXE 的一次性 profile 基本启动、preload/native SQLite、假数据与 `local://` 往返；它和源代码 Electron smoke 仍不能替代以下人工候选资产/平台 checks：

- Windows Setup 安装并启动；
- 从候选资产下载 Windows Portable 后在干净或一次性 Windows 主机直接启动；
- macOS ARM64 DMG 挂载、复制并启动；
- macOS ARM64 ZIP 解压并启动；
- 设置页显示 `v1.16.0` 和本版本内置更新摘要；
- update metadata 与正式资产名符合严格 allowlist。

没有完成的项目必须标记为 blocked，不得描述为 passed。

## Final Published Release Verification

- Verify the tag and Release target the intended commit.
- Verify the Release body matches `RELEASE_NOTES.md`.
- Verify the published asset names exactly match the allowlist above.
- Download and inspect `latest.yml` and `latest-mac.yml`, not only local build output.
- Verify the intended Release is marked latest.
- Do not edit earlier tags or replace assets on earlier Releases to correct a future-only workflow issue.
