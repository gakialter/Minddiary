import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  DEFAULT_AI_MODEL,
  getProvider,
  getProviderByEndpoint,
  getProviderByModel,
  getKnownModelCapabilities,
  isRemovedPresetModel,
  resolveAIModelCapabilities,
} from '../src/data/aiProviders'

const documentedVisionModelIds = [
  'deepseek-flash',
  'qwen3.8-flash',
  'qwen3.8-max',
  'glm-5.3-flash',
  'kimi-k2.6',
  'doubao-seed-2-1-lite-260915',
  'doubao-seed-2-1-pro-260915',
]

describe('AI provider model capabilities', () => {
  it('keeps the documented visual preset list explicit', () => {
    const actualVisionModelIds = AI_PROVIDERS
      .flatMap(provider => provider.models)
      .filter(model => getKnownModelCapabilities(model.id)?.vision === true)
      .map(model => model.id)

    expect(actualVisionModelIds).toEqual(documentedVisionModelIds)
  })

  it.each(documentedVisionModelIds)('marks %s as supporting image input', modelId => {
    expect(getKnownModelCapabilities(modelId)).toEqual({
      vision: true,
      textAttachments: true,
    })
  })

  it.each([
    'deepseek-chat',
    'deepseek-reasoner',
    'qwen3-plus',
    'glm-5.1',
    'kimi-latest',
    'doubao-pro-128k',
    'deepseek-ai/DeepSeek-V3',
  ])('keeps %s text-only unless a capability is documented', modelId => {
    expect(resolveAIModelCapabilities(modelId, true)).toEqual({
      vision: false,
      textAttachments: true,
    })
  })

  it('uses the custom vision toggle only for unknown models', () => {
    expect(resolveAIModelCapabilities('custom-vision-model', true)).toEqual({
      vision: true,
      textAttachments: true,
    })
    expect(resolveAIModelCapabilities('custom-text-model', false)).toEqual({
      vision: false,
      textAttachments: true,
    })
  })

  it('makes Flash the default and limits each released provider to one recommendation', () => {
    expect(DEFAULT_AI_MODEL).toBe('deepseek-flash')
    expect(getProvider('deepseek')?.models.filter(model => model.recommended).map(model => model.id)).toEqual([DEFAULT_AI_MODEL])
    for (const provider of AI_PROVIDERS) {
      expect(provider.models.filter(model => model.recommended)).toHaveLength(
        ['custom', 'siliconflow'].includes(provider.id) ? 0 : 1,
      )
    }
  })

  it('recognizes the saved Flash alias as visual without offering it in the picker', () => {
    expect(getProvider('deepseek')?.models.map(model => model.id)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
    expect(resolveAIModelCapabilities('deepseek-v4-flash', false, 'https://api.deepseek.com/v1')).toEqual({ vision: true, textAttachments: true })
    expect(getProviderByModel('deepseek-v4-flash')?.id).toBe('deepseek')
  })

  it.each([
    ['deepseek', 'deepseek-chat'], ['deepseek', 'deepseek-reasoner'],
    ['kimi', 'kimi-latest'], ['siliconflow', 'Qwen/Qwen2-VL-72B-Instruct'],
  ])('keeps removed %s / %s out of the catalog and scopes its block to the provider', (providerId, modelId) => {
    expect(AI_PROVIDERS.flatMap(provider => provider.models).some(model => model.id === modelId)).toBe(false)
    expect(isRemovedPresetModel(modelId, getProvider(providerId)!.endpoint)).toBe(true)
    expect(isRemovedPresetModel(modelId, 'https://custom.example/v1')).toBe(false)
    expect(isRemovedPresetModel(modelId, getProvider('qwen')!.endpoint)).toBe(false)
  })

  it.each([
    ['qwen', 'qwen3-plus'], ['qwen', 'qwen3-turbo'], ['qwen', 'qwen-coder-next'],
    ['zhipu', 'glm-5.1'], ['zhipu', 'glm-4.7'], ['zhipu', 'glm-4-flash'],
    ['doubao', 'doubao-pro-128k'], ['doubao', 'doubao-lite-32k'], ['doubao', 'ep-user-vision'],
    ['siliconflow', 'deepseek-ai/DeepSeek-V3'], ['siliconflow', 'Qwen/Qwen2.5-72B-Instruct'],
  ])('does not treat simplified or UNKNOWN %s / %s as removed', (providerId, modelId) => {
    expect(isRemovedPresetModel(modelId, getProvider(providerId)!.endpoint)).toBe(false)
  })

  it.each(['deepseek-flash', 'deepseek-v4-pro', 'glm-5.3-flash', 'kimi-k2.6', 'deepseek-chat'])('lets Custom own its vision toggle even for %s', modelId => {
    expect(resolveAIModelCapabilities(modelId, false, 'https://custom.example/v1').vision).toBe(false)
    expect(resolveAIModelCapabilities(modelId, true, 'https://custom.example/v1').vision).toBe(true)
  })

  it('matches endpoint origin and path exactly, including full completions URLs', () => {
    expect(getProviderByEndpoint('https://api.deepseek.com/v1/chat/completions/')?.id).toBe('deepseek')
    expect(getProviderByEndpoint('https://api.deepseek.com.attacker.example/v1')).toBeUndefined()
    expect(getProviderByEndpoint('https://custom.example/api.deepseek.com')).toBeUndefined()
    expect(getProviderByEndpoint('https://open.bigmodel.cn/custom/v1')).toBeUndefined()
    expect(getProviderByEndpoint('https://api.moonshot.cn:444/v1')).toBeUndefined()
  })
})
