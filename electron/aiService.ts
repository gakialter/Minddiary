import type { AIMessage, AIResponse } from '../src/types/index'
import {
    buildAiSummaryMessages,
    hasImageContentParts,
    validateAiRequestMessages,
} from '../src/utils/aiRequestPolicy'
import { DEFAULT_AI_MODEL, getProviderByEndpoint, isRemovedPresetModel, REMOVED_MODEL_MESSAGE, resolveAIModelCapabilities } from '../src/data/aiProviders'

const AI_TIMEOUT_MS = 30_000

interface AIDatabase {
    getSetting: (key: string) => string | undefined
    getAiApiKey: () => string | null
    getFirstSliceConfigRevision?: () => number
}

export type FirstSliceDestination = { normalizedEndpoint: string; model: string; revision: number }
export type FirstSliceServiceGuard = {
    valid: (actual: FirstSliceDestination) => boolean
    started: () => void
}

type FetchLike = typeof fetch

// Small, endpoint + exact-model overrides on top of the existing request.
function buildRequestBody(finalUrl: string, model: string, messages: AIMessage[]) {
    const providerId = getProviderByEndpoint(finalUrl)?.id
    const kimi = providerId === 'kimi' && model === 'kimi-k2.6'
    const qwen = providerId === 'qwen' && ['qwen3.8-flash', 'qwen3.8-max'].includes(model)
    const glm = providerId === 'zhipu' && model === 'glm-5.3-flash'
    const doubao = providerId === 'doubao' && [
        'doubao-seed-2-1-lite-260915', 'doubao-seed-2-1-pro-260915',
    ].includes(model)
    // GLM's image_url accepts url only; strip detail in the outbound copy.
    // https://docs.z.ai/guides/vlm/glm-5.3-flash
    const requestMessages = glm ? messages.map(message => ({
        ...message,
        content: typeof message.content === 'string' ? message.content : message.content.map(part => (
            part.type === 'image_url' ? { type: 'image_url' as const, image_url: { url: part.image_url.url } } : part
        )),
    })) : messages
    return {
        model,
        messages: requestMessages,
        // K2.6 fixes temperature by mode; let the server apply its default.
        // https://platform.kimi.com/docs/guide/kimi-k2-6-quickstart
        ...(kimi ? {} : { temperature: 0.7 }),
        max_tokens: 2000,
        // Preserve Phase D's exact-hostname DeepSeek gate.
        ...(new URL(finalUrl).hostname === 'api.deepseek.com' || kimi || doubao
            ? { thinking: { type: 'disabled' } } : {}),
        // Qwen 3.8 must not require reasoning history to be persisted/replayed.
        // https://docs.qwencloud.com/api-reference/chat/openai-chat
        ...(qwen ? { enable_thinking: false, preserve_thinking: false } : {}),
        // GLM cannot disable thinking. Use light reasoning without history reuse.
        // https://docs.z.ai/api-reference/llm/chat-completion
        ...(glm ? { thinking: { type: 'enabled', clear_thinking: true }, reasoning_effort: 'low' } : {}),
        // Ark disabled mode: https://docs.volcengine.com/docs/ark/deep-thinking
    }
}

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
    const chat = async (messages: AIMessage[], control?: FirstSliceServiceGuard): Promise<AIResponse> => {
        const safeMessages = validateAiRequestMessages(messages)
        const endpoint = database.getSetting('aiEndpoint')
        const apiKey = database.getAiApiKey()
        const model = database.getSetting('aiModel') || DEFAULT_AI_MODEL
        const aiVisionEnabled = database.getSetting('aiVisionEnabled') === 'true'

        if (!endpoint || !apiKey) {
            return { content: '', error: '请先在设置中配置 AI API 地址和密钥' }
        }

        if (isRemovedPresetModel(model, endpoint)) {
            return { content: '', error: REMOVED_MODEL_MESSAGE }
        }

        if (hasImageContentParts(safeMessages)) {
            const capabilities = resolveAIModelCapabilities(String(model), aiVisionEnabled, endpoint)
            if (!capabilities.vision) {
                return {
                    content: '',
                    error: '当前模型未声明支持图片输入，请切换视觉模型或在自定义模型设置中确认图片能力。',
                }
            }
        }

        const controller = new AbortController()
        let timeoutId!: ReturnType<typeof setTimeout>
        const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                controller.abort()
                reject(controller.signal.reason)
            }, AI_TIMEOUT_MS)
        })

        try {
            const finalUrl = resolveChatCompletionsUrl(endpoint)
            const request: RequestInit = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(buildRequestBody(finalUrl, model, safeMessages)),
                signal: controller.signal,
                ...(control ? { redirect: 'error' as const } : {}),
            }
            const actual = (): FirstSliceDestination => ({
                normalizedEndpoint: resolveChatCompletionsUrl(database.getSetting('aiEndpoint') || ''),
                model: database.getSetting('aiModel') || DEFAULT_AI_MODEL,
                revision: database.getFirstSliceConfigRevision?.() ?? -1,
            })
            if (control) {
                const destination = actual()
                if (String(request.body).includes(apiKey)
                    || destination.normalizedEndpoint !== finalUrl || destination.model !== model
                    || destination.revision < 0 || !control.valid(destination)) {
                    return { content: '', error: 'First Slice 请求已失效' }
                }
                control.started()
            }
            // Synchronous validity latch above; there is no await before fetch.
            const response = await Promise.race([fetchImpl(finalUrl, request), timeout])

            if (!response.ok) {
                await Promise.race([response.text(), timeout])
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

            const data = await Promise.race([response.json(), timeout])
            if (data?.choices?.[0]?.finish_reason === 'length') {
                return { content: '', error: 'AI 返回内容不完整，请重新生成。' }
            }
            const content = data?.choices?.[0]?.message?.content
            if (typeof content !== 'string') {
                return { content: '', error: 'AI 返回格式异常：缺少有效文本内容。' }
            }
            if (control && !content.trim()) {
                return { content: '', error: 'First Slice 返回内容不可用' }
            }
            if (control && !control.valid(actual())) return { content: '', error: 'First Slice 请求已失效，可能已经发送' }
            if (control && content.includes(apiKey)) return { content: '', error: 'First Slice 返回内容不可用' }
            return { content }
        } catch (err: unknown) {
            const error = err as Error
            if (control) return { content: '', error: 'First Slice 请求未完成，可能已经发送' }
            if (error.name === 'AbortError') {
                return { content: '', error: '请求超时（30秒），请检查网络连接或 API 服务是否正常。' }
            }
            return { content: '', error: `连接失败: ${error.message}` }
        } finally {
            clearTimeout(timeoutId)
        }
    }

    const summarize = async (content: string): Promise<AIResponse> => chat(buildAiSummaryMessages(content))

    return { chat: (messages: AIMessage[]) => chat(messages), summarize,
        chatFirstSlice: (messages: AIMessage[], control: FirstSliceServiceGuard) => chat(messages, control) }
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
