import fs from 'fs'
import Module from 'module'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ModuleWithLoad = typeof Module & {
  _load: (request: string, parent: { filename?: string } | null, isMain: boolean) => unknown
}

function makeDirLink(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('file manager storage', () => {
  const moduleWithLoad = Module as ModuleWithLoad
  const originalLoad = moduleWithLoad._load
  const submit = vi.fn().mockResolvedValue(undefined)
  const database = {
    getAttachmentById: vi.fn(),
    getAttachmentsByEntry: vi.fn(),
    removeAttachment: vi.fn(),
  }
  const logger = { error: vi.fn() }
  let userDataPath: string

  beforeEach(() => {
    vi.resetModules()
    submit.mockClear()
    database.getAttachmentById.mockReset()
    database.getAttachmentsByEntry.mockReset()
    database.removeAttachment.mockReset()
    logger.error.mockReset()
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-file-manager-'))
    moduleWithLoad._load = ((request: string, parent: { filename?: string } | null, isMain: boolean) => {
      if (request === 'electron') {
        return { app: { getPath: () => userDataPath } }
      }
      if (request === './database' && parent?.filename?.endsWith('fileManager.ts')) {
        return database
      }
      if (request === './imageWorkerPool' && parent?.filename?.endsWith('fileManager.ts')) {
        return { initialize: vi.fn(), submit }
      }
      if (request === './logger' && parent?.filename?.endsWith('fileManager.ts')) {
        return { logger }
      }
      return originalLoad(request, parent, isMain)
    }) as ModuleWithLoad['_load']
  })

  afterEach(() => {
    moduleWithLoad._load = originalLoad
    vi.restoreAllMocks()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  const loadFileManager = async () => await import('../electron/fileManager') as unknown as {
    saveMistakeImage: (data: { data: string; ext: string; mimetype?: string }) => Promise<string>
    deleteAttachment: (id: number) => Promise<{ success: boolean }>
    deleteAttachmentsForEntry: (entryId: number) => Promise<{ deleted: number; errors: number }>
  }

  it('generates distinct paths for rapid uploads even when Date.now collides', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456789)
    const fileManager = await loadFileManager()

    const [first, second] = await Promise.all([
      fileManager.saveMistakeImage({ data: 'aW1hZ2U=', ext: '.png', mimetype: 'image/png' }),
      fileManager.saveMistakeImage({ data: 'aW1hZ2U=', ext: '.png', mimetype: 'image/png' }),
    ])

    expect(first).not.toBe(second)
    expect(first).toMatch(/^mistake_images\/mistake_123456789_[a-f0-9-]+\.png$/)
    expect(second).toMatch(/^mistake_images\/mistake_123456789_[a-f0-9-]+\.png$/)
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('enforces the decoded 10 MB boundary and supported MIME types before writing', async () => {
    const fileManager = await loadFileManager()
    const atLimit = Buffer.alloc(10 * 1024 * 1024).toString('base64')
    const overLimit = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')

    await expect(fileManager.saveMistakeImage({ data: atLimit, ext: '.png', mimetype: 'image/png' })).resolves.toMatch(/\.png$/)
    await expect(fileManager.saveMistakeImage({ data: overLimit, ext: '.png', mimetype: 'image/png' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    await expect(fileManager.saveMistakeImage({ data: 'aW1hZ2U=', ext: '.svg', mimetype: 'image/svg+xml' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE_FORMAT',
    })
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('does not unlink outside the attachments directory for a malicious attachment row', async () => {
    const outsidePath = path.join(userDataPath, 'outside.txt')
    fs.writeFileSync(outsidePath, 'keep')
    database.getAttachmentById.mockReturnValue({ id: 7, filepath: '../outside.txt' })
    const unlink = vi.spyOn(fs.promises, 'unlink')
    const fileManager = await loadFileManager()

    await expect(fileManager.deleteAttachment(7)).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' })

    expect(unlink).not.toHaveBeenCalled()
    expect(fs.readFileSync(outsidePath, 'utf8')).toBe('keep')
    expect(database.removeAttachment).not.toHaveBeenCalled()
  })

  it('does not unlink outside the attachments directory when deleting entry attachments', async () => {
    const outsidePath = path.join(userDataPath, 'outside.txt')
    fs.writeFileSync(outsidePath, 'keep')
    database.getAttachmentsByEntry.mockReturnValue([{ id: 8, filepath: '..\\outside.txt' }])
    const unlink = vi.spyOn(fs.promises, 'unlink')
    const fileManager = await loadFileManager()

    await expect(fileManager.deleteAttachmentsForEntry(3)).resolves.toEqual({ deleted: 0, errors: 1 })

    expect(unlink).not.toHaveBeenCalled()
    expect(fs.readFileSync(outsidePath, 'utf8')).toBe('keep')
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('attachment id=8'),
      expect.stringContaining('Invalid attachment path'),
    )
  })

  it('still deletes a valid legacy attachment filepath', async () => {
    const attachmentsPath = path.join(userDataPath, 'attachments')
    const attachmentPath = path.join(attachmentsPath, 'abc.png')
    fs.mkdirSync(attachmentsPath, { recursive: true })
    fs.writeFileSync(attachmentPath, 'image')
    database.getAttachmentById.mockReturnValue({ id: 9, filepath: 'abc.png' })
    const fileManager = await loadFileManager()

    await expect(fileManager.deleteAttachment(9)).resolves.toEqual({ success: true })

    expect(fs.existsSync(attachmentPath)).toBe(false)
    expect(database.removeAttachment).toHaveBeenCalledWith(9)
  })

  it('does not delete an outside file through a junction inside the attachments directory', async () => {
    const attachmentsPath = path.join(userDataPath, 'attachments')
    const outsidePath = path.join(userDataPath, 'outside-attachments')
    const sentinelPath = path.join(outsidePath, 'sentinel.txt')
    fs.mkdirSync(attachmentsPath, { recursive: true })
    fs.mkdirSync(outsidePath, { recursive: true })
    fs.writeFileSync(sentinelPath, 'keep')
    makeDirLink(outsidePath, path.join(attachmentsPath, 'escape'))
    database.getAttachmentById.mockReturnValue({ id: 10, filepath: 'escape/sentinel.txt' })
    const fileManager = await loadFileManager()

    await expect(fileManager.deleteAttachment(10)).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' })

    expect(fs.existsSync(sentinelPath)).toBe(true)
    expect(fs.readFileSync(sentinelPath, 'utf8')).toBe('keep')
    expect(database.removeAttachment).not.toHaveBeenCalled()
  })

  it('does not delete an outside file through a junction during entry attachment cleanup', async () => {
    const attachmentsPath = path.join(userDataPath, 'attachments')
    const outsidePath = path.join(userDataPath, 'outside-entry-attachments')
    const sentinelPath = path.join(outsidePath, 'sentinel.txt')
    fs.mkdirSync(attachmentsPath, { recursive: true })
    fs.mkdirSync(outsidePath, { recursive: true })
    fs.writeFileSync(sentinelPath, 'keep')
    makeDirLink(outsidePath, path.join(attachmentsPath, 'escape'))
    database.getAttachmentsByEntry.mockReturnValue([{ id: 11, filepath: 'escape/sentinel.txt' }])
    const fileManager = await loadFileManager()

    await expect(fileManager.deleteAttachmentsForEntry(4)).resolves.toEqual({ deleted: 0, errors: 1 })

    expect(fs.existsSync(sentinelPath)).toBe(true)
    expect(fs.readFileSync(sentinelPath, 'utf8')).toBe('keep')
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('attachment id=11'),
      expect.stringContaining('Invalid attachment path'),
    )
  })

  it('keeps missing attachment files compatible with record cleanup', async () => {
    fs.mkdirSync(path.join(userDataPath, 'attachments'), { recursive: true })
    database.getAttachmentById.mockReturnValue({ id: 12, filepath: 'missing.png' })
    const fileManager = await loadFileManager()

    await expect(fileManager.deleteAttachment(12)).resolves.toEqual({ success: true })

    expect(database.removeAttachment).toHaveBeenCalledWith(12)
  })

  it('counts missing entry attachment files as successfully cleaned up', async () => {
    fs.mkdirSync(path.join(userDataPath, 'attachments'), { recursive: true })
    database.getAttachmentsByEntry.mockReturnValue([{ id: 13, filepath: 'missing.png' }])
    const fileManager = await loadFileManager()

    await expect(fileManager.deleteAttachmentsForEntry(5)).resolves.toEqual({ deleted: 1, errors: 0 })
  })
})
