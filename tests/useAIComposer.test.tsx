// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAIComposer } from '../src/hooks/useAIComposer'
import type { AIComposerAttachment } from '../src/utils/aiAttachmentPolicy'
import { readAIComposerFile } from '../src/utils/aiAttachmentReader'

const readerMocks = vi.hoisted(() => ({
  readAIComposerFile: vi.fn(),
  createReadingAIComposerAttachment: vi.fn((file: File): AIComposerAttachment => ({
    id: `pending-${file.name}`,
    kind: 'image',
    name: file.name,
    mimeType: file.type,
    size: file.size,
    status: 'reading',
    reusable: true,
  })),
}))

vi.mock('../src/utils/aiAttachmentReader', () => ({
  createReadingAIComposerAttachment: readerMocks.createReadingAIComposerAttachment,
  readAIComposerFile: readerMocks.readAIComposerFile,
}))

const makeImage = (name: string, size = 1) => (
  new File([new Uint8Array(size)], name, { type: 'image/png' })
)

const makeReadyAttachment = (file: File, id = `pending-${file.name}`): AIComposerAttachment => ({
  id,
  kind: 'image',
  name: file.name,
  mimeType: file.type,
  size: file.size,
  status: 'ready',
  previewUrl: `blob:${file.name}`,
  dataUrl: `data:image/png;base64,${file.name}`,
  reusable: true,
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useAIComposer', () => {
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    })
    readerMocks.readAIComposerFile.mockImplementation(async (file: File, _existing: AIComposerAttachment[], id?: string) => (
      makeReadyAttachment(file, id)
    ))
  })

  it('validates batch file additions against attachments already accepted earlier in the same batch', async () => {
    const { result } = renderHook(() => useAIComposer())

    await act(async () => {
      await result.current.addFiles([makeImage('one.png'), makeImage('two.png')])
    })

    expect(readAIComposerFile).toHaveBeenCalledTimes(2)
    expect(readerMocks.readAIComposerFile.mock.calls[0]?.[1]).toHaveLength(0)
    expect(readerMocks.readAIComposerFile.mock.calls[1]?.[1]).toEqual([
      expect.objectContaining({ name: 'one.png', status: 'ready' }),
    ])
    expect(result.current.attachments.map(attachment => attachment.name)).toEqual(['one.png', 'two.png'])
  })

  it('does not revive a removed attachment when another file is added', async () => {
    const { result } = renderHook(() => useAIComposer())

    await act(async () => {
      await result.current.addFiles([makeImage('one.png')])
    })
    act(() => {
      result.current.removeAttachment('pending-one.png')
    })
    await act(async () => {
      await result.current.addFiles([makeImage('two.png')])
    })

    expect(result.current.attachments.map(attachment => attachment.name)).toEqual(['two.png'])
    expect(readerMocks.readAIComposerFile.mock.calls[1]?.[1]).toHaveLength(0)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one.png')
  })

  it('does not revive cleared attachments when another file is added', async () => {
    const { result } = renderHook(() => useAIComposer())

    await act(async () => {
      await result.current.addFiles([makeImage('one.png')])
    })
    act(() => {
      result.current.clearComposer()
    })
    await act(async () => {
      await result.current.addFiles([makeImage('two.png')])
    })

    expect(result.current.attachments.map(attachment => attachment.name)).toEqual(['two.png'])
    expect(readerMocks.readAIComposerFile.mock.calls[1]?.[1]).toHaveLength(0)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one.png')
  })

  it('keeps only new attachments after the successful-send clear path', async () => {
    const { result } = renderHook(() => useAIComposer())

    act(() => {
      result.current.setInput('draft')
    })
    await act(async () => {
      await result.current.addFiles([makeImage('sent.png')])
    })
    act(() => {
      result.current.clearComposer()
    })
    await act(async () => {
      await result.current.addFiles([makeImage('next.png')])
    })

    expect(result.current.input).toBe('')
    expect(result.current.attachments.map(attachment => attachment.name)).toEqual(['next.png'])
    expect(readerMocks.readAIComposerFile.mock.calls[1]?.[1]).toHaveLength(0)
  })

  it('does not reinsert an attachment removed while it is still reading', async () => {
    const { result } = renderHook(() => useAIComposer())
    const file = makeImage('slow.png')
    const deferred = createDeferred<AIComposerAttachment>()
    readerMocks.readAIComposerFile.mockReturnValueOnce(deferred.promise)

    let addPromise!: Promise<void>
    await act(async () => {
      addPromise = result.current.addFiles([file])
      await Promise.resolve()
    })
    expect(result.current.attachments).toEqual([
      expect.objectContaining({ id: 'pending-slow.png', status: 'reading' }),
    ])

    act(() => {
      result.current.removeAttachment('pending-slow.png')
    })
    await act(async () => {
      deferred.resolve(makeReadyAttachment(file, 'pending-slow.png'))
      await addPromise
    })

    expect(result.current.attachments).toEqual([])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:slow.png')
  })

  it('does not count removed attachments against later attachment limits', async () => {
    readerMocks.readAIComposerFile.mockImplementation(async (file: File, existing: AIComposerAttachment[], id?: string) => {
      const existingImages = existing.filter(attachment => attachment.kind === 'image')
      if (existingImages.length >= 3) {
        return {
          ...makeReadyAttachment(file, id),
          status: 'error',
          error: 'too many images',
        } satisfies AIComposerAttachment
      }
      return makeReadyAttachment(file, id)
    })
    const { result } = renderHook(() => useAIComposer())

    await act(async () => {
      await result.current.addFiles([makeImage('one.png'), makeImage('two.png'), makeImage('three.png')])
    })
    act(() => {
      result.current.removeAttachment('pending-two.png')
    })
    await act(async () => {
      await result.current.addFiles([makeImage('four.png')])
    })

    expect(result.current.attachments.map(attachment => attachment.name)).toEqual([
      'one.png',
      'three.png',
      'four.png',
    ])
    expect(result.current.attachments[result.current.attachments.length - 1]).toEqual(expect.objectContaining({ status: 'ready' }))
    const fourthExistingAttachments = readerMocks.readAIComposerFile.mock.calls[3]?.[1] as AIComposerAttachment[]
    expect(fourthExistingAttachments.map(attachment => attachment.name)).toEqual([
      'one.png',
      'three.png',
    ])
  })
})
