import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import {
    AI_ATTACHMENT_LIMITS,
    getAttachmentPolicyError,
    getFileExtension,
    SUPPORTED_AI_IMAGE_MIME_TYPES,
    type AIComposerAttachment,
} from './aiAttachmentPolicy'

const IMAGE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
    'image/png': bytes => (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
    ),
    'image/jpeg': bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/webp': bytes => (
        bytes.length >= 12 &&
        String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
        String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    ),
}

export const makeAIComposerAttachmentId = (): string => (
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
)

function makeBaseAttachment(file: File, kind: AIComposerAttachment['kind']): AIComposerAttachment {
    return {
        id: makeAIComposerAttachmentId(),
        kind,
        name: file.name,
        mimeType: file.type || (kind === 'pdf' ? 'application/pdf' : 'text/plain'),
        size: file.size,
        status: 'reading',
        reusable: true,
    }
}

function makeErrorAttachment(file: File, kind: AIComposerAttachment['kind'], error: string): AIComposerAttachment {
    return {
        ...makeBaseAttachment(file, kind),
        status: 'error',
        error,
    }
}

export function createReadingAIComposerAttachment(file: File): AIComposerAttachment {
    return makeBaseAttachment(file, getAttachmentKind(file))
}

async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result)
            else reject(new Error('文件读取结果不是 data URL'))
        }
        reader.onerror = () => reject(new Error('文件读取失败'))
        reader.readAsDataURL(file)
    })
}

function isSupportedImageMime(mimeType: string): boolean {
    return (SUPPORTED_AI_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)
}

async function readImageAttachment(file: File): Promise<AIComposerAttachment> {
    if (!isSupportedImageMime(file.type)) {
        return makeErrorAttachment(file, 'image', '图片格式不受支持，请使用 PNG、JPEG 或 WebP。')
    }

    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    const signatureMatches = IMAGE_SIGNATURES[file.type]?.(header) === true
    if (!signatureMatches) {
        return makeErrorAttachment(file, 'image', '图片 MIME 与文件内容不匹配，已拒绝。')
    }

    try {
        const dataUrl = await fileToDataUrl(file)
        if (!dataUrl.startsWith(`data:${file.type};base64,`)) {
            return makeErrorAttachment(file, 'image', '图片 data URL 格式异常。')
        }
        return {
            ...makeBaseAttachment(file, 'image'),
            status: 'ready',
            previewUrl: URL.createObjectURL(file),
            dataUrl,
        }
    } catch (error) {
        return makeErrorAttachment(file, 'image', error instanceof Error ? error.message : '图片读取失败。')
    }
}

function hasTooManyControlChars(text: string): boolean {
    if (!text) return false
    let suspicious = 0
    for (const char of text) {
        const code = char.charCodeAt(0)
        const allowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d
        if ((code < 0x20 && !allowedWhitespace) || code === 0x7f) suspicious += 1
    }
    return suspicious / text.length > 0.08
}

function decodeTextFile(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    if (bytes.includes(0)) {
        throw new Error('文件包含 NUL 字节，可能不是文本文件。')
    }
    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    if (!text.trim()) {
        throw new Error('文件内容为空。')
    }
    if (hasTooManyControlChars(text)) {
        throw new Error('文件包含过多不可打印字符，已拒绝。')
    }
    return text
}

async function readTextAttachment(file: File): Promise<AIComposerAttachment> {
    try {
        const text = decodeTextFile(await file.arrayBuffer())
        return {
            ...makeBaseAttachment(file, 'text-file'),
            status: 'ready',
            extractedText: text,
            originalTextLength: text.length,
            textLength: text.length,
            truncated: false,
        }
    } catch (error) {
        return makeErrorAttachment(file, 'text-file', error instanceof Error ? error.message : '文本文件读取失败。')
    }
}

async function extractPdfText(pdf: PDFDocumentProxy): Promise<{ text: string; pageCount: number }> {
    if (pdf.numPages > AI_ATTACHMENT_LIMITS.maxPdfPages) {
        throw new Error(`PDF 页数为 ${pdf.numPages}，超过 ${AI_ATTACHMENT_LIMITS.maxPdfPages} 页限制。`)
    }

    const pageTexts: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber)
        const content = await page.getTextContent()
        const text = content.items
            .map(item => ('str' in item ? item.str : ''))
            .filter(Boolean)
            .join(' ')
        pageTexts.push(text)
    }

    const text = pageTexts.join('\n\n').trim()
    if (!text) {
        throw new Error('该 PDF 可能是扫描件，当前版本不支持 OCR。')
    }
    return { text, pageCount: pdf.numPages }
}

async function readPdfAttachment(file: File): Promise<AIComposerAttachment> {
    try {
        const data = new Uint8Array(await file.arrayBuffer())
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        const loadingTask = pdfjs.getDocument({
            data,
            disableFontFace: true,
            disableAutoFetch: true,
            disableStream: true,
        })
        let text = ''
        let pageCount = 0
        try {
            const pdf = await loadingTask.promise
            const extracted = await extractPdfText(pdf)
            text = extracted.text
            pageCount = extracted.pageCount
        } finally {
            await loadingTask.destroy()
        }
        return {
            ...makeBaseAttachment(file, 'pdf'),
            status: 'ready',
            mimeType: 'application/pdf',
            extractedText: text,
            originalTextLength: text.length,
            textLength: text.length,
            pageCount,
            truncated: false,
        }
    } catch (error) {
        return makeErrorAttachment(file, 'pdf', error instanceof Error ? error.message : 'PDF 文本提取失败。')
    }
}

function getAttachmentKind(file: File): AIComposerAttachment['kind'] {
    const extension = getFileExtension(file.name)
    if (isSupportedImageMime(file.type)) return 'image'
    if (file.type === 'application/pdf' || extension === '.pdf') return 'pdf'
    return 'text-file'
}

export async function readAIComposerFile(
    file: File,
    existing: AIComposerAttachment[],
    id?: string,
): Promise<AIComposerAttachment> {
    const kind = getAttachmentKind(file)
    const policyError = getAttachmentPolicyError(file, existing)
    if (policyError) return { ...makeErrorAttachment(file, kind, policyError), ...(id ? { id } : {}) }

    const attachment = kind === 'image'
        ? await readImageAttachment(file)
        : kind === 'pdf'
            ? await readPdfAttachment(file)
            : await readTextAttachment(file)
    return id ? { ...attachment, id } : attachment
}
