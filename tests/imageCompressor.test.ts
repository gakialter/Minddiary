import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressImage, compressImages } from '../src/utils/imageCompressor'

type UrlWithObjectMethods = typeof URL & {
  createObjectURL?: (obj: Blob | MediaSource) => string
  revokeObjectURL?: (url: string) => void
}

type GlobalWithOptionalOffscreenCanvas = typeof globalThis & {
  OffscreenCanvas?: typeof OffscreenCanvas
}

type ImageEventHandler = ((this: GlobalEventHandlers, ev: Event) => unknown) | null
type FileReaderEventHandler = ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null
type CanvasBlobCallback = (blob: Blob | null) => void

const originalImage = globalThis.Image
const originalFileReader = globalThis.FileReader
const originalCreateObjectURL = (globalThis.URL as UrlWithObjectMethods).createObjectURL
const originalRevokeObjectURL = (globalThis.URL as UrlWithObjectMethods).revokeObjectURL
const originalOffscreenCanvas = (globalThis as GlobalWithOptionalOffscreenCanvas).OffscreenCanvas
const originalCreateElement = document.createElement.bind(document)

let mockNaturalWidth = 800
let mockNaturalHeight = 600
let createObjectURLMock: ReturnType<typeof vi.fn>
let revokeObjectURLMock: ReturnType<typeof vi.fn>
let imageConstructorMock: ReturnType<typeof vi.fn>
let fileReaderReadAsDataURLMock: ReturnType<typeof vi.fn>
let createCanvasElementMock: ReturnType<typeof vi.fn>
let getContextMock: ReturnType<typeof vi.fn>
let drawImageMock: ReturnType<typeof vi.fn>
let toBlobMock: ReturnType<typeof vi.fn>
let mockCanvas: HTMLCanvasElement

class MockImage {
  onload: ImageEventHandler = null
  onerror: ImageEventHandler = null
  naturalWidth = mockNaturalWidth
  naturalHeight = mockNaturalHeight
  private source = ''

  constructor() {
    ;(imageConstructorMock as unknown as Function)()
  }

  set src(value: string) {
    this.source = value
    setTimeout(() => {
      if (value === 'blob:error') {
        this.onerror?.call(this as unknown as GlobalEventHandlers, new Event('error'))
        return
      }

      this.onload?.call(this as unknown as GlobalEventHandlers, new Event('load'))
    }, 0)
  }

  get src(): string {
    return this.source
  }
}

class MockFileReader {
  onload: FileReaderEventHandler = null
  onerror: FileReaderEventHandler = null
  result: string | ArrayBuffer | null = null

  readAsDataURL(blob: Blob): void {
    ;(fileReaderReadAsDataURLMock as unknown as Function)(blob)
    this.result = 'data:image/png;base64,mockBase64'

    setTimeout(() => {
      this.onload?.call(this as unknown as FileReader, new ProgressEvent('load') as ProgressEvent<FileReader>)
    }, 0)
  }
}

const makeFile = (name: string, type: string, sizeKB: number): File =>
  new File([new Uint8Array(sizeKB * 1024)], name, { type })

const installBrowserMocks = (): void => {
  mockNaturalWidth = 800
  mockNaturalHeight = 600

  createObjectURLMock = vi.fn((blob: Blob | MediaSource) => {
    if (blob instanceof File && blob.name.includes('decode-error')) {
      return 'blob:error'
    }

    return 'blob:mock'
  })
  revokeObjectURLMock = vi.fn()
  imageConstructorMock = vi.fn()
  fileReaderReadAsDataURLMock = vi.fn()
  drawImageMock = vi.fn()
  getContextMock = vi.fn((contextId: string) => {
    if (contextId !== '2d') return null
    return { drawImage: drawImageMock }
  })
  toBlobMock = vi.fn((callback: CanvasBlobCallback, type?: string, _quality?: number) => {
    callback(new Blob(['mock data'], { type: type ?? 'image/png' }))
  })

  mockCanvas = {
    width: 0,
    height: 0,
    getContext: getContextMock,
    toBlob: toBlobMock,
  } as unknown as HTMLCanvasElement

  createCanvasElementMock = vi.fn(() => mockCanvas)

  const urlGlobal = globalThis.URL as UrlWithObjectMethods
  urlGlobal.createObjectURL = createObjectURLMock as (obj: Blob | MediaSource) => string
  urlGlobal.revokeObjectURL = revokeObjectURLMock as (url: string) => void

  globalThis.Image = MockImage as unknown as typeof Image
  globalThis.FileReader = MockFileReader as unknown as typeof FileReader
  // @ts-ignore
  delete (globalThis as GlobalWithOptionalOffscreenCanvas).OffscreenCanvas

  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName.toLowerCase() === 'canvas') {
      return (createCanvasElementMock as unknown as Function)() as HTMLCanvasElement
    }

    return originalCreateElement(tagName)
  }) as typeof document.createElement)
}

beforeEach(() => {
  installBrowserMocks()
})

afterEach(() => {
  vi.restoreAllMocks()

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

  globalThis.Image = originalImage
  globalThis.FileReader = originalFileReader

  if (originalOffscreenCanvas) {
    ;(globalThis as GlobalWithOptionalOffscreenCanvas).OffscreenCanvas = originalOffscreenCanvas
  } else {
    // @ts-ignore
    delete (globalThis as GlobalWithOptionalOffscreenCanvas).OffscreenCanvas
  }
})

