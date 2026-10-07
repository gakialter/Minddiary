// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { AI_ATTACHMENT_LIMITS } from '../src/utils/aiAttachmentPolicy'
import { readAIComposerFile } from '../src/utils/aiAttachmentReader'

type UrlWithObjectMethods = typeof URL & {
  createObjectURL?: (obj: Blob | MediaSource) => string
  revokeObjectURL?: (url: string) => void
}

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  globalWorkerOptions: { workerSrc: '' },
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: pdfMocks.globalWorkerOptions,
  getDocument: pdfMocks.getDocument,
}))

const originalCreateObjectURL = (globalThis.URL as UrlWithObjectMethods).createObjectURL
const originalRevokeObjectURL = (globalThis.URL as UrlWithObjectMethods).revokeObjectURL

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
])
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

const makeFile = (name: string, type: string, bytes: Uint8Array | string): File =>
  new File([typeof bytes === 'string' ? bytes : toArrayBuffer(bytes)], name, { type })

const makePdfFile = () => makeFile('paper.pdf', 'application/pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46]))

beforeEach(() => {
  const urlGlobal = globalThis.URL as UrlWithObjectMethods
  urlGlobal.createObjectURL = vi.fn(() => 'blob:attachment-preview')
  urlGlobal.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  pdfMocks.globalWorkerOptions.workerSrc = ''

  const urlGlobal = globalThis.URL as UrlWithObjectMethods
  if (originalCreateObjectURL) {
    urlGlobal.createObjectURL = originalCreateObjectURL
  } else {
    // @ts-ignore
    delete urlGlobal.createObjectURL
  }

  if (originalRevokeObjectURL) {
    urlGlobal.revokeObjectURL = originalRevokeObjectURL
  } else {
    // @ts-ignore
    delete urlGlobal.revokeObjectURL
  }
})

describe('AI attachment reader', () => {
  it('reads PNG, JPEG, and WebP images as data URLs with local preview URLs', async () => {
    const png = await readAIComposerFile(makeFile('photo.png', 'image/png', pngBytes), [])
    const jpeg = await readAIComposerFile(makeFile('photo.jpg', 'image/jpeg', jpegBytes), [])
    const webp = await readAIComposerFile(makeFile('photo.webp', 'image/webp', webpBytes), [])

    expect(png).toMatchObject({ kind: 'image', status: 'ready', previewUrl: 'blob:attachment-preview' })
    expect(jpeg.status).toBe('ready')
    expect(webp.status).toBe('ready')
    expect(png.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('rejects unsupported or spoofed image files before send', async () => {
    const spoofed = await readAIComposerFile(makeFile('fake.png', 'image/png', new Uint8Array([1, 2, 3])), [])
    const gif = await readAIComposerFile(makeFile('animated.gif', 'image/gif', new Uint8Array([0x47, 0x49, 0x46])), [])

    expect(spoofed).toMatchObject({ kind: 'image', status: 'error' })
    expect(gif).toMatchObject({ kind: 'text-file', status: 'error' })
  })

  it('decodes UTF-8 text files, strips BOM, and rejects empty or binary-looking content', async () => {
    const text = await readAIComposerFile(makeFile('notes.md', 'text/markdown', new Uint8Array([0xef, 0xbb, 0xbf, 72, 105])), [])
    const empty = await readAIComposerFile(makeFile('empty.txt', 'text/plain', ''), [])
    const nul = await readAIComposerFile(makeFile('binary.txt', 'text/plain', new Uint8Array([65, 0, 66])), [])
    const controls = await readAIComposerFile(makeFile('controls.txt', 'text/plain', new Uint8Array([1, 1, 1, 65])), [])

    expect(text).toMatchObject({
      kind: 'text-file',
      status: 'ready',
      extractedText: 'Hi',
      truncated: false,
    })
    expect(empty.status).toBe('error')
    expect(nul.status).toBe('error')
    expect(controls.status).toBe('error')
  })

  it('extracts local text PDF content through the bundled worker path', async () => {
    const destroy = vi.fn(async () => undefined)
    const getPage = vi.fn(async (pageNumber: number) => ({
      getTextContent: vi.fn(async () => ({
        items: pageNumber === 1 ? [{ str: 'First page' }] : [{ str: 'Second page' }],
      })),
    }))
    pdfMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve({ numPages: 2, getPage }),
      destroy,
    })

    const result = await readAIComposerFile(makePdfFile(), [])

    expect(result).toMatchObject({
      kind: 'pdf',
      status: 'ready',
      pageCount: 2,
      extractedText: 'First page\n\nSecond page',
    })
    expect(pdfMocks.globalWorkerOptions.workerSrc).toBe(pdfWorkerUrl)
    expect(pdfMocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.any(Uint8Array),
      cMapUrl: new URL('./pdfjs/cmaps/', document.baseURI).href,
      cMapPacked: true,
      disableFontFace: true,
      disableAutoFetch: true,
      disableStream: true,
    }))
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['http://localhost:5173/', 'http://localhost:5173/pdfjs/cmaps/'],
    ['file:///C:/MindDiary/dist/index.html', 'file:///C:/MindDiary/dist/pdfjs/cmaps/'],
    ['file:///C:/Program%20Files/MindDiary/resources/app.asar/dist/index.html', 'file:///C:/Program%20Files/MindDiary/resources/app.asar/dist/pdfjs/cmaps/'],
  ])('uses the fixed bundled CMap directory from %s', async (documentUrl, cMapUrl) => {
    vi.spyOn(document, 'baseURI', 'get').mockReturnValue(documentUrl)
    pdfMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve({ numPages: 1, getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: '星河计划编号 7319' }] }),
      }) }), destroy: vi.fn(async () => undefined),
    })
    const result = await readAIComposerFile(makePdfFile(), [])
    expect(pdfMocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({ cMapUrl, cMapPacked: true }))
    expect(pdfMocks.globalWorkerOptions.workerSrc).toBe(pdfWorkerUrl)
    expect(result).toMatchObject({ status: 'ready', extractedText: '星河计划编号 7319' })
    expect(result).not.toHaveProperty('data')
    expect(result).not.toHaveProperty('dataUrl')
    expect(result).not.toHaveProperty('cMapUrl')
  })

  it('rejects a PDF over the byte limit before invoking PDF.js', async () => {
    const file = makePdfFile()
    Object.defineProperty(file, 'size', { value: AI_ATTACHMENT_LIMITS.maxPdfBytes + 1 })
    const result = await readAIComposerFile(file, [])
    expect(result.status).toBe('error')
    expect(pdfMocks.getDocument).not.toHaveBeenCalled()
  })

  it('rejects scanned or oversized PDFs and still destroys the loading task', async () => {
    const scannedDestroy = vi.fn(async () => undefined)
    pdfMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getTextContent: vi.fn(async () => ({ items: [] })),
        })),
      }),
      destroy: scannedDestroy,
    })

    const scanned = await readAIComposerFile(makePdfFile(), [])
    expect(scanned).toMatchObject({ kind: 'pdf', status: 'error' })
    expect(scanned.error).toBe('未检测到可读取文字，当前不支持扫描版 PDF。')
    expect(scannedDestroy).toHaveBeenCalledTimes(1)

    const tooManyPagesDestroy = vi.fn(async () => undefined)
    pdfMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve({
        numPages: AI_ATTACHMENT_LIMITS.maxPdfPages + 1,
        getPage: vi.fn(),
      }),
      destroy: tooManyPagesDestroy,
    })

    const tooManyPages = await readAIComposerFile(makePdfFile(), [])
    expect(tooManyPages).toMatchObject({ kind: 'pdf', status: 'error' })
    expect(tooManyPages.error).toContain(String(AI_ATTACHMENT_LIMITS.maxPdfPages))
    expect(tooManyPagesDestroy).toHaveBeenCalledTimes(1)
  })

  it('counts pages with extractable text and retains over-budget text for explicit send rejection', async () => {
    pdfMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve({ numPages: 2, getPage: async (page: number) => ({
        getTextContent: async () => ({ items: page === 1 ? [{ str: 'a'.repeat(20_001) }] : [{ str: '  ' }] }),
      }) }), destroy: vi.fn(async () => undefined),
    })
    const result = await readAIComposerFile(makePdfFile(), [])
    expect(result).toMatchObject({ status: 'ready', textPageCount: 1, pageCount: 2, truncated: false })
    expect(result.extractedText).toHaveLength(20_001)
    expect(result.dataUrl).toBeUndefined()
    expect(result.previewUrl).toBeUndefined()
  })

  it.each(['Invalid PDF structure', 'Password required'])('keeps PDF load failure closed: %s', async message => {
    const destroy = vi.fn(async () => undefined)
    pdfMocks.getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error(message)), destroy })
    const result = await readAIComposerFile(makePdfFile(), [])
    expect(result).toMatchObject({ status: 'error', error: message })
    expect(result.extractedText).toBeUndefined()
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
