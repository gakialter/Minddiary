import { useState, useEffect, useRef } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { BookX, Search, CheckCircle2, Clock, Undo2, Pencil, Trash2, Pin, BookOpen } from 'lucide-react'
import type { Mistake, Subject, MistakeFilters } from '../types'
import { calculateNextReview, isDueForReview, REVIEW_QUALITIES } from '../utils/spacedRepetition'
import Latex from 'react-latex-next'

interface MistakeFilter {
    subject_id: string
    mastered: string
    search: string
}

interface MistakeForm {
    subject_id: string
    question: string
    answer: string
    notes: string
    image_path?: string | null
}

export default function MistakeBook() {
    const diary = useDiary()
    const [mistakes, setMistakes] = useState<Mistake[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [filter, setFilter] = useState<MistakeFilter>({ subject_id: '', mastered: '', search: '' })
    const [searchInput, setSearchInput] = useState('')
    const [form, setForm] = useState<MistakeForm>({ subject_id: '', question: '', answer: '', notes: '', image_path: null })
    const [page, setPage] = useState(1)
    const [isDragging, setIsDragging] = useState(false)
    const PAGE_SIZE = 50
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        loadSubjects()
        loadMistakes()
    }, [])

    useEffect(() => { loadMistakes() }, [filter])

    // Debounced search: update filter.search 300ms after user stops typing
    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value
        setSearchInput(val)
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
        searchDebounceRef.current = setTimeout(() => {
            setFilter(f => ({ ...f, search: val }))
            setPage(1)
        }, 300)
    }

    const loadSubjects = async () => {
        try {
            const data = await diary.subjects.getAll()
            setSubjects(data || [])
        } catch (e) { console.error(e) }
    }

    const loadMistakes = async () => {
        try {
            const filters: MistakeFilters = {}
            if (filter.subject_id) filters.subject_id = Number(filter.subject_id)
            if (filter.mastered !== '') filters.mastered = filter.mastered === 'true'
            if (filter.search) filters.search = filter.search
            const data = await diary.mistakes.getAll(filters)
            setMistakes(data || [])
        } catch (e) { console.error(e) }
    }

    const handleSubmit = async () => {
        if (!form.question.trim()) return
        try {
            const payload = {
                subject_id: form.subject_id ? Number(form.subject_id) : null,
                question: form.question,
                answer: form.answer,
                notes: form.notes,
                image_path: form.image_path || null
            }
            if (editingId) {
                await diary.mistakes.update(editingId, payload)
            } else {
                await diary.mistakes.create(payload)
            }
            setForm({ subject_id: '', question: '', answer: '', notes: '', image_path: null })
            setShowForm(false)
            setEditingId(null)
            loadMistakes()
            showToast(editingId ? '修改已保存' : '已添加新的记录', 'success')
        } catch (e) {
            console.error(e)
            showToast('保存失败', 'error')
        }
    }

    const handleEdit = (m: Mistake) => {
        setEditingId(m.id)
        setForm({
            subject_id: m.subject_id?.toString() || '',
            question: m.question,
            answer: m.answer || '',
            notes: m.notes || '',
            image_path: m.image_path || null
        })
        setShowForm(true)
    }

    const handleImageFile = async (file: File) => {
        if (!file.type.startsWith('image/') || !diary.mistakes.saveImage) return
        
        try {
            const reader = new FileReader()
            reader.onload = async (e) => {
                const base64 = e.target?.result?.toString().split(',')[1]
                if (base64) {
                    const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')) : '.png'
                    const filename = await diary.mistakes.saveImage!({ data: base64, ext: ext || '.png' })
                    setForm(f => ({ ...f, image_path: filename }))
                    showToast('图片已上传', 'success')
                }
            }
            reader.readAsDataURL(file)
        } catch (e) {
            console.error(e)
            showToast('图片上传失败', 'error')
        }
    }

    const handlePaste = (e: React.ClipboardEvent) => {
        if (!showForm || !e.clipboardData || !e.clipboardData.items) return
        const items = e.clipboardData.items
        for (let i = 0; i < items.length; i++) {
            const item = items[i]
            if (item && item.type.startsWith('image/')) {
                const file = item.getAsFile()
                if (file) handleImageFile(file)
                break
            }
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        if (!showForm || !e.dataTransfer || !e.dataTransfer.files) return
        const files = e.dataTransfer.files
        if (files.length > 0) {
            const file = files.item(0)
            if (file && file.type.startsWith('image/')) {
                handleImageFile(file)
            }
        }
    }

    const handleDelete = async (id: number) => {
        try {
            await diary.mistakes.delete(id)
            loadMistakes()
            showToast('已删除', 'success')
        } catch (e) {
            console.error(e)
            showToast('删除失败', 'error')
        }
    }

    const toggleMastered = async (id: number) => {
        try {
            await diary.mistakes.toggleMastered(id)
            loadMistakes()
        } catch (e) { console.error(e) }
    }

    const handleReview = async (m: Mistake, quality: number) => {
        try {
            const result = calculateNextReview(
                quality,
                m.ease_factor || 2.5,
                m.review_interval || 1,
                m.review_count || 0
            )
            await diary.mistakes.review(m.id, result)
            loadMistakes()
            if (quality >= 3) showToast('复习成功，已安排下次复习', 'success')
            else showToast('没关系，已重置学习进度', 'info')
        } catch (e) {
            console.error(e)
            showToast('复习记录失败', 'error')
        }
    }

    const masteredCount = mistakes.filter(m => m.mastered).length
    const totalCount = mistakes.length
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    const pagedMistakes = mistakes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <div style={{ padding: 'var(--space-xl)' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-lg)' }}>
                <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <BookX size={22} style={{ color: 'var(--accent)' }} /> 错题 / 知识点本
                    </h2>
                    <span className="text-sm text-muted">
                        共 {totalCount} 条，已掌握 {masteredCount} 条
                    </span>
                </div>
                <button className="button button-primary" onClick={() => {
                    setShowForm(!showForm); setEditingId(null);
                    setForm({ subject_id: '', question: '', answer: '', notes: '', image_path: null })
                }}>
                    + 添加
                </button>
            </div>

            {/* Filters */}
            <div className="flex gap-sm" style={{ marginBottom: 'var(--space-md)' }}>
                <input
                    className="input" placeholder="搜索..." style={{ flex: 1, paddingLeft: 12 }}
                    value={searchInput} onChange={handleSearchChange}
                />
                <select className="input" value={filter.subject_id}
                    onChange={e => { setFilter({ ...filter, subject_id: e.target.value }); setPage(1) }}>
                    <option value="">全部科目</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="input" value={filter.mastered}
                    onChange={e => { setFilter({ ...filter, mastered: e.target.value }); setPage(1) }}>
                    <option value="">全部状态</option>
                    <option value="false">未掌握</option>
                    <option value="true">已掌握</option>
                </select>
            </div>

            {/* Add/Edit Form */}
            {showForm && (
                <div className="card" 
                     style={{ 
                         padding: 'var(--space-lg)', marginBottom: 'var(--space-md)',
                         border: isDragging ? '2px dashed var(--accent)' : '1px solid var(--border)' 
                     }}
                     onPaste={handlePaste}
                     onDragOver={handleDragOver}
                     onDragLeave={handleDragLeave}
                     onDrop={handleDrop}
                >
                    <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space)' }}>
                        <h3>{editingId ? '编辑' : '添加错题/知识点'}</h3>
                        <span className="text-xs text-muted">提示：支持 Ctrl+V 粘贴或拖拽图片</span>
                    </div>
                    <div className="flex flex-col gap-sm">
                        <select className="input" value={form.subject_id}
                            onChange={e => setForm({ ...form, subject_id: e.target.value })}>
                            <option value="">选择科目</option>
                            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <textarea
                            className="input" placeholder="问题 / 知识点" rows={3}
                            value={form.question} onChange={e => setForm({ ...form, question: e.target.value })}
                            style={{ resize: 'vertical' }}
                        />
                        <textarea
                            className="input" placeholder="答案 / 解析" rows={3}
                            value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })}
                            style={{ resize: 'vertical' }}
                        />
                        <textarea
                            className="input" placeholder="备注（可选）" rows={2}
                            value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                            style={{ resize: 'vertical' }}
                        />
                        {form.image_path && (
                            <div style={{ position: 'relative', display: 'inline-block', alignSelf: 'flex-start', marginTop: 'var(--space-xs)' }}>
                                <img 
                                    src={`local://${form.image_path}`} 
                                    alt="Mistake" 
                                    style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }} 
                                />
                                <button 
                                    onClick={() => setForm(f => ({ ...f, image_path: null }))}
                                    style={{ position: 'absolute', top: -8, right: -8, background: 'var(--error)', color: 'white', borderRadius: '50%', width: 24, height: 24, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >✕</button>
                            </div>
                        )}
                        <div className="flex gap-sm">
                            <button className="button button-primary" onClick={handleSubmit}>
                                {editingId ? '保存' : '添加'}
                            </button>
                            <button className="button button-secondary" onClick={() => { setShowForm(false); setEditingId(null) }}>
                                取消
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mistake List */}
            <div className="flex flex-col gap-sm">
                {pagedMistakes.map(m => (
                    <div key={m.id} className="card" style={{
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
                                    : isDueForReview(m.next_review_date) 
                                        ? <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={13} /> 今日待复习</span>
                                        : <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={13} /> 下次复习: {m.next_review_date}</span>
                                }
                            </div>
                            <div className="flex gap-xs">
                                <button className="button button-secondary" style={{ padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                                    onClick={() => toggleMastered(m.id)}>
                                    {m.mastered ? <><Undo2 size={13} /> 重新加入计划</> : <><CheckCircle2 size={13} /> 彻底掌握</>}
                                </button>
                                <button className="button button-secondary" style={{ padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    onClick={() => handleEdit(m)}><Pencil size={13} /></button>
                                <button className="button button-secondary" style={{ padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    onClick={() => handleDelete(m.id)}
                                    onMouseEnter={e => e.currentTarget.style.color = 'var(--error)'}
                                    onMouseLeave={e => e.currentTarget.style.color = 'inherit'}
                                ><Trash2 size={13} /></button>
                            </div>
                        </div>
                        <div style={{ marginBottom: 'var(--space-xs)', lineHeight: 1.6 }}>
                            <strong>Q：</strong><Latex>{m.question}</Latex>
                        </div>
                        {m.image_path && (
                            <div style={{ margin: 'var(--space-sm) 0' }}>
                                <img 
                                    src={`local://${m.image_path}`} 
                                    alt="Mistake" 
                                    style={{ maxHeight: 300, maxWidth: '100%', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }} 
                                />
                            </div>
                        )}
                        {m.answer && (
                            <div className="text-secondary" style={{ marginBottom: 'var(--space-xs)', lineHeight: 1.6 }}>
                                <strong>A：</strong><Latex>{m.answer}</Latex>
                            </div>
                        )}
                        {m.notes && (
                            <div className="text-sm text-muted" style={{ fontStyle: 'italic', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                <Pin size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {m.notes}
                            </div>
                        )}
                        
                        {/* Spaced Repetition Review Buttons */}
                        {!m.mastered && isDueForReview(m.next_review_date) && (
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
                ))}
                {mistakes.length === 0 && (
                    <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: 400, gap: 'var(--space-md)' }}>
                        <img src="/images/mistakebook_empty.png" alt="空错题本" style={{ width: 120, height: 120, objectFit: 'contain', opacity: 0.9, marginBottom: 'var(--space-sm)' }} />
                        <h3 className="text-lg font-medium">还没有错题记录</h3>
                        <p className="text-muted" style={{ maxWidth: 300 }}>
                            你可以将遇到的错题或需要背诵的知识点记录在这里，支持关联科目并随时复习。
                        </p>
                        {!showForm && (
                            <button className="button button-primary" style={{ marginTop: 'var(--space)' }} onClick={() => setShowForm(true)}>
                                + 添加第一条记录
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-sm" style={{ marginTop: 'var(--space-lg)' }}>
                    <button className="button button-secondary" style={{ padding: '4px 12px' }}
                        disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ 上一页</button>
                    <span className="text-sm text-muted">{page} / {totalPages}</span>
                    <button className="button button-secondary" style={{ padding: '4px 12px' }}
                        disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页 ›</button>
                </div>
            )}
        </div>
    )
}
