// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiService } from '../electron/aiService'
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
