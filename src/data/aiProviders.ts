/**
 * Curated AI models. Legacy recognition is separate from selectable models.
 *
 * Each provider lists its latest models and default API endpoint.
 * UI styling uses semantic brand tokens from the Zen Forest design system.
 */

export interface AIModel {
  id: string
  name: string
  desc: string
  tag?: '推荐' | '新' | '快' | '长文本' | '代码' | '免费'
    | '更强'
  recommended?: boolean
  capabilities?: AIModelCapabilities
}

export interface AIModelCapabilities {
  vision: boolean
  textAttachments: boolean
}

export interface AIProvider {
  id: string
  name: string
  endpoint: string    // default base URL
  models: AIModel[]
  website?: string
}

const visionCapabilities: AIModelCapabilities = {
  vision: true,
  textAttachments: true,
}

export const DEFAULT_AI_MODEL = 'deepseek-flash'
export const REMOVED_MODEL_MESSAGE = '当前模型已不可用，请重新选择模型。'

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com',
    website: 'https://platform.deepseek.com',
    models: [
      { id: DEFAULT_AI_MODEL, name: 'DeepSeek Flash', desc: '日常润色、总结、学习问答、截图理解', tag: '推荐', recommended: true, capabilities: visionCapabilities },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', desc: '复杂文字问题', tag: '更强' },
    ],
  },
  {
    id: 'qwen',
    name: '通义千问',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    website: 'https://bailian.console.aliyun.com',
    models: [
      { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', desc: '日常学习问答、截图理解', tag: '推荐', recommended: true, capabilities: visionCapabilities },
      { id: 'qwen3.8-max', name: 'Qwen3.8 Max', desc: '复杂问题与图片分析', tag: '更强', capabilities: visionCapabilities },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    website: 'https://open.bigmodel.cn',
    models: [
      { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', desc: '学习问答与图片理解', tag: '推荐', recommended: true, capabilities: visionCapabilities },
    ],
  },
  {
    id: 'kimi',
    name: 'Kimi',
    endpoint: 'https://api.moonshot.cn/v1',
    website: 'https://platform.moonshot.cn',
    models: [
      { id: 'kimi-k2.6', name: 'Kimi K2.6', desc: '日常问答、总结与图片理解', tag: '推荐', recommended: true, capabilities: visionCapabilities },
    ],
  },
  {
    id: 'doubao',
    name: '豆包',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    website: 'https://www.volcengine.com/product/doubao',
    models: [
      { id: 'doubao-seed-2-1-lite-260915', name: '豆包 Seed 2.1 Lite', desc: '日常学习问答与图片理解', tag: '推荐', recommended: true, capabilities: visionCapabilities },
      { id: 'doubao-seed-2-1-pro-260915', name: '豆包 Seed 2.1 Pro', desc: '复杂任务与图片分析', tag: '更强', capabilities: visionCapabilities },
    ],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    endpoint: 'https://api.siliconflow.cn/v1',
    website: 'https://siliconflow.cn',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3 (硅基)', desc: '通用文字问答' },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B (硅基)', desc: '硅基流动代理' },
    ],
  },
  {
    id: 'custom',
    name: '自定义',
    endpoint: '',
    models: [
      { id: '', name: '自定义模型', desc: '手动输入模型名称' },
    ],
  },
]

// Recognition only: never offered to new users or used to migrate saved values.
const legacyModels: Record<string, { providerId: string; vision: boolean; removed?: boolean }> = {
  'deepseek-v4-flash': { providerId: 'deepseek', vision: true },
  'deepseek-chat': { providerId: 'deepseek', vision: false, removed: true },
  'deepseek-reasoner': { providerId: 'deepseek', vision: false, removed: true },
  'qwen3-max': { providerId: 'qwen', vision: false },
  'qwen3-plus': { providerId: 'qwen', vision: false },
  'qwen3-vl-plus': { providerId: 'qwen', vision: true },
  'qwen3-vl-flash': { providerId: 'qwen', vision: true },
  'qwen3-turbo': { providerId: 'qwen', vision: false },
  'qwen-long': { providerId: 'qwen', vision: false },
  'qwen-coder-next': { providerId: 'qwen', vision: false },
  'glm-5.1': { providerId: 'zhipu', vision: false },
  'glm-4.7': { providerId: 'zhipu', vision: false },
  'glm-4-flash': { providerId: 'zhipu', vision: false },
  'kimi-latest': { providerId: 'kimi', vision: false, removed: true },
  'kimi-k2.7-code': { providerId: 'kimi', vision: true },
  'doubao-pro-128k': { providerId: 'doubao', vision: false },
  'doubao-lite-32k': { providerId: 'doubao', vision: false },
  'Qwen/Qwen2-VL-72B-Instruct': { providerId: 'siliconflow', vision: true, removed: true },
}

/** Match the actual provider URL, never a hostname substring or model alone. */
export function getProviderByEndpoint(endpoint: string): AIProvider | undefined {
  try {
    const url = new URL(endpoint.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return undefined
    const path = url.pathname.replace(/\/+$/, '')
    return AI_PROVIDERS.find(provider => {
      if (!provider.endpoint) return false
      const preset = new URL(provider.endpoint)
      if (url.origin !== preset.origin) return false
      const basePath = preset.pathname.replace(/\/+$/, '')
      return path === basePath || path === `${basePath}/chat/completions`
        || (provider.id === 'deepseek' && (path === '/v1' || path === '/v1/chat/completions'))
    })
  } catch { return undefined }
}

export function isRemovedPresetModel(modelId: string, endpoint: string): boolean {
  const legacy = legacyModels[modelId]
  return legacy?.removed === true && getProviderByEndpoint(endpoint)?.id === legacy.providerId
}

/** Look up provider by id */
export function getProvider(providerId: string): AIProvider | undefined {
  return AI_PROVIDERS.find(p => p.id === providerId)
}

/** Look up provider from a model id */
export function getProviderByModel(modelId: string): AIProvider | undefined {
  return AI_PROVIDERS.find(p => p.models.some(m => m.id === modelId))
    ?? getProvider(legacyModels[modelId]?.providerId ?? '')
}

export function getModelById(modelId: string): AIModel | undefined {
  return AI_PROVIDERS.flatMap(provider => provider.models).find(model => model.id === modelId)
}

export function getKnownModelCapabilities(modelId: string): AIModelCapabilities | null {
  const model = getModelById(modelId)
  if (!model) {
    const legacy = legacyModels[modelId]
    return legacy ? { vision: legacy.vision, textAttachments: true } : null
  }
  return model.capabilities ?? { vision: false, textAttachments: true }
}

export function resolveAIModelCapabilities(
  modelId: string,
  customVisionEnabled: boolean | undefined,
  endpoint?: string,
): AIModelCapabilities {
  const modelProvider = getProviderByModel(modelId)
  const usePreset = endpoint === undefined || getProviderByEndpoint(endpoint)?.id === modelProvider?.id
  const knownCapabilities = usePreset ? getKnownModelCapabilities(modelId) : null
  if (knownCapabilities) return knownCapabilities
  return {
    vision: customVisionEnabled === true,
    textAttachments: true,
  }
}

/** Tag color mapping (using semantic brand tokens to maintain low pressure) */
export function getTagColor(tag: string): { bg: string; text: string } {
  // Always return muted brand colors, no high saturation
  return { bg: 'var(--bg-tertiary)', text: 'var(--text-secondary)' }
}
