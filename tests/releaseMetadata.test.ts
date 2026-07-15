// @vitest-environment node

import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyReleaseMetadata } from '../scripts/verify-release-metadata'

const tempRoots: string[] = []

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-release-'))
  tempRoots.push(root)
  return root
}

function writePackageJson(root: string, version = '1.9.3'): string {
  const packagePath = path.join(root, 'package.json')
  fs.writeFileSync(packagePath, JSON.stringify({
    version,
    build: {
      publish: [{ provider: 'github', owner: 'gakialter', repo: 'Minddiary' }],
    },
  }))
  return packagePath
}

function writeLatestYml(releaseDir: string, body?: string): void {
  fs.writeFileSync(path.join(releaseDir, 'MindDiary-Setup-1.9.3.exe'), 'installer')
  fs.writeFileSync(path.join(releaseDir, 'latest.yml'), body ?? [
    'version: 1.9.3',
    'files:',
    '  - url: MindDiary-Setup-1.9.3.exe',
    '    sha512: abc123',
    '    size: 9',
    'path: MindDiary-Setup-1.9.3.exe',
    'sha512: abc123',
    'releaseDate: 2026-05-21T00:00:00.000Z',
    '',
  ].join('\n'))
}

function writeAppUpdateYml(releaseDir: string, owner = 'gakialter', repo = 'Minddiary'): void {
  const resourcesDir = path.join(releaseDir, 'win-unpacked', 'resources')
  fs.mkdirSync(resourcesDir, { recursive: true })
  fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), [
    'provider: github',
    `owner: ${owner}`,
    `repo: ${repo}`,
    'updaterCacheDirName: minddiary-updater',
    '',
  ].join('\n'))
}

function writeMacLatestYml(releaseDir: string, body?: string): void {
  fs.writeFileSync(path.join(releaseDir, 'MindDiary-1.9.3-arm64.dmg'), 'dmg')
  fs.writeFileSync(path.join(releaseDir, 'MindDiary-1.9.3-arm64-mac.zip'), 'zip')
  fs.writeFileSync(path.join(releaseDir, 'MindDiary-1.9.3-arm64-mac.zip.blockmap'), 'blockmap')
  fs.writeFileSync(path.join(releaseDir, 'latest-mac.yml'), body ?? [
    'version: 1.9.3',
    'files:',
    '  - url: MindDiary-1.9.3-arm64-mac.zip',
    '    sha512: ziphash',
    '    size: 3',
    '  - url: MindDiary-1.9.3-arm64.dmg',
    '    sha512: dmghash',
    '    size: 3',
    'path: MindDiary-1.9.3-arm64-mac.zip',
    'sha512: ziphash',
    'releaseDate: 2026-05-21T00:00:00.000Z',
    '',
  ].join('\n'))
}

function writeMacAppUpdateYml(releaseDir: string, owner = 'gakialter', repo = 'Minddiary'): void {
  const resourcesDir = path.join(releaseDir, 'mac-arm64', 'MindDiary.app', 'Contents', 'Resources')
  fs.mkdirSync(resourcesDir, { recursive: true })
  fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), [
    'provider: github',
    `owner: ${owner}`,
    `repo: ${repo}`,
    'updaterCacheDirName: minddiary-updater',
    '',
  ].join('\n'))
}

describe('release metadata verification', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts valid Windows latest.yml and packaged app-update.yml metadata', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeLatestYml(releaseDir)
    writeAppUpdateYml(releaseDir)

    expect(verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toEqual({
      latestPath: path.join(releaseDir, 'latest.yml'),
      installerPath: path.join(releaseDir, 'MindDiary-Setup-1.9.3.exe'),
      packageVersion: '1.9.3',
      publishOwner: 'gakialter',
      publishRepo: 'Minddiary',
      appUpdatePaths: [path.join(releaseDir, 'win-unpacked', 'resources', 'app-update.yml')],
    })
  })

  it('rejects a missing latest.yml', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/Missing latest\.yml/)
  })

  it('rejects latest.yml when the version does not match package.json', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root, '1.9.4')
    writeLatestYml(releaseDir)
    writeAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/version 1\.9\.3 does not match package\.json version 1\.9\.4/)
  })

  it('rejects latest.yml when path points into an unpacked directory', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(path.join(releaseDir, 'win-unpacked'), { recursive: true })
    const packagePath = writePackageJson(root)
    fs.writeFileSync(path.join(releaseDir, 'win-unpacked', 'MindDiary.exe'), 'internal app')
    fs.writeFileSync(path.join(releaseDir, 'latest.yml'), [
      'version: 1.9.3',
      'files:',
      '  - url: win-unpacked/MindDiary.exe',
      '    sha512: abc123',
      'path: win-unpacked/MindDiary.exe',
      'sha512: abc123',
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'))
    writeAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/path must point to the root release asset MindDiary-Setup-1\.9\.3\.exe/)
  })

  it('rejects latest.yml when required path, sha512, or files metadata is missing', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeLatestYml(releaseDir, [
      'version: 1.9.3',
      'files:',
      '  - url: MindDiary-Setup-1.9.3.exe',
      'path: MindDiary-Setup-1.9.3.exe',
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'))
    writeAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/Missing latest\.yml sha512/)
  })

  it('rejects packaged app-update.yml when GitHub owner or repo does not match publish config', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeLatestYml(releaseDir)
    writeAppUpdateYml(releaseDir, 'other-owner', 'Minddiary')

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/owner other-owner does not match package\.json publish owner gakialter/)
  })

  it('rejects duplicate updater metadata keys with runtime-equivalent YAML semantics', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeLatestYml(releaseDir)
    writeAppUpdateYml(releaseDir)
    fs.appendFileSync(
      path.join(releaseDir, 'win-unpacked', 'resources', 'app-update.yml'),
      'repo: Minddiary\n',
    )

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/duplicated mapping key|duplicate/i)
  })

  it('accepts valid macOS latest-mac.yml, assets, and packaged app-update.yml metadata', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeMacLatestYml(releaseDir)
    writeMacAppUpdateYml(releaseDir)

    expect(verifyReleaseMetadata({
      platform: 'mac',
      packageJsonPath: packagePath,
      releaseDir,
    })).toEqual({
      latestPath: path.join(releaseDir, 'latest-mac.yml'),
      installerPath: path.join(releaseDir, 'MindDiary-1.9.3-arm64-mac.zip'),
      packageVersion: '1.9.3',
      publishOwner: 'gakialter',
      publishRepo: 'Minddiary',
      appUpdatePaths: [
        path.join(releaseDir, 'mac-arm64', 'MindDiary.app', 'Contents', 'Resources', 'app-update.yml'),
      ],
    })
  })

  it('rejects macOS metadata when required release assets are missing', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeMacLatestYml(releaseDir)
    writeMacAppUpdateYml(releaseDir)
    fs.rmSync(path.join(releaseDir, 'MindDiary-1.9.3-arm64-mac.zip.blockmap'))

    expect(() => verifyReleaseMetadata({
      platform: 'mac',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/Missing macOS \.blockmap artifact/)
  })

  it('rejects macOS latest-mac.yml when the update path is not a zip artifact', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeMacLatestYml(releaseDir, [
      'version: 1.9.3',
      'files:',
      '  - url: MindDiary-1.9.3-arm64.dmg',
      '    sha512: dmghash',
      '    size: 3',
      'path: MindDiary-1.9.3-arm64.dmg',
      'sha512: dmghash',
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'))
    writeMacAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'mac',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/path must point to the root release asset MindDiary-1\.9\.3-arm64-mac\.zip/)
  })
})
