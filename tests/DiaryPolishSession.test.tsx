import { act, render } from '@testing-library/react'
import { history } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, type MutableRefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AIMessage, AIResponse } from '../src/types'
import { diaryMarkdown, rangeField } from '../src/components/common/diaryEditorState'
import { DiaryPolishSessionProvider } from '../src/components/common/DiaryPolishSessionContext'
import { useDiaryPolish } from '../src/components/common/useDiaryPolish'
import type { PolishAction } from '../src/utils/diaryPolish'

const source = '今天感觉很好'
const originalBody = `${source}，后文保留。`
const action: PolishAction = 'polish'
type PolishController = ReturnType<typeof useDiaryPolish>

function Probe({ identity, previousIdentity, viewRef, chat, controllerRef }: {
  identity: string
  previousIdentity?: string
  viewRef: MutableRefObject<EditorView | undefined>
  chat: (messages: AIMessage[]) => Promise<AIResponse>
  controllerRef: MutableRefObject<PolishController | null>
}) {
  const controller = useDiaryPolish(viewRef, identity, chat, previousIdentity)
  useEffect(() => { controllerRef.current = controller }, [controller, controllerRef])
  return null
}

function setup() {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({ parent, state: EditorState.create({ doc: originalBody,
    selection: { anchor: 0, head: source.length }, extensions: [diaryMarkdown, rangeField, history()] }) })
  const viewRef = { current: view as EditorView | undefined }
  const controllerRef: MutableRefObject<PolishController | null> = { current: null }
  const chat = vi.fn().mockResolvedValue({ content: '今天状态很好' })
  const app = (show: boolean, identity: string, previousIdentity?: string) => <DiaryPolishSessionProvider>
    {show && <Probe key="editor" identity={identity} previousIdentity={previousIdentity}
      viewRef={viewRef} chat={chat} controllerRef={controllerRef} />}
  </DiaryPolishSessionProvider>
  return { view, viewRef, controllerRef, chat, app, cleanup: () => { view.destroy(); parent.remove() } }
}

describe('Diary polish app-session candidates', () => {
  it('restores a ready candidate after the editor hook remounts in the same app session', async () => {
    const ctx = setup()
    try {
      const rendered = render(ctx.app(true, '2026-10-10:12'))
      await act(async () => { await ctx.controllerRef.current!.run(action) })
      expect(ctx.controllerRef.current?.review?.candidate).toBe('今天状态很好')

      rendered.rerender(ctx.app(false, '2026-10-10:12'))
      rendered.rerender(ctx.app(true, '2026-10-10:12'))

      expect(ctx.controllerRef.current?.review).toMatchObject({ candidate: '今天状态很好', candidateReady: true, stale: false })
      expect(ctx.chat).toHaveBeenCalledTimes(1)
    } finally { ctx.cleanup() }
  })

  it('moves an id-zero draft candidate to its saved identity and refuses it after body changes', async () => {
    const ctx = setup()
    try {
      const rendered = render(ctx.app(true, '2026-10-10:0'))
      await act(async () => { await ctx.controllerRef.current!.run(action) })
      rendered.rerender(ctx.app(true, '2026-10-10:42', '2026-10-10:0'))
      expect(ctx.controllerRef.current?.review).toMatchObject({ candidate: '今天状态很好', candidateReady: true, stale: false })

      act(() => { ctx.view.dispatch({ changes: { from: ctx.view.state.doc.length, insert: '新增文字' } }) })
      act(() => ctx.controllerRef.current!.invalidate())
      rendered.rerender(ctx.app(false, '2026-10-10:42'))
      rendered.rerender(ctx.app(true, '2026-10-10:42'))

      expect(ctx.controllerRef.current?.review).toMatchObject({ candidate: '今天状态很好', candidateReady: true, stale: true })
      act(() => ctx.controllerRef.current!.apply())
      expect(ctx.view.state.doc.toString()).toBe(`${originalBody}新增文字`)
    } finally { ctx.cleanup() }
  })
})