describe('compressImage', () => {
  it('skips compression for small PNG files and reads the original file as base64', async () => {
    const file = makeFile('small.png', 'image/png', 128)

    const result = await compressImage(file, { maxSizeKB: 128 })

    expect(result).toEqual({
      blob: file,
      base64: 'mockBase64',
      width: 0,
      height: 0,
      originalSizeKB: 128,
      compressedSizeKB: 128,
      skipped: true,
    })
    expect(fileReaderReadAsDataURLMock).toHaveBeenCalledWith(file)
    expect(imageConstructorMock).not.toHaveBeenCalled()
    expect(createObjectURLMock).not.toHaveBeenCalled()
    expect(createCanvasElementMock).not.toHaveBeenCalled()
    expect(drawImageMock).not.toHaveBeenCalled()
    expect(toBlobMock).not.toHaveBeenCalled()
  })

  it('scales oversized images to fit within maxWidth while preserving aspect ratio', async () => {
    mockNaturalWidth = 2560
    mockNaturalHeight = 1440
    const file = makeFile('large.jpg', 'image/jpeg', 640)

    const result = await compressImage(file, { maxWidth: 1280, maxHeight: 1280 })

    expect(result.width).toBe(1280)
    expect(result.height).toBe(720)
    expect(mockCanvas.width).toBe(1280)
    expect(mockCanvas.height).toBe(720)
    expect(drawImageMock).toHaveBeenCalledWith(
      expect.objectContaining({ naturalWidth: 2560, naturalHeight: 1440 }),
      0,
      0,
      1280,
      720,
    )
  })

  it('runs JPEG files through decode, fit, draw, blob export, and base64 conversion', async () => {
    const file = makeFile('photo.jpg', 'image/jpeg', 640)

    const result = await compressImage(file, { quality: 0.7, maxSizeKB: 512 })

    expect(createObjectURLMock).toHaveBeenCalledWith(file)
    expect(imageConstructorMock).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock')
    expect(createCanvasElementMock).toHaveBeenCalledTimes(1)
    expect(getContextMock).toHaveBeenCalledWith('2d')
    expect(drawImageMock).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 800, 600)
    expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.7)
    expect(fileReaderReadAsDataURLMock).toHaveBeenCalledWith(result.blob)
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.base64).toBe('mockBase64')
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    expect(result.skipped).toBeUndefined()
  })

  it('throws a decode error when Image loading fails', async () => {
    const file = makeFile('decode-error.jpg', 'image/jpeg', 640)

    await expect(compressImage(file)).rejects.toThrow('Cannot decode image: decode-error.jpg')
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:error')
    expect(createCanvasElementMock).not.toHaveBeenCalled()
    expect(drawImageMock).not.toHaveBeenCalled()
  })

  it('uses OffscreenCanvas when it is available', async () => {
    const offscreenDrawImageMock = vi.fn()
    const convertToBlobMock = vi.fn(async (options: ImageEncodeOptions) =>
      new Blob(['offscreen data'], { type: options.type }),
    )

    class MockOffscreenCanvas {
      width: number
      height: number

      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }

      getContext(contextId: string): { drawImage: typeof offscreenDrawImageMock } | null {
        if (contextId !== '2d') return null
        return { drawImage: offscreenDrawImageMock }
      }

      convertToBlob = convertToBlobMock
    }

    ;(globalThis as GlobalWithOptionalOffscreenCanvas).OffscreenCanvas =
      MockOffscreenCanvas as unknown as typeof OffscreenCanvas

    const file = makeFile('offscreen.jpg', 'image/jpeg', 640)

    const result = await compressImage(file, { quality: 0.5 })

    expect(createCanvasElementMock).not.toHaveBeenCalled()
    expect(offscreenDrawImageMock).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 800, 600)
    expect(convertToBlobMock).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.5 })
    expect(result.base64).toBe('mockBase64')
  })
})

describe('compressImages', () => {
  it('returns successful results for every file in a multi-batch list', async () => {
    const files = Array.from({ length: 5 }, (_, index) =>
      makeFile(`photo-${index + 1}.jpg`, 'image/jpeg', 640),
    )

    const results = await compressImages(files)

    expect(results).toHaveLength(5)
    expect(results.every(item => item.result !== null && item.error === undefined)).toBe(true)
    expect(results.map(item => item.file)).toEqual(files)
    expect(imageConstructorMock).toHaveBeenCalledTimes(5)
    expect(createObjectURLMock).toHaveBeenCalledTimes(5)
  })

  it('captures per-file errors without rejecting the whole batch', async () => {
    const okFileOne = makeFile('ok-1.jpg', 'image/jpeg', 640)
    const failedFile = makeFile('decode-error.jpg', 'image/jpeg', 640)
    const okFileTwo = makeFile('ok-2.jpg', 'image/jpeg', 640)

    const results = await compressImages([okFileOne, failedFile, okFileTwo])

    const successes = results.filter(item => item.result !== null)
    const failures = results.filter(item => item.error)

    expect(results).toHaveLength(3)
    expect(successes).toHaveLength(2)
    expect(failures).toHaveLength(1)
    expect(failures[0]?.file).toBe(failedFile)
    expect(failures[0]?.result).toBeNull()
    expect(failures[0]?.error).toBeInstanceOf(Error)
    expect(failures[0]?.error?.message).toContain('Cannot decode image')
  })
})
