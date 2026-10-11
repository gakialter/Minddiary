import { useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import type { AIMessage, AIResponse } from '../../types'
import { buildPolishMessages, validatePolishCandidate, type PolishAction } from '../../utils/diaryPolish'
import { capturePolishTarget, polishTargetMatches, polishTransaction, type PolishTarget } from './diaryPolishTarget'
import { useDiaryPolishSessions } from './DiaryPolishSessionContext'

export interface PolishReview { target: PolishTarget | null; action: PolishAction; loading: boolean; stale: boolean; error: string; candidate: string; candidateReady: boolean }
export function useDiaryPolish(viewRef: React.MutableRefObject<EditorView | undefined>, identity: string,
  chat?: (messages: AIMessage[]) => Promise<AIResponse>, previousIdentity?: string) {
  const sessions = useDiaryPolishSessions()
  const [review, setReview] = useState<PolishReview | null>(null)
  const current = useRef<PolishReview | null>(null)
  const generation = useRef(0)
  const latest = useRef({ identity, chat, previousIdentity })
  latest.current = { identity, chat, previousIdentity }
  const publish = (next: PolishReview | null) => {
    current.current = next
    if (next?.target && next.candidateReady) sessions.set(next.target.identity, { ...next, loading: false })
    setReview(next)
  }
  const close = () => { generation.current++; sessions.delete(latest.current.identity); publish(null) }
  const invalidate = () => {
    generation.current++
    // Synchronizing a different record must not expire this record's saved draft.
    if (current.current?.target?.identity === latest.current.identity) {
      publish({ ...current.current, loading: false, stale: true })
    }
  }
  useEffect(() => {
    const promoting = !!previousIdentity && previousIdentity !== identity
    let keepPendingPromotion = false
    if (promoting) {
      const active = current.current
      if (active?.target?.identity === previousIdentity) {
        // Keep the captured target object so an in-flight request sees the promoted identity.
        active.target.identity = identity
        const view = viewRef.current
        const matches = !!view && polishTargetMatches(view.state, identity, active.target)
        const promoted = { ...active, stale: active.stale || !matches, loading: active.loading && matches }
        keepPendingPromotion = promoted.loading && matches
        if (active.loading && !matches) generation.current++
        publish(promoted)
      } else {
        generation.current++
      }
      const previous = sessions.get(previousIdentity)
      if (previous?.target) sessions.set(identity, { ...previous, target: { ...previous.target, identity } })
      sessions.delete(previousIdentity)
    } else {
      generation.current++
    }
    if (!keepPendingPromotion && !(promoting && current.current?.target?.identity === identity)) {
      const saved = sessions.get(identity)
      const view = viewRef.current
      publish(saved ? { ...saved, stale: saved.stale || !view || !saved.target || !polishTargetMatches(view.state, identity, saved.target) } : null)
    }
    return () => {
      if (latest.current.identity !== identity && latest.current.previousIdentity === identity) return
      generation.current++
      current.current = null
    }
  }, [identity, previousIdentity, sessions])
  const run = async (action: PolishAction, original?: PolishTarget | null) => {
    const view = viewRef.current
    if (!view || view.compositionStarted) return
    const target = original ?? capturePolishTarget(view.state, latest.current.identity)
    if (!original) sessions.delete(latest.current.identity)
    const token = ++generation.current
    const previous = original && current.current?.target === original ? current.current : null
    const next: PolishReview = { target, action, loading: !!target, stale: false, error: '',
      candidate: previous?.candidate ?? '', candidateReady: previous?.candidateReady ?? false }
    if (!target) next.error = '请先选中一段连续正文。'
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
      publish({ ...current.current!, loading: false, error: error instanceof Error ? error.message : 'AI 润色请求未完成，请稍后重试。' })
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
      publish({ ...next, error: error instanceof Error ? error.message : '修改稿无效，请修改后再替换选中文字。' })
      return
    }
    if (!tr) { invalidate(); return }
    close()
    view.dispatch(tr)
    view.focus()
  }
  return { review, run, close, invalidate, editCandidate, apply }
}
