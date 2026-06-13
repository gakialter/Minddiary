import { useState, useEffect, useRef, useCallback } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { ArrowRightLeft, BookX, Search, CheckCircle2, Clock, Undo2, Pencil, Trash2, Pin, BookOpen, ImagePlus, X } from 'lucide-react'
import { logger } from '../utils/logger'
import type { Mistake, Subject, MistakeFilters } from '../types'
import { isDueForReview } from '../utils/spacedRepetition'
import { getLocalDateKey } from '../utils/dateKey'
import { submitMistakeReview } from '../utils/mistakeReviewCoordinator'
import { MistakeItem } from './MistakeItem'
import Latex from 'react-latex-next'
import { toLocalAssetUrl } from '../utils/localAssetUrl'
import ClickableImage from './ClickableImage'
import FormatToolbar from './common/FormatToolbar'
import { useTextFormat } from '../hooks/useTextFormat'
import ImagePreviewModal, { type PreviewImage } from './ImagePreviewModal'
import MistakeReviewModal from './MistakeReviewModal'

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
    question_image_paths: string[]
    answer_image_paths: string[]
}

type ImageRole = 'question' | 'answer'

export type MistakeFilterIntent = 'due'

interface MistakeBookProps {
    initialFilter?: MistakeFilterIntent | null
    onInitialFilterApplied?: () => void
}

const parseImagePaths = (raw?: string | null): string[] => {
    const trimmed = raw?.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed)
            return Array.isArray(parsed)
                ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                : []
        } catch {
            return [trimmed]
        }
    }
    return [trimmed]
}

const serializeImagePaths = (paths: string[]): string | null => {
    if (paths.length === 0) return null
    if (paths.length === 1) return paths[0]!
    return JSON.stringify(paths)
}

const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024

