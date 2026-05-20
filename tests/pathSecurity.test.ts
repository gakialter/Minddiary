// @vitest-environment node

import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPathInside, resolveLocalProtocolPath } from '../electron/pathSecurity'

const tempRoots: string[] = []

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-path-security-'))
  tempRoots.push(root)
  return root
}

function makeDirLink(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('path security for local:// protocol', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows a normal file under userData', () => {
    const userData = makeTempRoot()
    const attachments = path.join(userData, 'attachments')
    fs.mkdirSync(attachments)
    const file = path.join(attachments, 'image.png')
    fs.writeFileSync(file, 'ok')

    expect(resolveLocalProtocolPath('local://attachments/image.png', userData)).toBe(fs.realpathSync.native(file))
  })

  it('rejects ../ traversal outside userData', () => {
    const userData = makeTempRoot()
    const outside = path.join(path.dirname(userData), 'outside-traversal.txt')
    fs.writeFileSync(outside, 'secret')
    tempRoots.push(outside)

    expect(() => resolveLocalProtocolPath('local://../outside-traversal.txt', userData)).toThrow('Path outside userData')
  })

  it('rejects a Windows absolute path on another drive through mockable path handling', () => {
    const realpathSync = vi.fn((value: fs.PathLike) => String(value)) as unknown as typeof fs.realpathSync & {
      native: typeof fs.realpathSync.native
    }
    realpathSync.native = vi.fn((value: fs.PathLike) => String(value)) as unknown as typeof fs.realpathSync.native

    expect(() => resolveLocalProtocolPath('local:///D:/secret.txt', 'C:\\Users\\tester\\AppData\\Roaming\\MindDiary', {
      fsModule: { realpathSync },
      pathModule: path.win32,
      platform: 'win32',
    })).toThrow('Path outside userData')
  })

  it('rejects URL-encoded traversal outside userData', () => {
    const userData = makeTempRoot()
    const outside = path.join(path.dirname(userData), 'outside-encoded.txt')
    fs.writeFileSync(outside, 'secret')
    tempRoots.push(outside)

    expect(() => resolveLocalProtocolPath('local://%2e%2e/outside-encoded.txt', userData)).toThrow('Path outside userData')
  })

  it('rejects missing target files instead of falling back to the logical path', () => {
    const userData = makeTempRoot()

    expect(() => resolveLocalProtocolPath('local://attachments/missing.png', userData)).toThrow('Path not found')
    try {
      resolveLocalProtocolPath('local://attachments/missing.png', userData)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toContain('missing.png')
    }
  })

  it('rejects mixed backslash traversal outside userData', () => {
    const userData = makeTempRoot()
    const outside = path.join(path.dirname(userData), 'outside-backslash.txt')
    fs.writeFileSync(outside, 'secret')
    tempRoots.push(outside)

    expect(() => resolveLocalProtocolPath('local://..\\outside-backslash.txt', userData)).toThrow('Path outside userData')
  })

  it('rejects a symlink or junction inside userData that resolves outside userData', () => {
    const root = makeTempRoot()
    const userData = path.join(root, 'userData')
    const outside = path.join(root, 'outside')
    fs.mkdirSync(userData)
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    makeDirLink(outside, path.join(userData, 'linked-outside'))

    expect(() => resolveLocalProtocolPath('local://linked-outside/secret.txt', userData)).toThrow('Path outside userData')
  })

  it('allows a symlink or junction that resolves to a real file inside userData', () => {
    const userData = makeTempRoot()
    const realDir = path.join(userData, 'real')
    fs.mkdirSync(realDir)
    const file = path.join(realDir, 'ok.txt')
    fs.writeFileSync(file, 'ok')
    makeDirLink(realDir, path.join(userData, 'linked-inside'))

    expect(resolveLocalProtocolPath('local://linked-inside/ok.txt', userData)).toBe(fs.realpathSync.native(file))
  })

  it('compares Windows paths case-insensitively', () => {
    expect(isPathInside('C:\\Users\\Tester\\AppData\\Roaming\\MindDiary\\attachments\\a.png', 'c:\\users\\tester\\appdata\\roaming\\minddiary', {
      pathModule: path.win32,
      platform: 'win32',
    })).toBe(true)
  })
})
