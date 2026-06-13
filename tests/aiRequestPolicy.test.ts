// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { AIMessage } from '../src/types'
import {
  AI_REQUEST_LIMITS,
  buildAiSummaryMessages,
  formatAiRequestValidationError,
  getAiMessageTextContent,
  hasImageContentParts,
  validateAiRequestMessages,
  validateAiSummaryInput,
} from '../src/utils/aiRequestPolicy'

const validMessages = (): AIMessage[] => [
  { role: 'system', content: 'system prompt' },
  { role: 'user', content: 'hello' },
]

const makeMessage = (role: AIMessage['role'], content: string = role): AIMessage => ({ role, content })

const makeBase64 = (bytes: number): string => 'A'.repeat(Math.ceil(bytes / 3) * 4)
const makeImageDataUrl = (bytes = 8, mimeType = 'image/png'): string => (
  `data:${mimeType};base64,${makeBase64(bytes)}`
)

describe('AI request policy', () => {
  it('rejects non-array chat payloads', () => {
    expect(() => validateAiRequestMessages({ role: 'user', content: 'hello' })).toThrow('must be an array')
  })

  it('rejects empty message arrays', () => {
    expect(() => validateAiRequestMessages([])).toThrow('at least 2 messages')
  })

  it('rejects arrays with only one system message', () => {
    expect(() => validateAiRequestMessages([makeMessage('system')])).toThrow('at least 2 messages')
  })

  it('accepts a valid two-message request', () => {
    expect(validateAiRequestMessages(validMessages())).toEqual(validMessages())
  })

  it('accepts exactly eight messages', () => {
    const messages: AIMessage[] = [
      makeMessage('system'),
      makeMessage('assistant', 'history 1'),
      makeMessage('user', 'history 2'),
      makeMessage('assistant', 'history 3'),
      makeMessage('user', 'history 4'),
      makeMessage('assistant', 'history 5'),
      makeMessage('assistant', 'history 6'),
      makeMessage('user', 'current'),
    ]

    expect(validateAiRequestMessages(messages)).toEqual(messages)
  })

  it('rejects nine messages', () => {
    const messages: AIMessage[] = [
      makeMessage('system'),
      makeMessage('assistant', '1'),
      makeMessage('user', '2'),
      makeMessage('assistant', '3'),
      makeMessage('user', '4'),
      makeMessage('assistant', '5'),
      makeMessage('user', '6'),
      makeMessage('assistant', '7'),
      makeMessage('user', '8'),
    ]

    expect(() => validateAiRequestMessages(messages)).toThrow('at most 8 messages')
  })

  it('rejects requests missing a leading system message', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('user', 'hello'),
      makeMessage('user', 'again'),
    ])).toThrow('start with a system message')
  })

  it('rejects requests whose first message is not system', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('assistant', 'history'),
      makeMessage('user', 'hello'),
    ])).toThrow('start with a system message')
  })

  it('rejects a second system message', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system', 'first'),
      makeMessage('system', 'second'),
      makeMessage('user', 'hello'),
    ])).toThrow('only one system message')
  })

  it('rejects a middle system message', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system', 'first'),
      makeMessage('assistant', 'history'),
      makeMessage('system', 'middle'),
      makeMessage('user', 'hello'),
    ])).toThrow('only one system message')
  })

  it('rejects requests ending with assistant', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      makeMessage('user'),
      makeMessage('assistant'),
    ])).toThrow('end with a user message')
  })

  it('rejects invalid roles', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      { role: 'tool', content: 'hello' },
    ])).toThrow('role must be one of')
  })

  it('rejects non-string content', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      { role: 'user', content: { text: 'hello' } },
    ])).toThrow('content must be a string')
  })

  it('rejects empty content', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      makeMessage('user', ''),
    ])).toThrow('content is required')
  })

  it('rejects whitespace-only content', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      makeMessage('user', '   \n\t'),
    ])).toThrow('content is required')
  })

  it('accepts content exactly at the per-message limit', () => {
    const messages = [
      makeMessage('system', 'system'),
      makeMessage('user', 'x'.repeat(AI_REQUEST_LIMITS.maxMessageContent)),
    ]

    expect(validateAiRequestMessages(messages)).toEqual(messages)
  })

  it('rejects content one character over the per-message limit', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system', 'system'),
      makeMessage('user', 'x'.repeat(AI_REQUEST_LIMITS.maxMessageContent + 1)),
    ])).toThrow('content must be at most')
  })

  it('accepts total content exactly at the total limit', () => {
    const halfTotalLimit = AI_REQUEST_LIMITS.maxTotalContent / 2
    const messages = [
      makeMessage('system', 's'.repeat(halfTotalLimit)),
      makeMessage('user', 'u'.repeat(halfTotalLimit)),
    ]

    expect(validateAiRequestMessages(messages)).toEqual(messages)
  })

  it('rejects total content one character over the total limit', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system', 's'.repeat(AI_REQUEST_LIMITS.maxMessageContent)),
      makeMessage('assistant', 'a'),
      makeMessage('user', 'u'.repeat(AI_REQUEST_LIMITS.maxMessageContent)),
    ])).toThrow('total content must be at most')
  })

  it('does not mutate valid input objects and returns normalized message objects', () => {
    const messages = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'hello' },
    ] satisfies AIMessage[]
    const before = JSON.stringify(messages)

    const result = validateAiRequestMessages(messages)

    expect(JSON.stringify(messages)).toBe(before)
    expect(result).toEqual(messages)
    expect(result).not.toBe(messages)
    expect(result[0]).not.toBe(messages[0])
  })

  it('rejects unknown message fields', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      { role: 'user', content: 'hello', tool_calls: [] },
    ])).toThrow('unsupported fields')
  })

  it('allows the first history message after system to be assistant', () => {
    const messages = [
      makeMessage('system'),
      makeMessage('assistant', 'previous answer'),
      makeMessage('user', 'current question'),
    ]

    expect(validateAiRequestMessages(messages)).toEqual(messages)
  })

  it('keeps the existing AIPanel eight-message structure valid', () => {
    const messages: AIMessage[] = [
      makeMessage('system', 'system prompt'),
      makeMessage('assistant', 'history 1'),
      makeMessage('user', 'history 2'),
      makeMessage('assistant', 'history 3'),
      makeMessage('user', 'history 4'),
      makeMessage('assistant', 'history 5'),
      makeMessage('user', 'history 6'),
      makeMessage('user', 'current input'),
    ]

    expect(validateAiRequestMessages(messages)).toEqual(messages)
  })

  it('accepts valid multipart content only on the final user message', () => {
    const messages: AIMessage[] = [
      makeMessage('system', 'system prompt'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this image' },
          { type: 'image_url', image_url: { url: makeImageDataUrl(), detail: 'auto' } },
        ],
      },
    ]

    expect(validateAiRequestMessages(messages)).toEqual(messages)
    expect(hasImageContentParts(messages)).toBe(true)
    expect(getAiMessageTextContent(messages[1]!)).toBe('describe this image')
  })

  it('rejects multipart content on system, assistant, or non-final user messages', () => {
    const parts = [{ type: 'text', text: 'multipart text' }]

    expect(() => validateAiRequestMessages([
      { role: 'system', content: parts },
      makeMessage('user', 'hello'),
    ])).toThrow('Only the final user message may use content parts')

    expect(() => validateAiRequestMessages([
      makeMessage('system', 'system'),
      { role: 'assistant', content: parts },
      makeMessage('user', 'hello'),
    ])).toThrow('Only the final user message may use content parts')

    expect(() => validateAiRequestMessages([
      makeMessage('system', 'system'),
      { role: 'user', content: parts },
      makeMessage('user', 'hello'),
    ])).toThrow('Only the final user message may use content parts')
  })

  it('rejects malformed multipart content', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      { role: 'user', content: [] },
    ])).toThrow('content parts are required')

    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      { role: 'user', content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] },
    ])).toThrow('may contain only one text part')

    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      { role: 'user', content: [{ type: 'file', file: {} }] },
    ])).toThrow('unsupported type')

    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      { role: 'user', content: [{ type: 'text', text: 'hello', cache_control: {} }] },
    ])).toThrow('unsupported fields')
  })

  it('rejects unsupported image URL shapes and details', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'image' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
        ],
      },
    ])).toThrow('base64 data URL')

    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'image' },
          { type: 'image_url', image_url: { url: 'file:///tmp/image.png' } },
        ],
      },
    ])).toThrow('base64 data URL')

    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'image' },
          { type: 'image_url', image_url: { url: makeImageDataUrl(8, 'image/gif') } },
        ],
      },
    ])).toThrow('PNG, JPEG, or WebP')

    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'image' },
          { type: 'image_url', image_url: { url: makeImageDataUrl(), detail: 'medium' } },
        ],
      },
    ])).toThrow('image detail must be auto, low, or high')

    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'image' },
          { type: 'image_url', image_url: { url: makeImageDataUrl(), name: 'photo.png' } },
        ],
      },
    ])).toThrow('unsupported fields')
  })

  it('enforces image count, single-image size, and total image size limits', () => {
    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'too many images' },
          { type: 'image_url', image_url: { url: makeImageDataUrl() } },
          { type: 'image_url', image_url: { url: makeImageDataUrl() } },
          { type: 'image_url', image_url: { url: makeImageDataUrl() } },
          { type: 'image_url', image_url: { url: makeImageDataUrl() } },
        ],
      },
    ])).toThrow('at most 3 images')

    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'too large' },
          { type: 'image_url', image_url: { url: makeImageDataUrl(AI_REQUEST_LIMITS.maxImageBytes + 1) } },
        ],
      },
    ])).toThrow('at most 5242880 bytes')

    expect(() => validateAiRequestMessages([
      makeMessage('system'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'too large together' },
          { type: 'image_url', image_url: { url: makeImageDataUrl(4 * 1024 * 1024) } },
          { type: 'image_url', image_url: { url: makeImageDataUrl(4 * 1024 * 1024) } },
          { type: 'image_url', image_url: { url: makeImageDataUrl(4 * 1024 * 1024) } },
        ],
      },
    ])).toThrow('total at most 10485760 bytes')
  })

  it('does not include base64 data in formatted validation errors', () => {
    const base64 = makeBase64(AI_REQUEST_LIMITS.maxImageBytes + 1)
    let formatted = ''
    try {
      validateAiRequestMessages([
        makeMessage('system'),
        {
          role: 'user',
          content: [
            { type: 'text', text: 'too large' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        },
      ])
    } catch (error) {
      formatted = formatAiRequestValidationError(error)
    }

    expect(formatted).not.toContain(base64.slice(0, 24))
    expect(formatted).toContain('5MB')
  })

  it('keeps the existing Editor system-plus-user structure valid', () => {
    expect(validateAiRequestMessages(validMessages())).toEqual(validMessages())
  })

  it('rejects non-string summary input', () => {
    expect(() => validateAiSummaryInput({ content: 'hello' })).toThrow('summary input must be a string')
  })

  it('rejects empty summary input', () => {
    expect(() => validateAiSummaryInput('')).toThrow('summary input is required')
  })

  it('rejects whitespace-only summary input', () => {
    expect(() => validateAiSummaryInput('  \n\t')).toThrow('summary input is required')
  })

  it('accepts summary input exactly at the summary limit', () => {
    const input = 'x'.repeat(AI_REQUEST_LIMITS.maxSummaryInput)

    expect(validateAiSummaryInput(input)).toBe(input)
  })

  it('rejects summary input one character over the summary limit', () => {
    expect(() => validateAiSummaryInput('x'.repeat(AI_REQUEST_LIMITS.maxSummaryInput + 1))).toThrow(
      'summary input must be at most',
    )
  })

  it('builds summary requests that satisfy the shared chat policy', () => {
    const messages = buildAiSummaryMessages('summary source')

    expect(validateAiRequestMessages(messages)).toEqual(messages)
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]).toMatchObject({ role: 'user' })
    expect(messages[1]?.content).toContain('summary source')
  })

  it('formats validation errors for renderer display', () => {
    let formatted = ''
    try {
      validateAiRequestMessages([
        makeMessage('system'),
        makeMessage('user', 'x'.repeat(AI_REQUEST_LIMITS.maxMessageContent + 1)),
      ])
    } catch (error) {
      formatted = formatAiRequestValidationError(error)
    }

    expect(formatted).toContain('AI 请求单条内容过长')
  })
})
