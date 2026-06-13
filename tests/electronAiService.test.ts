// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiService, resolveChatCompletionsUrl } from '../electron/aiService'
import { AI_PROVIDERS } from '../src/data/aiProviders'
import type { AIMessage } from '../src/types'

const dbMocks = {
  getSetting: vi.fn(),
  getAiApiKey: vi.fn(),
}

const imageMessages = (): AIMessage[] => [
  { role: 'system', content: 'system' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ],
  },
]

const okResponse = () => new Response(JSON.stringify({
  choices: [{ message: { content: 'assistant reply' } }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } })

const makeFetchMock = (responseFactory: () => Response | Promise<Response>) =>
  vi.fn<typeof fetch>(async () => responseFactory())

const presetProviderRequestUrls = [
  ['deepseek', 'https://api.deepseek.com/v1/chat/completions'],
  ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
  ['zhipu', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
  ['kimi', 'https://api.moonshot.cn/v1/chat/completions'],
  ['doubao', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'],
  ['siliconflow', 'https://api.siliconflow.cn/v1/chat/completions'],
] as const

describe('resolveChatCompletionsUrl', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com/v1/chat/completions'],
    ['https://api.example.com/', 'https://api.example.com/v1/chat/completions'],
    ['https://api.siliconflow.cn/v1', 'https://api.siliconflow.cn/v1/chat/completions'],
    [
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    ],
    [
      'https://open.bigmodel.cn/api/paas/v4',
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    ],
    ['https://example.com/v1/chat/completions', 'https://example.com/v1/chat/completions'],
  ])('resolves %s to %s', (endpoint, expected) => {
    expect(resolveChatCompletionsUrl(endpoint)).toBe(expected)
  })

  it('has explicit expected URLs for every preset provider', () => {
    const presetProviderIds = AI_PROVIDERS
      .filter(provider => provider.id !== 'custom')
      .map(provider => provider.id)

    expect(presetProviderIds).toEqual(presetProviderRequestUrls.map(([providerId]) => providerId))
  })

  it.each(presetProviderRequestUrls)('resolves the %s preset endpoint', (providerId, expected) => {
    const provider = AI_PROVIDERS.find(provider => provider.id === providerId)

    expect(provider).toBeDefined()
    expect(resolveChatCompletionsUrl(provider?.endpoint || '')).toBe(expected)
  })
})

describe('Electron AI service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMocks.getAiApiKey.mockReturnValue('secret-key')
    dbMocks.getSetting.mockImplementation((key: string) => {
      if (key === 'aiEndpoint') return 'https://api.example.test'
      if (key === 'aiModel') return 'custom-model'
      if (key === 'aiVisionEnabled') return 'false'
      return ''
    })
    vi.stubGlobal('fetch', makeFetchMock(okResponse))
  })

  it('rejects image messages before network when the configured model has no vision capability', async () => {
    const fetchMock = makeFetchMock(okResponse)
    const { chat } = createAiService(dbMocks, fetchMock)

    const result = await chat(imageMessages())

    expect(result.content).toBe('')
    expect(result.error).toContain('图片')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends OpenAI-compatible multipart requests when a custom model declares vision support', async () => {
    dbMocks.getSetting.mockImplementation((key: string) => {
      if (key === 'aiEndpoint') return 'https://api.example.test'
      if (key === 'aiModel') return 'custom-model'
      if (key === 'aiVisionEnabled') return 'true'
      return ''
    })
    const fetchMock = makeFetchMock(okResponse)
    const { chat } = createAiService(dbMocks, fetchMock)

    const result = await chat(imageMessages())

    expect(result).toEqual({ content: 'assistant reply' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.test/v1/chat/completions')
    const requestInit = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(requestInit?.body))
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/png;base64,AAAA')
  })

  it('adds an image-specific hint when the provider rejects a multipart request with HTTP 400', async () => {
    dbMocks.getSetting.mockImplementation((key: string) => {
      if (key === 'aiEndpoint') return 'https://api.example.test'
      if (key === 'aiModel') return 'custom-model'
      if (key === 'aiVisionEnabled') return 'true'
      return ''
    })
    const fetchMock = makeFetchMock(() => new Response('bad request', { status: 400 }))
    const { chat } = createAiService(dbMocks, fetchMock)

    const result = await chat(imageMessages())

    expect(result.error).toContain('400')
    expect(result.error).toContain('图片')
  })

  it('rejects malformed provider responses without returning non-string content', async () => {
    const fetchMock = makeFetchMock(() => new Response(JSON.stringify({
      choices: [{ message: { content: { text: 'not allowed' } } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { chat } = createAiService(dbMocks, fetchMock)

    const result = await chat([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'hello' },
    ])

    expect(result.content).toBe('')
    expect(result.error).toContain('格式')
  })
})
