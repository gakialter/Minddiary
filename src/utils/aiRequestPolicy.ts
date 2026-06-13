import type { AIContentPart, AIImageContentPart, AIMessage, AITextContentPart } from '../types'

export const AI_REQUEST_LIMITS = {
    maxMessages: 8,
    maxMessageContent: 30_000,
    maxTotalContent: 40_000,
    maxSummaryInput: 16_000,
    maxImageParts: 3,
    maxImageBytes: 5 * 1024 * 1024,
    maxTotalImageBytes: 10 * 1024 * 1024,
} as const

const AI_MESSAGE_ROLES = ['system', 'user', 'assistant'] as const
const AI_MESSAGE_FIELDS = ['role', 'content'] as const
const TEXT_PART_FIELDS = ['type', 'text'] as const
const IMAGE_PART_FIELDS = ['type', 'image_url'] as const
const IMAGE_URL_FIELDS = ['url', 'detail'] as const
const IMAGE_DETAIL_VALUES = ['auto', 'low', 'high'] as const
const SUPPORTED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

type AIMessageRole = (typeof AI_MESSAGE_ROLES)[number]
type AIMessageField = (typeof AI_MESSAGE_FIELDS)[number]
type ImageDetail = (typeof IMAGE_DETAIL_VALUES)[number]
type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]

export type AiRequestValidationCode =
    | 'messages.notArray'
    | 'messages.tooFew'
    | 'messages.tooMany'
    | 'messages.firstSystem'
    | 'messages.singleSystem'
    | 'messages.finalUser'
    | 'message.notObject'
    | 'message.extraFields'
    | 'message.invalidRole'
    | 'message.contentNotString'
    | 'message.contentEmpty'
    | 'message.contentTooLong'
    | 'messages.totalContentTooLong'
    | 'contentParts.notArray'
    | 'contentParts.empty'
    | 'contentParts.extraFields'
    | 'contentParts.invalidType'
    | 'contentParts.multipleText'
    | 'contentParts.textRequired'
    | 'contentParts.imageNotAllowed'
    | 'image.imageUrlInvalid'
    | 'image.imageUrlExtraFields'
    | 'image.detailInvalid'
    | 'image.invalidDataUrl'
    | 'image.unsupportedMime'
    | 'image.invalidBase64'
    | 'image.tooLarge'
    | 'images.tooMany'
    | 'images.totalTooLarge'
    | 'summary.notString'
    | 'summary.empty'
    | 'summary.tooLong'

export class AiRequestValidationError extends Error {
    constructor(
        public readonly code: AiRequestValidationCode,
        message: string,
    ) {
        super(message)
        this.name = 'AiRequestValidationError'
    }
}

const allowedRoles = new Set<string>(AI_MESSAGE_ROLES)
const allowedMessageFields = new Set<string>(AI_MESSAGE_FIELDS)
const allowedTextPartFields = new Set<string>(TEXT_PART_FIELDS)
const allowedImagePartFields = new Set<string>(IMAGE_PART_FIELDS)
const allowedImageUrlFields = new Set<string>(IMAGE_URL_FIELDS)
const allowedImageDetailValues = new Set<string>(IMAGE_DETAIL_VALUES)
const supportedImageMimeTypes = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES)

