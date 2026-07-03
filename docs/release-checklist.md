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
- update metadata and the exact Release asset manifest pass validation;
- the publish job receives only allowlisted root assets.

CI does not install the Windows Setup package, launch Portable on a clean Windows host, mount the DMG on a user Mac, or evaluate macOS Gatekeeper/notarization behavior.

## Manual Install Smoke Tests

Run these during release acceptance after candidate artifacts exist. Record OS version, architecture, asset name, result, and any warning shown.

Before publishing v1.13.3, also record one packaged media-deletion containment smoke against a candidate Windows Setup or Portable build using only disposable profile data:

- Confirm normal attachment deletion, entry attachment cleanup, and managed mistake image deletion still remove files inside their managed directories.
- Place a junction inside the disposable `attachments` directory that points to an outside disposable sentinel file; confirm single and entry-cleanup deletion paths leave the sentinel unchanged.
- Place a junction inside the disposable `mistake_images` directory that points to an outside disposable sentinel file; confirm managed mistake image deletion leaves the sentinel unchanged.
- Record the candidate artifact, disposable profile paths, sentinel results, and any filesystem error; do not use the real user profile or real attachments.

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

## Final Published Release Verification

- Verify the tag and Release target the intended commit.
- Verify the Release body matches `RELEASE_NOTES.md`.
- Verify the published asset names exactly match the allowlist above.
- Download and inspect `latest.yml` and `latest-mac.yml`, not only local build output.
- Verify the intended Release is marked latest.
- Do not edit earlier tags or replace assets on earlier Releases to correct a future-only workflow issue.
