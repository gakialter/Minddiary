import { useMemo, useState } from 'react'
import type { Subject } from '../types'

interface SubjectConversionDialogProps {
    subject: Subject
    chapterCount: number
    onCancel: () => void
    onConfirm: (markCompletedCount: number) => Promise<void>
}

export default function SubjectConversionDialog({
    subject,
    chapterCount,
    onCancel,
    onConfirm,
}: SubjectConversionDialogProps) {
    const summaryTotal = subject.total_chapters || 0
    const summaryCompleted = Math.min(subject.completed_chapters || 0, summaryTotal)
    const defaultMode = summaryCompleted > 0 ? 'preserve' : 'empty'
    const [mode, setMode] = useState<'preserve' | 'empty'>(defaultMode)
    const [saving, setSaving] = useState(false)

    const markCompletedCount = mode === 'preserve' ? summaryCompleted : 0
    const preserveUnavailable = mode === 'preserve' && summaryCompleted > chapterCount
    const resultText = useMemo(() => {
        if (mode === 'empty') return `${chapterCount} 个章节都会设为未完成。`
        return `前 ${Math.min(summaryCompleted, chapterCount)} 个章节会标记为已完成。`
    }, [chapterCount, mode, summaryCompleted])

    const handleConfirm = async () => {
        if (preserveUnavailable || saving) return
        setSaving(true)
        try {
            await onConfirm(markCompletedCount)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="subject-conversion-title"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 'var(--z-modal)',
                background: 'rgba(0,0,0,0.42)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 'var(--space-lg)',
            }}
        >
            <div
                className="card"
                style={{
                    width: 'min(520px, 100%)',
                    padding: 'var(--space-xl)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                }}
            >
                <h3 id="subject-conversion-title" className="font-bold text-lg" style={{ marginBottom: 'var(--space-sm)' }}>
                    转换为详细章节模式
                </h3>
                <p className="text-sm text-secondary" style={{ lineHeight: 1.7, marginBottom: 'var(--space-md)' }}>
                    当前「{subject.name}」的汇总进度是 {summaryCompleted} / {summaryTotal}。确认后将创建 {chapterCount} 个详细章节，
                    之后科目进度会由详细章节自动汇总；确认前不会修改原汇总数据。
                </p>

                <div style={{ display: 'grid', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                    <label className="flex items-start gap-sm" style={{ cursor: 'pointer' }}>
                        <input
                            type="radio"
                            name="chapter-conversion-mode"
                            checked={mode === 'preserve'}
                            onChange={() => setMode('preserve')}
                            disabled={summaryCompleted === 0}
                        />
                        <span>
                            <span className="font-semibold">按原完成数标记</span>
                            <span className="block text-sm text-muted">将前 {summaryCompleted} 个新章节设为已完成。</span>
                        </span>
                    </label>
                    <label className="flex items-start gap-sm" style={{ cursor: 'pointer' }}>
                        <input
                            type="radio"
                            name="chapter-conversion-mode"
                            checked={mode === 'empty'}
                            onChange={() => setMode('empty')}
                        />
                        <span>
                            <span className="font-semibold">全部设为未完成</span>
                            <span className="block text-sm text-muted">保留旧汇总到确认前，不自动推断完成章节。</span>
                        </span>
                    </label>
                </div>

                <div
                    className="text-sm"
                    style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: preserveUnavailable ? 'rgba(198,90,58,0.10)' : 'var(--bg-tertiary)',
                        color: preserveUnavailable ? 'var(--danger)' : 'var(--text-secondary)',
                        marginBottom: 'var(--space-md)',
                    }}
                >
                    {preserveUnavailable
                        ? `输入章节数少于原已完成数 ${summaryCompleted}。请补充更多章节，或选择“全部设为未完成”。`
                        : resultText}
                </div>

                <div className="flex justify-end gap-sm">
                    <button className="button button-secondary" onClick={onCancel} disabled={saving}>
                        取消
                    </button>
                    <button className="button button-primary" onClick={handleConfirm} disabled={saving || preserveUnavailable} data-testid="chapter-conversion-confirm">
                        {saving ? '转换中...' : '确认转换'}
                    </button>
                </div>
            </div>
        </div>
    )
}