function fail(code: AiRequestValidationCode, message: string): never {
    throw new AiRequestValidationError(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: AIMessageField): boolean {
    return Object.prototype.hasOwnProperty.call(record, key)
}

function validateRole(value: unknown, index: number): AIMessageRole {
    if (typeof value !== 'string' || !allowedRoles.has(value)) {
        fail(
            'message.invalidRole',
            `AI message ${index} role must be one of: ${AI_MESSAGE_ROLES.join(', ')}`,
        )
    }
    return value as AIMessageRole
}

function validateStringContent(value: unknown, index: number): string {
    if (typeof value !== 'string') {
        fail('message.contentNotString', `AI message ${index} content must be a string or valid content parts`)
    }
    if (!value.trim()) {
        fail('message.contentEmpty', `AI message ${index} content is required`)
    }
    if (value.length > AI_REQUEST_LIMITS.maxMessageContent) {
        fail(
            'message.contentTooLong',
            `AI message ${index} content must be at most ${AI_REQUEST_LIMITS.maxMessageContent} characters`,
        )
    }
    return value
}

function validateTextLength(text: string, index: number): string {
    if (!text.trim()) {
        fail('message.contentEmpty', `AI message ${index} content is required`)
    }
    if (text.length > AI_REQUEST_LIMITS.maxMessageContent) {
        fail(
            'message.contentTooLong',
            `AI message ${index} content must be at most ${AI_REQUEST_LIMITS.maxMessageContent} characters`,
        )
    }
    return text
}

function validateMessageFields(message: Record<string, unknown>, index: number): void {
    const extraFields = Object.keys(message).filter(key => !allowedMessageFields.has(key))
    if (extraFields.length > 0) {
        fail(
            'message.extraFields',
            `AI message ${index} contains unsupported fields: ${extraFields.join(', ')}`,
        )
    }
    if (!hasOwn(message, 'role')) {
        fail('message.invalidRole', `AI message ${index} role must be one of: ${AI_MESSAGE_ROLES.join(', ')}`)
    }
    if (!hasOwn(message, 'content')) {
        fail('message.contentNotString', `AI message ${index} content must be a string or valid content parts`)
    }
}

function getExtraFields(record: Record<string, unknown>, allowed: Set<string>): string[] {
    return Object.keys(record).filter(key => !allowed.has(key))
}

interface ParsedDataUrl {
    mimeType: SupportedImageMimeType
    byteLength: number
}

export function parseSupportedImageDataUrl(url: string): ParsedDataUrl {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url)
    if (!match) {
        fail('image.invalidDataUrl', 'Image content must be a base64 data URL')
    }

    const mimeType = match[1]!
    const base64 = match[2]!
    if (!supportedImageMimeTypes.has(mimeType)) {
        fail('image.unsupportedMime', 'Image content must be PNG, JPEG, or WebP')
    }
    if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || /=/.test(base64.slice(0, -2))) {
        fail('image.invalidBase64', 'Image content must contain valid base64 data')
    }

    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    const byteLength = Math.floor((base64.length * 3) / 4) - padding
    if (byteLength <= 0) {
        fail('image.invalidBase64', 'Image content must contain valid base64 data')
    }
    if (byteLength > AI_REQUEST_LIMITS.maxImageBytes) {
        fail(
            'image.tooLarge',
            `Image content must be at most ${AI_REQUEST_LIMITS.maxImageBytes} bytes`,
        )
    }

    return { mimeType: mimeType as SupportedImageMimeType, byteLength }
}

function validateImageUrl(value: unknown, index: number, partIndex: number): AIImageContentPart['image_url'] {
    if (!isRecord(value)) {
        fail('image.imageUrlInvalid', `AI message ${index} image part ${partIndex} image_url must be an object`)
    }
    const extraFields = getExtraFields(value, allowedImageUrlFields)
    if (extraFields.length > 0) {
        fail('image.imageUrlExtraFields', `AI message ${index} image_url contains unsupported fields: ${extraFields.join(', ')}`)
    }
    if (typeof value.url !== 'string') {
        fail('image.invalidDataUrl', `AI message ${index} image part ${partIndex} must use a data URL`)
    }
    const detail = value.detail
    if (detail !== undefined && (typeof detail !== 'string' || !allowedImageDetailValues.has(detail))) {
        fail('image.detailInvalid', `AI message ${index} image detail must be auto, low, or high`)
    }
    parseSupportedImageDataUrl(value.url)
    return detail === undefined
        ? { url: value.url }
        : { url: value.url, detail: detail as ImageDetail }
}

interface ContentPartsResult {
    parts: AIContentPart[]
    textLength: number
    imageCount: number
    imageBytes: number
}

