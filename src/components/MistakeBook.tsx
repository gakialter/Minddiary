import { useState, useEffect, useRef } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { BookX, Search, CheckCircle2, Clock, Undo2, Pencil, Trash2, Pin, BookOpen, ImagePlus, X } from 'lucide-react'
import type { Mistake, Subject, MistakeFilters } from '../types'
import { calculateNextReview, isDueForReview, REVIEW_QUALITIES } from '../utils/spacedRepetition'
import { MistakeItem } from './MistakeItem'
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
    image_paths: string[]
}

const parseImagePaths = (raw?: string | null): string[] => {
    if (!raw) return []
    if (raw.startsWith('[')) { try { return JSON.parse(raw) } catch { return [] } }
    return [raw]
}

const serializeImagePaths = (paths: string[]): string | null => {
    if (paths.length === 0) return null
    if (paths.length === 1) return paths[0]!
    return JSON.stringify(paths)
}

export default function MistakeBook() {
    const diary = useDiary()
    const [mistakes, setMistakes] = useState<Mistake[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [filter, setFilter] = useState<MistakeFilter>({ subject_id: '', mastered: '', search: '' })
    const [searchInput, setSearchInput] = useState('')
    const [form, setForm] = useState<MistakeForm>({ subject_id: '', question: '', answer: '', notes: '', image_paths: [] })
    const [page, setPage] = useState(1)
    const [isDragging, setIsDragging] = useState(false)
    const PAGE_SIZE = 50
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

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
                image_path: serializeImagePaths(form.image_paths)
            }
            if (editingId) {
                await diary.mistakes.update(editingId, payload)
            } else {
                await diary.mistakes.create(payload)
            }
            setForm({ subject_id: '', question: '', answer: '', notes: '', image_paths: [] })
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
            image_paths: parseImagePaths(m.image_path)
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
                    setForm(f => ({ ...f, image_paths: [...f.image_paths, filename] }))
                    showToast('图片已上传', 'success')
                }
            }
            reader.readAsDataURL(file)
        } catch (e) {
            console.error(e)
            showToast('图片上传失败', 'error')
        }
    }

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'))
        files.forEach(file => handleImageFile(file))
        e.target.value = ''
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
        for (let i = 0; i < files.length; i++) {
            const file = files.item(i)
            if (file && file.type.startsWith('image/')) handleImageFile(file)
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
                <div className="text-sm text-muted">
                    共 <strong style={{ color: 'var(--text-primary)' }}>{totalCount}</strong> 条记录，已吃透 <strong style={{ color: 'var(--success)' }}>{masteredCount}</strong> 条
                </div>
                <button className="button button-primary" onClick={() => {
                    setShowForm(!showForm); setEditingId(null);
                    setForm({ subject_id: '', question: '', answer: '', notes: '', image_paths: [] })
                }} data-testid="mistake-add-btn">
                    + 添加
                </button>
            </div>

            {/* Filters */}
            <div className="flex gap-sm" style={{ marginBottom: 'var(--space-md)' }}>
                <input
                    className="input" placeholder="搜索..." style={{ flex: 1, paddingLeft: 12 }}
                    value={searchInput} onChange={handleSearchChange}
                    data-testid="mistake-search-input"
                />
                <select className="input" value={filter.subject_id}
                    onChange={e => { setFilter({ ...filter, subject_id: e.target.value }); setPage(1) }}
                    data-testid="mistake-subject-filter">
                    <option value="">全部科目</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="input" value={filter.mastered}
                    onChange={e => { setFilter({ ...filter, mastered: e.target.value }); setPage(1) }}
                    data-testid="mistake-status-filter">
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
                        <span className="text-xs text-muted">提示：支持 Ctrl/Cmd+V 粘贴或拖拽图片</span>
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
                        {/* Multi-image thumbnails */}
                        {form.image_paths.length > 0 && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'var(--space-xs)' }}>
                                {form.image_paths.map((imgPath, idx) => (
                                    <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
                                        <img
                                            src={`local://${imgPath}`}
                                            alt={`图片 ${idx + 1}`}
                                            style={{ height: 80, width: 80, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'block' }}
                                        />
                                        <button
                                            onClick={() => setForm(f => ({ ...f, image_paths: f.image_paths.filter((_, i) => i !== idx) }))}
                                            style={{ position: 'absolute', top: -8, right: -8, background: 'var(--color-state-danger)', color: 'white', borderRadius: '50%', width: 22, height: 22, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            title="删除此图片"
                                        ><X size={14} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Action row: submit + cancel + upload */}
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button className="button button-primary" onClick={handleSubmit}>
                                {editingId ? '保存' : '添加'}
                            </button>
                            <button className="button button-secondary" onClick={() => { setShowForm(false); setEditingId(null) }}>
                                取消
                            </button>
                            <button
                                className="button button-secondary"
                                onClick={() => fileInputRef.current?.click()}
                                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                                title="选择图片文件（支持多选）"
                            >
                                <ImagePlus size={16} /> 上传图片
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleFileInputChange}
                                style={{ display: 'none' }}
                            />
                            {form.image_paths.length === 0 && (
                                <span className="text-xs text-muted">或拖拽 / Ctrl+V 粘贴</span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Mistake List */}
            <div className="flex flex-col gap-sm">
                {pagedMistakes.map(m => (
                    <MistakeItem
                        key={m.id}
                        mistake={m}
                        parseImagePaths={parseImagePaths}
                        toggleMastered={toggleMastered}
                        handleEdit={handleEdit}
                        handleDelete={handleDelete}
                        handleReview={handleReview}
                    />
                ))}
                {mistakes.length === 0 && (
                    <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: 400, gap: 'var(--space-md)' }} data-testid="mistake-empty-state">
                        <div style={{ width: 100, height: 100, borderRadius: '50%', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-sm)', border: '2px solid var(--bg-secondary)', boxShadow: 'var(--shadow-sm)' }}>
                            <BookX size={48} style={{ color: 'var(--accent)', opacity: 0.9 }} />
                        </div>
                        <h3 className="text-lg font-medium">还没有错题记录</h3>
                        <p className="text-muted" style={{ maxWidth: 300 }}>
                            你可以将遇到的错题或需要背诵的知识点记录在这里，支持关联科目并随时复习。
                        </p>
                        {!showForm && (
                            <button className="button button-primary" style={{ marginTop: 'var(--space)' }} onClick={() => setShowForm(true)} data-testid="mistake-add-first-btn">
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
