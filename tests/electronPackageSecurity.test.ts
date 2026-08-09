import fs from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_UNPACKED_FILES,
  EXPECTED_FUSES,
  EXPECTED_UPDATER_METADATA,
  validateFuseWire,
  verifyPackagedUpdaterMetadata,
  verifyUnpackedLayout,
} from '../scripts/verify-electron-package-security.mjs'
import {
  createIntegrityControlExecutable,
  expectRejectedStartup,
  findParseableAsarHeaderMutation,
  removeIntegrityControlExecutable,
  retryTransientWindowsCleanup,
} from '../scripts/test-packaged-asar-integrity.mjs'
import {
  findPackagedArchives,
  validatePackagedNativeResolution,
} from '../scripts/verify-electron-native.mjs'

const tempRoots: string[] = []

function makeResources(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-package-security-'))
  tempRoots.push(root)
  const resourcesDir = path.join(root, 'resources')
  fs.mkdirSync(resourcesDir)
  fs.writeFileSync(path.join(resourcesDir, 'app.asar'), 'test archive')
  for (const relativePath of ALLOWED_UNPACKED_FILES) {
    const target = path.join(resourcesDir, 'app.asar.unpacked', ...relativePath.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, 'native binary')
  }
  return resourcesDir
}

describe('packaged Electron security verifier', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  it('accepts the exact Electron 42 fuse wire policy', () => {
    const wire = {
      version: '1',
      0: 48,
      1: 48,
      2: 48,
      3: 48,
      4: 49,
      5: 49,
      6: 48,
      7: 49,
      8: 49,
    }

    expect(validateFuseWire(wire)).toEqual(EXPECTED_FUSES)
  })

  it('fails closed for an unexpected or changed fuse', () => {
    expect(() => validateFuseWire({
      version: '1',
      0: 48,
      1: 48,
      2: 48,
      3: 48,
      4: 49,
      5: 49,
      6: 48,
      7: 49,
      8: 48,
    })).toThrow(/WasmTrapHandlers expected enabled/)

    expect(() => validateFuseWire({
      version: '1',
      0: 48,
      1: 48,
      2: 48,
      3: 48,
      4: 49,
      5: 49,
      6: 48,
      7: 49,
      8: 49,
      9: 49,
    })).toThrow(/Unexpected Electron fuse wire indexes/)
  })

  it('accepts only app.asar plus the approved native binary outside it', () => {
    const resourcesDir = makeResources()

    expect(verifyUnpackedLayout(resourcesDir).unpackedFiles).toEqual(ALLOWED_UNPACKED_FILES)
  })

  it('discovers packaged archives in Windows resources and macOS Resources directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-native-archives-'))
    tempRoots.push(root)
    const windowsAsar = path.join(root, 'win-unpacked', 'resources', 'app.asar')
    const macAsar = path.join(root, 'mac-arm64', 'MindDiary.app', 'Contents', 'Resources', 'app.asar')
    for (const archive of [windowsAsar, macAsar]) {
      fs.mkdirSync(path.dirname(archive), { recursive: true })
      fs.writeFileSync(archive, 'test archive')
    }

    expect(findPackagedArchives(root)).toEqual([macAsar, windowsAsar].sort())
  })

  it('binds packaged native resolution to the selected ASAR and unpacked tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-native-resolution-'))
    tempRoots.push(root)
    const appAsar = path.join(root, 'resources', 'app.asar')
    const packageJsonPath = path.join(appAsar, 'node_modules', 'better-sqlite3', 'package.json')
    const virtualNative = path.join(
      appAsar,
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    )
    const physicalNative = virtualNative.replace(`${appAsar}${path.sep}`, `${appAsar}.unpacked${path.sep}`)
    fs.mkdirSync(path.dirname(physicalNative), { recursive: true })
    fs.writeFileSync(physicalNative, 'native binary')

    expect(validatePackagedNativeResolution(appAsar, packageJsonPath, virtualNative)).toBe(physicalNative)
    expect(() => validatePackagedNativeResolution(
      appAsar,
      path.join(root, 'node_modules', 'better-sqlite3', 'package.json'),
      virtualNative,
    )).toThrow(/metadata resolves outside packaged app\.asar/)
    expect(() => validatePackagedNativeResolution(
      appAsar,
      packageJsonPath,
      path.join(root, 'node_modules', 'better-sqlite3', 'better_sqlite3.node'),
    )).toThrow(/better_sqlite3\.node resolves outside packaged app\.asar/)
    fs.rmSync(physicalNative)
    expect(() => validatePackagedNativeResolution(appAsar, packageJsonPath, virtualNative))
      .toThrow(/does not exist/)
  })

  it('rejects unpacked JavaScript and fallback application code', () => {
    const resourcesDir = makeResources()
    const unpackedScript = path.join(
      resourcesDir,
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
      'lib',
      'index.js',
    )
    fs.mkdirSync(path.dirname(unpackedScript), { recursive: true })
    fs.writeFileSync(unpackedScript, 'module.exports = {}')
    expect(() => verifyUnpackedLayout(resourcesDir)).toThrow(/Unexpected app\.asar\.unpacked files/)

    fs.rmSync(path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'lib'), {
      recursive: true,
      force: true,
    })
    fs.mkdirSync(path.join(resourcesDir, 'app'))
    expect(() => verifyUnpackedLayout(resourcesDir)).toThrow(/fallback directory/)
  })

  it('rejects an app.asar.unpacked junction that escapes packaged resources', () => {
    const resourcesDir = makeResources()
    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')
    const externalDir = path.join(path.dirname(resourcesDir), 'external-unpacked')
    fs.rmSync(unpackedDir, { recursive: true, force: true })
    for (const relativePath of ALLOWED_UNPACKED_FILES) {
      const target = path.join(externalDir, ...relativePath.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, 'external native binary')
    }
    fs.symlinkSync(externalDir, unpackedDir, 'junction')

    expect(() => verifyUnpackedLayout(resourcesDir)).toThrow(/symbolic link|outside packaged resources/)
  })

  it('rejects a resources junction that relocates the package layout', () => {
    const resourcesDir = makeResources()
    const externalResources = path.join(path.dirname(resourcesDir), 'external-resources')
    fs.renameSync(resourcesDir, externalResources)
    fs.symlinkSync(externalResources, resourcesDir, 'junction')

    expect(() => verifyUnpackedLayout(resourcesDir)).toThrow(/resources.*symbolic link/i)
  })

  it('fails when a supposedly rejected packaged process is still running at the deadline', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-rejected-startup-'))
    tempRoots.push(root)
    const profilePath = path.join(root, 'profile')
    fs.mkdirSync(profilePath)
    const markerPath = path.join(root, 'executed.txt')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'pipe' })

    try {
      await expect(expectRejectedStartup({ child, output: () => '' }, profilePath, markerPath, 100))
        .rejects.toThrow(/still running|timed out/i)
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('selects an ASAR integrity mutation that keeps the header valid JSON', () => {
    const header = Buffer.from(JSON.stringify({
      files: {
        'dependency.map': { size: 1, offset: '0' },
      },
    }))
    const padding = Buffer.alloc((4 - (header.length % 4)) % 4)
    const archive = Buffer.alloc(16 + header.length + padding.length + 1)
    archive.writeUInt32LE(header.length + padding.length, 12)
    header.copy(archive, 16)
    const mutation = findParseableAsarHeaderMutation(archive)
    archive[mutation.offset] = mutation.changedByte

    expect(() => JSON.parse(
      archive.subarray(16, 16 + header.length).toString('utf8'),
    )).not.toThrow()
    expect(archive.subarray(16, 16 + header.length).toString('utf8')).toContain('dependency.nap')
  })

  it.each(['EBUSY', 'EPERM', 'ENOTEMPTY'])('retries bounded Windows cleanup failure %s', async code => {
    const transientError = Object.assign(new Error('transient cleanup failure'), { code })
    const wait = vi.fn(async () => undefined)
    const operation = vi.fn()
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(undefined)

    await expect(retryTransientWindowsCleanup(operation, { platform: 'win32', wait })).resolves.toBeUndefined()
    expect(operation).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls).toEqual([[100], [200]])
  })

  it('preserves a pre-existing integrity control executable it does not own', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-control-ownership-'))
    tempRoots.push(root)
    const executablePath = path.join(root, 'MindDiary.exe')
    const controlExecutablePath = path.join(root, `MindDiary.integrity-control-${process.pid}.exe`)
    fs.writeFileSync(executablePath, 'packaged executable')
    fs.writeFileSync(controlExecutablePath, 'pre-existing control')

    let created = false
    try {
      expect(() => createIntegrityControlExecutable(executablePath, controlExecutablePath))
        .toThrow(/Refusing to overwrite existing integrity-control executable/)
    } finally {
      await removeIntegrityControlExecutable(controlExecutablePath, executablePath, created)
    }
    expect(fs.readFileSync(controlExecutablePath, 'utf8')).toBe('pre-existing control')
  })

  it('removes only an owned exact-name integrity control executable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-control-cleanup-'))
    tempRoots.push(root)
    const executablePath = path.join(root, 'MindDiary.exe')
    const controlExecutablePath = path.join(root, `MindDiary.integrity-control-${process.pid}.exe`)
    const unexpectedPath = path.join(root, 'MindDiary.integrity-control-unexpected.exe')
    fs.writeFileSync(executablePath, 'packaged executable')
    fs.writeFileSync(unexpectedPath, 'unowned executable')

    createIntegrityControlExecutable(executablePath, controlExecutablePath)
    await expect(removeIntegrityControlExecutable(
      controlExecutablePath,
      executablePath,
      true,
    )).resolves.toBeUndefined()
    expect(fs.existsSync(controlExecutablePath)).toBe(false)
    await expect(removeIntegrityControlExecutable(
      unexpectedPath,
      executablePath,
      true,
    )).rejects.toThrow(/unexpected integrity-control executable/)
    expect(fs.existsSync(unexpectedPath)).toBe(true)
  })

  it('throws non-transient cleanup failures immediately and exhausts transient retries', async () => {
    const nonTransientError = Object.assign(new Error('access denied'), { code: 'EACCES' })
    const nonTransientOperation = vi.fn().mockRejectedValue(nonTransientError)
    const nonTransientWait = vi.fn(async () => undefined)

    await expect(retryTransientWindowsCleanup(nonTransientOperation, {
      platform: 'win32',
      wait: nonTransientWait,
    })).rejects.toBe(nonTransientError)
    expect(nonTransientOperation).toHaveBeenCalledTimes(1)
    expect(nonTransientWait).not.toHaveBeenCalled()

    const transientError = Object.assign(new Error('directory not empty'), { code: 'ENOTEMPTY' })
    const transientOperation = vi.fn().mockRejectedValue(transientError)
    const transientWait = vi.fn(async () => undefined)

    await expect(retryTransientWindowsCleanup(transientOperation, {
      platform: 'win32',
      wait: transientWait,
    })).rejects.toBe(transientError)
    expect(transientOperation).toHaveBeenCalledTimes(4)
    expect(transientWait.mock.calls).toEqual([[100], [200], [300]])
  })

  it('does not retry transient cleanup codes outside Windows', async () => {
    const error = Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    const operation = vi.fn().mockRejectedValue(error)
    const wait = vi.fn(async () => undefined)

    await expect(retryTransientWindowsCleanup(operation, { platform: 'linux', wait })).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('requires exact updater metadata for distributable packages', () => {
    const resourcesDir = makeResources()
    expect(verifyPackagedUpdaterMetadata(resourcesDir)).toEqual({ present: false })
    expect(() => verifyPackagedUpdaterMetadata(resourcesDir, { required: true }))
      .toThrow(/updater metadata does not exist/)

    fs.writeFileSync(
      path.join(resourcesDir, 'app-update.yml'),
      Object.entries(EXPECTED_UPDATER_METADATA).map(([key, value]) => `${key}: ${value}`).join('\n'),
    )
    expect(verifyPackagedUpdaterMetadata(resourcesDir, { required: true })).toEqual({
      present: true,
      ...EXPECTED_UPDATER_METADATA,
    })

    fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), 'provider: github\nowner: gakialter\nrepo: wrong')
    expect(() => verifyPackagedUpdaterMetadata(resourcesDir, { required: true }))
      .toThrow(/repo expected Minddiary, got wrong/)

    fs.writeFileSync(
      path.join(resourcesDir, 'app-update.yml'),
      'provider: github\nowner: gakialter\nrepo: Minddiary\nrepo: Minddiary',
    )
    expect(() => verifyPackagedUpdaterMetadata(resourcesDir, { required: true }))
      .toThrow(/duplicated mapping key|duplicate/i)
  })
})
