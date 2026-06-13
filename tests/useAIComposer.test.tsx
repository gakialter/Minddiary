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

const makeImage = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' })

describe('useAIComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readerMocks.readAIComposerFile.mockImplementation(async (file: File, _existing: AIComposerAttachment[], id?: string) => ({
      id: id || file.name,
      kind: 'image',
      name: file.name,
      mimeType: file.type,
      size: file.size,
      status: 'ready',
      previewUrl: `blob:${file.name}`,
      dataUrl: `data:image/png;base64,${file.name}`,
      reusable: true,
    }))
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
})
