// @vitest-environment node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getExpectedReleaseAssetNames,
  stageReleaseAssets,
  validateReleaseAssetManifest,
  verifyReleaseAssetDirectory,
} from '../scripts/prepare-release-assets.mjs'

const version = '1.17.0'
const tempRoots: string[] = []

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-release-assets-'))
  tempRoots.push(root)
  return root
}

describe('release asset allowlist', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('defines the exact public assets for Windows and macOS', () => {
    expect(getExpectedReleaseAssetNames(version, 'all')).toEqual([
      'MindDiary-Setup-1.17.0.exe',
      'MindDiary-Portable-1.17.0.exe',
      'MindDiary-Setup-1.17.0.exe.blockmap',
      'latest.yml',
      'MindDiary-1.17.0-arm64.dmg',
      'MindDiary-1.17.0-arm64-mac.zip',
      'MindDiary-1.17.0-arm64.dmg.blockmap',
      'MindDiary-1.17.0-arm64-mac.zip.blockmap',
      'latest-mac.yml',
    ])
  })

  it.each([
    'MindDiary.exe',
    'elevate.exe',
    'win-unpacked/MindDiary.exe',
    'win-unpacked/resources/elevate.exe',
    'mac-arm64/MindDiary.app/Contents/MacOS/MindDiary',
    'MindDiary.pdb',
    'debug.log',
    'temporary-build.tmp',
  ])('rejects internal or unpacked asset %s', forbiddenAsset => {
    expect(() => validateReleaseAssetManifest([
      ...getExpectedReleaseAssetNames(version, 'all'),
      forbiddenAsset,
    ], version, 'all')).toThrow(/root-level|Unexpected/)
  })

  it('rejects assets whose version does not match the package version', () => {
    const mismatched = getExpectedReleaseAssetNames('1.16.0', 'win')
    expect(() => validateReleaseAssetManifest(mismatched, version, 'win'))
      .toThrow(/Missing: MindDiary-Portable-1\.17\.0\.exe/)
  })

  it('stages only allowlisted root assets from a build output with unpacked directories', () => {
    const root = makeTempRoot()
    const sourceDir = path.join(root, 'release')
    const outputDir = path.join(root, 'release-upload')
    fs.mkdirSync(path.join(sourceDir, 'win-unpacked', 'resources'), { recursive: true })

    for (const assetName of getExpectedReleaseAssetNames(version, 'win')) {
      fs.writeFileSync(path.join(sourceDir, assetName), assetName)
    }
    fs.writeFileSync(path.join(sourceDir, 'win-unpacked', 'MindDiary.exe'), 'internal app')
    fs.writeFileSync(path.join(sourceDir, 'win-unpacked', 'resources', 'elevate.exe'), 'helper')

    expect(stageReleaseAssets({ sourceDir, outputDir, version, platform: 'win' }))
      .toEqual([...getExpectedReleaseAssetNames(version, 'win')].sort())
    expect(fs.readdirSync(outputDir).sort()).toEqual(
      [...getExpectedReleaseAssetNames(version, 'win')].sort(),
    )
  })

  it('rejects directories in the final publish manifest', () => {
    const root = makeTempRoot()
    for (const assetName of getExpectedReleaseAssetNames(version, 'all')) {
      fs.writeFileSync(path.join(root, assetName), assetName)
    }
    fs.mkdirSync(path.join(root, 'win-unpacked'))

    expect(() => verifyReleaseAssetDirectory(root, version, 'all'))
      .toThrow(/must contain only root-level files.*win-unpacked/)
  })

  it('keeps workflow upload paths non-recursive and manifest-backed', () => {
    const workflow = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/release.yml'),
      'utf8',
    )

    expect(workflow).toContain('node scripts/prepare-release-assets.mjs --platform win')
    expect(workflow).toContain('node scripts/prepare-release-assets.mjs --platform mac')
    expect(workflow).toContain('node scripts/prepare-release-assets.mjs --platform all')
    expect(workflow).toContain('release-upload/*')
    expect(workflow).toContain('release-artifacts/*')
    expect(workflow).not.toContain('release/**/*.exe')
    expect(workflow).not.toContain('release-artifacts/**/*.exe')
  })

  it('rebuilds and verifies better-sqlite3 for Electron before packaging', () => {
    const packageJson = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), 'package.json'),
      'utf8',
    )) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
      build: {
        asar: { smartUnpack: boolean }
        asarUnpack: string[]
        electronFuses: Record<string, boolean>
        nsis: { deleteAppDataOnUninstall: boolean }
      }
    }
    const ciWorkflow = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/ci.yml'),
      'utf8',
    )
    const releaseWorkflow = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/release.yml'),
      'utf8',
    )

    expect(packageJson.devDependencies['@electron/rebuild']).toBeDefined()
    expect(packageJson.devDependencies['@electron/fuses']).toBe('2.1.2')
    expect(packageJson.scripts['rebuild:electron'])
      .toBe('electron-rebuild -f -w better-sqlite3')
    expect(packageJson.scripts['verify:electron-native'])
      .toBe('node scripts/verify-electron-native.mjs')
    expect(packageJson.scripts['verify:electron-native:packaged'])
      .toBe('node scripts/verify-electron-native.mjs --release-dir release')
    expect(packageJson.scripts['verify:electron-package-security'])
      .toBe('node scripts/verify-electron-package-security.mjs --release-dir release')
    expect(packageJson.scripts['verify:electron-package-security:release'])
      .toBe('node scripts/verify-electron-package-security.mjs --release-dir release --require-updater-metadata')
    expect(packageJson.scripts['test:e2e:packaged-security'])
      .toBe('playwright test --config playwright.packaged.config.ts')
    expect(packageJson.scripts['test:e2e:portable-smoke'])
      .toBe('playwright test --config playwright.portable.config.ts')
    expect(packageJson.scripts['test:e2e:setup-smoke'])
      .toBe('playwright test --config playwright.setup.config.ts')
    expect(packageJson.scripts['test:asar-integrity:packaged'])
      .toBe('node scripts/test-packaged-asar-integrity.mjs --release-dir release')

    expect(packageJson.build.asar).toEqual({ smartUnpack: false })
    expect(packageJson.build.asarUnpack).toEqual([
      'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    ])
    expect(packageJson.build.electronFuses).toEqual({
      runAsNode: false,
      enableCookieEncryption: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      loadBrowserProcessSpecificV8Snapshot: false,
      grantFileProtocolExtraPrivileges: true,
      resetAdHocDarwinSignature: true,
    })
    expect(packageJson.build.nsis.deleteAppDataOnUninstall).toBe(false)

    for (const scriptName of ['build', 'build:win', 'build:mac']) {
      expect(packageJson.scripts[scriptName]).toMatch(
        /npm run rebuild:electron && npm run verify:electron-native && electron-builder/,
      )
      expect(packageJson.scripts[scriptName]).toMatch(
        /electron-builder(?: --(?:win|mac))? && npm run verify:electron-package-security:release && npm run verify:electron-native:packaged$/,
      )
    }

    expect(ciWorkflow.match(/run: npm run rebuild:electron/g)).toHaveLength(2)
    expect(ciWorkflow.match(/run: npm run test:e2e$/gm)).toHaveLength(1)
    expect(ciWorkflow.match(/run: npm run verify:electron-native$/gm)).toHaveLength(1)
    expect(ciWorkflow.match(/run: npm run verify:electron-native:packaged/g)).toHaveLength(1)
    expect(ciWorkflow.match(/run: npm run verify:electron-package-security/g)).toHaveLength(1)
    expect(ciWorkflow.match(/run: npm run test:e2e:packaged-security/g)).toHaveLength(1)
    expect(ciWorkflow.match(/run: npm run test:e2e:portable-smoke/g)).toHaveLength(1)
    expect(ciWorkflow.match(/run: npm run test:e2e:setup-smoke/g)).toHaveLength(1)
    expect(ciWorkflow).toContain('npx electron-builder --win nsis portable --x64 --publish never')
    expect(ciWorkflow).toContain(
      'name: windows-portable-smoke-${{ github.event.pull_request.head.sha || github.sha }}',
    )
    expect(ciWorkflow).toContain('test-results/windows-portable-smoke-evidence/*')
    expect(ciWorkflow).toContain(
      'name: windows-setup-smoke-${{ github.event.pull_request.head.sha || github.sha }}',
    )
    expect(ciWorkflow).toContain('test-results/windows-setup-smoke-evidence/*')
    expect(ciWorkflow).toContain(
      'name: windows-date-rollover-${{ github.event.pull_request.head.sha || github.sha }}',
    )
    expect(ciWorkflow).toContain('test-results/date-rollover-evidence/*')
    expect(ciWorkflow.match(/run: npm run test:asar-integrity:packaged/g)).toHaveLength(1)
    expect(releaseWorkflow.match(/run: npm run rebuild:electron/g)).toHaveLength(2)
    expect(releaseWorkflow.match(/run: npm run verify:electron-native$/gm)).toHaveLength(2)
    expect(releaseWorkflow.match(/run: npm run verify:electron-native:packaged/g)).toHaveLength(2)
    expect(releaseWorkflow.match(/run: npm run verify:electron-package-security:release/g)).toHaveLength(2)
    expect(releaseWorkflow.match(/run: npm run test:e2e:packaged-security/g)).toHaveLength(2)
    expect(releaseWorkflow.match(/run: npm run test:e2e:portable-smoke/g)).toHaveLength(1)
    expect(releaseWorkflow.match(/run: npm run test:e2e:setup-smoke/g)).toHaveLength(1)
    expect(releaseWorkflow).toContain('name: windows-setup-smoke-evidence')
    expect(releaseWorkflow).toContain('path: test-results/windows-setup-smoke-evidence/*')
    expect(releaseWorkflow).toContain('name: windows-date-rollover-evidence')
    expect(releaseWorkflow).toContain('path: test-results/date-rollover-evidence/*')
    expect(releaseWorkflow).toContain("pattern: '*-release'")
    expect(releaseWorkflow.match(/run: npm run test:asar-integrity:packaged/g)).toHaveLength(1)
  })
})
