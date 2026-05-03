/**
 * aiProviders.ts — 2026 Chinese-first AI model registry.
 *
 * Each provider lists its latest models and default API endpoint.
 * UI styling uses semantic brand tokens from the Zen Forest design system.
 */

export interface AIModel {
  id: string
  name: string
  desc: string
  tag?: '推荐' | '新' | '快' | '长文本' | '代码' | '免费'
}

export interface AIProvider {
  id: string
  name: string
  endpoint: string    // default base URL
  models: AIModel[]
  website?: string
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com',
    website: 'https://platform.deepseek.com',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', desc: '推理旗舰，超长上下文 1M', tag: '推荐' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', desc: '高速高性价比', tag: '快' },
      { id: 'deepseek-chat', name: 'DeepSeek Chat', desc: '经典对话模型（将于7月停服）' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', desc: '深度推理模型（将于7月停服）' },
    ],
  },
  {
    id: 'qwen',
    name: '通义千问',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    website: 'https://bailian.console.aliyun.com',
    models: [
      { id: 'qwen3-max', name: 'Qwen3 Max', desc: '综合能力旗舰', tag: '推荐' },
      { id: 'qwen3-plus', name: 'Qwen3 Plus', desc: '均衡性能与成本' },
      { id: 'qwen3-turbo', name: 'Qwen3 Turbo', desc: '快速响应，高性价比', tag: '快' },
      { id: 'qwen-long', name: 'Qwen Long', desc: '超长上下文 10M Token', tag: '长文本' },
      { id: 'qwen-coder-next', name: 'Qwen Coder Next', desc: '代码专精', tag: '代码' },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    website: 'https://open.bigmodel.cn',
    models: [
      { id: 'glm-5.1', name: 'GLM-5.1', desc: '旗舰级通用模型', tag: '推荐' },
      { id: 'glm-4.7', name: 'GLM-4.7', desc: 'Agent 与推理增强', tag: '新' },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', desc: '免费高速', tag: '免费' },
    ],
  },
  {
    id: 'kimi',
    name: 'Kimi',
    endpoint: 'https://api.moonshot.cn/v1',
    website: 'https://platform.moonshot.cn',
    models: [
      { id: 'kimi-latest', name: 'Kimi Latest', desc: '跟随产品迭代的通用模型', tag: '推荐' },
      { id: 'kimi-k2.6', name: 'Kimi K2.6', desc: '万亿参数 Agent 集群旗舰', tag: '新' },
    ],
  },
  {
    id: 'doubao',
    name: '豆包',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    website: 'https://www.volcengine.com/product/doubao',
    models: [
      { id: 'doubao-pro-128k', name: '豆包 Pro 128K', desc: '高性能长上下文', tag: '推荐' },
      { id: 'doubao-lite-32k', name: '豆包 Lite 32K', desc: '轻量极速', tag: '快' },
    ],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    endpoint: 'https://api.siliconflow.cn/v1',
    website: 'https://siliconflow.cn',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3 (硅基)', desc: '硅基流动代理，免费额度', tag: '免费' },
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

/** Look up provider by id */
export function getProvider(providerId: string): AIProvider | undefined {
  return AI_PROVIDERS.find(p => p.id === providerId)
}

/** Look up provider from a model id */
export function getProviderByModel(modelId: string): AIProvider | undefined {
  return AI_PROVIDERS.find(p => p.models.some(m => m.id === modelId))
}

/** Tag color mapping (using semantic brand tokens to maintain low pressure) */
export function getTagColor(tag: string): { bg: string; text: string } {
  // Always return muted brand colors, no high saturation
  return { bg: 'var(--bg-tertiary)', text: 'var(--text-secondary)' }
}
