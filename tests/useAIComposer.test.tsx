// @vitest-environment jsdom

import { act, render, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAIComposer, type AITextDraft, type AITextDraftBinding } from '../src/hooks/useAIComposer'
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
  it.each([false, true])('UX-04 preserves an ABA text edit against a stale success with app binding=%s', bound => {
    const { result } = renderHook(() => {
      const [draft, setDraft] = useState<AITextDraft>({ text: '', revision: 0 })
      return useAIComposer(bound ? { draft, setDraft } : undefined)
    })
    act(() => result.current.setInput('submitted text'))
    const sentRevision = result.current.inputRevision
    act(() => result.current.setInput('newer text'))
    act(() => result.current.setInput('submitted text'))
    expect(result.current.inputRevision).toBeGreaterThan(sentRevision)
    act(() => result.current.clearSentDraft('submitted text', [], sentRevision))
    expect(result.current.input).toBe('submitted text')
  })

  it('UX-04 clears only an exact submitted text and revision pair', () => {
    const { result } = renderHook(() => useAIComposer())
    act(() => result.current.setInput('exact submitted text'))
    const sentRevision = result.current.inputRevision
    act(() => result.current.clearSentDraft('different text', [], sentRevision))
    expect(result.current.input).toBe('exact submitted text')
    act(() => result.current.clearSentDraft('exact submitted text', [], sentRevision))
    expect(result.current.input).toBe('')
  })

  it('UX-04 keeps batched functional text edits in order and advances revision for each edit', () => {
    const { result } = renderHook(() => {
      const [draft, setDraft] = useState<AITextDraft>({ text: '', revision: 0 })
      return useAIComposer({ draft, setDraft })
    })
    act(() => {
      result.current.setInput('first')
      result.current.setInput(current => `${current} second`)
      result.current.setInput(current => `${current} third`)
    })
    expect(result.current.input).toBe('first second third')
    expect(result.current.inputRevision).toBe(3)
  })

  it('UX-04 retains only owner text across composer remount and explicit clear updates the owner', async () => {
    let composer!: ReturnType<typeof useAIComposer>
    let ownerDraft!: AITextDraft
    function Composer({ binding }: { binding: AITextDraftBinding }) {
      composer = useAIComposer(binding)
      return null
    }
    function Owner({ active }: { active: boolean }) {
      const [draft, setDraft] = useState<AITextDraft>({ text: '', revision: 0 })
      ownerDraft = draft
      return active ? <Composer binding={{ draft, setDraft }} /> : null
    }
    const view = render(<Owner active />)
    await act(async () => {
      composer.setInput('Retained owner text')
      composer.setContextKinds(['mistake-patterns'])
      composer.setError('Ephemeral request error')
      await composer.addFiles([makeImage('page-only.png')])
    })
    expect(composer.attachments).toHaveLength(1)
    const revisionBeforeNavigation = ownerDraft.revision
    view.rerender(<Owner active={false} />)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:page-only.png')
    view.rerender(<Owner active />)
    expect(composer.input).toBe('Retained owner text')
    expect(composer.inputRevision).toBe(revisionBeforeNavigation)
    expect(composer.contextKinds).toEqual([])
    expect(composer.attachments).toEqual([])
    expect(composer.error).toBeNull()
    act(() => composer.clearComposer())
    expect(ownerDraft.text).toBe('')
    view.rerender(<Owner active={false} />)
    view.rerender(<Owner active />)
    expect(composer.input).toBe('')
    view.unmount()
    render(<Owner active />)
    expect(ownerDraft).toEqual({ text: '', revision: 0 })
  })

  it('UX-04 discards a pending attachment after composer unmount and stops the remaining batch', async () => {
    const deferred = createDeferred<AIComposerAttachment>()
    const firstFile = makeImage('late-page-only.png')
    readerMocks.readAIComposerFile.mockReturnValueOnce(deferred.promise)
    const { result, unmount } = renderHook(() => useAIComposer())
    let pending!: Promise<void>
    act(() => { pending = result.current.addFiles([firstFile, makeImage('never-read.png')]) })
    unmount()
    await act(async () => {
      deferred.resolve(makeReadyAttachment(firstFile))
      await pending
    })
    expect(readerMocks.readAIComposerFile).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:late-page-only.png')
    const remounted = renderHook(() => useAIComposer())
    expect(remounted.result.current.attachments).toEqual([])
  })

  it('removes only the deleted attachment error and preserves other file and request errors', async () => {
    readerMocks.readAIComposerFile.mockImplementation(async (file: File, _existing: AIComposerAttachment[], id?: string) => ({
      ...makeReadyAttachment(file, id), kind: 'pdf', status: 'error', error: `failure ${file.name}`,
    }))
    const { result } = renderHook(() => useAIComposer())
    await act(async () => { await result.current.addFiles([makeImage('one.pdf'), makeImage('two.pdf')]) })
    expect(result.current.error).toContain('one.pdf')
    act(() => result.current.removeAttachment('pending-one.pdf'))
    expect(result.current.error).toContain('two.pdf')
    act(() => { result.current.setError('real request error'); result.current.removeAttachment('pending-two.pdf') })
    expect(result.current.error).toBe('real request error')
    act(() => { result.current.setError(null); result.current.setInput('text question') })
    expect(result.current.error).toBeNull()
    expect(result.current.canSendContent).toBe(true)
  })
  it('clears only the sent draft and preserves text and images added while awaiting the reply', async () => {
    const { result } = renderHook(() => useAIComposer())
    await act(async () => { result.current.setInput('sent question'); await result.current.addFiles([makeImage('sent.png')]) })
    await act(async () => { result.current.setInput('next question'); await result.current.addFiles([makeImage('next.png')]) })
    act(() => result.current.clearSentDraft('sent question', ['pending-sent.png']))
    expect(result.current.input).toBe('next question')
    expect(result.current.attachments.map(item => item.name)).toEqual(['next.png'])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:sent.png')
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:next.png')
  })
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
