import { describe, expect, it } from 'vitest'
import {
  AI_PROVIDERS,
  getKnownModelCapabilities,
  resolveAIModelCapabilities,
} from '../src/data/aiProviders'

const documentedVisionModelIds = [
  'qwen3-vl-plus',
  'qwen3-vl-flash',
  'kimi-k2.6',
  'kimi-k2.7-code',
  'Qwen/Qwen2-VL-72B-Instruct',
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
})
