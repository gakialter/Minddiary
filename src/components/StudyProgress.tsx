import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Library, Pencil, PlusCircle, Target, Trash2 } from 'lucide-react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { logger } from '../utils/logger'
import { getLocalDateKey } from '../utils/dateKey'
import { calculateChapterStats } from '../utils/subjectChapters'
import SubjectChapterPanel from './SubjectChapterPanel'
import type { Mistake, PomodoroStat, Subject, SubjectChapter } from '../types'

interface SubjectForm {
    name: string
    total_chapters: string
    color: string
}

interface SubjectMetric extends Subject {
    pct: number
    studyTime: number
    mistakeCount: number
    masteredCount: number
    hasDetailedChapters: boolean
    nextIncompleteChapter: string | null
}

const COLORS = ['#0F766E', '#2F8F6B', '#0E7490', '#475569', '#854D0E', '#C65A3A', '#4D7C0F', '#6B7280']

function getProgressPercent(completed: number, total: number): number {
    return total > 0 ? Math.round((Math.min(completed, total) / total) * 100) : 0
}

export default function StudyProgress() {
    const {
        subjects: subjectsAPI,
        subjectChapters: subjectChaptersAPI,
        pomodoro: pomodoroAPI,
        mistakes: mistakesAPI,
    } = useDiary()
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [chaptersBySubject, setChaptersBySubject] = useState<Record<number, SubjectChapter[]>>({})
    const [pomodoroStats, setPomodoroStats] = useState<PomodoroStat[]>([])
    const [mistakes, setMistakes] = useState<Mistake[]>([])
    const [loading, setLoading] = useState(true)
    const [savingSubject, setSavingSubject] = useState(false)
    const [subjectActionPending, setSubjectActionPending] = useState<string | null>(null)
    const [expandedSubjectId, setExpandedSubjectId] = useState<number | null>(null)

    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [form, setForm] = useState<SubjectForm>({ name: '', total_chapters: '', color: '#0F766E' })

    const loadAllData = useCallback(async () => {
        setLoading(true)
        try {
            const [subjData, pStats, mistData] = await Promise.all([
                subjectsAPI.getAll().catch(() => [] as Subject[]),
                pomodoroAPI.getStats(getLocalDateKey()).catch(() => [] as PomodoroStat[]),
                mistakesAPI.getAll({}).catch(() => ({ data: [] })),
            ])
            const normalizedSubjects = subjData || []
            const chapterPairs = await Promise.all(
                normalizedSubjects.map(async subject => [
                    subject.id,
                    await subjectChaptersAPI.getBySubject(subject.id).catch(() => [] as SubjectChapter[]),
                ] as const),
            )
            setSubjects(normalizedSubjects)
            setChaptersBySubject(Object.fromEntries(chapterPairs))
            setPomodoroStats(pStats || [])
            setMistakes((mistData && 'data' in mistData ? mistData.data : []) as Mistake[])
        } catch (error) {
            logger.error(error)
            showToast('加载科目进度失败', 'error')
        } finally {
            setLoading(false)
        }
    }, [mistakesAPI, pomodoroAPI, subjectChaptersAPI, subjectsAPI])

    useEffect(() => {
        void loadAllData()
    }, [loadAllData])

    const { totalChapters, totalCompleted, overallProgress, subjectMetrics } = useMemo(() => {
        const mistakeIndex = new Map<number | null, { total: number; mastered: number }>()
        for (const mistake of mistakes) {
            const bucket = mistakeIndex.get(mistake.subject_id) ?? { total: 0, mastered: 0 }
            bucket.total += 1
            if (mistake.mastered) bucket.mastered += 1
            mistakeIndex.set(mistake.subject_id, bucket)
        }

        const pomodoroIndex = new Map<string, number>(
            pomodoroStats
                .filter((stat): stat is typeof stat & { subject_name: string } => typeof stat.subject_name === 'string')
                .map(stat => [stat.subject_name, stat.total_minutes]),
        )

        let chapterTotal = 0
        let chapterCompleted = 0
        const metrics: SubjectMetric[] = subjects.map(subject => {
            const chapters = chaptersBySubject[subject.id] || []
            const chapterStats = calculateChapterStats(chapters)
            const total = subject.total_chapters || 0
            const completed = Math.min(subject.completed_chapters || 0, total)
            chapterTotal += total
            chapterCompleted += completed

            const { total: mistakeCount = 0, mastered: masteredCount = 0 } = mistakeIndex.get(subject.id) ?? {}
            return {
                ...subject,
                pct: getProgressPercent(completed, total),
                studyTime: pomodoroIndex.get(subject.name) ?? 0,
                mistakeCount,
                masteredCount,
                hasDetailedChapters: chapters.length > 0,
                nextIncompleteChapter: chapterStats.nextIncomplete?.title ?? null,
            }
        })

        return {
            totalChapters: chapterTotal,
            totalCompleted: chapterCompleted,
            overallProgress: chapterTotal > 0 ? (chapterCompleted / chapterTotal * 100).toFixed(1) : '0',
            subjectMetrics: metrics,
        }
    }, [chaptersBySubject, mistakes, pomodoroStats, subjects])

    const resetForm = () => {
        setForm({ name: '', total_chapters: '', color: '#0F766E' })
        setShowForm(false)
        setEditingId(null)
    }

    const handleSubmit = async () => {
        if (!form.name.trim() || savingSubject) return
        setSavingSubject(true)
        try {
            const existing = editingId ? subjects.find(subject => subject.id === editingId) : null
            const hasDetailedChapters = editingId ? (chaptersBySubject[editingId]?.length || 0) > 0 : false
            const total = Math.max(0, parseInt(form.total_chapters, 10) || 0)
            if (editingId && existing) {
                await subjectsAPI.update(editingId, {
                    name: form.name.trim(),
                    total_chapters: hasDetailedChapters ? existing.total_chapters || 0 : total,
                    completed_chapters: hasDetailedChapters
                        ? existing.completed_chapters || 0
                        : Math.min(existing.completed_chapters || 0, total),
                    color: form.color,
                })
            } else {
                await subjectsAPI.create({
                    name: form.name.trim(),
                    total_chapters: total,
                    color: form.color,
                })
            }
            resetForm()
            await loadAllData()
            showToast(editingId ? '科目已更新' : '已添加新科目', 'success')
        } catch (error) {
            logger.error(error)
            showToast('保存科目失败', 'error')
        } finally {
            setSavingSubject(false)
        }
    }

    const handleEdit = (subject: SubjectMetric) => {
        setEditingId(subject.id)
        setForm({
            name: subject.name,
            total_chapters: (subject.total_chapters || 0).toString(),
            color: subject.color || '#0F766E',
        })
        setShowForm(true)
    }

    const handleDelete = async (id: number) => {
        if (subjectActionPending) return
        if (!window.confirm('确定删除这个科目吗？关联的错题、专注记录和任务会保留，但不再归属任何科目；详细章节会一起删除。')) return
        setSubjectActionPending(`delete-${id}`)
        try {
            await subjectsAPI.delete(id)
            if (expandedSubjectId === id) setExpandedSubjectId(null)
            await loadAllData()
            showToast('科目已删除', 'success')
        } catch (error) {
            logger.error(error)
            showToast('删除科目失败', 'error')
        } finally {
            setSubjectActionPending(null)
        }
    }

    const updateSummaryProgress = async (subject: SubjectMetric, delta: number) => {
        if (subjectActionPending) return
        const total = subject.total_chapters || 0
        const nextCompleted = Math.max(0, Math.min(total, (subject.completed_chapters || 0) + delta))
        setSubjectActionPending(`summary-${subject.id}`)
        try {
            await subjectsAPI.update(subject.id, {
                name: subject.name,
                total_chapters: total,
                completed_chapters: nextCompleted,
                color: subject.color,
            })
            setSubjects(previous => previous.map(item => (
                item.id === subject.id ? { ...item, completed_chapters: nextCompleted } : item
            )))
        } catch (error) {
            logger.error(error)
            showToast('更新汇总进度失败', 'error')
            await loadAllData()
        } finally {
            setSubjectActionPending(null)
        }
    }

    return (
        <div style={{ maxWidth: 1040, margin: '0 auto', paddingBottom: 'var(--space-2xl)' }}>
            <div
                className="card"
                style={{
                    padding: 'var(--space-xl)',
                    marginBottom: 'var(--space-2xl)',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-light)',
                }}
            >
                <div className="flex items-center justify-between gap-md flex-wrap" style={{ marginBottom: 'var(--space-md)' }}>
                    <div className="flex items-center gap-md flex-wrap">
                        <div className="flex items-center gap-sm">
                            <div
                                style={{
                                    padding: 8,
                                    borderRadius: 8,
                                    background: 'var(--accent)',
                                    color: 'white',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <Target size={18} />
                            </div>
                            <span className="font-semibold text-lg">备考大盘</span>
                        </div>
                        <span className="font-bold text-3xl" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                            {overallProgress}%
                        </span>
                    </div>

                    {!showForm && (
                        <button
                            className="button button-primary"
                            style={{ borderRadius: 20 }}
                            onClick={() => {
                                setShowForm(true)
                                setEditingId(null)
                                setForm({ name: '', total_chapters: '', color: '#0F766E' })
                            }}
                        >
                            <PlusCircle size={16} /> 新增科目
                        </button>
                    )}
                </div>

                <div style={{ height: 12, background: 'var(--bg-primary)', borderRadius: 6, overflow: 'hidden' }}>
                    <div
                        style={{
                            height: '100%',
                            width: `${overallProgress}%`,
                            background: 'var(--accent)',
                            borderRadius: 6,
                            transition: 'width var(--duration-slow) var(--ease-out)',
                        }}
                    />
                </div>

                <div className="flex items-center justify-between mt-4 gap-sm flex-wrap">
                    <div className="text-sm">
                        <span className="text-muted">已完成 </span>
                        <span className="font-semibold">{totalCompleted}</span>
                        <span className="text-muted"> / {totalChapters} 个章节</span>
                    </div>
                    {Number(overallProgress) >= 100 && totalChapters > 0 && (
                        <div className="text-xs font-semibold" style={{ color: 'var(--success)', background: 'var(--accent-light)', padding: '4px 10px', borderRadius: 12 }}>
                            全部完成
                        </div>
                    )}
                </div>
            </div>

            {showForm && (
                <div className="card" style={{ padding: 'var(--space-xl)', marginBottom: 'var(--space-xl)' }}>
                    <h3 className="font-bold text-lg" style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {editingId ? <><Pencil size={18} /> 编辑科目</> : <><BookOpen size={18} /> 创建科目</>}
                    </h3>
                    <div className="flex flex-col gap-md">
                        <div className="flex gap-md w-full flex-wrap">
                            <div style={{ flex: '2 1 260px' }}>
                                <label className="text-xs font-bold text-muted uppercase mb-1 block">科目名称</label>
                                <input
                                    className="input w-full"
                                    placeholder="例如：考研数学、英语一"
                                    value={form.name}
                                    onChange={event => setForm({ ...form, name: event.target.value })}
                                    autoFocus
                                />
                            </div>
                            <div style={{ flex: '1 1 160px' }}>
                                <label className="text-xs font-bold text-muted uppercase mb-1 block">汇总章节数</label>
                                <input
                                    className="input w-full"
                                    type="number"
                                    min={0}
                                    placeholder="可先填 0"
                                    value={form.total_chapters}
                                    onChange={event => setForm({ ...form, total_chapters: event.target.value })}
                                    disabled={editingId !== null && (chaptersBySubject[editingId]?.length || 0) > 0}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-muted uppercase mb-2 block">代表色</label>
                            <div className="flex items-center gap-md flex-wrap">
                                {COLORS.map(color => (
                                    <button
                                        key={color}
                                        onClick={() => setForm({ ...form, color })}
                                        style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: '50%',
                                            background: color,
                                            border: 'none',
                                            cursor: 'pointer',
                                            outline: form.color === color ? `3px solid ${color}40` : 'none',
                                            outlineOffset: 2,
                                        }}
                                        title={`选择颜色 ${color}`}
                                        aria-label={`选择颜色 ${color}`}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="flex gap-sm mt-2 justify-end">
                            <button className="button button-secondary" onClick={resetForm} disabled={savingSubject}>
                                取消
                            </button>
                            <button className="button button-primary" onClick={handleSubmit} disabled={!form.name.trim() || savingSubject}>
                                {savingSubject ? '保存中...' : editingId ? '保存更改' : '创建科目'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 'var(--space-xl)' }}>
                {loading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="card" style={{ padding: 'var(--space-lg)', minHeight: 200, opacity: 0.55 }}>
                            <div className="skeleton-line" style={{ width: '45%', height: 24, marginBottom: 20 }} />
                            <div className="skeleton-line" style={{ width: '100%', height: 8, borderRadius: 4, marginBottom: 30 }} />
                            <div className="skeleton-line" style={{ width: '70%', height: 16 }} />
                        </div>
                    ))
                ) : (
                    subjectMetrics.map(subject => {
                        const displayColor = subject.color || '#0F766E'
                        const expanded = expandedSubjectId === subject.id
                        return (
                            <div
                                key={subject.id}
                                data-testid={`subject-card-${subject.id}`}
                                className="card progress-card"
                                style={{
                                    padding: 'var(--space-xl)',
                                    position: 'relative',
                                    overflow: 'hidden',
                                    borderTop: `4px solid ${displayColor}`,
                                }}
                            >
                                <div className="flex items-center justify-between gap-sm" style={{ marginBottom: 'var(--space-md)' }}>
                                    <h3 className="font-bold text-lg" style={{ overflowWrap: 'anywhere' }}>{subject.name}</h3>
                                    <div className="flex gap-xs" style={{ opacity: 0.72 }}>
                                        <button
                                            className="icon-button"
                                            onClick={() => handleEdit(subject)}
                                            title="编辑科目"
                                            aria-label={`编辑科目：${subject.name}`}
                                            disabled={!!subjectActionPending}
                                        >
                                            <Pencil size={14} />
                                        </button>
                                        <button
                                            className="icon-button"
                                            onClick={() => void handleDelete(subject.id)}
                                            title="删除科目"
                                            aria-label={`删除科目：${subject.name}`}
                                            disabled={!!subjectActionPending}
                                            style={{ color: 'var(--danger)' }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-end justify-between gap-sm" style={{ marginBottom: 'var(--space-sm)' }}>
                                    <div className="text-3xl font-extrabold" style={{ color: displayColor, fontVariantNumeric: 'tabular-nums' }}>
                                        {subject.pct}%
                                    </div>
                                    <div className="text-sm text-muted font-medium mb-1">
                                        {subject.completed_chapters || 0} / {subject.total_chapters || 0} 章节
                                    </div>
                                </div>

                                <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden', marginBottom: 'var(--space-lg)' }}>
                                    <div
                                        style={{
                                            height: '100%',
                                            width: `${subject.pct}%`,
                                            background: displayColor,
                                            borderRadius: 4,
                                            transition: 'width var(--duration-slow) var(--ease-out)',
                                        }}
                                    />
                                </div>

                                <div className="text-sm" style={{ minHeight: 22, marginBottom: 'var(--space-md)' }}>
                                    {subject.hasDetailedChapters ? (
                                        subject.nextIncompleteChapter ? (
                                            <span className="text-secondary">下一章节：<span className="font-semibold">{subject.nextIncompleteChapter}</span></span>
                                        ) : (
                                            <span className="text-success font-semibold">全部章节已完成</span>
                                        )
                                    ) : (
                                        <span className="text-muted">汇总模式：可继续用 +/- 更新，或展开添加详细章节。</span>
                                    )}
                                </div>

                                <div className="flex justify-between items-center text-sm mb-4" style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 8, border: '1px solid var(--border-light)' }}>
                                    <div className="flex flex-col items-center flex-1">
                                        <span className="text-muted text-xs mb-1">今日专注</span>
                                        <span className="font-semibold">{subject.studyTime} m</span>
                                    </div>
                                    <div className="flex flex-col items-center flex-1" style={{ borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
                                        <span className="text-muted text-xs mb-1">未清错题</span>
                                        <span className="font-semibold text-danger">{subject.mistakeCount - subject.masteredCount}</span>
                                    </div>
                                    <div className="flex flex-col items-center flex-1">
                                        <span className="text-muted text-xs mb-1">已掌握</span>
                                        <span className="font-semibold text-success">{subject.masteredCount}</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between gap-sm pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                                    {!subject.hasDetailedChapters ? (
                                        <div className="flex gap-sm">
                                            <button
                                                className="button button-secondary flex items-center justify-center p-0"
                                                style={{ width: 32, height: 32, borderRadius: '50%' }}
                                                onClick={() => void updateSummaryProgress(subject, -1)}
                                                disabled={!!subjectActionPending || (subject.completed_chapters || 0) <= 0}
                                                title="汇总进度减一"
                                            >
                                                -
                                            </button>
                                            <button
                                                className="button button-primary flex items-center justify-center p-0"
                                                style={{ width: 32, height: 32, borderRadius: '50%', background: displayColor }}
                                                onClick={() => void updateSummaryProgress(subject, 1)}
                                                disabled={!!subjectActionPending || (subject.completed_chapters || 0) >= (subject.total_chapters || 0)}
                                                title="汇总进度加一"
                                            >
                                                +
                                            </button>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-muted">详细章节自动汇总进度</span>
                                    )}
                                    <button
                                        className="button button-secondary"
                                        style={{ borderRadius: 20 }}
                                        onClick={() => setExpandedSubjectId(expanded ? null : subject.id)}
                                        aria-expanded={expanded}
                                        title={expanded ? '收起章节管理' : '管理章节'}
                                        data-testid={`manage-chapters-${subject.id}`}
                                    >
                                        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                        {expanded ? '收起' : '管理章节'}
                                    </button>
                                </div>

                                {expanded && (
                                    <SubjectChapterPanel
                                        subject={subject}
                                        chapters={chaptersBySubject[subject.id] || []}
                                        color={displayColor}
                                        api={subjectChaptersAPI}
                                        onRefresh={loadAllData}
                                    />
                                )}
                            </div>
                        )
                    })
                )}

                {!loading && subjectMetrics.length === 0 && !showForm && (
                    <div className="empty-state" style={{ gridColumn: '1 / -1', padding: 'var(--space-2xl)' }}>
                        <Library size={52} style={{ marginBottom: 'var(--space)', opacity: 0.25, color: 'var(--text-secondary)' }} />
                        <h3 style={{ fontSize: 18, marginBottom: 'var(--space-sm)' }}>还没有科目</h3>
                        <p className="text-muted" style={{ maxWidth: 420, margin: '0 auto', lineHeight: 1.7 }}>
                            先创建科目，再添加详细章节或使用汇总进度记录备考进展。
                        </p>
                    </div>
                )}
            </div>

            <style>{`
                .progress-card {
                    transition: box-shadow var(--duration-normal) var(--ease-out), transform var(--duration-normal) var(--ease-out);
                }
                .progress-card:hover {
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-lg);
                }
                .icon-button {
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: none;
                    color: inherit;
                    cursor: pointer;
                    opacity: 0.75;
                    transition: opacity var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
                }
                .icon-button:hover:not(:disabled) {
                    opacity: 1;
                    background: var(--bg-tertiary);
                }
                .icon-button:disabled {
                    cursor: not-allowed;
                    opacity: 0.35;
                }
            `}</style>
        </div>
    )
}
