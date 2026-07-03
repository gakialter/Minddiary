// @vitest-environment node

import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userDataPath: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userDataPath },
}))

function makeDirLink(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('managed mistake image deletion', () => {
  let userDataPath: string

  beforeEach(() => {
    vi.resetModules()
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-mistake-images-'))
    electronState.userDataPath = userDataPath
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  const loadMistakeImageStorage = async () => await import('../electron/mistakeImageStorage')

  it('deletes a normal file inside the managed mistake image directory', async () => {
    const managedPath = path.join(userDataPath, 'mistake_images')
    const imagePath = path.join(managedPath, 'normal.png')
    fs.mkdirSync(managedPath, { recursive: true })
    fs.writeFileSync(imagePath, 'image')
    const storage = await loadMistakeImageStorage()

    await expect(storage.deleteManagedMistakeImage('mistake_images/normal.png')).resolves.toBeUndefined()

    expect(fs.existsSync(imagePath)).toBe(false)
  })

  it('does not delete an outside file through a junction inside mistake_images', async () => {
    const managedPath = path.join(userDataPath, 'mistake_images')
    const outsidePath = path.join(userDataPath, 'outside-mistake-images')
    const sentinelPath = path.join(outsidePath, 'sentinel.png')
    fs.mkdirSync(managedPath, { recursive: true })
    fs.mkdirSync(outsidePath, { recursive: true })
    fs.writeFileSync(sentinelPath, 'keep')
    makeDirLink(outsidePath, path.join(managedPath, 'escape'))
    const storage = await loadMistakeImageStorage()

    await expect(storage.deleteManagedMistakeImage('mistake_images/escape/sentinel.png')).rejects.toMatchObject({
      code: 'PATH_TRAVERSAL',
      message: 'Invalid image path',
    })

    expect(fs.existsSync(sentinelPath)).toBe(true)
    expect(fs.readFileSync(sentinelPath, 'utf8')).toBe('keep')
  })

  it('keeps a missing target file as a successful no-op', async () => {
    fs.mkdirSync(path.join(userDataPath, 'mistake_images'), { recursive: true })
    const storage = await loadMistakeImageStorage()

    await expect(storage.deleteManagedMistakeImage('mistake_images/missing.png')).resolves.toBeUndefined()
  })

  it('keeps a missing managed directory as a successful no-op', async () => {
    const storage = await loadMistakeImageStorage()

    await expect(storage.deleteManagedMistakeImage('mistake_images/missing.png')).resolves.toBeUndefined()
  })

  it('preserves the existing error shape for a lexical path escape', async () => {
    const storage = await loadMistakeImageStorage()

    await expect(storage.deleteManagedMistakeImage('../outside.png')).rejects.toMatchObject({
      code: 'PATH_TRAVERSAL',
      message: 'Invalid image path',
    })
  })

  it('propagates non-ENOENT realpath failures', async () => {
    const managedPath = path.join(userDataPath, 'mistake_images')
    const imagePath = path.join(managedPath, 'blocked.png')
    fs.mkdirSync(managedPath, { recursive: true })
    fs.writeFileSync(imagePath, 'image')
    const realpathError = Object.assign(new Error('access denied'), { code: 'EACCES' })
    vi.spyOn(fs.promises, 'realpath').mockRejectedValueOnce(realpathError)
    const storage = await loadMistakeImageStorage()

    await expect(storage.deleteManagedMistakeImage('mistake_images/blocked.png')).rejects.toBe(realpathError)
    expect(fs.existsSync(imagePath)).toBe(true)
  })
})
