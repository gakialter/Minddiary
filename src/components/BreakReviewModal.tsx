import { useState, useEffect, useCallback } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { calculateNextReview, REVIEW_QUALITIES } from '../utils/spacedRepetition'
import { BookOpen, X, Trophy, RotateCcw, Pin, CheckCircle } from 'lucide-react'
import type { Mistake } from '../types'
import Latex from 'react-latex-next'

interface BreakReviewModalProps {
    onClose: () => void
}

type ReviewPhase = 'question' | 'answer'

export default function BreakReviewModal({ onClose }: BreakReviewModalProps) {
    const diary = useDiary()
    const [mistake, setMistake] = useState<Mistake | null>(null)
    const [loading, setLoading] = useState(true)
    const [phase, setPhase] = useState<ReviewPhase>('question')
    const [reviewDone, setReviewDone] = useState(false)
    const [noMistakes, setNoMistakes] = useState(false)

    const loadRandomMistake = useCallback(async () => {
        setLoading(true)
        setPhase('question')
        setReviewDone(false)
        try {
            const today = new Date().toISOString().split('T')[0]!
            const m = await diary.mistakes.getRandomDue(today)
            if (!m) {
                setNoMistakes(true)
                setMistake(null)
            } else {
                setMistake(m)
                setNoMistakes(false)
            }
        } catch (e) {
            console.error(e)
            setNoMistakes(true)
        } finally {
            setLoading(false)
        }
    }, [diary.mistakes])

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
            setReviewDone(true)
        } catch (e) {
            console.error(e)
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9000,
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
                {/* Header */}
                <div style={{
                    padding: 'var(--space-md) var(--space-lg)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-secondary))'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--warning)', fontWeight: 700 }}>
                        <BookOpen size={18} />
                        <span>休息时间 · 顺手刷一题！</span>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4 }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: 'var(--space-xl)' }}>
                    {loading && (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-2xl)' }}>
                            <div style={{ width: 32, height: 32, border: '3px solid var(--warning)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto var(--space-md)' }} />
                            正在从错题本抓题...
                        </div>
                    )}

                    {!loading && noMistakes && (
                        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
                            <Trophy size={48} style={{ color: 'var(--success)', margin: '0 auto var(--space-md)', display: 'block' }} />
                            <h3 style={{ color: 'var(--success)', marginBottom: 'var(--space-sm)' }}>今日无欠债！</h3>
                            <p className="text-muted" style={{ marginBottom: 'var(--space-lg)' }}>今天该复习的都搞定了，继续加油！</p>
                            <button className="button button-primary" onClick={onClose}>好的，去休息</button>
                        </div>
                    )}

                    {!loading && mistake && (
                        <div>
                            {/* Subject tag */}
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

                            {/* Question */}
                            <div className="content-selectable" style={{
                                background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)',
                                padding: 'var(--space-md)', marginBottom: 'var(--space-md)',
                                lineHeight: 1.7, fontSize: 15
                            }}>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>题目</div>
                                <Latex>{mistake.question}</Latex>
                            </div>

                            {/* Images if any (supports single path or JSON array) */}
                            {mistake.image_path && (() => {
                                const imgs: string[] = mistake.image_path!.startsWith('[')
                                    ? (() => { try { return JSON.parse(mistake.image_path!) } catch { return [] } })()
                                    : [mistake.image_path!]
                                return imgs.length > 0 ? (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--space-md)' }}>
                                        {imgs.map((imgPath: string, idx: number) => (
                                            <img
                                                key={idx}
                                                src={`local://${imgPath}`}
                                                alt={`图片 ${idx + 1}`}
                                                style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                                            />
                                        ))}
                                    </div>
                                ) : null
                            })()}

                            {/* Reveal answer button */}
                            {phase === 'question' && !reviewDone && (
                                <button
                                    className="button button-primary"
                                    style={{ width: '100%', justifyContent: 'center' }}
                                    onClick={() => setPhase('answer')}
                                >
                                    查看答案
                                </button>
                            )}

                            {/* Answer */}
                            {phase === 'answer' && !reviewDone && (
                                <div>
                                    <div className="content-selectable" style={{
                                        background: 'color-mix(in srgb, var(--success) 8%, var(--bg-secondary))',
                                        border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
                                        borderRadius: 'var(--radius)', padding: 'var(--space-md)',
                                        marginBottom: 'var(--space-md)', lineHeight: 1.7, fontSize: 14
                                    }}>
                                        <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 6, fontWeight: 600 }}>答案</div>
                                        <Latex>{mistake.answer || ''}</Latex>
                                        {mistake.notes && (
                                            <div style={{ marginTop: 'var(--space-sm)', fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                                <Pin size={13} style={{ flexShrink: 0, marginRight: 2 }} /> <Latex>{mistake.notes}</Latex>
                                            </div>
                                        )}
                                    </div>

                                    {/* Rating */}
                                    <div style={{ marginBottom: 'var(--space-sm)', fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
                                        对自己打个分吧：
                                    </div>
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                        {REVIEW_QUALITIES.map(rq => (
                                            <button
                                                key={rq.quality}
                                                className="button button-secondary"
                                                style={{ flex: 1, color: rq.color, borderColor: rq.color + '55', fontSize: 13 }}
                                                onClick={() => handleReview(rq.quality)}
                                            >
                                                {rq.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Done state */}
                            {reviewDone && (
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ color: 'var(--success)', fontWeight: 600, marginBottom: 'var(--space-md)', fontSize: 15 }}>
                                        已记录，AI 已安排下次复习
                                    </div>
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center' }}>
                                        <button className="button button-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={loadRandomMistake}>
                                            <RotateCcw size={14} /> 再来一题
                                        </button>
                                        <button className="button button-primary" onClick={onClose}>
                                            好的，够了
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {!loading && !noMistakes && (
                    <div style={{ padding: 'var(--space-sm) var(--space-lg)', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                        <span className="text-xs text-muted">错题会根据你的作答质量，由 SM-2 算法智能安排下次复习时间</span>
                    </div>
                )}
            </div>
        </div>
    )
}
