import { useState, useEffect, useRef } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'

export default function MistakeBook() {
    const diary = useDiary()
    const [mistakes, setMistakes] = useState([])
    const [subjects, setSubjects] = useState([])
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [filter, setFilter] = useState({ subject_id: '', mastered: '', search: '' })
    const [searchInput, setSearchInput] = useState('')
    const [form, setForm] = useState({ subject_id: '', question: '', answer: '', notes: '' })
    const [page, setPage] = useState(1)
    const PAGE_SIZE = 50
    const searchDebounceRef = useRef(null)

    useEffect(() => {
        loadSubjects()
        loadMistakes()
    }, [])

    useEffect(() => { loadMistakes() }, [filter])

    // Debounced search: update filter.search 300ms after user stops typing
    const handleSearchChange = (e) => {
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
            const filters = {}
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
                notes: form.notes
            }
            if (editingId) {
                await diary.mistakes.update(editingId, payload)
            } else {
                await diary.mistakes.create(payload)
            }
            setForm({ subject_id: '', question: '', answer: '', notes: '' })
            setShowForm(false)
            setEditingId(null)
            loadMistakes()
            showToast(editingId ? '修改已保存' : '已添加新的记录', 'success')
        } catch (e) {
            console.error(e)
            showToast('保存失败', 'error')
        }
    }

    const handleEdit = (m) => {
        setEditingId(m.id)
        setForm({
            subject_id: m.subject_id?.toString() || '',
            question: m.question,
            answer: m.answer || '',
            notes: m.notes || ''
        })
        setShowForm(true)
    }

    const handleDelete = async (id) => {
        try {
            await diary.mistakes.delete(id)
            loadMistakes()
            showToast('已删除', 'success')
        } catch (e) {
            console.error(e)
            showToast('删除失败', 'error')
        }
    }

    const toggleMastered = async (id) => {
        try {
            await diary.mistakes.toggleMastered(id)
            loadMistakes()
        } catch (e) { console.error(e) }
    }

    const masteredCount = mistakes.filter(m => m.mastered).length
    const totalCount = mistakes.length
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    const pagedMistakes = mistakes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <div style={{ padding: 'var(--space-xl)' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-lg)' }}>
                <div>
                    <h2>📝 错题 / 知识点本</h2>
                    <span className="text-sm text-muted">
                        共 {totalCount} 条，已掌握 {masteredCount} 条
                    </span>
                </div>
                <button className="button button-primary" onClick={() => {
                    setShowForm(!showForm); setEditingId(null);
                    setForm({ subject_id: '', question: '', answer: '', notes: '' })
                }}>
                    + 添加
                </button>
            </div>

            {/* Filters */}
            <div className="flex gap-sm" style={{ marginBottom: 'var(--space-md)' }}>
                <input
                    className="input" placeholder="🔍 搜索..." style={{ flex: 1 }}
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
                <div className="card" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' }}>
                    <h3 style={{ marginBottom: 'var(--space)' }}>{editingId ? '编辑' : '添加错题/知识点'}</h3>
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
                                    ? <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>✅ 已掌握</span>
                                    : <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 500 }}>⏳ 待复习</span>}
                            </div>
                            <div className="flex gap-xs">
                                <button className="button button-secondary" style={{ padding: '2px 8px', fontSize: 12 }}
                                    onClick={() => toggleMastered(m.id)}>
                                    {m.mastered ? '↩️ 重学' : '✅ 掌握'}
                                </button>
                                <button className="button button-secondary" style={{ padding: '2px 8px', fontSize: 12 }}
                                    onClick={() => handleEdit(m)}>✏️</button>
                                <button className="button button-secondary" style={{ padding: '2px 8px', fontSize: 12 }}
                                    onClick={() => handleDelete(m.id)}>🗑️</button>
                            </div>
                        </div>
                        <div style={{ marginBottom: 'var(--space-xs)' }}>
                            <strong>Q：</strong>{m.question}
                        </div>
                        {m.answer && (
                            <div className="text-secondary" style={{ marginBottom: 'var(--space-xs)' }}>
                                <strong>A：</strong>{m.answer}
                            </div>
                        )}
                        {m.notes && (
                            <div className="text-sm text-muted" style={{ fontStyle: 'italic' }}>
                                📌 {m.notes}
                            </div>
                        )}
                    </div>
                ))}
                {mistakes.length === 0 && (
                    <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: 400, gap: 'var(--space-md)' }}>
                        <div style={{ fontSize: 64, opacity: 0.9 }}>📚</div>
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
