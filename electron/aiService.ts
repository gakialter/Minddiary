import type { AIMessage, AIResponse } from '../src/types/index'
import {
    buildAiSummaryMessages,
    hasImageContentParts,
    validateAiRequestMessages,
} from '../src/utils/aiRequestPolicy'
import { resolveAIModelCapabilities } from '../src/data/aiProviders'

const AI_TIMEOUT_MS = 30_000

interface AIDatabase {
    getSetting: (key: string) => string | undefined
    getAiApiKey: () => string | null
}

type FetchLike = typeof fetch

export function resolveChatCompletionsUrl(endpoint: string): string {
    const normalized = endpoint.trim().replace(/\/+$/, '')
    const url = new URL(normalized)
    const path = url.pathname.replace(/\/+$/, '')

    if (/\/chat\/completions$/i.test(path)) {
        return normalized
    }

    const alreadyVersioned =
        /\/v\d+$/i.test(path) ||
        /\/compatible-mode\/v\d+$/i.test(path)

    return alreadyVersioned
        ? `${normalized}/chat/completions`
        : `${normalized}/v1/chat/completions`
}

export function createAiService(database: AIDatabase, fetchImpl: FetchLike = fetch) {
    const chat = async (messages: AIMessage[]): Promise<AIResponse> => {
        const safeMessages = validateAiRequestMessages(messages)
        const endpoint = database.getSetting('aiEndpoint')
        const apiKey = database.getAiApiKey()
        const model = database.getSetting('aiModel') || 'gpt-3.5-turbo'
        const aiVisionEnabled = database.getSetting('aiVisionEnabled') === 'true'

        if (!endpoint || !apiKey) {
            return { content: '', error: '请先在设置中配置 AI API 地址和密钥' }
        }

        if (hasImageContentParts(safeMessages)) {
            const capabilities = resolveAIModelCapabilities(String(model), aiVisionEnabled)
            if (!capabilities.vision) {
                return {
                    content: '',
                    error: '当前模型未声明支持图片输入，请切换视觉模型或在自定义模型设置中确认图片能力。',
                }
            }
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

        try {
            const response = await fetchImpl(resolveChatCompletionsUrl(endpoint), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: safeMessages,
                    temperature: 0.7,
                    max_tokens: 2000,
                }),
                signal: controller.signal,
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                await response.text()
                const statusHints: Record<number, string> = {
                    401: '密钥无效或已过期，请在设置中更新 API Key。',
                    403: 'API 访问被拒绝，请检查权限。',
                    429: '请求频率超出限制，请稍后再试。',
                    500: 'AI 服务器内部错误，请稍后再试。',
                }
                const imageHint = response.status === 400 && hasImageContentParts(safeMessages)
                    ? '当前服务商或模型可能不支持图片输入，请切换视觉模型或移除图片后重试。'
                    : ''
                const hint = imageHint || statusHints[response.status] || ''
                return { content: '', error: `API 请求失败 (${response.status})${hint ? '\n' + hint : ''}` }
            }

            const data = await response.json()
            const content = data?.choices?.[0]?.message?.content
            if (typeof content !== 'string') {
                return { content: '', error: 'AI 返回格式异常：缺少有效文本内容。' }
            }
            return { content }
        } catch (err: unknown) {
            clearTimeout(timeoutId)
            const error = err as Error
            if (error.name === 'AbortError') {
                return { content: '', error: '请求超时（30秒），请检查网络连接或 API 服务是否正常。' }
            }
            return { content: '', error: `连接失败: ${error.message}` }
        }
    }

    const summarize = async (content: string): Promise<AIResponse> => chat(buildAiSummaryMessages(content))

    return { chat, summarize }
}

function getDatabase(): AIDatabase {
    return require('./database') as AIDatabase
}

async function chat(messages: AIMessage[]): Promise<AIResponse> {
    return createAiService(getDatabase()).chat(messages)
}

async function summarize(content: string): Promise<AIResponse> {
    return createAiService(getDatabase()).summarize(content)
}

module.exports = { chat, summarize, createAiService, resolveChatCompletionsUrl }
