export type AIComposerAttachmentKind = 'image' | 'text-file' | 'pdf'
export type AIComposerAttachmentStatus = 'reading' | 'ready' | 'error'

export interface AIComposerAttachment {
    id: string
    kind: AIComposerAttachmentKind
    name: string
    mimeType: string
    size: number
    status: AIComposerAttachmentStatus
    previewUrl?: string
    dataUrl?: string
    extractedText?: string
    pageCount?: number
    error?: string
    truncated?: boolean
    originalTextLength?: number
    textLength?: number
    reusable: boolean
}

export interface PersistedAIAttachmentMeta {
    kind: AIComposerAttachmentKind
    name: string
    mimeType: string
    size: number
    reusable: false
}

export const AI_ATTACHMENT_LIMITS = {
    maxAttachments: 5,
    maxImages: 3,
    maxImageBytes: 5 * 1024 * 1024,
    maxTotalImageBytes: 10 * 1024 * 1024,
    maxTextFileBytes: 2 * 1024 * 1024,
    maxPdfBytes: 10 * 1024 * 1024,
    maxPdfPages: 50,
    maxExtractedTextChars: 20_000,
} as const

export const SUPPORTED_AI_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const SUPPORTED_AI_TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.log'] as const

const supportedImageMimeTypes = new Set<string>(SUPPORTED_AI_IMAGE_MIME_TYPES)
const supportedTextExtensions = new Set<string>(SUPPORTED_AI_TEXT_EXTENSIONS)

export function getFileExtension(name: string): string {
    const index = name.lastIndexOf('.')
    return index >= 0 ? name.slice(index).toLowerCase() : ''
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function attachmentToMeta(attachment: AIComposerAttachment): PersistedAIAttachmentMeta {
    return {
        kind: attachment.kind,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        reusable: false,
    }
}

export function countAttachmentsByKind(attachments: AIComposerAttachment[]) {
    const images = attachments.filter(attachment => attachment.kind === 'image').length
    const textLike = attachments.filter(attachment => attachment.kind === 'text-file' || attachment.kind === 'pdf').length
    return { images, textLike, total: attachments.length }
}

export function getAttachmentPolicyError(file: File, existing: AIComposerAttachment[]): string | null {
    const extension = getFileExtension(file.name)
    const isImage = supportedImageMimeTypes.has(file.type)
    const isPdf = file.type === 'application/pdf' || extension === '.pdf'
    const isTextFile = supportedTextExtensions.has(extension)
    const { images, total } = countAttachmentsByKind(existing)

    if (total >= AI_ATTACHMENT_LIMITS.maxAttachments) {
        return `一次最多添加 ${AI_ATTACHMENT_LIMITS.maxAttachments} 个附件。`
    }

    if (isImage) {
        if (images >= AI_ATTACHMENT_LIMITS.maxImages) {
            return `一次最多添加 ${AI_ATTACHMENT_LIMITS.maxImages} 张图片。`
        }
        if (file.size > AI_ATTACHMENT_LIMITS.maxImageBytes) {
            return `图片 ${file.name} 超过 ${formatBytes(AI_ATTACHMENT_LIMITS.maxImageBytes)}。`
        }
        const currentImageBytes = existing
            .filter(attachment => attachment.kind === 'image')
            .reduce((sum, attachment) => sum + attachment.size, 0)
        if (currentImageBytes + file.size > AI_ATTACHMENT_LIMITS.maxTotalImageBytes) {
            return `图片总大小超过 ${formatBytes(AI_ATTACHMENT_LIMITS.maxTotalImageBytes)}。`
        }
        return null
    }

    if (isPdf) {
        if (file.size > AI_ATTACHMENT_LIMITS.maxPdfBytes) {
            return `PDF ${file.name} 超过 ${formatBytes(AI_ATTACHMENT_LIMITS.maxPdfBytes)}。`
        }
        return null
    }

    if (isTextFile) {
        if (file.size > AI_ATTACHMENT_LIMITS.maxTextFileBytes) {
            return `文本文件 ${file.name} 超过 ${formatBytes(AI_ATTACHMENT_LIMITS.maxTextFileBytes)}。`
        }
        return null
    }

    if (file.type.startsWith('image/')) {
        return `图片 ${file.name} 格式不受支持，请使用 PNG、JPEG 或 WebP。`
    }
    return `文件 ${file.name} 格式不受支持。支持 TXT、MD、CSV、JSON、LOG 和文本型 PDF。`
}

export function getReadyAttachmentError(attachments: AIComposerAttachment[]): string | null {
    const reading = attachments.find(attachment => attachment.status === 'reading')
    if (reading) return `附件 ${reading.name} 仍在读取中。`
    const failed = attachments.find(attachment => attachment.status === 'error')
    if (failed) return `附件 ${failed.name} 读取失败：${failed.error || '未知错误'}`
    const extractedChars = attachments
        .filter(attachment => attachment.kind !== 'image')
        .reduce((sum, attachment) => sum + (attachment.extractedText?.length || 0), 0)
    if (extractedChars > AI_ATTACHMENT_LIMITS.maxExtractedTextChars) {
        return `附件文本总量 ${extractedChars} 字超过 ${AI_ATTACHMENT_LIMITS.maxExtractedTextChars} 字，请移除部分文件。`
    }
    return null
}

export function revokeAttachmentPreview(attachment: AIComposerAttachment): void {
    if (attachment.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl)
    }
}
