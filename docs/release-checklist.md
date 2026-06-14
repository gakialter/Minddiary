# MindDiary Release Checklist

This checklist covers the Windows public release path, signing verification, update metadata verification, and manual updater smoke testing for GitHub Releases.

## Before Pushing a Release Tag

- Confirm `package.json` has the intended version.
- Confirm the pushed tag is exactly `v${package.json.version}`.
- Confirm `RELEASE_NOTES.md` has the release notes for that version and starts with `# MindDiary v${package.json.version}`.
- Run local validation:
  - `npm.cmd run typecheck`
  - `npm.cmd test -- --run`
  - `npm.cmd run build`
  - `npm.cmd run build:win` or a release workflow dry run from a non-public test branch/tag
- Confirm no certificate files, private keys, passwords, or generated signing artifacts are committed.

## GitHub Secrets

The Windows release workflow passes these secrets to `electron-builder`:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`

`CSC_LINK` must use a format supported by `electron-builder`, such as a p12/pfx certificate file encoded for CI use or a secure URL that `electron-builder` can consume. `CSC_KEY_PASSWORD` must be the matching certificate password.

Do not print these values in logs. Do not commit certificate files, p12/pfx files, private keys, or passwords.

The tag-based public release workflow requires both secrets. If either secret is missing, the Windows build job fails before packaging and writes the signing status to the GitHub step summary.

## Windows Signing Verification

After `electron-builder` packages the Windows artifacts, CI runs:

```powershell
./scripts/verify-windows-signing.ps1 -ReleaseDir release -RequireSigned:$true
```

The script checks every Windows `.exe` artifact with `Get-AuthenticodeSignature`. For public tag releases, the NSIS setup installer matching `*Setup*.exe` and the portable `.exe` must both have a `Valid` Authenticode signature before artifacts are uploaded.

For local unsigned validation, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows-signing.ps1 -ReleaseDir release -RequireSigned:$false
```

When `RequireSigned` is false, the script reports the signature status and warns that unsigned installers can show Unknown Publisher and SmartScreen warnings. Public tag releases always run with `RequireSigned:$true`.

## Update Metadata Verification

CI verifies Windows update metadata before uploading artifacts:

```bash
npx tsx scripts/verify-release-metadata.ts --platform win --release-dir release --package package.json
```

The check requires `release/latest.yml` and validates:

- `version`
- `files`
- `path`
- `sha512`
- `releaseDate`

`latest.yml.version` must match `package.json.version`. `latest.yml.path` and each listed file path must resolve to an existing release asset inside the release directory, and each listed file must have a non-empty `sha512`.

CI also verifies macOS update metadata before uploading artifacts:

```bash
npx tsx scripts/verify-release-metadata.ts --platform mac --release-dir release --package package.json
```

The macOS check requires `release/latest-mac.yml`, validates `version`, `files`, `path`, `sha512`, and `releaseDate`, requires the update `path` to point to a `.zip`, and verifies that `.dmg`, `.zip`, and `.blockmap` artifacts exist and are non-empty.

Both checks find packaged `app-update.yml` files under the release output, such as `win-unpacked/resources/app-update.yml` or `mac-arm64/MindDiary.app/Contents/Resources/app-update.yml`, and verify that they contain:

- `provider: github`
- `owner: gakialter`
- `repo: Minddiary`

These values must match `package.json` `build.publish`. The in-app update check depends on this packaged `app-update.yml` to know which GitHub Release feed to query.

The publish job only runs after both Windows and macOS build jobs succeed. It creates a non-draft, non-prerelease latest release and fails if any configured asset glob does not match.

## GitHub Release Update Smoke Test

Do not rely on CI to download and install older app versions end to end. Use this manual prerelease flow for updater verification:

1. Create a prerelease tag for the candidate build.
2. Let the release workflow create the GitHub Release.
3. Confirm the Release assets include:
   - `MindDiary-Setup-<version>.exe`
   - `MindDiary-Portable-<version>.exe`
   - `MindDiary-Setup-<version>.exe.blockmap`
   - `latest.yml`
   - macOS `.dmg`
   - macOS `.zip`
   - macOS `.blockmap`
   - `latest-mac.yml`
4. Install a lower-version MindDiary build.
5. Start the app or click the in-app update check.
6. Confirm updater status transitions through checking and update available.
7. Confirm the update downloads, reaches downloaded state, and installs after restart.

For final release verification, inspect the published GitHub Release assets, `latest.yml`, and `latest-mac.yml` contents, not only the local `release/` directory.

## Unsigned Installer and SmartScreen Behavior

Unsigned Windows installers can show Unknown Publisher and Windows SmartScreen warnings. Unsigned packages should be treated as internal testing artifacts only and should not be used for public distribution.

Code signing proves the installer publisher identity and helps Windows verify that the artifact has not been modified after signing. It does not guarantee immediate SmartScreen trust. A new certificate can still need reputation to accumulate before SmartScreen warnings disappear.
