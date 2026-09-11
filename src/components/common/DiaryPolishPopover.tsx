import { useEffect, useRef } from 'react'
import { polishActions } from '../../utils/diaryPolish'
import type { PolishReview } from './useDiaryPolish'

export default function DiaryPolishPopover({ review, onClose, onRegenerate, onApply }: {
  review: PolishReview; onClose: () => void; onRegenerate: () => void; onApply: () => void
}) {
  const dismiss = useRef<HTMLButtonElement>(null)
  useEffect(() => { dismiss.current?.focus() }, [])
  return <section className="diary-polish-review" role="dialog" aria-label="AI 润色候选" data-diary-format="true"
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>
    <header><strong>{polishActions[review.action].label}</strong><span>仅发送选区 · 应用后才修改正文</span></header>
    <div className="diary-polish-review__text">
      {review.target && <><h3>原文</h3><p>{review.target.source}</p></>}
      {review.loading && <p role="status">正在生成候选… 你可以继续写作。</p>}
      {review.stale && <p role="alert">原文或选区已发生变化，请重新选择并生成。</p>}
      {review.error && <p role="alert">{review.error}</p>}
      {review.candidate && <><h3>候选</h3><p className="diary-polish-review__candidate">{review.candidate}</p></>}
    </div>
    <footer>
      <button type="button" onClick={onRegenerate} disabled={!review.target || review.stale}>重新生成</button>
      <button ref={dismiss} type="button" onClick={onClose}>放弃</button>
      <button type="button" className="diary-polish-review__apply" onClick={onApply}
        disabled={review.loading || review.stale || !review.candidate}>应用</button>
    </footer>
  </section>
}
