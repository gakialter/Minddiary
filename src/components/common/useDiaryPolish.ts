import { useLayoutEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import type { AIMessage, AIResponse } from '../../types'
import { buildPolishMessages, validatePolishCandidate, type PolishAction } from '../../utils/diaryPolish'
import { capturePolishTarget, polishTargetMatches, polishTransaction, type PolishTarget } from './diaryPolishTarget'

export interface PolishReview { target: PolishTarget | null; action: PolishAction; loading: boolean; stale: boolean; error: string; candidate: string; candidateReady: boolean }
export function useDiaryPolish(viewRef: React.MutableRefObject<EditorView | undefined>, identity: string,
  chat?: (messages: AIMessage[]) => Promise<AIResponse>) {
  const [review, setReview] = useState<PolishReview | null>(null)
  const current = useRef<PolishReview | null>(null)
  const generation = useRef(0)
  const latest = useRef({ identity, chat })
  latest.current = { identity, chat }
  const publish = (next: PolishReview | null) => { current.current = next; setReview(next) }
  const close = () => { generation.current++; publish(null) }
  const invalidate = () => {
    generation.current++
    if (current.current) publish({ ...current.current, loading: false, stale: true })
  }
  useLayoutEffect(() => { close(); return () => { generation.current++; current.current = null } }, [identity])
  const run = async (action: PolishAction, original?: PolishTarget | null) => {
    const view = viewRef.current
    if (!view || view.compositionStarted) return
    const target = original ?? capturePolishTarget(view.state, latest.current.identity)
    const token = ++generation.current
    const previous = original && current.current?.target === original ? current.current : null
    const next: PolishReview = { target, action, loading: !!target, stale: false, error: '',
      candidate: previous?.candidate ?? '', candidateReady: previous?.candidateReady ?? false }
    if (!target) next.error = '请选择一段连续正文后再使用 AI 润色。'
    else if (!polishTargetMatches(view.state, latest.current.identity, target)) { next.stale = true; next.loading = false }
    publish(next)
    if (!target || next.stale) return
    try {
      if (!latest.current.chat) throw new Error('当前环境无法使用 AI，请在桌面应用中配置 AI。')
      const result = await latest.current.chat(buildPolishMessages(target.source, action))
      if (token !== generation.current) return
      if (view.compositionStarted || !polishTargetMatches(view.state, latest.current.identity, target)) { invalidate(); return }
      if (result?.error) throw new Error(result.error)
      const candidate = validatePolishCandidate(result?.content, target.source)
      publish({ ...next, loading: false, candidate, candidateReady: true })
    } catch (error) {
      if (token !== generation.current) return
      publish({ ...current.current!, loading: false, error: error instanceof Error ? error.message : 'AI 请求失败，请检查网络。' })
    }
  }
  const editCandidate = (candidate: string) => {
    if (current.current?.candidateReady) publish({ ...current.current, candidate })
  }
  const apply = () => {
    const next = current.current, view = viewRef.current
    if (!next?.target || !view || next.loading || next.stale || !next.candidateReady) return
    if (view.compositionStarted) { invalidate(); return }
    let tr
    try { tr = polishTransaction(view.state, latest.current.identity, next.target, next.candidate) }
    catch (error) {
      publish({ ...next, error: error instanceof Error ? error.message : '候选文本无效，请修改后再应用。' })
      return
    }
    if (!tr) { invalidate(); return }
    close()
    view.dispatch(tr)
    view.focus()
  }
  return { review, run, close, invalidate, editCandidate, apply }
}
