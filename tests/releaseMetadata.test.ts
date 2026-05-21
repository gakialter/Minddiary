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
})
