import Module from 'module'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ModuleWithLoad = typeof Module & {
  _load: (request: string, parent: { filename?: string } | null, isMain: boolean) => unknown
}

describe('mistake image file storage', () => {
  const moduleWithLoad = Module as ModuleWithLoad
  const originalLoad = moduleWithLoad._load
  const submit = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.resetModules()
    submit.mockClear()
    moduleWithLoad._load = ((request: string, parent: { filename?: string } | null, isMain: boolean) => {
      if (request === 'electron') {
        return { app: { getPath: () => path.join(os.tmpdir(), 'minddiary-file-manager-test') } }
      }
      if (request === './database' && parent?.filename?.endsWith('fileManager.ts')) {
        return {}
      }
      if (request === './imageWorkerPool' && parent?.filename?.endsWith('fileManager.ts')) {
        return { initialize: vi.fn(), submit }
      }
      if (request === './logger' && parent?.filename?.endsWith('fileManager.ts')) {
        return { logger: { error: vi.fn() } }
      }
      return originalLoad(request, parent, isMain)
    }) as ModuleWithLoad['_load']
  })

  afterEach(() => {
    moduleWithLoad._load = originalLoad
    vi.restoreAllMocks()
  })

  const loadFileManager = async () => await import('../electron/fileManager') as unknown as {
    saveMistakeImage: (data: { data: string; ext: string; mimetype?: string }) => Promise<string>
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
})