export default function MistakeBook({ initialFilter = null, onInitialFilterApplied }: MistakeBookProps) {
    const diary = useDiary()
    const [mistakes, setMistakes] = useState<Mistake[]>([])
    const [totalCount, setTotalCount] = useState(0)
    const [masteredCount, setMasteredCount] = useState(0)
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [filter, setFilter] = useState<MistakeFilter>({ subject_id: '', mastered: '', search: '' })
    const [dueOnly, setDueOnly] = useState(initialFilter === 'due')
    const [searchInput, setSearchInput] = useState('')
    const [form, setForm] = useState<MistakeForm>({ subject_id: '', question: '', answer: '', notes: '', question_image_paths: [], answer_image_paths: [] })
    const [page, setPage] = useState(1)
    const [draggingRole, setDraggingRole] = useState<ImageRole | null>(null)
    const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null)
    const [showManualReview, setShowManualReview] = useState(false)
    const [reviewingMistakeIds, setReviewingMistakeIds] = useState<Set<number>>(new Set())
    const [editScrollRequest, setEditScrollRequest] = useState(0)
    const PAGE_SIZE = 50
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const questionFileInputRef = useRef<HTMLInputElement>(null)
    const answerFileInputRef = useRef<HTMLInputElement>(null)
    const formRef = useRef<HTMLDivElement>(null)
    const questionTextareaRef = useRef<HTMLTextAreaElement>(null)
    const notesTextareaRef = useRef<HTMLTextAreaElement>(null)
    const reviewInFlightIdsRef = useRef<Set<number>>(new Set())

    const handleNotesValueChange = useCallback((newValue: string) => {
        setForm(f => ({ ...f, notes: newValue }))
    }, [])
    const notesFormat = useTextFormat(notesTextareaRef, handleNotesValueChange)

    useEffect(() => {
        loadSubjects()
        loadMistakes()
    }, [])

    useEffect(() => { loadMistakes() }, [filter, page, dueOnly])

    useEffect(() => {
        if (initialFilter !== 'due') return
        setDueOnly(true)
        setPage(1)
        onInitialFilterApplied?.()
    }, [initialFilter, onInitialFilterApplied])

    useEffect(() => {
        if (!showForm || !editingId || editScrollRequest === 0) return
        const frameId = requestAnimationFrame(() => {
            formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            questionTextareaRef.current?.focus({ preventScroll: true })
        })
        return () => cancelAnimationFrame(frameId)
    }, [showForm, editingId, editScrollRequest])

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
        } catch (e) { logger.error(e) }
    }

    const loadMistakes = async () => {
        try {
            const filters: MistakeFilters = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }
            if (filter.subject_id) filters.subject_id = Number(filter.subject_id)
            if (dueOnly) {
                filters.due = true
                filters.dueDate = getLocalDateKey()
            } else if (filter.mastered !== '') {
                filters.mastered = filter.mastered === 'true'
            }
            if (filter.search) filters.search = filter.search
            const response: { data: Mistake[]; total: number; masteredTotal: number } | Mistake[] = await diary.mistakes.getAll(filters)
            if (Array.isArray(response)) {
                setMistakes(response)
                setTotalCount(response.length)
                setMasteredCount(response.filter(m => m.mastered).length)
            } else {
                setMistakes(response?.data || [])
                setTotalCount(response?.total || 0)
                setMasteredCount(response?.masteredTotal || 0)
            }
        } catch (e) { logger.error(e) }
    }

    const handleSubmit = async () => {
        if (!form.question.trim()) return
        try {
            const payload = {
                subject_id: form.subject_id ? Number(form.subject_id) : null,
                question: form.question,
                answer: form.answer,
                notes: form.notes,
                image_path: serializeImagePaths(form.question_image_paths),
                answer_image_path: serializeImagePaths(form.answer_image_paths),
            }
            if (editingId) {
                await diary.mistakes.update(editingId, payload)
            } else {
                await diary.mistakes.create(payload)
            }
            setForm({ subject_id: '', question: '', answer: '', notes: '', question_image_paths: [], answer_image_paths: [] })
            setShowForm(false)
            setEditingId(null)
            loadMistakes()
            showToast(editingId ? '修改已保存' : '已添加新的记录', 'success')
        } catch (e) {
            logger.error(e)
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
            question_image_paths: parseImagePaths(m.image_path),
            answer_image_paths: parseImagePaths(m.answer_image_path),
        })
        setShowForm(true)
        setEditScrollRequest(request => request + 1)
    }

    const appendImagePath = (role: ImageRole, filename: string) => {
        setForm(f => role === 'question'
            ? { ...f, question_image_paths: [...f.question_image_paths, filename] }
            : { ...f, answer_image_paths: [...f.answer_image_paths, filename] })
    }

    const handleImageFile = async (file: File, role: ImageRole) => {
        if (!file.type.startsWith('image/')) {
            showToast(`文件 ${file.name} 不是图片，已拒绝上传`, 'error')
            return
        }
        if (file.size > MAX_IMAGE_FILE_BYTES) {
            showToast(`图片 ${file.name} 超过 10MB，已拒绝上传`, 'error')
            return
        }
        if (!diary.mistakes.saveImage) {
            return
        }
        
        try {
            const reader = new FileReader()
            reader.onload = async (e) => {
                try {
                    const base64 = e.target?.result?.toString().split(',')[1]
                    if (base64) {
                        const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')) : '.png'
                        const filename = await diary.mistakes.saveImage!({
                            data: base64,
                            ext: ext || '.png',
                            name: file.name,
                            mimetype: file.type,
                        })
                        appendImagePath(role, filename)
                        showToast('图片已上传', 'success')
                    }
                } catch (error) {
                    logger.error('Failed to upload mistake image:', error instanceof Error ? error.message : String(error))
                    showToast('图片上传失败', 'error')
                }
            }
            reader.readAsDataURL(file)
        } catch (e) {
            logger.error('Failed to read mistake image:', e instanceof Error ? e.message : String(e))
            showToast('图片上传失败', 'error')
        }
    }

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>, role: ImageRole) => {
        const files = Array.from(e.target.files || [])
        files.forEach(file => handleImageFile(file, role))
        e.target.value = ''
    }

    const handlePaste = (e: React.ClipboardEvent, role: ImageRole) => {
        if (!showForm || !e.clipboardData || !e.clipboardData.items) return
        const items = e.clipboardData.items
        for (let i = 0; i < items.length; i++) {
            const item = items[i]
            if (item && item.type.startsWith('image/')) {
                const file = item.getAsFile()
                if (file) handleImageFile(file, role)
                e.preventDefault()
                break
            }
        }
    }

    const handleDragOver = (e: React.DragEvent, role: ImageRole) => {
        e.preventDefault()
        setDraggingRole(role)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setDraggingRole(null)
    }

    const handleDrop = (e: React.DragEvent, role: ImageRole) => {
        e.preventDefault()
        setDraggingRole(null)
        if (!showForm || !e.dataTransfer || !e.dataTransfer.files) return
        const files = e.dataTransfer.files
        for (let i = 0; i < files.length; i++) {
            const file = files.item(i)
            if (file && file.type.startsWith('image/')) handleImageFile(file, role)
        }
    }

    const removeImagePath = (role: ImageRole, index: number) => {
        setForm(f => role === 'question'
            ? { ...f, question_image_paths: f.question_image_paths.filter((_, i) => i !== index) }
            : { ...f, answer_image_paths: f.answer_image_paths.filter((_, i) => i !== index) })
    }

    const appendUniqueImagePath = (paths: string[], imagePath: string): string[] => (
        paths.includes(imagePath) ? paths : [...paths, imagePath]
    )

    const moveImagePath = (fromRole: ImageRole, index: number) => {
        setForm(f => {
            const sourcePaths = fromRole === 'question' ? f.question_image_paths : f.answer_image_paths
            const imagePath = sourcePaths[index]
            if (!imagePath) return f
            return fromRole === 'question'
                ? {
                    ...f,
                    question_image_paths: f.question_image_paths.filter((_, i) => i !== index),
                    answer_image_paths: appendUniqueImagePath(f.answer_image_paths, imagePath),
                }
                : {
                    ...f,
                    answer_image_paths: f.answer_image_paths.filter((_, i) => i !== index),
                    question_image_paths: appendUniqueImagePath(f.question_image_paths, imagePath),
                }
        })
    }

    const handleDelete = async (id: number) => {
        try {
            await diary.mistakes.delete(id)
            loadMistakes()
            showToast('已删除', 'success')
        } catch (e) {
            logger.error(e)
            showToast('删除失败', 'error')
        }
    }

    const toggleMastered = async (id: number) => {
        try {
            await diary.mistakes.toggleMastered(id)
            loadMistakes()
        } catch (e) { logger.error(e) }
    }

    const handleReview = async (m: Mistake, quality: number) => {
        if (reviewInFlightIdsRef.current.has(m.id)) return
        reviewInFlightIdsRef.current.add(m.id)
        setReviewingMistakeIds(current => new Set(current).add(m.id))
        try {
            const result = await submitMistakeReview({
                mistake: m,
                quality,
                reviewDate: getLocalDateKey(),
                mistakesAPI: diary.mistakes,
                tasksAPI: diary.tasks,
            })
            diary.requestDataRefresh()
            loadMistakes()
            if (result.taskSettlementStatus === 'completed') {
                showToast('复习已保存，关联任务已完成', 'success')
            } else if (result.taskSettlementStatus === 'failed') {
                showToast('复习已保存，任务结算失败，可稍后重试', 'error')
            } else if (result.taskSettlementStatus === 'conflict') {
                showToast('复习已保存，存在多个关联任务，请稍后手动结算', 'info')
            } else if (quality >= 3) {
                showToast('复习成功，已安排下次复习', 'success')
            } else {
                showToast('没关系，已重置学习进度', 'info')
            }
        } catch (e) {
            logger.error(e)
            showToast('复习记录失败', 'error')
        } finally {
            reviewInFlightIdsRef.current.delete(m.id)
            setReviewingMistakeIds(current => {
                const next = new Set(current)
                next.delete(m.id)
                return next
            })
        }
    }

    const renderImageSection = (
        role: ImageRole,
        title: string,
        description: string,
        paths: string[],
    ) => {
        const fileInputRef = role === 'question' ? questionFileInputRef : answerFileInputRef
        const moveLabel = role === 'question' ? '移到答案' : '移到题目'
        const previewLabel = role === 'question' ? '题目图片' : '答案图片'
        const isRoleDragging = draggingRole === role

        return (
            <div
                data-testid={`mistake-${role}-image-zone`}
                tabIndex={0}
                role="group"
                aria-label={`${title}上传区域`}
                onPaste={e => handlePaste(e, role)}
                onDragOver={e => handleDragOver(e, role)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, role)}
                style={{
                    border: isRoleDragging ? '2px dashed var(--accent)' : '1px dashed var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-sm)',
                    background: isRoleDragging ? 'color-mix(in srgb, var(--accent) 6%, var(--bg-secondary))' : 'var(--bg-secondary)',
                }}
            >
                <div className="flex items-center justify-between" style={{ gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                    <div>
                        <div className="text-sm font-medium">{title}</div>
                        <div className="text-xs text-muted">{description}</div>
                    </div>
                    <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => fileInputRef.current?.click()}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        title={`选择${title}文件，支持多选`}
                    >
                        <ImagePlus size={16} /> 上传
                    </button>
                    <input
                        ref={fileInputRef}
                        data-testid={`mistake-${role}-image-input`}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={e => handleFileInputChange(e, role)}
                        style={{ display: 'none' }}
                    />
                </div>
                {paths.length > 0 ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'var(--space-xs)' }}>
                        {paths.map((imgPath, idx) => (
                            <div key={`${role}-${imgPath}-${idx}`} style={{ position: 'relative', flexShrink: 0, width: 112 }}>
                                <ClickableImage
                                    src={toLocalAssetUrl(imgPath, 'mistake_images')}
                                    alt={`${previewLabel} ${idx + 1}`}
                                    onPreview={({ src }) => setPreviewImage({ src, alt: `错题编辑区${previewLabel} ${idx + 1}` })}
                                    ariaLabel={`放大查看错题编辑区${previewLabel} ${idx + 1}`}
                                    title={`放大查看${previewLabel} ${idx + 1}`}
                                    buttonStyle={{
                                        padding: 0,
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'zoom-in',
                                        display: 'block',
                                    }}
                                    imageStyle={{ height: 80, width: 80, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'block' }}
                                />
                                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                                    <button
                                        type="button"
                                        className="button button-secondary text-xs"
                                        onClick={() => moveImagePath(role, idx)}
                                        style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4 }}
                                        title={`${moveLabel}${previewLabel} ${idx + 1}`}
                                    >
                                        <ArrowRightLeft size={12} /> {moveLabel}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeImagePath(role, idx)}
                                        style={{ background: 'var(--color-state-danger)', color: 'white', borderRadius: '50%', width: 22, height: 22, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        title={`删除${previewLabel} ${idx + 1}`}
                                        aria-label={`删除${previewLabel} ${idx + 1}`}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <span className="text-xs text-muted">拖拽图片到这里，或在此区域 Ctrl/Cmd+V 粘贴</span>
                )}
            </div>
        )
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    const pagedMistakes = mistakes

    return (
        <div style={{ padding: 'var(--space-xl)' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="text-sm text-muted">
                    共 <strong style={{ color: 'var(--text-primary)' }}>{totalCount}</strong> 条记录，已吃透 <strong style={{ color: 'var(--success)' }}>{masteredCount}</strong> 条
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                        type="button"
                        className="button button-primary"
                        data-testid="mistake-start-review-btn"
                        onClick={() => setShowManualReview(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        <BookOpen size={16} /> 开始复习
                    </button>
                    <button className="button button-primary" onClick={() => {
                        setShowForm(!showForm); setEditingId(null);
                        setForm({ subject_id: '', question: '', answer: '', notes: '', question_image_paths: [], answer_image_paths: [] })
                    }} data-testid="mistake-add-btn">
                        + 添加
                    </button>
                </div>
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

            {dueOnly && (
                <div
                    className="flex items-center gap-sm"
                    data-testid="mistake-due-filter-chip"
                    style={{ marginBottom: 'var(--space-md)' }}
                >
                    <span
                        className="text-xs font-medium"
                        style={{
                            padding: '4px 10px',
                            borderRadius: 999,
                            color: 'var(--accent)',
                            background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-secondary))',
                            border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--border))',
                        }}
                    >
                        今日待复习
                    </span>
                    <button
                        type="button"
                        className="button button-secondary text-xs"
                        data-testid="mistake-clear-due-filter"
                        onClick={() => { setDueOnly(false); setPage(1) }}
                        style={{ padding: '3px 8px', background: 'transparent' }}
                    >
                        清除筛选
                    </button>
                </div>
            )}

            {/* Add/Edit Form */}
            {showForm && (
                <div className="card" 
                     ref={formRef}
                     style={{ 
                         padding: 'var(--space-lg)', marginBottom: 'var(--space-md)',
                         border: draggingRole ? '2px dashed var(--accent)' : '1px solid var(--border)'
                     }}
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
                            ref={questionTextareaRef}
                            className="input" placeholder="问题 / 知识点" rows={3}
                            value={form.question} onChange={e => setForm({ ...form, question: e.target.value })}
                            style={{ resize: 'vertical' }}
                        />
                        {renderImageSection('question', '题目图片', '在查看答案前显示', form.question_image_paths)}
                        <textarea
                            className="input" placeholder="答案 / 解析" rows={3}
                            value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value })}
                            style={{ resize: 'vertical' }}
                        />
                        {renderImageSection('answer', '答案图片', '查看答案后显示', form.answer_image_paths)}
                        <div>
                            <FormatToolbar
                                onBold={notesFormat.bold}
                                onHighlight={notesFormat.highlight}
                                onUnderline={notesFormat.underline}
                                onColor={notesFormat.color}
                            />
                            <textarea
                                ref={notesTextareaRef}
                                className="input" placeholder="备注（可选）" rows={2}
                                value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                                style={{ resize: 'vertical', marginTop: 'var(--space-xs)' }}
                                data-testid="mistake-notes-textarea"
                            />
                        </div>
                        {/* Action row: submit + cancel */}
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
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
                    <MistakeItem
                        key={m.id}
                        mistake={m}
                        parseImagePaths={parseImagePaths}
                        toggleMastered={toggleMastered}
                        handleEdit={handleEdit}
                        handleDelete={handleDelete}
                        handleReview={handleReview}
                        reviewing={reviewingMistakeIds.has(m.id)}
                        onPreviewImage={setPreviewImage}
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
            {showManualReview && (
                <MistakeReviewModal
                    onClose={() => {
                        setShowManualReview(false)
                        loadMistakes()
                    }}
                    variant="manual"
                    subjectId={filter.subject_id ? Number(filter.subject_id) : undefined}
                />
            )}
            <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
        </div>
    )
}
