import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Library, Pencil, PlusCircle, Target, Trash2 } from 'lucide-react'
import { useDiary } from '../contexts/DiaryContext'
import { useCurrentLocalDateKey } from '../contexts/LocalDateContext'
import { showToast } from './Toast'
import { logger } from '../utils/logger'
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
        tasks: tasksAPI,
        requestDataRefresh,
        dataRefreshVersion = 0,
    } = useDiary()
    const todayDate = useCurrentLocalDateKey()
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [chaptersBySubject, setChaptersBySubject] = useState<Record<number, SubjectChapter[]>>({})
    const [pomodoroStats, setPomodoroStats] = useState<PomodoroStat[]>([])
    const [mistakes, setMistakes] = useState<Mistake[]>([])
    const [loading, setLoading] = useState(true)
    const [savingSubject, setSavingSubject] = useState(false)
    const [subjectActionPending, setSubjectActionPending] = useState<string | null>(null)
    const [expandedSubjectId, setExpandedSubjectId] = useState<number | null>(null)
    const [todayChapterTaskIds, setTodayChapterTaskIds] = useState<Set<number>>(new Set())
    const locallyRequestedRefreshVersionRef = useRef<number | null>(null)

    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [form, setForm] = useState<SubjectForm>({ name: '', total_chapters: '', color: '#0F766E' })

    const loadAllData = useCallback(async () => {
        setLoading(true)
        try {
            const [subjData, pStats, mistData, todayTasks] = await Promise.all([
                subjectsAPI.getAll().catch(() => [] as Subject[]),
                pomodoroAPI.getStats(todayDate).catch(() => [] as PomodoroStat[]),
                mistakesAPI.getAll({}).catch(() => ({ data: [] })),
                tasksAPI.getByDate(todayDate).catch(() => []),
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
            setTodayChapterTaskIds(new Set(
                (todayTasks || [])
                    .map(task => task.related_chapter_id)
                    .filter((chapterId): chapterId is number => chapterId !== null),
            ))
        } catch (error) {
            logger.error(error)
            showToast('加载科目进度失败', 'error')
        } finally {
            setLoading(false)
        }
    }, [mistakesAPI, pomodoroAPI, subjectChaptersAPI, subjectsAPI, tasksAPI, todayDate])

    useEffect(() => {
        if (locallyRequestedRefreshVersionRef.current === dataRefreshVersion) {
            locallyRequestedRefreshVersionRef.current = null
            return
        }
        void loadAllData()
    }, [dataRefreshVersion, loadAllData])

    const updateChapterLocally = useCallback((previousChapter: SubjectChapter, updatedChapter: SubjectChapter) => {
        setChaptersBySubject(previous => ({
            ...previous,
            [updatedChapter.subject_id]: (previous[updatedChapter.subject_id] || []).map(chapter => (
                chapter.id === updatedChapter.id ? updatedChapter : chapter
            )),
        }))
        if (previousChapter.completed === updatedChapter.completed) return
        const completedDelta = updatedChapter.completed ? 1 : -1
        setSubjects(previous => previous.map(subject => {
            if (subject.id !== updatedChapter.subject_id) return subject
            const total = subject.total_chapters || 0
            const completed = Math.max(0, Math.min(total, (subject.completed_chapters || 0) + completedDelta))
            return { ...subject, completed_chapters: completed }
        }))
    }, [])

    const addChapterToToday = useCallback(async (subject: Subject, chapter: SubjectChapter) => {
        const existing = await tasksAPI.find({
            planned_date: todayDate,
            related_chapter_id: chapter.id,
        })
        if (existing.length === 0) {
            await tasksAPI.create({
                title: `学习：${subject.name} · ${chapter.title}`,
                type: 'focus',
                subject_id: subject.id,
                related_chapter_id: chapter.id,
                planned_date: todayDate,
                source: 'manual',
            })
            showToast('已加入今日任务', 'success')
        } else {
            showToast('该章节已在今日任务中', 'success')
        }
        setTodayChapterTaskIds(previous => {
            if (previous.has(chapter.id)) return previous
            const next = new Set(previous)
            next.add(chapter.id)
            return next
        })
        locallyRequestedRefreshVersionRef.current = dataRefreshVersion + 1
        requestDataRefresh()
    }, [dataRefreshVersion, requestDataRefresh, tasksAPI, todayDate])

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
        <div className="workspace-page workspace-page--wide study-progress" aria-busy={loading}>
            <section className="study-progress__overview" aria-labelledby="study-progress-overview-title">
                <div className="study-progress__overview-header">
                    <div className="study-progress__overview-copy">
                        <span className="study-progress__overview-icon" aria-hidden="true">
                            <Target size={18} />
                        </span>
                        <div>
                            <h2 id="study-progress-overview-title" className="study-progress__overview-title">备考总进度</h2>
                            <p className="study-progress__overview-help">按科目查看章节进展与今日学习证据。</p>
                        </div>
                    </div>
                    {!showForm && (
                        <button
                            type="button"
                            className="button button-primary study-progress__add-subject"
                            onClick={() => {
                                setShowForm(true)
                                setEditingId(null)
                                setForm({ name: '', total_chapters: '', color: '#0F766E' })
                            }}
                        >
                            <PlusCircle size={16} aria-hidden="true" /> 新增科目
                        </button>
                    )}
                </div>

                <div className="study-progress__overall-value">
                    <strong>{overallProgress}%</strong>
                    <span>已完成 {totalCompleted} / {totalChapters} 个章节</span>
                </div>
                <div
                    className="study-progress__track study-progress__track--overall"
                    role="progressbar"
                    aria-label="总体章节进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Number(overallProgress)}
                    aria-valuetext={`已完成 ${totalCompleted} / ${totalChapters} 个章节`}
                >
                    <span className="study-progress__fill" style={{ width: `${overallProgress}%` }} />
                </div>
                {Number(overallProgress) >= 100 && totalChapters > 0 && (
                    <span className="study-progress__complete-status">全部完成</span>
                )}
            </section>

            {showForm && (
                <section className="study-progress__form" aria-labelledby="study-progress-form-title">
                    <h2 id="study-progress-form-title" className="study-progress__form-title">
                        {editingId
                            ? <><Pencil size={18} aria-hidden="true" /> 编辑科目</>
                            : <><BookOpen size={18} aria-hidden="true" /> 创建科目</>}
                    </h2>
                    <div className="study-progress__form-fields">
                        <div className="study-progress__form-row">
                            <div className="workspace-field study-progress__name-field">
                                <label htmlFor="study-progress-subject-name">科目名称</label>
                                <input
                                    id="study-progress-subject-name"
                                    className="input w-full"
                                    placeholder="例如：考研数学、英语一"
                                    value={form.name}
                                    onChange={event => setForm({ ...form, name: event.target.value })}
                                    autoFocus
                                />
                            </div>
                            <div className="workspace-field study-progress__chapter-count-field">
                                <label htmlFor="study-progress-subject-total">汇总章节数</label>
                                <input
                                    id="study-progress-subject-total"
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

                        <fieldset className="study-progress__color-field">
                            <legend>代表色</legend>
                            <div className="study-progress__color-options">
                                {COLORS.map(color => (
                                    <button
                                        key={color}
                                        type="button"
                                        className="study-progress__color-option"
                                        onClick={() => setForm({ ...form, color })}
                                        style={{ '--subject-color': color } as CSSProperties}
                                        title={`选择颜色 ${color}`}
                                        aria-label={`选择颜色 ${color}`}
                                        aria-pressed={form.color === color}
                                        data-selected={form.color === color || undefined}
                                    />
                                ))}
                            </div>
                        </fieldset>

                        <div className="study-progress__form-actions">
                            <button type="button" className="button button-secondary" onClick={resetForm} disabled={savingSubject}>
                                取消
                            </button>
                            <button type="button" className="button button-primary" onClick={handleSubmit} disabled={!form.name.trim() || savingSubject}>
                                {savingSubject ? '保存中...' : editingId ? '保存更改' : '创建科目'}
                            </button>
                        </div>
                    </div>
                </section>
            )}

            <section className="study-progress__subjects" aria-label="科目进度">
                {loading ? (
                    <div className="study-progress__loading" role="status">
                        <span>正在加载科目进度...</span>
                        <div className="study-progress__skeleton-grid" aria-hidden="true">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="study-progress__skeleton">
                                    <div className="skeleton-line study-progress__skeleton-title" />
                                    <div className="skeleton-line study-progress__skeleton-track" />
                                    <div className="skeleton-line study-progress__skeleton-detail" />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    subjectMetrics.map(subject => {
                        const displayColor = subject.color || '#0F766E'
                        const expanded = expandedSubjectId === subject.id
                        return (
                            <article
                                key={subject.id}
                                data-testid={`subject-card-${subject.id}`}
                                className="study-progress__subject"
                                style={{ '--subject-color': displayColor } as CSSProperties}
                                aria-labelledby={`study-progress-subject-${subject.id}`}
                            >
                                <header className="study-progress__subject-header">
                                    <h3 id={`study-progress-subject-${subject.id}`} className="study-progress__subject-title">{subject.name}</h3>
                                    <div className="study-progress__subject-actions">
                                        <button
                                            type="button"
                                            className="study-progress__icon-action"
                                            onClick={() => handleEdit(subject)}
                                            title="编辑科目"
                                            aria-label={`编辑科目：${subject.name}`}
                                            disabled={!!subjectActionPending}
                                        >
                                            <Pencil size={14} aria-hidden="true" />
                                        </button>
                                        <button
                                            type="button"
                                            className="study-progress__icon-action study-progress__icon-action--danger"
                                            onClick={() => void handleDelete(subject.id)}
                                            title="删除科目"
                                            aria-label={`删除科目：${subject.name}`}
                                            disabled={!!subjectActionPending}
                                        >
                                            <Trash2 size={14} aria-hidden="true" />
                                        </button>
                                    </div>
                                </header>

                                <div className="study-progress__subject-summary">
                                    <strong>{subject.pct}%</strong>
                                    <span>{subject.completed_chapters || 0} / {subject.total_chapters || 0} 章节</span>
                                </div>
                                <div
                                    className="study-progress__track"
                                    role="progressbar"
                                    aria-label={`${subject.name}章节进度`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={subject.pct}
                                    aria-valuetext={`已完成 ${subject.completed_chapters || 0} / ${subject.total_chapters || 0} 章节`}
                                >
                                    <span className="study-progress__fill" style={{ width: `${subject.pct}%` }} />
                                </div>

                                <p className="study-progress__next-step">
                                    {subject.hasDetailedChapters ? (
                                        subject.nextIncompleteChapter ? (
                                            <>下一章节：<strong>{subject.nextIncompleteChapter}</strong></>
                                        ) : (
                                            <strong className="study-progress__complete-copy">全部章节已完成</strong>
                                        )
                                    ) : (
                                        <>汇总模式：可继续用 +/- 更新，或展开添加详细章节。</>
                                    )}
                                </p>

                                <dl className="study-progress__evidence">
                                    <div>
                                        <dt>今日专注</dt>
                                        <dd>{subject.studyTime} 分钟</dd>
                                    </div>
                                    <div>
                                        <dt>未清错题</dt>
                                        <dd className="study-progress__metric-danger">{subject.mistakeCount - subject.masteredCount}</dd>
                                    </div>
                                    <div>
                                        <dt>已掌握</dt>
                                        <dd className="study-progress__metric-success">{subject.masteredCount}</dd>
                                    </div>
                                </dl>

                                <div className="study-progress__subject-footer">
                                    {!subject.hasDetailedChapters ? (
                                        <div className="study-progress__summary-controls" aria-label={`${subject.name}汇总进度调整`}>
                                            <button
                                                type="button"
                                                className="button button-secondary study-progress__summary-control"
                                                onClick={() => void updateSummaryProgress(subject, -1)}
                                                disabled={!!subjectActionPending || (subject.completed_chapters || 0) <= 0}
                                                title="汇总进度减一"
                                                aria-label={`${subject.name}汇总进度减一`}
                                            >
                                                −
                                            </button>
                                            <button
                                                type="button"
                                                className="button button-primary study-progress__summary-control"
                                                onClick={() => void updateSummaryProgress(subject, 1)}
                                                disabled={!!subjectActionPending || (subject.completed_chapters || 0) >= (subject.total_chapters || 0)}
                                                title="汇总进度加一"
                                                aria-label={`${subject.name}汇总进度加一`}
                                            >
                                                +
                                            </button>
                                        </div>
                                    ) : (
                                        <span className="study-progress__auto-summary">详细章节自动汇总进度</span>
                                    )}
                                    <button
                                        type="button"
                                        className="button button-secondary study-progress__manage"
                                        onClick={() => setExpandedSubjectId(expanded ? null : subject.id)}
                                        aria-expanded={expanded}
                                        aria-controls={`study-progress-chapters-${subject.id}`}
                                        title={expanded ? '收起章节管理' : '管理章节'}
                                        data-testid={`manage-chapters-${subject.id}`}
                                    >
                                        {expanded
                                            ? <ChevronUp size={15} aria-hidden="true" />
                                            : <ChevronDown size={15} aria-hidden="true" />}
                                        {expanded ? '收起' : '管理章节'}
                                    </button>
                                </div>

                                {expanded && (
                                    <div id={`study-progress-chapters-${subject.id}`} className="study-progress__chapters">
                                        <SubjectChapterPanel
                                            subject={subject}
                                            chapters={chaptersBySubject[subject.id] || []}
                                            color={displayColor}
                                            api={subjectChaptersAPI}
                                            onRefresh={loadAllData}
                                            onChapterUpdated={updateChapterLocally}
                                            todayChapterTaskIds={todayChapterTaskIds}
                                            onAddToToday={chapter => addChapterToToday(subject, chapter)}
                                        />
                                    </div>
                                )}
                            </article>
                        )
                    })
                )}

                {!loading && subjectMetrics.length === 0 && !showForm && (
                    <div className="workspace-empty study-progress__empty">
                        <Library size={44} aria-hidden="true" />
                        <h3>还没有科目</h3>
                        <p>先创建科目，再添加详细章节或使用汇总进度记录备考进展。</p>
                    </div>
                )}
            </section>
        </div>
    )
}
