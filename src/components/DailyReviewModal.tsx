import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import Latex from 'react-latex-next'
import { useDiary } from '../contexts/DiaryContext'
import { useModalFocus } from '../hooks/useModalFocus'
import type { Subject } from '../types'
import type { DailyReviewCommand, DailyReviewSnapshot } from '../types/dailyReview'
import { getDelayUntilNextLocalDate, getLocalDateKey } from '../utils/dateKey'
import { toLocalAssetUrl } from '../utils/localAssetUrl'
import ClickableImage from './ClickableImage'
import ImagePreviewModal, { type PreviewImage } from './ImagePreviewModal'
import MarkdownRenderer from './common/MarkdownRenderer'
import './DailyReviewModal.css'

function imagePaths(raw?: string | null): string[] {
    if (!raw?.trim()) return []
    if (!raw.trim().startsWith('[')) return [raw]
    try {
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && !!item.trim()) : []
    } catch { return [] }
}

export default function DailyReviewModal({ subjects, subjectId: initialSubjectId, onClose }: {
    subjects: Subject[]; subjectId?: number; onClose: () => void
}) {
    const { dailyReview } = useDiary()
    const modalRef = useModalFocus(onClose)
    const [subjectId, setSubjectId] = useState(initialSubjectId ?? subjects[0]?.id ?? 0)
    const [quota, setQuota] = useState('50')
    const [snapshot, setSnapshot] = useState<DailyReviewSnapshot | null>(null)
    const [revealed, setRevealed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [preview, setPreview] = useState<PreviewImage | null>(null)
    const inFlight = useRef(false)
    const generation = useRef(0)
    const subjectAvailable = subjects.some(subject => subject.id === subjectId)

    useEffect(() => {
        const nextSubjectId = subjectAvailable ? subjectId
            : subjects.find(subject => subject.id === initialSubjectId)?.id ?? subjects[0]?.id ?? 0
        if (nextSubjectId !== subjectId) {
            generation.current++
            inFlight.current = false
            setBusy(false)
            setSubjectId(nextSubjectId)
        }
    }, [subjects, initialSubjectId, subjectId, subjectAvailable])

    const execute = useCallback(async (command: DailyReviewCommand, loadQuota = false) => {
        if (inFlight.current) return
        inFlight.current = true
        setBusy(true)
        setError('')
        const requestGeneration = generation.current
        try {
            const next = await dailyReview.execute(command)
            if (requestGeneration !== generation.current) return
            setSnapshot(next)
            setRevealed(false)
            if (loadQuota) setQuota(String(next.quota ?? 50))
        } catch (cause) {
            if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : '无法保存复盘进度，请重试')
        } finally {
            if (requestGeneration === generation.current) {
                inFlight.current = false
                setBusy(false)
            }
        }
    }, [dailyReview])

    useEffect(() => {
        setSnapshot(null)
        if (subjectAvailable) void execute({ kind: 'get', subjectId, date: getLocalDateKey() }, true)
    }, [subjectId, subjectAvailable, execute])

    useEffect(() => {
        if (!subjectId) return
        let timer: ReturnType<typeof setTimeout>
        const refresh = () => {
            if (!inFlight.current) void execute({ kind: 'get', subjectId, date: getLocalDateKey() })
        }
        const schedule = () => {
            timer = setTimeout(() => { refresh(); schedule() }, getDelayUntilNextLocalDate())
        }
        schedule()
        window.addEventListener('focus', refresh)
        return () => { clearTimeout(timer); window.removeEventListener('focus', refresh) }
    }, [subjectId, execute])

    const item = snapshot?.currentItem
    const images = (raw: string | null | undefined, role: string) => imagePaths(raw).map((path, index) => (
        <ClickableImage key={`${role}-${path}-${index}`} src={toLocalAssetUrl(path, 'mistake_images')}
            alt={`${role}图片 ${index + 1}`} ariaLabel={`放大查看${role}图片 ${index + 1}`} onPreview={setPreview}
            imageStyle={{ maxWidth: '100%', maxHeight: 200 }} />
    ))
    const dailyDone = !!snapshot?.quota && snapshot.dailyCompleted >= snapshot.quota
    const canStart = snapshot && (snapshot.status === 'ready' || snapshot.status === 'round_done') && !dailyDone && snapshot.subjectTotal > 0

    return createPortal(<div className="c8-review-overlay">
        <div ref={modalRef} role="dialog" aria-modal="true" aria-label="日常复盘" tabIndex={-1} className="c8-review-dialog daily-review-dialog">
            <header className="daily-review-header"><h2>日常复盘</h2><button type="button" className="button c8-review-close" aria-label="关闭日常复盘" onClick={onClose}><X size={18} /></button></header>
            <div className="c8-review-body">
                <form className="daily-review-config" onSubmit={event => {
                    event.preventDefault()
                    void execute({ kind: 'configure', subjectId, date: getLocalDateKey(), quota: Number(quota) })
                }}>
                    <label>科目<select className="input" value={subjectId} disabled={busy} onChange={event => { generation.current++; setSubjectId(Number(event.target.value)) }}>
                        {!subjects.length && <option value={0}>暂无科目</option>}
                        {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                    </select></label>
                    <label>每日题量<input className="input" type="number" min="1" step="1" required value={quota} disabled={busy} onChange={event => setQuota(event.target.value)} /></label>
                    <button className="button button-secondary" type="submit" disabled={busy || !subjectId}>保存</button>
                </form>
                {snapshot && <p className="text-muted">本科目共 {snapshot.subjectTotal} 题{snapshot.quota !== null && ` · 每日 ${snapshot.quota} 题 · 预计约 ${snapshot.estimatedDays} 天 / 轮`}</p>}
                {error && <div role="alert"><p>{error}</p><button className="button button-secondary" onClick={() => void execute({ kind: 'get', subjectId, date: getLocalDateKey() }, true)} disabled={busy}>重新读取进度</button></div>}
                {snapshot?.status === 'unconfigured' && <p>设置每日题量，保存后即可开始。包含本科目全部错题。</p>}
                {snapshot?.status === 'round_done' && <p role="status">本轮已完成 · {snapshot.roundTotal} / {snapshot.roundTotal}。{dailyDone ? '今日目标也已完成。' : '可开始下一轮。'}</p>}
                {snapshot?.status === 'daily_done' && <p role="status">今日目标已完成，明天从本轮剩余题目继续。</p>}
                {snapshot?.subjectTotal === 0 && <p>本科目暂无错题，添加后可开始新一轮。</p>}
                {item && <article className="daily-review-content" key={`${snapshot.roundId}-${item.id}`}>
                    <h3>题目</h3><div className="content-selectable"><Latex>{item.question}</Latex></div>
                    <div className="daily-review-images">{images(item.image_path, '题目')}</div>
                    {revealed && <><h3>答案</h3><div className="content-selectable"><Latex>{item.answer || '暂无答案'}</Latex></div>
                        <div className="daily-review-images">{images(item.answer_image_path, '答案')}</div>
                        {item.notes && <><h3>备注</h3><MarkdownRenderer>{item.notes}</MarkdownRenderer></>}
                    </>}
                </article>}
                {busy && <p role="status">正在读取或保存进度…</p>}
            </div>
            <footer className="daily-review-footer">
                {snapshot?.quota != null && <div className="daily-review-progress" aria-live="polite">
                    <span>今日：{snapshot.dailyCompleted} / {snapshot.quota}</span>
                    <span>本轮：{snapshot.roundCompleted} / {snapshot.roundTotal}</span><span>剩余：{snapshot.remaining}</span>
                </div>}
                <div className="daily-review-actions">
                    <button type="button" className="button button-secondary" onClick={onClose}>{dailyDone ? '结束今日复盘' : '返回错题本'}</button>
                    {canStart && <button type="button" className="button button-primary" disabled={busy || !!error} onClick={() => void execute({ kind: 'start', subjectId, date: getLocalDateKey(), previousRoundId: snapshot.roundId })}>{snapshot.roundId ? '开始下一轮' : '开始本轮'}</button>}
                    {item && !revealed && <button type="button" className="button button-primary" disabled={busy || !!error} onClick={() => setRevealed(true)}>查看答案</button>}
                    {item && revealed && snapshot.roundId && <button type="button" className="button button-primary" disabled={busy || !!error} onClick={() => void execute({ kind: 'complete', subjectId, date: getLocalDateKey(), roundId: snapshot.roundId!, mistakeId: item.id })}>完成本题 / 下一题</button>}
                </div>
            </footer>
        </div>
        {preview && <ImagePreviewModal image={preview} onClose={() => setPreview(null)} />}
    </div>, document.body)
}
