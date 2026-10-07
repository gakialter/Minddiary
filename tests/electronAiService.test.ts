// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('curated provider request compatibility', () => {
  const textMessages: AIMessage[] = [
    { role: 'system', content: 'synthetic system' }, { role: 'user', content: 'synthetic question' },
  ]
  function configured(endpoint: string, model: string | undefined, vision = false) {
    const values = new Map<string, string | undefined>([['aiEndpoint', endpoint], ['aiModel', model], ['aiVisionEnabled', String(vision)]])
    return { values, db: { getSetting: (key: string) => values.get(key), getAiApiKey: () => 'synthetic-key', getFirstSliceConfigRevision: () => 1 } }
  }
  async function request(endpoint: string, model: string, messages = textMessages, vision = false) {
    const fixture = configured(endpoint, model, vision)
    const fetchMock = makeFetchMock(okResponse)
    expect(await createAiService(fixture.db, fetchMock).chat(messages)).toEqual({ content: 'assistant reply' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    return JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))
  }

  it.each(['deepseek-flash', 'deepseek-v4-flash'])('sends image input on DeepSeek %s while keeping the saved ID', async model => {
    const body = await request('https://api.deepseek.com', model, imageMessages())
    expect(body).toMatchObject({ model, thinking: { type: 'disabled' } })
    expect(body.messages).toEqual(imageMessages())
  })

  it.each(['qwen3.8-flash', 'qwen3.8-max'])('disables Qwen thinking and preserved reasoning for %s', async model => {
    const history: AIMessage[] = [textMessages[0]!, { role: 'user', content: 'previous question' }, { role: 'assistant', content: 'visible answer' }, textMessages[1]!]
    const body = await request(AI_PROVIDERS.find(provider => provider.id === 'qwen')!.endpoint, model, history)
    expect(body).toMatchObject({ enable_thinking: false, preserve_thinking: false, temperature: 0.7 })
    expect(body).not.toHaveProperty('thinking')
    expect(body.messages).toEqual(history)
    const images = await request(AI_PROVIDERS.find(provider => provider.id === 'qwen')!.endpoint, model, imageMessages())
    expect(images.messages).toEqual(imageMessages())
  })

  it('disables Kimi K2.6 thinking and omits the invalid fixed temperature', async () => {
    const body = await request('https://api.moonshot.cn/v1', 'kimi-k2.6', imageMessages())
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('enable_thinking')
    expect(body).not.toHaveProperty('preserve_thinking')
  })

  it('sends only url in GLM image_url without mutating input or disabling its required thinking', async () => {
    const messages = imageMessages()
    if (Array.isArray(messages[1]!.content)) {
      const image = messages[1]!.content[1]!
      if (image.type === 'image_url') image.image_url.detail = 'high'
    }
    const original = structuredClone(messages)
    const body = await request('https://open.bigmodel.cn/api/paas/v4', 'glm-5.3-flash', messages)
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } })
    expect(messages).toEqual(original)
    expect(body).not.toHaveProperty('enable_thinking')
    expect(body.thinking).toEqual({ type: 'enabled', clear_thinking: true })
    expect(body.reasoning_effort).toBe('low')
    const custom = await request('https://custom.example/v1', 'glm-5.3-flash', messages, true)
    expect(custom.messages).toEqual(original)
    expect(custom).not.toHaveProperty('reasoning_effort')
  })

  it.each(['doubao-seed-2-1-lite-260915', 'doubao-seed-2-1-pro-260915'])('uses only Ark thinking override for %s', async model => {
    const body = await request('https://ark.cn-beijing.volces.com/api/v3', model, imageMessages())
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.temperature).toBe(0.7)
    expect(body).not.toHaveProperty('enable_thinking')
    expect(body).not.toHaveProperty('preserve_thinking')
    expect(body.messages).toEqual(imageMessages())
  })

  it.each([
    ['deepseek-chat', 'https://api.deepseek.com'], ['deepseek-reasoner', 'https://api.deepseek.com/v1'],
    ['kimi-latest', 'https://api.moonshot.cn/v1'], ['Qwen/Qwen2-VL-72B-Instruct', 'https://api.siliconflow.cn/v1'],
  ])('blocks confirmed removed %s before fetch without migrating its saved value', async (model, endpoint) => {
    const f = configured(endpoint, model)
    const fetchMock = makeFetchMock(okResponse)
    expect(await createAiService(f.db, fetchMock).chat(textMessages)).toEqual({ content: '', error: '当前模型已不可用，请重新选择模型。' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(f.values.get('aiModel')).toBe(model)
    expect((await request('https://custom.example/v1', model)).model).toBe(model)
  })

  it.each([
    ['qwen3-plus', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['glm-4-flash', 'https://open.bigmodel.cn/api/paas/v4'],
    ['glm-5.1', 'https://open.bigmodel.cn/api/paas/v4'],
    ['doubao-pro-128k', 'https://ark.cn-beijing.volces.com/api/v3'],
    ['doubao-lite-32k', 'https://ark.cn-beijing.volces.com/api/v3'],
    ['ep-user-vision', 'https://ark.cn-beijing.volces.com/api/v3'],
    ['deepseek-ai/DeepSeek-V3', 'https://api.siliconflow.cn/v1'],
  ])('still sends simplified or UNKNOWN saved %s unchanged', async (model, endpoint) => {
    const body = await request(endpoint, model)
    expect(body.model).toBe(model)
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('enable_thinking')
  })

  it('preserves user Ark endpoint IDs and their explicit vision declaration', async () => {
    const body = await request('https://ark.cn-beijing.volces.com/api/v3', 'ep-user-vision', imageMessages(), true)
    expect(body.model).toBe('ep-user-vision')
    expect(body.messages).toEqual(imageMessages())
    expect(body).not.toHaveProperty('thinking')
  })

  it.each(['deepseek-flash', 'qwen3.8-flash', 'qwen3.8-max', 'glm-5.3-flash', 'kimi-k2.6', 'doubao-seed-2-1-lite-260915'])('keeps Custom %s free of preset overrides and respects its toggle', async model => {
    const body = await request('https://custom.example/v1', model, imageMessages(), true)
    expect(body.temperature).toBe(0.7)
    for (const field of ['thinking', 'enable_thinking', 'preserve_thinking']) expect(body).not.toHaveProperty(field)
    const fetchMock = makeFetchMock(okResponse)
    const f = configured('https://custom.example/v1', model, false)
    expect((await createAiService(f.db, fetchMock).chat(imageMessages())).error).toContain('图片')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['https://api.moonshot.cn.attacker.example/v1', 'kimi-k2.6'],
    ['https://dashscope.aliyuncs.com/custom/v1', 'qwen3.8-flash'],
    ['https://ark.cn-beijing.volces.com/api/v3', 'kimi-k2.6'],
    ['https://api.moonshot.cn/v1', 'qwen3.8-flash'],
  ])('does not apply a mismatched request profile at %s / %s', async (endpoint, model) => {
    const body = await request(endpoint, model)
    expect(body.temperature).toBe(0.7)
    for (const field of ['thinking', 'enable_thinking', 'preserve_thinking']) expect(body).not.toHaveProperty(field)
  })

  it('uses Flash for an empty Electron configuration, including the First Slice final latch', async () => {
    const f = configured('https://api.deepseek.com', undefined)
    const fetchMock = makeFetchMock(okResponse)
    const valid = vi.fn(actual => actual.model === 'deepseek-flash')
    expect(await createAiService(f.db, fetchMock).chatFirstSlice(textMessages, { valid, started: vi.fn() })).toEqual({ content: 'assistant reply' })
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).model).toBe('deepseek-flash')
    expect(f.values.get('aiModel')).toBeUndefined()
  })
})

