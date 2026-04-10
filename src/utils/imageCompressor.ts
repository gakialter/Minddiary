/**
 * imageCompressor.ts — Canvas-based client-side image compression
 */

interface CompressOptions {
    maxWidth?: number
    maxHeight?: number
    quality?: number
    qualityFloor?: number
    qualityStep?: number
    maxSizeKB?: number
}

interface CompressResult {
    blob: Blob
    base64: string
    width: number
    height: number
    originalSizeKB: number
    compressedSizeKB: number
    skipped?: boolean
}

interface CompressBatchResult {
    file: File
    result: CompressResult | null
    error?: Error
}

const DEFAULTS: Required<CompressOptions> = {
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.82,
    qualityFloor: 0.40,
    qualityStep: 0.08,
    maxSizeKB: 512,
}

/**
 * Scale dimensions to fit inside maxW × maxH, preserving aspect ratio.
 */
function fitDimensions(width: number, height: number, maxW: number, maxH: number): { width: number; height: number } {
    if (width <= maxW && height <= maxH) return { width, height }
    const ratio = Math.min(maxW / width, maxH / height)
    return {
        width: Math.floor(width * ratio),
        height: Math.floor(height * ratio),
    }
}

/** Decode a File / Blob into an HTMLImageElement. */
function decodeImage(file: File | Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
            URL.revokeObjectURL(url)
            resolve(img)
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error(`Cannot decode image: ${(file as File).name || 'unknown'}`))
        }
        img.src = url
    })
}

/** Convert a Blob to a base64-encoded data string (without the data: prefix). */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            const base64 = result.split(',')[1] ?? ''
            resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

/**
 * Draw img onto a canvas and export as a Blob.
 * Uses OffscreenCanvas when available (no DOM attachment).
 */
function drawToBlob(img: HTMLImageElement, width: number, height: number, mimeType: string, quality: number): Promise<Blob> {
    if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)
        return canvas.convertToBlob({ type: mimeType, quality })
    }

    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('Canvas.toBlob returned null')),
            mimeType,
            quality,
        )
    })
}

/**
 * Compress a single image File.
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
    const options = { ...DEFAULTS, ...opts }

    const originalSizeKB = file.size / 1024
    const isPng = file.type === 'image/png'

    // Skip compression for small PNGs to avoid lossy artefacts
    if (isPng && originalSizeKB <= options.maxSizeKB) {
        const base64 = await blobToBase64(file)
        return {
            blob: file,
            base64,
            width: 0,
            height: 0,
            originalSizeKB,
            compressedSizeKB: originalSizeKB,
            skipped: true,
        }
    }

    const img = await decodeImage(file)
    const { width, height } = fitDimensions(
        img.naturalWidth,
        img.naturalHeight,
        options.maxWidth,
        options.maxHeight,
    )

    const mimeType = isPng ? 'image/png' : 'image/jpeg'
    let quality = options.quality
    let blob: Blob

    // Iterative quality-reduction loop
    do {
        blob = await drawToBlob(img, width, height, mimeType, quality)
        if (blob.size / 1024 <= options.maxSizeKB) break
        quality = Math.round((quality - options.qualityStep) * 100) / 100
    } while (quality >= options.qualityFloor)

    const base64 = await blobToBase64(blob!)

    return {
        blob: blob!,
        base64,
        width,
        height,
        originalSizeKB: Math.round(originalSizeKB),
        compressedSizeKB: Math.round(blob!.size / 1024),
    }
}

/**
 * Compress multiple files concurrently (capped at 4 parallel tasks).
 */
export async function compressImages(files: File[], opts: CompressOptions = {}): Promise<CompressBatchResult[]> {
    const CONCURRENCY = 4
    const results: CompressBatchResult[] = []

    for (let i = 0; i < files.length; i += CONCURRENCY) {
        const batch = files.slice(i, i + CONCURRENCY)
        const settled = await Promise.allSettled(
            batch.map(f => compressImage(f, opts))
        )
        for (let j = 0; j < batch.length; j++) {
            const s = settled[j]!
            results.push(
                s.status === 'fulfilled'
                    ? { file: batch[j]!, result: s.value }
                    : { file: batch[j]!, result: null, error: s.reason as Error }
            )
        }
    }

    return results
}
