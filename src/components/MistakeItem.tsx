import { useState } from 'react'
import { Mistake } from '../types'
import { CheckCircle2, Clock, Eye, EyeOff, Undo2, Pencil, Trash2, Pin } from 'lucide-react'
import { isDueForReview } from '../utils/spacedRepetition'
import { REVIEW_QUALITIES } from '../utils/reviewLabels'
import Latex from 'react-latex-next'
import { toLocalAssetUrl } from '../utils/localAssetUrl'
import ClickableImage from './ClickableImage'
import type { PreviewImage } from './ImagePreviewModal'
import MarkdownRenderer from './common/MarkdownRenderer'

interface MistakeItemProps {
    mistake: Mistake
    parseImagePaths: (raw?: string | null) => string[]
    toggleMastered: (id: number) => void
    handleEdit: (m: Mistake) => void
    handleDelete: (id: number) => void
    handleReview: (m: Mistake, quality: number) => void
    onPreviewImage: (image: PreviewImage) => void
}

export function MistakeItem({ 
    mistake: m, 
    parseImagePaths, 
    toggleMastered, 
    handleEdit, 
    handleDelete, 
    handleReview,
    onPreviewImage,
}: MistakeItemProps) {
    const [answerVisible, setAnswerVisible] = useState(false)
    const dueForReview = isDueForReview(m.next_review_date)
    const hasAnswerContent = Boolean(m.answer || m.notes)
    const canRevealAnswer = hasAnswerContent || (!m.mastered && dueForReview)
    const showReviewControls = answerVisible && !m.mastered && dueForReview

    return (
        <div className="card" style={{
            padding: 'var(--space-md)',
            borderLeft: `3px solid ${m.subject_color || 'var(--border)'}`,
            opacity: m.mastered ? 0.6 : 1
        }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-xs)' }}>
                <div className="flex items-center gap-sm">
                    {m.subject_name && (
                        <span className="text-sm" style={{
                            background: m.subject_color + '22', color: m.subject_color,
                            padding: '1px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 500
                        }}>
                            {m.subject_name}
                        </span>
                    )}
                    {m.mastered
                        ? <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={13} /> 斩首成功 (已掌握)</span>
                        : dueForReview
                            ? <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={13} /> 今日待复习</span>
                            : <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={13} /> 下次复习: {m.next_review_date}</span>
                    }
                </div>
                <div className="flex gap-xs">
                    <button className="button button-secondary" style={{ padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => toggleMastered(m.id)}
                        aria-label={m.mastered ? "撤销掌握，重新加入计划" : "标记为已彻底掌握"}
                    >
                        {m.mastered ? <><Undo2 size={13} aria-hidden /> 重新加入计划</> : <><CheckCircle2 size={13} aria-hidden /> 彻底掌握</>}
                    </button>
                    <button className="button button-secondary" style={{ padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => handleEdit(m)}
                        aria-label="编辑错题"
                        title="编辑错题"
                    ><Pencil size={13} aria-hidden /></button>
                    <button className="button button-secondary" style={{ padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => handleDelete(m.id)}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'inherit'}
                        aria-label="删除错题"
                        title="删除错题"
                    ><Trash2 size={13} aria-hidden /></button>
                </div>
            </div>
            <div className="content-selectable" style={{ marginBottom: 'var(--space-xs)', lineHeight: 1.6 }}>
                <strong>Q：</strong><Latex>{m.question}</Latex>
            </div>
            {m.image_path && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: 'var(--space-sm) 0' }}>
                    {parseImagePaths(m.image_path).map((imgPath, idx) => {
                        const imageUrl = toLocalAssetUrl(imgPath, 'mistake_images')
                        const alt = `错题附图 ${idx + 1}`
                        return (
                            <ClickableImage
                                key={idx}
                                src={imageUrl}
                                alt={alt}
                                onPreview={onPreviewImage}
                                ariaLabel={`放大查看${alt}`}
                                title={`放大查看${alt}`}
                                buttonStyle={{
                                    padding: 0,
                                    border: 'none',
                                    background: 'transparent',
                                    cursor: 'zoom-in',
                                    display: 'block',
                                    maxWidth: '100%',
                                }}
                                imageStyle={{ maxHeight: 240, maxWidth: '100%', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                            />
                        )
                    })}
                </div>
            )}
            {canRevealAnswer && (
                <div style={{ marginTop: 'var(--space-sm)' }}>
                    <button
                        type="button"
                        className="button button-secondary"
                        data-testid={`mistake-toggle-answer-${m.id}`}
                        onClick={() => setAnswerVisible(visible => !visible)}
                        style={{ padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                        {answerVisible ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
                        {answerVisible ? '隐藏答案' : '查看答案'}
                    </button>
                </div>
            )}
            {answerVisible && m.answer && (
                <div className="text-secondary content-selectable" style={{ marginBottom: 'var(--space-xs)', lineHeight: 1.6 }}>
                    <strong>A：</strong><Latex>{m.answer}</Latex>
                </div>
            )}
            {answerVisible && m.notes && (
                <div className="text-sm text-muted content-selectable" style={{ fontStyle: 'italic', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                    <Pin size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                    <MarkdownRenderer className="mistake-notes-md">{m.notes}</MarkdownRenderer>
                </div>
            )}
            {answerVisible && !hasAnswerContent && (
                <div className="text-sm text-muted" style={{ marginTop: 'var(--space-xs)' }}>
                    暂无答案或备注
                </div>
            )}
            
            {/* Spaced Repetition Review Buttons */}
            {showReviewControls && (
                <div className="flex gap-sm" style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--border)' }}>
                    {REVIEW_QUALITIES.map(rq => (
                        <button 
                            key={rq.quality}
                            className="button button-secondary"
                            style={{ flex: 1, color: rq.color, borderColor: rq.color + '44' }}
                            onClick={() => handleReview(m, rq.quality)}
                        >
                            {rq.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