describe('I3 aiService synchronous final-fetch and adoption guard', () => {
  const messages: AIMessage[] = [{role:'system',content:'synthetic system'},{role:'user',content:'synthetic question'}]
  function controlled() {
    const settings = new Map([['aiEndpoint','https://example.test/v1/'],['aiModel','model-a'],['aiVisionEnabled','false']])
    let revision = 7
    const db = { getSetting: vi.fn((key:string)=>settings.get(key)), getAiApiKey:()=> 'KEY_CANARY_I3_q9G', getFirstSliceConfigRevision:()=>revision }
    return { settings, db, change:()=>{revision++} }
  }
  it.each([
    ['https://api.deepseek.com', true],
    ['https://api.deepseek.com/v1', true],
    ['https://api.deepseek.com/v1/chat/completions', true],
    ['https://api.example.test/v1', false],
    ['https://api.deepseek.com.attacker.example/v1', false],
  ])('uses exact DeepSeek hostname for final body at %s', async (endpoint, deepseek) => {
    const f = controlled(); f.settings.set('aiEndpoint', endpoint); f.settings.set('aiModel', 'deepseek-flash')
    const fetchMock = makeFetchMock(okResponse)
    await createAiService(f.db, fetchMock).chatFirstSlice(messages, { valid: () => true, started: vi.fn() })
    const expected = { model: 'deepseek-flash', messages, temperature: 0.7, max_tokens: 2000,
      ...(deepseek ? { thinking: { type: 'disabled' } } : {}) }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1]?.body).toBe(JSON.stringify(expected))
  })
  it.each([
    ['stop', 'usable answer', true], ['stop', '', false], ['stop', '  \n ', false],
    ['stop', null, false], ['stop', undefined, false], ['length', 'partial...', false], ['length', '', false],
  ])('controlled response %s / %j is usable=%s without reasoning retention', async (finish_reason, content, usable) => {
    const f = controlled(); f.settings.set('aiEndpoint', 'https://api.deepseek.com')
    const fetchMock = makeFetchMock(() => new Response(JSON.stringify({ choices: [{ finish_reason,
      message: { content, reasoning_content: 'REASONING_EXCLUSION_CANARY' } }] })))
    const result = await createAiService(f.db, fetchMock).chatFirstSlice(messages, { valid: () => true, started: vi.fn() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('REASONING_EXCLUSION_CANARY')
    if (usable) expect(result).toEqual({ content })
    else expect(result).toEqual({ content: '', error: expect.any(String) })
  })
  it.each(['chat', 'summarize'] as const)('rejects truncated %s responses, including empty content', async method => {
    for (const content of ['', 'partial...']) {
      const fetchMock = makeFetchMock(() => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content } }] })))
      const service = createAiService(controlled().db, fetchMock)
      const result = method === 'chat' ? await service.chat(messages) : await service.summarize('synthetic text')
      expect(result).toEqual({ content: '', error: 'AI 返回内容不完整，请重新生成。' }); expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })
  it('checks actual normalized URL, model and configuration revision immediately before one fetch', async () => {
    const f=controlled(),order:string[]=[]
    const fetchMock=vi.fn<typeof fetch>(async()=>{order.push('fetch');return okResponse()})
    const valid=vi.fn(actual=>{order.push('guard');expect(actual).toEqual({normalizedEndpoint:'https://example.test/v1/chat/completions',model:'model-a',revision:7});return true})
    const result=await createAiService(f.db,fetchMock).chatFirstSlice(messages,{valid,started:()=>order.push('started')})
    expect(result.content).toBe('assistant reply');expect(order).toEqual(['guard','started','fetch','guard'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(valid.mock.calls)).not.toContain('KEY_CANARY')
  })
  it.each(['revoked','cancelled','source','destination','model','key','vision'])('%s before final latch causes zero fetch',async change=>{
    const f=controlled(),fetchMock=vi.fn<typeof fetch>(async()=>okResponse())
    let permitted=true
    const get=f.db.getSetting.getMockImplementation()!
    f.db.getSetting.mockImplementation(key=>{
      if(key==='aiVisionEnabled') {
        if(change==='destination') f.settings.set('aiEndpoint','https://other.test')
        else if(change==='model') f.settings.set('aiModel','model-b')
        else if(change==='key'||change==='vision') f.change()
        else permitted=false
      }
      return get(key)
    })
    const valid=vi.fn(actual=>permitted&&actual.revision===7&&actual.model==='model-a'&&actual.normalizedEndpoint==='https://example.test/v1/chat/completions')
    const result=await createAiService(f.db,fetchMock).chatFirstSlice(messages,{valid,started:vi.fn()})
    expect(result.error).toBeDefined();expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['revocation','cancel','source','destination','model','key','vision'])('%s during fetch prevents result adoption without retries',async change=>{
    const f=controlled();let release!:(value:Response)=>void, permitted=true
    const fetchMock=vi.fn<typeof fetch>(()=>new Promise(resolve=>{release=resolve}))
    const promise=createAiService(f.db,fetchMock).chatFirstSlice(messages,{started:vi.fn(),valid:actual=>permitted&&actual.revision===7&&actual.model==='model-a'&&actual.normalizedEndpoint==='https://example.test/v1/chat/completions'})
    expect(fetchMock).toHaveBeenCalledTimes(1)
    if(change==='destination') f.settings.set('aiEndpoint','https://other.test')
    else if(change==='model')f.settings.set('aiModel','model-b')
    else if(change==='key'||change==='vision')f.change()
    else permitted=false
    release(okResponse())
    expect(await promise).toMatchObject({content:'',error:expect.stringContaining('可能已经发送')})
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it.each(['echo','exception','body'])('synthetic key is excluded from %s/output/errors and is only used for authorization',async variant=>{
    const f=controlled(),secret=f.db.getAiApiKey()
    let secretLogged=false
    const logs=(['debug','log','warn','error'] as const).map(method=>vi.spyOn(console,method).mockImplementation((...args:unknown[])=>{
      secretLogged ||= args.some(value=>String(value).includes(secret))
    }))
    const fetchMock=vi.fn<typeof fetch>(async()=>{
      if(variant==='exception')throw new Error(secret)
      return new Response(JSON.stringify({choices:[{message:{content:secret}}]}))
    })
    const result=await createAiService(f.db,fetchMock).chatFirstSlice(variant==='body'?[messages[0]!,{role:'user',content:secret}]:messages,{valid:()=>true,started:vi.fn()})
    logs.forEach(log=>log.mockRestore())
    expect(secretLogged).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(result.content).toBe('')
    if(variant==='body')expect(fetchMock).not.toHaveBeenCalled()
    else {
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(String(fetchMock.mock.calls[0]![1]?.body)).not.toContain(secret)
      expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('Authorization')===`Bearer ${secret}`).toBe(true)
    }
  })
})

describe('AI response completion and timeout guard', () => {
  const messages: AIMessage[] = [
    { role: 'system', content: 'synthetic system' },
    { role: 'user', content: 'synthetic question' },
  ]
  const incompleteError = 'AI 返回内容不完整，请重新生成。'

  function database() {
    return {
      getSetting: (key: string) => ({
        aiEndpoint: 'https://example.test/v1',
        aiModel: 'synthetic-model',
        aiVisionEnabled: 'false',
      } as Record<string, string>)[key],
      getAiApiKey: () => 'synthetic-key',
      getFirstSliceConfigRevision: () => 1,
    }
  }

  function response(finishReason?: string | null, content = 'complete answer') {
    return new Response(JSON.stringify({
      choices: [{ ...(finishReason === undefined ? {} : { finish_reason: finishReason }), message: { content } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['stop', 'stop'],
    ['missing', undefined],
    ['null', null],
  ] as const)('accepts a complete response with %s finish_reason', async (_label, finishReason) => {
    const fetchMock = makeFetchMock(() => response(finishReason))
    const result = await createAiService(database(), fetchMock).chat(messages)

    expect(result).toEqual({ content: 'complete answer' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['chat', 'summarize', 'first-slice'] as const)('rejects nonempty truncated content from %s', async method => {
    const fetchMock = makeFetchMock(() => response('length', 'partial answer'))
    const service = createAiService(database(), fetchMock)
    const result = method === 'chat'
      ? await service.chat(messages)
      : method === 'summarize'
        ? await service.summarize('synthetic source text')
        : await service.chatFirstSlice(messages, { valid: () => true, started: vi.fn() })

    expect(result).toEqual({ content: '', error: incompleteError })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps blank content compatibility when finish_reason is absent', async () => {
    const fetchMock = makeFetchMock(() => response(undefined, '  \n '))

    expect(await createAiService(database(), fetchMock).chat(messages)).toEqual({ content: '  \n ' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['fetch', 'json', 'error-text'] as const)('times out and aborts when %s stays pending, even if it ignores abort', async phase => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    let releaseHeaders: ((value: Response) => void) | undefined
    let bodyReader: ReturnType<typeof vi.fn> | undefined
    const neverSettles = () => new Promise<never>(() => {})
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      signal = init?.signal as AbortSignal
      if (phase === 'fetch') return neverSettles()
      const headers = new Promise<Response>(resolve => { releaseHeaders = resolve })
      if (phase === 'json') {
        bodyReader = vi.fn(neverSettles)
        return headers.then(() => ({ ok: true, status: 200, json: bodyReader }) as unknown as Response)
      }
      bodyReader = vi.fn(neverSettles)
      return headers.then(() => ({ ok: false, status: 502, text: bodyReader }) as unknown as Response)
    })
    const promise = createAiService(database(), fetchMock).chat(messages)
    let settled = false
    void promise.then(() => { settled = true })

    if (phase === 'fetch') {
      await vi.advanceTimersByTimeAsync(30_000)
    } else {
      await vi.advanceTimersByTimeAsync(10_000)
      releaseHeaders?.({} as Response)
      await vi.advanceTimersByTimeAsync(0)
      expect(bodyReader).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(19_999)
      expect(signal?.aborted).toBe(false)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
    }
    const result = await promise

    expect(signal?.aborted).toBe(true)
    expect(result.error).toContain('超时')
    expect(result.content).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timeout after a normal body and after body rejection, with one request and no retry', async () => {
    vi.useFakeTimers()
    const successFetch = makeFetchMock(() => response('stop'))
    expect(await createAiService(database(), successFetch).chat(messages)).toEqual({ content: 'complete answer' })
    expect(successFetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    const rejectedBody = {
      ok: true,
      status: 200,
      json: async () => { throw new Error('synthetic body failure') },
    } as unknown as Response
    const failureFetch = makeFetchMock(() => rejectedBody)
    const result = await createAiService(database(), failureFetch).chat(messages)
    expect(result.error).toContain('synthetic body failure')
    expect(failureFetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
