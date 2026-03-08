/**
 * imageCompressor.js — Canvas-based client-side image compression
 *
 * Strategy
 * ────────
 * 1. Decode the raw File via FileReader + HTMLImageElement (no server round-trip).
 * 2. Draw onto an OffscreenCanvas (or regular Canvas as fallback) scaled to fit
 *    within maxWidth × maxHeight while preserving aspect ratio.
 * 3. Export as JPEG at the given quality.  If the first pass still exceeds
 *    maxSizeKB we iteratively reduce quality in steps until the target is met
 *    or quality drops below the floor (0.4).
 * 4. Return both a Blob and a pre-encoded base64 string so callers don't have
 *    to do another async read.
 *
 * Why not WebP?
 *   Electron ships Chromium so WebP is supported, but the Electron file://
 *   protocol and SQLite BLOB storage work best with JPEG for broad compat.
 *   PNG source files (screenshots, diagrams) are kept as PNG when they are
 *   already under maxSizeKB to avoid quality loss on line art.
 *
 * Memory notes
 *   OffscreenCanvas is preferred because it avoids attaching a DOM element.
 *   The HTMLImageElement is revoked via URL.revokeObjectURL after decode so
 *   the browser can GC the raw pixel buffer immediately.
 */

const DEFAULTS = {
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.82,       // initial JPEG quality
    qualityFloor: 0.40,  // never go below this
    qualityStep: 0.08,   // decrement per retry pass
    maxSizeKB: 512,      // target ceiling in KB
}

/**
 * Scale `{ width, height }` to fit inside `maxW × maxH`, preserving ratio.
 * Returns the original dimensions if they already fit.
 */
function fitDimensions(width, height, maxW, maxH) {
    if (width <= maxW && height <= maxH) return { width, height }
    const ratio = Math.min(maxW / width, maxH / height)
    return {
        width: Math.floor(width * ratio),
        height: Math.floor(height * ratio),
    }
}

/** Decode a File / Blob into an HTMLImageElement, returns a Promise<HTMLImageElement>. */
function decodeImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
            URL.revokeObjectURL(url)  // free raw buffer ASAP
            resolve(img)
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error(`Cannot decode image: ${file.name}`))
        }
        img.src = url
    })
}

/** Convert a Blob to a base64-encoded data string (without the data: prefix). */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            // result is "data:image/jpeg;base64,<data>" — strip the prefix
            const base64 = reader.result.split(',')[1]
            resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

/**
 * Draw `img` onto a canvas of `{ width, height }` and export as a Blob.
 * Uses OffscreenCanvas when available (no DOM attachment).
 */
function drawToBlob(img, width, height, mimeType, quality) {
    if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        return canvas.convertToBlob({ type: mimeType, quality })
    }

    // Fallback: regular Canvas (always supported in Electron/Chromium)
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('Canvas.toBlob returned null')),
            mimeType,
            quality,
        )
    })
}

/**
 * Compress a single image File.
 *
 * @param {File} file
 * @param {object} [opts]
 * @param {number} [opts.maxWidth=1280]
 * @param {number} [opts.maxHeight=1280]
 * @param {number} [opts.quality=0.82]     initial JPEG quality (0–1)
 * @param {number} [opts.qualityFloor=0.4] minimum quality before giving up
 * @param {number} [opts.qualityStep=0.08] quality reduction per retry
 * @param {number} [opts.maxSizeKB=512]    target file size ceiling
 *
 * @returns {Promise<{ blob: Blob, base64: string, width: number, height: number,
 *                     originalSizeKB: number, compressedSizeKB: number }>}
 */
export async function compressImage(file, opts = {}) {
    const options = { ...DEFAULTS, ...opts }

    const originalSizeKB = file.size / 1024
    const isPng = file.type === 'image/png'

    // Skip compression for small PNGs (diagrams, screenshots) to avoid lossy artefacts
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

    // Choose output format: keep PNG for small PNGs, use JPEG otherwise
    const mimeType = isPng ? 'image/png' : 'image/jpeg'
    let quality = options.quality
    let blob

    // Iterative quality-reduction loop
    do {
        blob = await drawToBlob(img, width, height, mimeType, quality)
        if (blob.size / 1024 <= options.maxSizeKB) break
        quality = Math.round((quality - options.qualityStep) * 100) / 100
    } while (quality >= options.qualityFloor)

    const base64 = await blobToBase64(blob)

    return {
        blob,
        base64,
        width,
        height,
        originalSizeKB: Math.round(originalSizeKB),
        compressedSizeKB: Math.round(blob.size / 1024),
    }
}

/**
 * Compress multiple files concurrently (capped at 4 parallel tasks to avoid
 * saturating the GPU raster pipeline on low-end hardware).
 *
 * @param {File[]} files
 * @param {object} [opts] — same as compressImage opts
 * @returns {Promise<Array<{ file: File, result: object, error?: Error }>>}
 */
export async function compressImages(files, opts = {}) {
    const CONCURRENCY = 4
    const results = []

    for (let i = 0; i < files.length; i += CONCURRENCY) {
        const batch = files.slice(i, i + CONCURRENCY)
        const settled = await Promise.allSettled(
            batch.map(f => compressImage(f, opts))
        )
        for (let j = 0; j < batch.length; j++) {
            const s = settled[j]
            results.push(
                s.status === 'fulfilled'
                    ? { file: batch[j], result: s.value }
                    : { file: batch[j], result: null, error: s.reason }
            )
        }
    }

    return results
}