function validateContentParts(value: unknown, index: number, role: AIMessageRole, isFinalMessage: boolean): ContentPartsResult {
    if (!Array.isArray(value)) {
        fail('contentParts.notArray', `AI message ${index} content parts must be an array`)
    }
    if (value.length === 0) {
        fail('contentParts.empty', `AI message ${index} content parts are required`)
    }
    if (role !== 'user' || !isFinalMessage) {
        fail('contentParts.imageNotAllowed', 'Only the final user message may use content parts')
    }

    const parts: AIContentPart[] = []
    let textCount = 0
    let imageCount = 0
    let textLength = 0
    let imageBytes = 0

    value.forEach((part, partIndex) => {
        if (!isRecord(part) || typeof part.type !== 'string') {
            fail('contentParts.invalidType', `AI message ${index} content part ${partIndex} must have a valid type`)
        }

        if (part.type === 'text') {
            const extraFields = getExtraFields(part, allowedTextPartFields)
            if (extraFields.length > 0) {
                fail('contentParts.extraFields', `AI message ${index} text part contains unsupported fields: ${extraFields.join(', ')}`)
            }
            if (typeof part.text !== 'string') {
                fail('message.contentNotString', `AI message ${index} text part must contain text`)
            }
            if (textCount >= 1) {
                fail('contentParts.multipleText', `AI message ${index} may contain only one text part`)
            }
            const text = validateTextLength(part.text, index)
            textCount += 1
            textLength += text.length
            parts.push({ type: 'text', text } satisfies AITextContentPart)
            return
        }

        if (part.type === 'image_url') {
            const extraFields = getExtraFields(part, allowedImagePartFields)
            if (extraFields.length > 0) {
                fail('contentParts.extraFields', `AI message ${index} image part contains unsupported fields: ${extraFields.join(', ')}`)
            }
            if (imageCount >= AI_REQUEST_LIMITS.maxImageParts) {
                fail('images.tooMany', `AI request can include at most ${AI_REQUEST_LIMITS.maxImageParts} images`)
            }
            const imageUrl = validateImageUrl(part.image_url, index, partIndex)
            const parsed = parseSupportedImageDataUrl(imageUrl.url)
            imageCount += 1
            imageBytes += parsed.byteLength
            if (imageBytes > AI_REQUEST_LIMITS.maxTotalImageBytes) {
                fail(
                    'images.totalTooLarge',
                    `AI request images must total at most ${AI_REQUEST_LIMITS.maxTotalImageBytes} bytes`,
                )
            }
            parts.push({ type: 'image_url', image_url: imageUrl } satisfies AIImageContentPart)
            return
        }

        fail('contentParts.invalidType', `AI message ${index} content part ${partIndex} has an unsupported type`)
    })

    if (textCount !== 1) {
        fail('contentParts.textRequired', `AI message ${index} content parts must include exactly one text part`)
    }

    return { parts, textLength, imageCount, imageBytes }
}

function validateContent(
    value: unknown,
    index: number,
    role: AIMessageRole,
    isFinalMessage: boolean,
): { content: AIMessage['content']; textLength: number; imageCount: number; imageBytes: number } {
    if (typeof value === 'string') {
        const content = validateStringContent(value, index)
        return { content, textLength: content.length, imageCount: 0, imageBytes: 0 }
    }
    if (Array.isArray(value)) {
        const result = validateContentParts(value, index, role, isFinalMessage)
        return {
            content: result.parts,
            textLength: result.textLength,
            imageCount: result.imageCount,
            imageBytes: result.imageBytes,
        }
    }
    fail('message.contentNotString', `AI message ${index} content must be a string or valid content parts`)
}

export function validateAiRequestMessages(payload: unknown): AIMessage[] {
    if (!Array.isArray(payload)) {
        fail('messages.notArray', 'AI chat messages must be an array')
    }
    if (payload.length < 2) {
        fail('messages.tooFew', 'AI chat messages must include at least 2 messages')
    }
    if (payload.length > AI_REQUEST_LIMITS.maxMessages) {
        fail(
            'messages.tooMany',
            `AI chat messages must include at most ${AI_REQUEST_LIMITS.maxMessages} messages`,
        )
    }

    let systemMessages = 0
    let totalContentLength = 0
    let totalImageBytes = 0
    let totalImages = 0
    const messages: AIMessage[] = []

    payload.forEach((item, index) => {
        if (!isRecord(item)) {
            fail('message.notObject', `AI message ${index} must be an object`)
        }

        validateMessageFields(item, index)
        const role = validateRole(item.role, index)
        if (index === 0 && role !== 'system') {
            fail('messages.firstSystem', 'AI chat messages must start with a system message')
        }
        if (role === 'system') {
            systemMessages += 1
            if (index !== 0 || systemMessages > 1) {
                fail('messages.singleSystem', 'AI chat messages may contain only one system message at index 0')
            }
        }

        const { content, textLength, imageCount, imageBytes } = validateContent(
            item.content,
            index,
            role,
            index === payload.length - 1,
        )
        totalContentLength += textLength
        totalImages += imageCount
        totalImageBytes += imageBytes
        if (totalImages > AI_REQUEST_LIMITS.maxImageParts) {
            fail('images.tooMany', `AI request can include at most ${AI_REQUEST_LIMITS.maxImageParts} images`)
        }
        if (totalImageBytes > AI_REQUEST_LIMITS.maxTotalImageBytes) {
            fail(
                'images.totalTooLarge',
                `AI request images must total at most ${AI_REQUEST_LIMITS.maxTotalImageBytes} bytes`,
            )
        }
        if (totalContentLength > AI_REQUEST_LIMITS.maxTotalContent) {
            fail(
                'messages.totalContentTooLong',
                `AI chat messages total content must be at most ${AI_REQUEST_LIMITS.maxTotalContent} characters`,
            )
        }

        messages.push({ role, content })
    })

    if (systemMessages !== 1) {
        fail('messages.firstSystem', 'AI chat messages must start with exactly one system message')
    }
    if (messages[messages.length - 1]?.role !== 'user') {
        fail('messages.finalUser', 'AI chat messages must end with a user message')
    }

    return messages
}

