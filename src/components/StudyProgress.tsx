import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { BookOpen, ChevronDown, Library, Pencil, PlusCircle, Search, Trash2 } from 'lucide-react'
import { useDiary } from '../contexts/DiaryContext'
import { useCurrentLocalDateKey } from '../contexts/LocalDateContext'
import { showToast } from './Toast'
import { logger } from '../utils/logger'
import SubjectChapterPanel from './SubjectChapterPanel'
import { useModalFocus } from '../hooks/useModalFocus'
import type { Mistake, PomodoroStat, StudyTask, Subject, SubjectChapter } from '../types'

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
    const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null)
    const [visitedSubjectIds, setVisitedSubjectIds] = useState<Set<number>>(new Set())
    const [subjectQuery, setSubjectQuery] = useState('')
    const [todayTasks, setTodayTasks] = useState<StudyTask[]>([])
    const todayTasksRequestRef = useRef(0)
    const todayDateRef = useRef(todayDate)
    todayDateRef.current = todayDate
    const locallyRequestedRefreshVersionRef = useRef<number | null>(null)

    const todayChapterTasks = useMemo(() => {
        const result = new Map<number, StudyTask[]>()
        for (const task of todayTasks) {
            if (task.planned_date !== todayDate || task.related_chapter_id === null) continue
            const tasks = result.get(task.related_chapter_id) ?? []
            tasks.push(task)
            result.set(task.related_chapter_id, tasks)
        }
        return result
    }, [todayDate, todayTasks])

    const refreshTodayTasks = useCallback(async () => {
        const request = ++todayTasksRequestRef.current
        const tasks = await tasksAPI.getByDate(todayDate)
        if (request === todayTasksRequestRef.current && todayDateRef.current === todayDate) {
            setTodayTasks(tasks)
        }
    }, [tasksAPI, todayDate])

    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [form, setForm] = useState<SubjectForm>({ name: '', total_chapters: '', color: '#0F766E' })

    const loadAllData = useCallback(async () => {
        // Refresh in place: mounted workspaces own filters, drafts and scroll position.
        try {
            const [subjData, pStats, mistData] = await Promise.all([
                subjectsAPI.getAll().catch(() => [] as Subject[]),
                pomodoroAPI.getStats(todayDate).catch(() => [] as PomodoroStat[]),
                mistakesAPI.getAll({}).catch(() => ({ data: [] })),
                // A failed task read must not turn known links into an empty state.
                refreshTodayTasks().catch(error => logger.error(error)),
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
    }, [mistakesAPI, pomodoroAPI, refreshTodayTasks, subjectChaptersAPI, subjectsAPI, todayDate])

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
        ++todayTasksRequestRef.current
        try {
            const existing = await tasksAPI.find({
                planned_date: todayDate,
                related_chapter_id: chapter.id,
            })
            const linkedTasks = existing.filter(task => task.subject_id === subject.id)
            if (linkedTasks.length === 0) {
                linkedTasks.push(await tasksAPI.create({
                    title: `学习：${subject.name} · ${chapter.title}`,
                    type: 'focus',
                    subject_id: subject.id,
                    related_chapter_id: chapter.id,
                    planned_date: todayDate,
                    source: 'chapter',
                }))
            }
            ++todayTasksRequestRef.current
            if (todayDateRef.current === todayDate) {
                setTodayTasks(previous => [...previous.filter(task => !linkedTasks.some(linked => linked.id === task.id)), ...linkedTasks])
            }
            locallyRequestedRefreshVersionRef.current = dataRefreshVersion + 1
            requestDataRefresh()
        } catch (error) {
            await refreshTodayTasks().catch(refreshError => logger.error(refreshError))
            throw error
        }
    }, [dataRefreshVersion, refreshTodayTasks, requestDataRefresh, tasksAPI, todayDate])

    const removeChapterFromToday = useCallback(async (subject: Subject, chapter: SubjectChapter) => {
        const linkedTasks = (todayChapterTasks.get(chapter.id) ?? []).filter(task => task.subject_id === subject.id)
        const task = linkedTasks.find(item => item.source === 'chapter') ?? linkedTasks[0]
        if (!task) return
        ++todayTasksRequestRef.current
        try {
            const result = await tasksAPI.removeChapterFromToday({ taskId: task.id, subjectId: subject.id, chapterId: chapter.id, date: todayDate })
            ++todayTasksRequestRef.current
            if (todayDateRef.current === todayDate) setTodayTasks(result.tasks)
            locallyRequestedRefreshVersionRef.current = dataRefreshVersion + 1
            requestDataRefresh()
            if (result.status === 'protected') {
                throw new Error('任务已开始、修改或包含记录，已保留。请到今日安排中处理。')
            }
            if (result.status === 'changed') {
                throw new Error('任务或日期已变化，已更新关联状态，请核对后重试。')
            }
            if (result.tasks.some(item => item.planned_date === todayDate && item.related_chapter_id === chapter.id && item.subject_id === subject.id)) {
                throw new Error('已撤销此任务，但该章节还有其他今日任务。请到今日安排中核对。')
            }
        } catch (error) {
            await refreshTodayTasks().catch(refreshError => logger.error(refreshError))
            throw error
        }
    }, [dataRefreshVersion, refreshTodayTasks, requestDataRefresh, tasksAPI, todayChapterTasks, todayDate])

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

    const formRef = useModalFocus(() => { if (!savingSubject) resetForm() }, showForm)

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
                const created = await subjectsAPI.create({
                    name: form.name.trim(),
                    total_chapters: total,
                    color: form.color,
                })
                selectSubject(created.id)
                setSubjectQuery('')
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
            if (selectedSubjectId === id) setSelectedSubjectId(null)
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

    const activeSubjectId = subjects.find(subject => subject.id === selectedSubjectId)?.id ?? subjects[0]?.id
    const visibleSubjects = subjectMetrics.filter(subject => subject.name.toLocaleLowerCase().includes(subjectQuery.trim().toLocaleLowerCase()))
    const selectSubject = (id: number) => {
        setVisitedSubjectIds(previous => new Set([...previous, ...(activeSubjectId ? [activeSubjectId] : []), id]))
        setSelectedSubjectId(id)
    }

    return (
        <div className="workspace-page workspace-page--wide study-progress" aria-busy={loading}>
            <section className="study-progress__overview" aria-label="学习总进度">
                <div className="study-progress__overall-value">
                    <span>整体进度</span>
                    <strong>{overallProgress}%</strong>
                    <span>已完成 {totalCompleted} / {totalChapters} 个章节</span>
                    <div className="study-progress__track" role="progressbar" aria-label="总进度"
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(overallProgress)}
                        aria-valuetext={`已完成 ${totalCompleted} / ${totalChapters} 个章节`}>
                        <span className="study-progress__fill" style={{ width: `${overallProgress}%` }} />
                    </div>
                </div>
                <div className="study-progress__overview-actions">
                    <span className="study-progress__today-count" role="status">今日已安排 <strong>{todayChapterTasks.size}</strong> 章</span>
                    <button type="button" className="button button-secondary" onClick={() => {
                        setShowForm(true)
                        setEditingId(null)
                        setForm({ name: '', total_chapters: '', color: '#0F766E' })
                    }}><PlusCircle size={15} aria-hidden="true" /> 添加科目</button>
                </div>
            </section>

            {showForm && (
                <div className="study-progress__form-backdrop">
                <div ref={formRef} role="dialog" aria-modal="true" tabIndex={-1} className="study-progress__form" aria-labelledby="study-progress-form-title">
                    <h2 id="study-progress-form-title" className="study-progress__form-title">
                        {editingId
                            ? <><Pencil size={18} aria-hidden="true" /> 编辑科目</>
                            : <><BookOpen size={18} aria-hidden="true" /> 创建科目</>}
                    </h2>
                    <div className="study-progress__form-fields">
                        <div className="study-progress__form-row">
                            <div className="workspace-field study-progress__name-field">
                                <label htmlFor="study-progress-subject-name">科目名</label>
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
                                <label htmlFor="study-progress-subject-total">章节总数</label>
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
                </div>
                </div>
            )}

            {loading ? (
                <div className="study-progress__loading" role="status">正在加载科目进度...</div>
            ) : subjects.length === 0 ? (
                <div className="workspace-empty study-progress__empty">
                    <Library size={40} aria-hidden="true" />
                    <h3>暂无科目</h3>
                    <p>创建科目后，可添加章节或记录完成数量。</p>
                </div>
            ) : (
                <div className="study-progress__planner">
                    <nav className="study-progress__navigator" aria-label="选择科目">
                        <div className="study-progress__nav-heading"><h2>我的科目</h2><span>{subjects.length}</span></div>
                        <label className="study-progress__search">
                            <Search size={15} aria-hidden="true" />
                            <input type="search" value={subjectQuery} aria-label="搜索科目" placeholder="搜索科目"
                                onChange={event => setSubjectQuery(event.target.value)} />
                        </label>
                        <div className="study-progress__subject-list">
                            {visibleSubjects.map(subject => (
                                <button key={subject.id} type="button" className="study-progress__subject-link"
                                    data-testid={`subject-select-${subject.id}`} aria-pressed={activeSubjectId === subject.id}
                                    aria-controls="study-progress-workspaces"
                                    onClick={() => selectSubject(subject.id)}
                                    onKeyDown={event => {
                                        const index = visibleSubjects.findIndex(item => item.id === subject.id)
                                        const next = event.key === 'ArrowDown' ? visibleSubjects[(index + 1) % visibleSubjects.length]
                                            : event.key === 'ArrowUp' ? visibleSubjects[(index - 1 + visibleSubjects.length) % visibleSubjects.length]
                                            : event.key === 'Home' ? visibleSubjects[0]
                                            : event.key === 'End' ? visibleSubjects[visibleSubjects.length - 1] : undefined
                                        if (!next) return
                                        event.preventDefault()
                                        selectSubject(next.id)
                                        event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-testid="subject-select-${next.id}"]`)?.focus()
                                    }}>
                                    <span className="study-progress__subject-marker" style={{ '--subject-color': subject.color || '#0F766E' } as CSSProperties} aria-hidden="true" />
                                    <span className="study-progress__subject-label"><strong>{subject.name}</strong><span>{subject.completed_chapters || 0} / {subject.total_chapters || 0} 章节</span></span>
                                    <span className="study-progress__nav-percent">{subject.pct}%</span>
                                </button>
                            ))}
                            {visibleSubjects.length === 0 && <p className="study-progress__no-match" role="status">没有匹配的科目</p>}
                        </div>
                    </nav>
                    <label className="study-progress__compact-picker">
                        <span>切换科目</span>
                        <select className="input" aria-label="切换科目" value={activeSubjectId} onChange={event => selectSubject(Number(event.target.value))}>
                            {subjectMetrics.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                        </select>
                    </label>
                    <section id="study-progress-workspaces" className="study-progress__workspaces" aria-label="科目章节工作区">
                        {subjectMetrics.filter(subject => subject.id === activeSubjectId || visitedSubjectIds.has(subject.id)).map(subject => (
                            <article key={subject.id} id={`study-progress-workspace-${subject.id}`} data-testid={`subject-card-${subject.id}`}
                                className="study-progress__subject" hidden={subject.id !== activeSubjectId}
                                aria-labelledby={`study-progress-subject-${subject.id}`}>
                                <header className="study-progress__subject-header">
                                    <div className="study-progress__subject-heading">
                                        <h2 id={`study-progress-subject-${subject.id}`}>{subject.name}</h2>
                                        <span>已完成 {subject.completed_chapters || 0} / {subject.total_chapters || 0} 章 · {subject.pct}%</span>
                                    </div>
                                    <details className="study-progress__settings">
                                        <summary>科目设置 <ChevronDown size={14} aria-hidden="true" /></summary>
                                        <div className="study-progress__settings-menu">
                                            <button type="button" className="button button-secondary" title="编辑科目" onClick={event => {
                                                event.currentTarget.closest('details')?.removeAttribute('open')
                                                handleEdit(subject)
                                            }} disabled={!!subjectActionPending}><Pencil size={14} aria-hidden="true" /> 编辑科目</button>
                                            <button type="button" className="button button-secondary study-progress__delete" title="删除科目"
                                                onClick={() => void handleDelete(subject.id)} disabled={!!subjectActionPending}><Trash2 size={14} aria-hidden="true" /> 删除科目</button>
                                        </div>
                                    </details>
                                </header>
                                <div className="study-progress__track" role="progressbar" aria-label={`${subject.name}章节进度`}
                                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={subject.pct}
                                    aria-valuetext={`已完成 ${subject.completed_chapters || 0} / ${subject.total_chapters || 0} 章节`}>
                                    <span className="study-progress__fill" style={{ width: `${subject.pct}%` }} />
                                </div>
                                <div className="study-progress__evidence" aria-label="今日学习情况">
                                    <span>今日专注 <strong>{subject.studyTime}</strong> 分钟</span>
                                    <span>未掌握 <strong>{subject.mistakeCount - subject.masteredCount}</strong></span>
                                    <span>已掌握 <strong>{subject.masteredCount}</strong></span>
                                </div>
                                {!subject.hasDetailedChapters && (
                                    <div className="study-progress__summary-controls" aria-label={`${subject.name}汇总进度调整`}>
                                        <span>按数量记录进度</span>
                                        <button type="button" className="button button-secondary study-progress__summary-control"
                                            onClick={() => void updateSummaryProgress(subject, -1)}
                                            disabled={!!subjectActionPending || (subject.completed_chapters || 0) <= 0}
                                            title={`减少 ${subject.name} 的完成章节数`} aria-label={`减少 ${subject.name} 的完成章节数`}>−</button>
                                        <strong>{subject.completed_chapters || 0} / {subject.total_chapters || 0}</strong>
                                        <button type="button" className="button button-secondary study-progress__summary-control"
                                            onClick={() => void updateSummaryProgress(subject, 1)}
                                            disabled={!!subjectActionPending || (subject.completed_chapters || 0) >= (subject.total_chapters || 0)}
                                            title={`增加 ${subject.name} 的完成章节数`} aria-label={`增加 ${subject.name} 的完成章节数`}>+</button>
                                    </div>
                                )}
                                <SubjectChapterPanel subject={subject} chapters={chaptersBySubject[subject.id] || []}
                                    api={subjectChaptersAPI} onRefresh={loadAllData}
                                    onChapterUpdated={updateChapterLocally} todayChapterTasks={todayChapterTasks}
                                    onAddToToday={chapter => addChapterToToday(subject, chapter)}
                                    onRemoveFromToday={chapter => removeChapterFromToday(subject, chapter)} />
                            </article>
                        ))}
                    </section>
                </div>
            )}
        </div>
    )
}
