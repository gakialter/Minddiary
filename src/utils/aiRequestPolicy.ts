import type { AIMessage } from '../types'

export const AI_REQUEST_LIMITS = {
    maxMessages: 8,
    maxMessageContent: 20_000,
    maxTotalContent: 40_000,
    maxSummaryInput: 16_000,
} as const

const AI_MESSAGE_ROLES = ['system', 'user', 'assistant'] as const
const AI_MESSAGE_FIELDS = ['role', 'content'] as const

type AIMessageRole = (typeof AI_MESSAGE_ROLES)[number]
type AIMessageField = (typeof AI_MESSAGE_FIELDS)[number]

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

function validateContent(value: unknown, index: number): string {
    if (typeof value !== 'string') {
        fail('message.contentNotString', `AI message ${index} content must be a string`)
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
        fail('message.contentNotString', `AI message ${index} content must be a string`)
    }
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

        const content = validateContent(item.content, index)
        totalContentLength += content.length
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
            return 'AI 请求内容不能为空，请填写有效内容后重试。'
        default:
            return 'AI 请求消息格式异常，请重试或清空部分聊天历史。'
    }
}
