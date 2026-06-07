import { useState, useEffect, useMemo } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { logger } from '../utils/logger'
import { getLocalDateKey } from '../utils/dateKey'
import { Rocket, Target, Pencil, Trash2, Library, PlusCircle, Sparkles } from 'lucide-react'
import type { Subject, Mistake, PomodoroStat } from '../types'

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
}

export default function StudyProgress() {
    const { subjects: subjectsAPI, pomodoro: pomodoroAPI, mistakes: mistakesAPI } = useDiary()
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [pomodoroStats, setPomodoroStats] = useState<PomodoroStat[]>([])
    const [mistakes, setMistakes] = useState<Mistake[]>([])
    const [loading, setLoading] = useState(true)

    // Form states
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [form, setForm] = useState<SubjectForm>({ name: '', total_chapters: '', color: '#0F766E' })

    useEffect(() => {
        loadAllData()
    }, [])

    const loadAllData = async () => {
        setLoading(true)
        try {
            const [subjData, pStats, mistData] = await Promise.all([
                subjectsAPI.getAll().catch(() => [] as Subject[]),
                pomodoroAPI.getStats(getLocalDateKey()).catch(() => [] as PomodoroStat[]),
                mistakesAPI.getAll({}).catch(() => ({ data: [] } as any))
            ])
            setSubjects((subjData || []) as Subject[])
            setPomodoroStats((pStats || []) as PomodoroStat[])
            const mistArray = mistData && 'data' in mistData ? mistData.data : mistData;
            setMistakes((mistArray || []) as Mistake[])
        } catch (e) {
            logger.error(e)
        } finally {
            setLoading(false)
        }
    }

    const { totalChapters, totalCompleted, overallProgress, subjectMetrics } = useMemo(() => {
        // Index mistakes by subject_id
        const mistakeIndex = new Map<number | null, { total: number; mastered: number }>()
        for (const m of mistakes) {
            const bucket = mistakeIndex.get(m.subject_id) ?? { total: 0, mastered: 0 }
            bucket.total++
            if (m.mastered) bucket.mastered++
            mistakeIndex.set(m.subject_id, bucket)
        }

        // Index pomodoro time by subject name
        const pomodoroIndex = new Map<string, number>(pomodoroStats.map(p => [p.subject_name, p.total_minutes]))

        let chTotal = 0
        let chCompleted = 0

        const metrics: SubjectMetric[] = subjects.map(sub => {
            const t = sub.total_chapters || 0
            const c = Math.min(sub.completed_chapters || 0, t)
            chTotal += t
            chCompleted += c

            const { total: mistakeCount = 0, mastered: masteredCount = 0 } =
                mistakeIndex.get(sub.id) ?? {}
            const pTime = pomodoroIndex.get(sub.name) ?? 0

            return {
                ...sub,
                pct: t > 0 ? Math.round((c / t) * 100) : 0,
                studyTime: pTime,
                mistakeCount,
                masteredCount
            }
        })

        return {
            totalChapters: chTotal,
            totalCompleted: chCompleted,
            overallProgress: chTotal > 0 ? (chCompleted / chTotal * 100).toFixed(1) : '0',
            subjectMetrics: metrics
        }
    }, [subjects, pomodoroStats, mistakes])

    // --- Actions ---
    const handleSubmit = async () => {
        if (!form.name.trim()) return
        try {
            if (editingId) {
                const subject = subjects.find(s => s.id === editingId)
                await subjectsAPI.update(editingId, {
                    name: form.name,
                    total_chapters: parseInt(form.total_chapters) || 0,
                    completed_chapters: subject?.completed_chapters || 0,
                    color: form.color
                })
            } else {
                await subjectsAPI.create({
                    name: form.name,
                    total_chapters: parseInt(form.total_chapters) || 0,
                    color: form.color
                })
            }
            setForm({ name: '', total_chapters: '', color: '#0F766E' })
            setShowForm(false)
            setEditingId(null)
            loadAllData()
            showToast(editingId ? '科目已更新' : '已添加新科目', 'success')
        } catch (e) {
            logger.error(e)
            showToast('保存失败', 'error')
        }
    }

    const handleEdit = (subject: SubjectMetric) => {
        setEditingId(subject.id)
        setForm({ name: subject.name, total_chapters: (subject.total_chapters || 0).toString(), color: subject.color })
        setShowForm(true)
    }

    const handleDelete = async (id: number) => {
        if (!window.confirm('确定要删除这个科目吗？关联的错题、专注记录和任务会保留，但将不再归属任何科目。')) return;
        try {
            await subjectsAPI.delete(id)
            loadAllData()
            showToast('科目已删除', 'success')
        } catch (e) {
            logger.error(e)
            showToast('删除失败', 'error')
        }
    }

    const updateProgress = async (subject: SubjectMetric, delta: number) => {
        const newCompleted = Math.max(0, Math.min(subject.total_chapters || 0, (subject.completed_chapters || 0) + delta))
        try {
            await subjectsAPI.update(subject.id, {
                ...subject,
                completed_chapters: newCompleted
            })
            // Optimistic update
            setSubjects(prev => prev.map(s => s.id === subject.id ? { ...s, completed_chapters: newCompleted } : s));
        } catch (e) { logger.error(e) }
    }

    // Zen Forest Palette
    const COLORS = ['#0F766E', '#2F8F6B', '#0E7490', '#475569', '#854D0E', '#C65A3A', '#4D7C0F', '#6B7280']

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 'var(--space-2xl)' }}>
            {/* Overall Header Banner */}
            <div className="card" style={{
                padding: 'var(--space-xl)', marginBottom: 'var(--space-2xl)',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-light)'
            }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-md)' }}>
                    <div className="flex items-center gap-md">
                        <div className="flex items-center gap-sm">
                            <div style={{ padding: 8, borderRadius: 12, background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Target size={18} />
                            </div>
                            <span className="font-semibold text-lg">备考大盘</span>
                        </div>
                        <span className="font-bold text-3xl" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{overallProgress}%</span>
                    </div>
                    
                    {!showForm && (
                        <button className="button button-primary" style={{ borderRadius: 20 }} onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: '', total_chapters: '', color: '#0F766E' }) }}>
                            + 新增科目池
                        </button>
                    )}
                </div>

                <div style={{ height: 12, background: 'var(--bg-primary)', borderRadius: 6, overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)' }}>
                    <div style={{
                        height: '100%', width: `${overallProgress}%`,
                        background: 'var(--accent)',
                        borderRadius: 6, transition: 'width 1s cubic-bezier(0.34, 1.56, 0.64, 1)'
                    }} />
                </div>

                <div className="flex items-center justify-between mt-4">
                    <div className="text-sm">
                        <span className="text-muted">已攻克 </span>
                        <span className="font-semibold">{totalCompleted}</span>
                        <span className="text-muted"> / {totalChapters} 核心章节</span>
                    </div>
                    {Number(overallProgress) >= 100 && totalChapters > 0 ? (
                        <div className="text-xs font-semibold" style={{ color: 'var(--success)', background: 'var(--success-light)', padding: '4px 10px', borderRadius: 12 }}>
                            目标达成！
                        </div>
                    ) : null}
                </div>
            </div>

            {/* Add/Edit Form */}
            {showForm && (
                <div className="card" style={{ padding: 'var(--space-xl)', marginBottom: 'var(--space-xl)', animation: 'page-fade-in 0.3s ease-out' }}>
                    <h3 style={{ marginBottom: 'var(--space-lg)', fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {editingId ? <><Pencil size={18} /> 编辑科目</> : <><Sparkles size={18} /> 创建新科目</>}
                    </h3>
                    <div className="flex flex-col gap-md">
                        <div className="flex gap-md w-full">
                            <div style={{ flex: 2 }}>
                                <label className="text-xs font-bold text-muted uppercase mb-1 block">科目名称</label>
                                <input className="input w-full" placeholder="例如：考研政治、英语一" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="text-xs font-bold text-muted uppercase mb-1 block">总章节数</label>
                                <input className="input w-full" type="number" placeholder="例如：50" value={form.total_chapters} onChange={e => setForm({ ...form, total_chapters: e.target.value })} />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-muted uppercase mb-2 block">代表色 (用于图表与标签)</label>
                            <div className="flex items-center gap-md flex-wrap">
                                {COLORS.map(c => (
                                    <button
                                        key={c} onClick={() => setForm({ ...form, color: c })}
                                        style={{
                                            width: 32, height: 32, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                                            outline: form.color === c ? `3px solid ${c}40` : 'none',
                                            outlineOffset: 2,
                                            boxShadow: form.color === c ? 'var(--shadow-md)' : 'none',
                                            transform: form.color === c ? 'scale(1.1)' : 'scale(1)',
                                            transition: 'all 0.2s'
                                        }}
                                        title={c}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="flex gap-sm mt-2 justify-end">
                            <button className="button button-secondary" onClick={() => { setShowForm(false); setEditingId(null) }}>
                                取消
                            </button>
                            <button className="button button-primary" onClick={handleSubmit} disabled={!form.name.trim() || !form.total_chapters}>
                                {editingId ? '保存更改' : '创建科目'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Subjects Grid */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-xl)'
            }}>
                {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="card" style={{ padding: 'var(--space-lg)', minHeight: 200, opacity: 0.5 }}>
                            <div className="skeleton-line" style={{ width: '40%', height: 24, marginBottom: 20 }} />
                            <div className="skeleton-line" style={{ width: '100%', height: 8, borderRadius: 4, marginBottom: 30 }} />
                            <div className="flex justify-between">
                                <div className="skeleton-line" style={{ width: '20%', height: 16 }} />
                                <div className="skeleton-line" style={{ width: '30%', height: 24, borderRadius: 12 }} />
                            </div>
                        </div>
                    ))
                ) : (
                    subjectMetrics.map(subject => {
                        const displayColor = subject.color || '#0F766E';
                        return (
                        <div key={subject.id} className="card progress-card" style={{
                            padding: 'var(--space-xl)',
                            position: 'relative', overflow: 'hidden',
                            borderTop: `4px solid ${displayColor}`
                        }}>
                            {/* Glass background decoration */}
                            <div style={{
                                position: 'absolute', top: -50, right: -50, width: 100, height: 100,
                                borderRadius: '50%', background: displayColor, opacity: 0.05, filter: 'blur(20px)'
                            }} />

                            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-md)' }}>
                                <div className="flex items-center gap-sm">
                                    <h3 className="font-bold text-lg">{subject.name}</h3>
                                </div>
                                <div className="flex gap-xs" style={{ opacity: 0.6 }}>
                                    <button
                                        className="icon-button"
                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6 }}
                                        onClick={() => handleEdit({...subject, color: displayColor})}
                                        title="编辑科目"
                                    ><Pencil size={14} /></button>
                                    <button
                                        className="icon-button"
                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6 }}
                                        onClick={() => handleDelete(subject.id)}
                                        title="删除科目"
                                        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-state-danger)'}
                                        onMouseLeave={e => e.currentTarget.style.color = 'inherit'}
                                    ><Trash2 size={14} /></button>
                                </div>
                            </div>

                            <div className="flex items-end justify-between" style={{ marginBottom: 'var(--space-sm)' }}>
                                <div className="text-3xl font-extrabold" style={{ color: displayColor, fontVariantNumeric: 'tabular-nums' }}>
                                    {subject.pct}%
                                </div>
                                <div className="text-sm text-muted font-medium mb-1">
                                    {subject.completed_chapters || 0} / {subject.total_chapters} Pts
                                </div>
                            </div>

                            <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden', marginBottom: 'var(--space-lg)' }}>
                                <div style={{
                                    height: '100%', width: `${subject.pct}%`,
                                    background: displayColor, borderRadius: 4, transition: 'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)'
                                }} />
                            </div>

                            {/* Stats Metrics */}
                            <div className="flex justify-between items-center text-sm mb-4 bg-tertiary rounded p-2" style={{ background: 'var(--bg-secondary)', borderRadius: 8 }}>
                                <div className="flex flex-col items-center flex-1">
                                    <span className="text-muted text-xs mb-1">今日投入</span>
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

                            <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                                <span className="text-xs text-muted font-medium uppercase tracking-wider">更新进度</span>
                                <div className="flex gap-sm">
                                    <button className="button button-secondary flex items-center justify-center p-0"
                                        style={{ width: 32, height: 32, borderRadius: '50%' }}
                                        onClick={() => updateProgress(subject, -1)}
                                        disabled={(subject.completed_chapters || 0) <= 0}
                                    >−</button>
                                    <button className="button button-primary flex items-center justify-center p-0"
                                        style={{ width: 32, height: 32, borderRadius: '50%', background: displayColor, boxShadow: `0 2px 8px ${displayColor}40` }}
                                        onClick={() => updateProgress(subject, 1)}
                                        disabled={(subject.completed_chapters || 0) >= (subject.total_chapters || 0)}
                                    >+</button>
                                </div>
                            </div>
                        </div>
                    )})
                )}

                {!loading && subjectMetrics.length === 0 && !showForm && (
                    <div className="empty-state" style={{ gridColumn: '1 / -1', padding: 'var(--space-3xl)' }}>
                        <Library size={56} style={{ marginBottom: 'var(--space)', opacity: 0.2, color: 'var(--text-secondary)' }} />
                        <h3 style={{ fontSize: 18, marginBottom: 'var(--space-sm)' }}>尚未建立复习轨迹</h3>
                        <p className="text-muted" style={{ maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
                            添加您要报考的科目，拆分章节任务。我们将会结合番茄钟与错题本数据，为您生成精准的能力雷达。
                        </p>
                    </div>
                )}
            </div>

            <style>{`
                .progress-card {
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .progress-card:hover {
                    transform: translateY(-4px);
                    box-shadow: var(--shadow-xl);
                }
                .icon-button {
                    background: transparent; border: none; cursor: pointer; opacity: 0.6; transition: all 0.2s;
                }
                .icon-button:hover {
                    opacity: 1; transform: scale(1.1);
                }
            `}</style>
        </div>
    )
}