export function hasImageContentParts(messages: AIMessage[]): boolean {
    return messages.some(message => (
        Array.isArray(message.content) &&
        message.content.some(part => part.type === 'image_url')
    ))
}

export function getAiMessageTextContent(message: AIMessage): string {
    if (typeof message.content === 'string') return message.content
    return message.content
        .filter((part): part is AITextContentPart => part.type === 'text')
        .map(part => part.text)
        .join('\n')
}

export function validateAiSummaryInput(payload: unknown): string {
    if (typeof payload !== 'string') {
        fail('summary.notString', 'AI summary input must be a string')
    }
    if (!payload.trim()) {
        fail('summary.empty', 'AI summary input is required')
    }
    if (payload.length > AI_REQUEST_LIMITS.maxSummaryInput) {
        fail(
            'summary.tooLong',
            `AI summary input must be at most ${AI_REQUEST_LIMITS.maxSummaryInput} characters`,
        )
    }
    return payload
}

export function buildAiSummaryMessages(payload: unknown): AIMessage[] {
    const content = validateAiSummaryInput(payload)
    return validateAiRequestMessages([
        {
            role: 'system',
            content: '你是一位考研学习助手。请用简洁的中文回答，帮助学生总结学习内容、分析学习状态。',
        },
        {
            role: 'user',
            content: `请帮我总结以下学习日记的要点，并给出改进建议：\n\n${content}`,
        },
    ])
}

export function formatAiRequestValidationError(error: unknown): string {
    if (!(error instanceof AiRequestValidationError)) {
        return error instanceof Error ? error.message : String(error)
    }

    switch (error.code) {
        case 'messages.tooMany':
            return 'AI 请求消息过多，请清空部分聊天历史后重试。'
        case 'message.contentTooLong':
            return 'AI 请求单条内容过长，请缩短当前输入、日记内容或清空部分聊天历史后重试。'
        case 'messages.totalContentTooLong':
            return 'AI 请求总内容过长，请缩短当前输入、日记内容或清空部分聊天历史后重试。'
        case 'summary.tooLong':
            return 'AI 总结内容过长，请缩短日记内容后重试。'
        case 'summary.notString':
        case 'summary.empty':
            return 'AI 总结内容格式异常，请先填写有效日记内容。'
        case 'message.contentEmpty':
        case 'contentParts.textRequired':
            return 'AI 请求内容不能为空，请填写有效内容后重试。'
        case 'image.unsupportedMime':
            return '图片格式不受支持，请使用 PNG、JPEG 或 WebP。'
        case 'image.tooLarge':
            return '单张图片超过 5MB，请移除或压缩后重试。'
        case 'images.tooMany':
            return '一次最多发送 3 张图片，请移除多余图片后重试。'
        case 'images.totalTooLarge':
            return '图片总大小超过 10MB，请移除或压缩后重试。'
        case 'image.invalidDataUrl':
        case 'image.invalidBase64':
        case 'contentParts.invalidType':
        case 'contentParts.extraFields':
        case 'image.imageUrlExtraFields':
        case 'image.detailInvalid':
        case 'contentParts.imageNotAllowed':
            return 'AI 附件请求格式异常，请移除异常附件后重试。'
        default:
            return 'AI 请求消息格式异常，请重试或清空部分聊天历史。'
    }
}
