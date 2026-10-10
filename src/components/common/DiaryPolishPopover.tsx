import { useEffect, useId, useMemo, useRef } from 'react'
import { polishActions, validatePolishCandidate } from '../../utils/diaryPolish'
import type { PolishReview } from './useDiaryPolish'

export default function DiaryPolishPopover({ review, onClose, onRegenerate, onCandidateChange, onApply }: {
  review: PolishReview
  onClose: () => void
  onRegenerate: () => void
  onCandidateChange: (candidate: string) => void
  onApply: () => void
}) {
  const dismiss = useRef<HTMLButtonElement>(null)
  const validationId = useId()
  useEffect(() => { dismiss.current?.focus() }, [])

  const validationError = useMemo(() => {
    if (!review.candidateReady || !review.target) return ''
    try {
      validatePolishCandidate(review.candidate, review.target.source)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message.replace('AI 返回了空文本', '修改稿不能为空').replace('请重新生成', '请修改后再替换选中文字')
        : '候选内容无效，请修改后再应用。'
    }
  }, [review.candidate, review.candidateReady, review.target])

  return <section className="diary-polish-review" role="dialog" aria-label="AI 修改稿" data-diary-format="true"
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
    <header><strong>{polishActions[review.action].label}</strong><span>仅发送选中文字；点击“替换选中文字”后才修改正文。</span></header>
    <div className="diary-polish-review__text">
      {review.target && <><h3>原文</h3><p>{review.target.source}</p></>}
      {review.loading && <p role="status">正在生成；继续修改正文会取消这次结果。</p>}
      {review.stale && <p role="alert">原文或选区已变化，请重新选择并重新生成。</p>}
      {review.error && <p role="alert" className="diary-polish-review__request-error">{review.error}</p>}
      {review.candidateReady && <>
        <h3>修改稿</h3>
        {review.target && <textarea aria-label="修改稿" className="diary-polish-review__candidate"
          aria-invalid={!!validationError} aria-describedby={validationError ? validationId : undefined}
          value={review.candidate} onChange={e => onCandidateChange(e.currentTarget.value)} />}
        <p className="diary-polish-review__hint">重新生成会使用原文；成功后才替换当前修改稿。</p>
        {validationError && <p id={validationId} role="alert" className="diary-polish-review__validation-error">{validationError}</p>}
      </>}
    </div>
    <footer>
      <button type="button" onClick={onRegenerate} disabled={!review.target || review.stale}>重新生成</button>
      <button ref={dismiss} type="button" onClick={onClose}>放弃修改</button>
      <button type="button" className="diary-polish-review__apply" onClick={onApply}
        disabled={review.loading || review.stale || !review.candidateReady || !!validationError}>替换选中文字</button>
    </footer>
  </section>
}
