// @vitest-environment node

import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyReleaseMetadata } from '../scripts/verify-release-metadata'

const tempRoots: string[] = []
const installerSha512 = createHash('sha512').update('installer').digest('base64')
const zipSha512 = createHash('sha512').update('zip').digest('base64')
const dmgSha512 = createHash('sha512').update('dmg').digest('base64')

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
    `    sha512: ${installerSha512}`,
    '    size: 9',
    'path: MindDiary-Setup-1.9.3.exe',
    `sha512: ${installerSha512}`,
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
    `    sha512: ${zipSha512}`,
    '    size: 3',
    '  - url: MindDiary-1.9.3-arm64.dmg',
    `    sha512: ${dmgSha512}`,
    '    size: 3',
    'path: MindDiary-1.9.3-arm64-mac.zip',
    `sha512: ${zipSha512}`,
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

  it('accepts an asset whose SHA512 covers multiple read chunks and a partial final chunk', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeLatestYml(releaseDir)
    writeAppUpdateYml(releaseDir)
    const installer = Buffer.alloc(1024 * 1024 + 7, 0x5a)
    installer.fill(0x3c, 1024 * 1024)
    const sha512 = createHash('sha512').update(installer).digest('base64')
    fs.writeFileSync(path.join(releaseDir, 'MindDiary-Setup-1.9.3.exe'), installer)
    const latestPath = path.join(releaseDir, 'latest.yml')
    fs.writeFileSync(latestPath, fs.readFileSync(latestPath, 'utf8')
      .split(installerSha512).join(sha512)
      .replace('    size: 9', `    size: ${installer.length}`))

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).not.toThrow()
  })

  it.each(['win', 'mac'] as const)('rejects %s metadata when the top-level SHA512 does not match the primary asset', platform => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    if (platform === 'win') {
      writeLatestYml(releaseDir)
      writeAppUpdateYml(releaseDir)
    } else {
      writeMacLatestYml(releaseDir)
      writeMacAppUpdateYml(releaseDir)
    }
    const latestFilename = platform === 'win' ? 'latest.yml' : 'latest-mac.yml'
    const latestPath = path.join(releaseDir, latestFilename)
    const wrongSha512 = createHash('sha512').update('different asset').digest('base64')
    fs.writeFileSync(latestPath, fs.readFileSync(latestPath, 'utf8').replace(
      /\nsha512: [^\n]+/,
      `\nsha512: ${wrongSha512}`,
    ))

    expect(() => verifyReleaseMetadata({
      platform,
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(`${latestFilename} sha512 does not match asset SHA512`)
  })

  it.each(['win', 'mac'] as const)('rejects %s metadata when a file-entry SHA512 does not match its asset', platform => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    if (platform === 'win') {
      writeLatestYml(releaseDir)
      writeAppUpdateYml(releaseDir)
    } else {
      writeMacLatestYml(releaseDir)
      writeMacAppUpdateYml(releaseDir)
    }
    const latestFilename = platform === 'win' ? 'latest.yml' : 'latest-mac.yml'
    const latestPath = path.join(releaseDir, latestFilename)
    const originalSha512 = platform === 'win' ? installerSha512 : dmgSha512
    const wrongSha512 = createHash('sha512').update('different asset').digest('base64')
    fs.writeFileSync(latestPath, fs.readFileSync(latestPath, 'utf8').replace(
      `    sha512: ${originalSha512}`,
      `    sha512: ${wrongSha512}`,
    ))

    expect(() => verifyReleaseMetadata({
      platform,
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(`${latestFilename} files[${platform === 'win' ? 0 : 1}] sha512 does not match asset SHA512`)
  })

  it.each(['win', 'mac'] as const)('rejects %s metadata after an asset changes without changing its size', platform => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    if (platform === 'win') {
      writeLatestYml(releaseDir)
      writeAppUpdateYml(releaseDir)
    } else {
      writeMacLatestYml(releaseDir)
      writeMacAppUpdateYml(releaseDir)
    }
    const assetPath = path.join(releaseDir, platform === 'win'
      ? 'MindDiary-Setup-1.9.3.exe'
      : 'MindDiary-1.9.3-arm64.dmg')
    const originalSize = fs.statSync(assetPath).size
    fs.writeFileSync(assetPath, platform === 'win' ? 'corrupted' : 'bad')
    expect(fs.statSync(assetPath).size).toBe(originalSize)

    expect(() => verifyReleaseMetadata({
      platform,
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/sha512 does not match asset SHA512/)
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
      `    sha512: ${createHash('sha512').update('internal app').digest('base64')}`,
      'path: win-unpacked/MindDiary.exe',
      `sha512: ${createHash('sha512').update('internal app').digest('base64')}`,
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

  it('rejects latest.yml when an asset size is missing', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeLatestYml(releaseDir, [
      'version: 1.9.3',
      'files:',
      '  - url: MindDiary-Setup-1.9.3.exe',
      `    sha512: ${installerSha512}`,
      'path: MindDiary-Setup-1.9.3.exe',
      `sha512: ${installerSha512}`,
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'))
    writeAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/latest\.yml files\[0\] size must be a positive safe integer/)
  })

  it('rejects latest.yml when an asset size is non-numeric', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeLatestYml(releaseDir, [
      'version: 1.9.3',
      'files:',
      '  - url: MindDiary-Setup-1.9.3.exe',
      `    sha512: ${installerSha512}`,
      '    size: invalid',
      'path: MindDiary-Setup-1.9.3.exe',
      `sha512: ${installerSha512}`,
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'))
    writeAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/latest\.yml files\[0\] size must be a positive safe integer/)
  })

  it('rejects latest.yml when an asset size does not match the actual file', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeLatestYml(releaseDir, [
      'version: 1.9.3',
      'files:',
      '  - url: MindDiary-Setup-1.9.3.exe',
      `    sha512: ${installerSha512}`,
      '    size: 10',
      'path: MindDiary-Setup-1.9.3.exe',
      `sha512: ${installerSha512}`,
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'))
    writeAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'win',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/latest\.yml files\[0\] size 10 does not match asset size 9/)
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
      `    sha512: ${dmgSha512}`,
      '    size: 3',
      'path: MindDiary-1.9.3-arm64.dmg',
      `sha512: ${dmgSha512}`,
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

  it('rejects macOS metadata when files lists only the DMG and omits the primary update ZIP', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeMacLatestYml(releaseDir, [
      'version: 1.9.3',
      'files:',
      '  - url: MindDiary-1.9.3-arm64.dmg',
      `    sha512: ${dmgSha512}`,
      '    size: 3',
      'path: MindDiary-1.9.3-arm64-mac.zip',
      `sha512: ${zipSha512}`,
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'))
    writeMacAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'mac',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/latest-mac\.yml files must include the primary update asset MindDiary-1\.9\.3-arm64-mac\.zip/)
  })

  it('rejects macOS latest-mac.yml when an asset size does not match the actual file', () => {
    const root = makeTempRoot()
    const releaseDir = path.join(root, 'release')
    fs.mkdirSync(releaseDir)
    const packagePath = writePackageJson(root)
    writeMacLatestYml(releaseDir, [
      'version: 1.9.3',
      'files:',
      '  - url: MindDiary-1.9.3-arm64-mac.zip',
      `    sha512: ${zipSha512}`,
      '    size: 4',
      '  - url: MindDiary-1.9.3-arm64.dmg',
      `    sha512: ${dmgSha512}`,
      '    size: 3',
      'path: MindDiary-1.9.3-arm64-mac.zip',
      `sha512: ${zipSha512}`,
      'releaseDate: 2026-05-21T00:00:00.000Z',
      '',
    ].join('\n'))
    writeMacAppUpdateYml(releaseDir)

    expect(() => verifyReleaseMetadata({
      platform: 'mac',
      packageJsonPath: packagePath,
      releaseDir,
    })).toThrow(/latest-mac\.yml files\[0\] size 4 does not match asset size 3/)
  })
})
