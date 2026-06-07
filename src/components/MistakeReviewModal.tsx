import { useCallback, useEffect, useState } from 'react'
import { BookOpen, CheckCircle, Pin, RotateCcw, Trophy, X } from 'lucide-react'
import Latex from 'react-latex-next'
import { useDiary } from '../contexts/DiaryContext'
import type { Mistake } from '../types'
import { getLocalDateKey } from '../utils/dateKey'
import { logger } from '../utils/logger'
import { toLocalAssetUrl } from '../utils/localAssetUrl'
import { REVIEW_QUALITIES } from '../utils/reviewLabels'
import { calculateNextReview } from '../utils/spacedRepetition'
import ClickableImage from './ClickableImage'
import ImagePreviewModal, { type PreviewImage } from './ImagePreviewModal'
import MarkdownRenderer from './common/MarkdownRenderer'

export interface MistakeReviewModalProps {
    onClose: () => void
    variant: 'break' | 'manual'
    subjectId?: number
}

type ReviewPhase = 'question' | 'answer' | 'done'

const parseImagePaths = (raw?: string | null): string[] => {
    if (!raw) return []
    if (raw.startsWith('[')) {
        try {
            return JSON.parse(raw)
        } catch {
            return []
        }
    }
    return [raw]
}

export default function MistakeReviewModal({ onClose, variant, subjectId }: MistakeReviewModalProps) {
    const diary = useDiary()
    const [mistake, setMistake] = useState<Mistake | null>(null)
    const [loading, setLoading] = useState(true)
    const [phase, setPhase] = useState<ReviewPhase>('question')
    const [noMistakes, setNoMistakes] = useState(false)
    const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null)

    const isBreakReview = variant === 'break'
    const testPrefix = isBreakReview ? 'break-review' : 'mistake-review'
    const title = isBreakReview ? '休息时间 · 顺手刷一题！' : '错题复习'
    const loadingText = isBreakReview ? '正在从错题本抓题...' : '正在抽取今日待复习错题...'
    const emptyTitle = isBreakReview ? '今日无欠债！' : '当前没有待复习错题'
    const emptyText = isBreakReview
        ? '今天该复习的都搞定了，继续加油！'
        : subjectId
            ? '当前科目今天没有到期错题。'
            : '今天没有到期错题。'
    const emptyActionText = isBreakReview ? '好的，去休息' : '返回错题本'
    const closeDoneText = isBreakReview ? '好的，够了' : '返回错题本'

    const loadRandomMistake = useCallback(async () => {
        setLoading(true)
        setPhase('question')
        try {
            const today = getLocalDateKey()
            const dueMistake = subjectId === undefined
                ? await diary.mistakes.getRandomDue(today)
                : await diary.mistakes.getRandomDue(today, subjectId)
            if (!dueMistake) {
                setNoMistakes(true)
                setMistake(null)
            } else {
                setMistake(dueMistake)
                setNoMistakes(false)
            }
        } catch (e) {
            logger.error(e)
            setMistake(null)
            setNoMistakes(true)
        } finally {
            setLoading(false)
        }
    }, [diary.mistakes, subjectId])

    useEffect(() => {
        loadRandomMistake()
    }, [loadRandomMistake])

    const handleReview = async (quality: number) => {
        if (!mistake) return
        try {
            const result = calculateNextReview(
                quality,
                mistake.ease_factor || 2.5,
                mistake.review_interval || 1,
                mistake.review_count || 0
            )
            await diary.mistakes.review(mistake.id, result)
            diary.requestDataRefresh()
            setPhase('done')
        } catch (e) {
            logger.error(e)
        }
    }

    const imagePaths = parseImagePaths(mistake?.image_path)

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'page-fade-in 0.2s ease-out'
        }}>
            <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 32px 96px rgba(0,0,0,0.4)',
                width: '100%', maxWidth: 520,
                margin: '0 var(--space-lg)',
                overflow: 'hidden',
                animation: 'slide-up 0.3s cubic-bezier(0.2, 0, 0, 1)'
            }}>
                <div style={{
                    padding: 'var(--space-md) var(--space-lg)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-secondary))'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--warning)', fontWeight: 700 }}>
                        <BookOpen size={18} />
                        <span>{title}</span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="关闭复习"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4 }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div style={{ padding: 'var(--space-xl)' }}>
                    {loading && (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-2xl)' }}>
                            <div style={{ width: 32, height: 32, border: '3px solid var(--warning)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto var(--space-md)' }} />
                            {loadingText}
                        </div>
                    )}

                    {!loading && noMistakes && (
                        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
                            <Trophy size={48} style={{ color: 'var(--success)', margin: '0 auto var(--space-md)', display: 'block' }} />
                            <h3 style={{ color: 'var(--success)', marginBottom: 'var(--space-sm)' }}>{emptyTitle}</h3>
                            <p className="text-muted" style={{ marginBottom: 'var(--space-lg)' }}>{emptyText}</p>
                            <button className="button button-primary" onClick={onClose}>{emptyActionText}</button>
                        </div>
                    )}

                    {!loading && mistake && (
                        <div>
                            {mistake.subject_name && (
                                <span style={{
                                    display: 'inline-block',
                                    background: (mistake.subject_color || 'var(--accent)') + '22',
                                    color: mistake.subject_color || 'var(--accent)',
                                    padding: '2px 10px', borderRadius: 'var(--radius-sm)',
                                    fontSize: 13, fontWeight: 500, marginBottom: 'var(--space-md)'
                                }}>
                                    {mistake.subject_name}
                                </span>
                            )}

                            <div className="content-selectable" style={{
                                background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)',
                                padding: 'var(--space-md)', marginBottom: 'var(--space-md)',
                                lineHeight: 1.7, fontSize: 15
                            }}>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>题目</div>
                                <Latex>{mistake.question}</Latex>
                            </div>

                            {imagePaths.length > 0 && (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--space-md)' }}>
                                    {imagePaths.map((imgPath, idx) => {
                                        const imageUrl = toLocalAssetUrl(imgPath, 'mistake_images')
                                        const alt = `错题复习图片 ${idx + 1}`
                                        return (
                                            <ClickableImage
                                                key={idx}
                                                src={imageUrl}
                                                alt={alt}
                                                onPreview={setPreviewImage}
                                                ariaLabel={`放大查看${alt}`}
                                                title={`放大查看${alt}`}
                                                buttonStyle={{
                                                    padding: 0,
                                                    border: 'none',
                                                    background: 'transparent',
                                                    cursor: 'zoom-in',
                                                    maxWidth: '100%',
                                                }}
                                                imageStyle={{ maxWidth: '100%', maxHeight: 180, borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                                            />
                                        )
                                    })}
                                </div>
                            )}

                            {phase === 'question' && (
                                <button
                                    type="button"
                                    className="button button-primary"
                                    data-testid={`${testPrefix}-reveal-answer`}
                                    style={{ width: '100%', justifyContent: 'center' }}
                                    onClick={() => setPhase('answer')}
                                >
                                    查看答案
                                </button>
                            )}

                            {phase === 'answer' && (
                                <div>
                                    <div className="content-selectable" style={{
                                        background: 'color-mix(in srgb, var(--success) 8%, var(--bg-secondary))',
                                        border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
                                        borderRadius: 'var(--radius)', padding: 'var(--space-md)',
                                        marginBottom: 'var(--space-md)', lineHeight: 1.7, fontSize: 14
                                    }}>
                                        <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 6, fontWeight: 600 }}>答案</div>
                                        {mistake.answer ? <Latex>{mistake.answer}</Latex> : <span className="text-muted">暂无答案</span>}
                                        {mistake.notes && (
                                            <div style={{ marginTop: 'var(--space-sm)', fontSize: 13, color: 'var(--text-muted)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontWeight: 600 }}>
                                                    <Pin size={13} style={{ flexShrink: 0 }} /> 备注
                                                </div>
                                                <MarkdownRenderer className="mistake-review-notes-md">{mistake.notes}</MarkdownRenderer>
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ marginBottom: 'var(--space-sm)', fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
                                        对自己的掌握情况打分：
                                    </div>
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                        {REVIEW_QUALITIES.map(rq => (
                                            <button
                                                key={rq.quality}
                                                type="button"
                                                className="button button-secondary"
                                                data-testid={`${testPrefix}-quality-${rq.quality}`}
                                                style={{ flex: 1, color: rq.color, borderColor: rq.color + '55', fontSize: 13 }}
                                                onClick={() => handleReview(rq.quality)}
                                            >
                                                {rq.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {phase === 'done' && (
                                <div style={{ textAlign: 'center' }}>
                                    <CheckCircle size={32} style={{ color: 'var(--success)', marginBottom: 'var(--space-sm)' }} />
                                    <div style={{ color: 'var(--success)', fontWeight: 600, marginBottom: 'var(--space-md)', fontSize: 15 }}>
                                        已记录，下一次复习时间已更新
                                    </div>
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center' }}>
                                        <button type="button" className="button button-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={loadRandomMistake}>
                                            <RotateCcw size={14} /> 再来一题
                                        </button>
                                        <button type="button" className="button button-primary" onClick={onClose}>
                                            {closeDoneText}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {!loading && !noMistakes && (
                    <div style={{ padding: 'var(--space-sm) var(--space-lg)', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                        <span className="text-xs text-muted">错题会根据你的作答质量，由 SM-2 算法安排下次复习时间</span>
                    </div>
                )}
            </div>
            <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
        </div>
    )
}
