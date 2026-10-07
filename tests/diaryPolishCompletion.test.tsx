import { act, renderHook } from '@testing-library/react'
import { history } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { createAiService } from '../electron/aiService'
import type { AIMessage } from '../src/types'
import { diaryMarkdown, rangeField } from '../src/components/common/diaryEditorState'
import { capturePolishTarget } from '../src/components/common/diaryPolishTarget'
import { useDiaryPolish } from '../src/components/common/useDiaryPolish'
import type { PolishAction } from '../src/utils/diaryPolish'

const source = '今天感觉很好'
const action: PolishAction = 'polish'
const completionError = 'AI 返回内容不完整，请重新生成。'

function setup(completions: Array<{ content: string; finish_reason?: string }>) {
  const database = {
    getSetting: (key: string) => ({
      aiEndpoint: 'https://fixture.invalid/v1',
      aiModel: 'fixture-model',
      aiVisionEnabled: 'false',
    })[key],
    getAiApiKey: () => 'synthetic-key',
  }
  const fetchMock = vi.fn<typeof fetch>(async (_input, _init) => {
    const completion = completions.shift()
    if (!completion) throw new Error('No synthetic completion configured')
    return new Response(JSON.stringify({ choices: [{
      finish_reason: completion.finish_reason,
      message: { content: completion.content },
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const service = createAiService(database, fetchMock)
  const chat = (messages: AIMessage[]) => service.chat(messages)

  const parent = document.createElement('div')
  document.body.append(parent)
  const originalBody = `${source}，后文保留。`
  const view = new EditorView({ parent, state: EditorState.create({ doc: originalBody,
    selection: { anchor: 0, head: source.length }, extensions: [diaryMarkdown, rangeField, history()] }) })
  const viewRef = { current: view as EditorView | undefined }
  const hook = renderHook(() => useDiaryPolish(viewRef, 'day-1', chat))
  const target = capturePolishTarget(view.state, 'day-1')
  return { ...hook, view, parent, target, originalBody, fetchMock,
    cleanup: () => { hook.unmount(); view.destroy(); parent.remove() } }
}

function requestMessages(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).messages as AIMessage[]
}

describe('diary polish transport completion integration', () => {
  it('does not publish or apply a length-truncated first completion and sends the captured source', async () => {
    const ctx = setup([{ content: '不完整的候选', finish_reason: 'length' }])
    try {
      await act(async () => { await ctx.result.current.run(action, ctx.target) })

      expect(ctx.result.current.review).toMatchObject({
        candidate: '', candidateReady: false, loading: false, error: completionError,
      })
      expect(ctx.view.state.doc.toString()).toBe(ctx.originalBody)
      expect(requestMessages(ctx.fetchMock)[1]).toEqual({ role: 'user', content: source })
      act(() => ctx.result.current.apply())
      expect(ctx.view.state.doc.toString()).toBe(ctx.originalBody)
    } finally { ctx.cleanup() }
  })

  it('accepts a normal stop completion as a candidate', async () => {
    const ctx = setup([{ content: '润色后的正文', finish_reason: 'stop' }])
    try {
      await act(async () => { await ctx.result.current.run(action, ctx.target) })

      expect(ctx.result.current.review).toMatchObject({ candidate: '润色后的正文', candidateReady: true, error: '' })
      expect(ctx.view.state.doc.toString()).toBe(ctx.originalBody)
      expect(requestMessages(ctx.fetchMock)[1]).toEqual({ role: 'user', content: source })
    } finally { ctx.cleanup() }
  })

  it('preserves a hand-edited candidate when regeneration is truncated and keeps it applicable', async () => {
    const ctx = setup([
      { content: '候选 A', finish_reason: 'stop' },
      { content: '被截断的候选 B', finish_reason: 'length' },
    ])
    try {
      await act(async () => { await ctx.result.current.run(action, ctx.target) })
      act(() => ctx.result.current.editCandidate('人工修改 A'))
      await act(async () => { await ctx.result.current.run(action, ctx.target) })

      expect(ctx.result.current.review).toMatchObject({
        candidate: '人工修改 A', candidateReady: true, loading: false, error: completionError,
      })
      expect(ctx.view.state.doc.toString()).toBe(ctx.originalBody)
      expect(ctx.fetchMock).toHaveBeenCalledTimes(2)
      const secondRequest = JSON.parse(String(ctx.fetchMock.mock.calls[1]?.[1]?.body))
      expect(secondRequest.messages[1]).toEqual({ role: 'user', content: source })

      act(() => ctx.result.current.apply())
      expect(ctx.view.state.doc.toString()).toBe('人工修改 A，后文保留。')
    } finally { ctx.cleanup() }
  })

  it('continues to accept completions that omit finish_reason', async () => {
    const ctx = setup([{ content: '兼容旧服务的候选' }])
    try {
      await act(async () => { await ctx.result.current.run(action, ctx.target) })
      expect(ctx.result.current.review).toMatchObject({ candidate: '兼容旧服务的候选', candidateReady: true, error: '' })
    } finally { ctx.cleanup() }
  })
})
