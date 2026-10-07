import { act, renderHook } from '@testing-library/react'
import { history, undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIMessage, AIResponse } from '../src/types'
import { diaryMarkdown, rangeField } from '../src/components/common/diaryEditorState'
import { capturePolishTarget } from '../src/components/common/diaryPolishTarget'
import { useDiaryPolish } from '../src/components/common/useDiaryPolish'
import type { PolishAction } from '../src/utils/diaryPolish'

const source = '今天感觉很好'
const action: PolishAction = 'polish'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup(doc = `${source}，准备继续复习。`, from = 0, to = source.length,
  chat: (messages: AIMessage[]) => Promise<AIResponse> = vi.fn().mockResolvedValue({ content: '今天感觉很好' })) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor: from, head: to },
    extensions: [diaryMarkdown, rangeField, history()] }) })
  const viewRef = { current: view as EditorView | undefined }
  const hook = renderHook(({ identity }: { identity: string }) => useDiaryPolish(viewRef, identity, chat),
    { initialProps: { identity: 'day-1' } })
  const target = capturePolishTarget(view.state, 'day-1')
  return { ...hook, view, parent, target, cleanup: () => { hook.unmount(); view.destroy(); parent.remove() } }
}

afterEach(() => { vi.restoreAllMocks() })

describe('useDiaryPolish', () => {
  it('edits a returned candidate and applies only the selection with one-step undo', async () => {
    const chat = vi.fn().mockResolvedValue({ content: source })
    const ctx = setup(`${source}，后文保留。`, 0, source.length, chat)
    try {
      await act(async () => { await ctx.result.current.run(action, ctx.target) })
      expect(ctx.result.current.review?.candidateReady).toBe(true)
      act(() => ctx.result.current.editCandidate('今天状态很好'))
      expect(ctx.view.state.doc.toString()).toBe(`${source}，后文保留。`)
      expect(ctx.result.current.review?.target?.source).toBe(source)
      expect(ctx.result.current.review?.candidate).toBe('今天状态很好')
      act(() => ctx.result.current.apply())
      expect(ctx.view.state.doc.toString()).toBe('今天状态很好，后文保留。')
      expect(undo(ctx.view)).toBe(true)
      expect(ctx.view.state.doc.toString()).toBe(`${source}，后文保留。`)
      expect(chat.mock.calls[0]?.[0][1]).toEqual({ role: 'user', content: source })
    } finally { ctx.cleanup() }
  })

  it('cancel closes the review without changing editor text', async () => {
    const ctx = setup()
    try {
      await act(async () => { await ctx.result.current.run(action, ctx.target) })
      act(() => ctx.result.current.close())
      expect(ctx.result.current.review).toBeNull()
      expect(ctx.view.state.doc.toString()).toBe(`${source}，准备继续复习。`)
    } finally { ctx.cleanup() }
  })

  it.each(['', '  \n ', '第一段\n第二段', '**加粗**', '字'.repeat(121)])(
    'refuses invalid edited candidate %j without changing body or marking target stale', async candidate => {
      const ctx = setup()
      try {
        await act(async () => { await ctx.result.current.run(action, ctx.target) })
        act(() => ctx.result.current.editCandidate(candidate))
        // Readiness means the review has an editable result; apply still
        // validates each edit before touching the document.
        expect(ctx.result.current.review?.candidateReady).toBe(true)
        act(() => ctx.result.current.apply())
        expect(ctx.view.state.doc.toString()).toBe(`${source}，准备继续复习。`)
        expect(ctx.result.current.review?.stale).toBe(false)
        expect(ctx.result.current.review?.error).toBeTruthy()
      } finally { ctx.cleanup() }
    },
  )

  it('keeps a hand-edited candidate during regeneration, preserves it on failure, and replaces it on success', async () => {
    const first = deferred<AIResponse>()
    const second = deferred<AIResponse>()
    const chat = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const ctx = setup(undefined, 0, source.length, chat)
    try {
      act(() => { void ctx.result.current.run(action, ctx.target) })
      await act(async () => { first.resolve({ content: '候选 A' }); await first.promise })
      act(() => ctx.result.current.editCandidate('手改 A'))
      act(() => { void ctx.result.current.run(action, ctx.target) })
      expect(ctx.result.current.review?.loading).toBe(true)
      expect(ctx.result.current.review?.candidate).toBe('手改 A')
      await act(async () => { second.reject(new Error('network down')); try { await second.promise } catch {} })
      expect(ctx.result.current.review?.candidate).toBe('手改 A')
      expect(ctx.result.current.review?.candidateReady).toBe(true)
      expect(ctx.result.current.review?.error).toBe('network down')
      act(() => ctx.result.current.editCandidate('手改后 A'))
      expect(ctx.result.current.review?.candidate).toBe('手改后 A')
      expect(chat.mock.calls[1]?.[0][1]).toEqual({ role: 'user', content: source })
    } finally { ctx.cleanup() }

    const successChat = vi.fn().mockResolvedValueOnce({ content: '候选 A' }).mockResolvedValueOnce({ content: '候选 B' })
    const success = setup(undefined, 0, source.length, successChat)
    try {
      await act(async () => { await success.result.current.run(action, success.target) })
      act(() => success.result.current.editCandidate('手改 A'))
      await act(async () => { await success.result.current.run(action, success.target) })
      expect(success.result.current.review?.candidate).toBe('候选 B')
      expect(successChat.mock.calls[1]?.[0][1]).toEqual({ role: 'user', content: source })
    } finally { success.cleanup() }
  })

  it('keeps the newest regeneration when an older response resolves last', async () => {
    const older = deferred<AIResponse>()
    const newer = deferred<AIResponse>()
    const chat = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const ctx = setup(undefined, 0, source.length, chat)
    try {
      act(() => { void ctx.result.current.run(action, ctx.target) })
      act(() => { void ctx.result.current.run(action, ctx.target) })
      await act(async () => { newer.resolve({ content: '候选 B' }); await newer.promise })
      await act(async () => { older.resolve({ content: '候选 A' }); await older.promise })
      expect(ctx.result.current.review?.candidate).toBe('候选 B')
    } finally { ctx.cleanup() }
  })

  it.each(['close', 'unmount', 'identity switch'] as const)('ignores late response after %s', async ending => {
    const request = deferred<AIResponse>()
    const ctx = setup(undefined, 0, source.length, () => request.promise)
    try {
      act(() => { void ctx.result.current.run(action, ctx.target) })
      if (ending === 'close') act(() => ctx.result.current.close())
      if (ending === 'identity switch') ctx.rerender({ identity: 'day-2' })
      if (ending === 'unmount') ctx.unmount()
      await act(async () => { request.resolve({ content: '过期候选' }); await request.promise })
      if (ending === 'unmount') {
        // The hook result remains the last mounted snapshot; the late response
        // must not publish a candidate into that snapshot or edit the document.
        expect(ctx.result.current.review?.candidate).toBe('')
        expect(ctx.result.current.review?.loading).toBe(true)
      } else expect(ctx.result.current.review).toBeNull()
      expect(ctx.view.state.doc.toString()).toBe(`${source}，准备继续复习。`)
    } finally { ctx.cleanup() }
  })

  it('invalidates on document or selection changes, blocks apply during IME, and rechecks the captured target at apply time', async () => {
    const ctx = setup()
    try {
      await act(async () => { await ctx.result.current.run(action, ctx.target) })
      ctx.view.dispatch({ changes: { from: ctx.view.state.doc.length, insert: '外部' } })
      act(() => ctx.result.current.invalidate())
      expect(ctx.result.current.review?.stale).toBe(true)
      act(() => ctx.result.current.apply())
      expect(ctx.view.state.doc.toString()).toBe(`${source}，准备继续复习。外部`)

      const freshTarget = capturePolishTarget(ctx.view.state, 'day-1')
      ctx.view.dispatch({ selection: { anchor: 1, head: 3 } })
      await act(async () => { await ctx.result.current.run(action, freshTarget) })
      act(() => ctx.result.current.invalidate())
      expect(ctx.result.current.review?.stale).toBe(true)
      act(() => ctx.result.current.close())
      ctx.view.dispatch({ selection: { anchor: 0, head: source.length } })
      const imeTarget = capturePolishTarget(ctx.view.state, 'day-1')
      await act(async () => { await ctx.result.current.run(action, imeTarget) })
      Object.defineProperty(ctx.view, 'compositionStarted', { configurable: true, get: () => true })
      act(() => ctx.result.current.apply())
      expect(ctx.view.state.doc.toString()).toBe(`${source}，准备继续复习。外部`)
      expect(ctx.result.current.review?.stale).toBe(true)
    } finally { ctx.cleanup() }
  })
})
