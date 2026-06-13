// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import {
  AI_ATTACHMENT_LIMITS,
  attachmentToMeta,
  getAttachmentPolicyError,
  getReadyAttachmentError,
  revokeAttachmentPreview,
  type AIComposerAttachment,
} from '../src/utils/aiAttachmentPolicy'

const makeFile = (name: string, type: string, size: number): File =>
  new File([new Uint8Array(size)], name, { type })

const makeAttachment = (
  kind: AIComposerAttachment['kind'],
  overrides: Partial<AIComposerAttachment> = {},
): AIComposerAttachment => ({
  id: `${kind}-1`,
  kind,
  name: `${kind}.txt`,
  mimeType: kind === 'image' ? 'image/png' : 'text/plain',
  size: 128,
  status: 'ready',
  reusable: true,
  ...overrides,
})

describe('AI attachment policy', () => {
  it('accepts supported image, text, and PDF file types within limits', () => {
    expect(getAttachmentPolicyError(makeFile('photo.png', 'image/png', 128), [])).toBeNull()
    expect(getAttachmentPolicyError(makeFile('notes.md', 'text/markdown', 128), [])).toBeNull()
    expect(getAttachmentPolicyError(makeFile('paper.pdf', 'application/pdf', 128), [])).toBeNull()
  })

  it('rejects unsupported image formats and fake text extensions', () => {
    expect(getAttachmentPolicyError(makeFile('vector.svg', 'image/svg+xml', 128), [])).toContain('PNG')
    expect(getAttachmentPolicyError(makeFile('animated.gif', 'image/gif', 128), [])).toContain('PNG')
    expect(getAttachmentPolicyError(makeFile('archive.zip', 'application/zip', 128), [])).toContain('TXT')
  })

  it('enforces total attachment, image count, single-size, and total-image-size limits', () => {
    const fiveAttachments = Array.from({ length: AI_ATTACHMENT_LIMITS.maxAttachments }, (_, index) =>
      makeAttachment('text-file', { id: `text-${index}` }),
    )
    expect(getAttachmentPolicyError(makeFile('extra.txt', 'text/plain', 128), fiveAttachments)).toContain('5')

    const threeImages = Array.from({ length: AI_ATTACHMENT_LIMITS.maxImages }, (_, index) =>
      makeAttachment('image', { id: `image-${index}` }),
    )
    expect(getAttachmentPolicyError(makeFile('extra.png', 'image/png', 128), threeImages)).toContain('3')

    expect(
      getAttachmentPolicyError(makeFile('large.png', 'image/png', AI_ATTACHMENT_LIMITS.maxImageBytes + 1), []),
    ).toContain('5.0 MB')

    const existingImages = [
      makeAttachment('image', { id: 'image-a', size: 6 * 1024 * 1024 }),
      makeAttachment('image', { id: 'image-b', size: 4 * 1024 * 1024 }),
    ]
    expect(getAttachmentPolicyError(makeFile('too-much.png', 'image/png', 1), existingImages)).toContain('10.0 MB')
  })

  it('blocks send while attachments are reading, failed, or over extracted text limits', () => {
    expect(getReadyAttachmentError([makeAttachment('text-file', { status: 'reading' })])).toContain('text-file.txt')
    expect(getReadyAttachmentError([makeAttachment('text-file', { status: 'error', error: 'bad file' })])).toContain('bad file')
    expect(getReadyAttachmentError([
      makeAttachment('text-file', { extractedText: 'a'.repeat(AI_ATTACHMENT_LIMITS.maxExtractedTextChars + 1) }),
    ])).toContain(String(AI_ATTACHMENT_LIMITS.maxExtractedTextChars))
  })

  it('persists only attachment metadata and marks it non-reusable', () => {
    const meta = attachmentToMeta(makeAttachment('image', {
      name: 'photo.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      previewUrl: 'blob:photo',
      extractedText: 'hidden',
    }))

    expect(meta).toEqual({
      kind: 'image',
      name: 'photo.png',
      mimeType: 'image/png',
      size: 128,
      reusable: false,
    })
    expect(JSON.stringify(meta)).not.toContain('base64')
    expect(JSON.stringify(meta)).not.toContain('hidden')
  })

  it('revokes only blob preview URLs', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    revokeAttachmentPreview(makeAttachment('image', { previewUrl: 'blob:preview' }))
    revokeAttachmentPreview(makeAttachment('image', { previewUrl: 'data:image/png;base64,AAAA' }))

    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:preview')
  })
})
