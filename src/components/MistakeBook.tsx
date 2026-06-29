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

interface ImageUploadFailure {
    id: number
    role: ImageRole
    filename: string
    message: string
}

type ImageFormSaveOutcome = 'idle' | 'save_failed' | 'saved'
type ImageFormState =
    | 'idle'
    | 'uploading'
    | 'upload_failed'
    | 'cleanup_in_flight'
    | 'ready_to_save'
    | 'saving'
    | 'save_failed'
    | 'saved'

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
const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
}
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

const getSupportedImageExtension = (file: File): string | null => {
    const mimetype = file.type.toLowerCase()
    if (mimetype && !IMAGE_EXTENSION_BY_MIME[mimetype]) return null

    const dotIndex = file.name.lastIndexOf('.')
    const filenameExtension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : ''
    if (!mimetype && !ALLOWED_IMAGE_EXTENSIONS.has(filenameExtension)) return null

    return IMAGE_EXTENSION_BY_MIME[mimetype] || filenameExtension
}

const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'))
    reader.onabort = () => reject(new Error('Image file read was aborted'))
    reader.onload = () => {
        if (typeof reader.result !== 'string') {
            reject(new Error('Invalid image file data'))
            return
        }
        const separatorIndex = reader.result.indexOf(',')
        const base64 = separatorIndex >= 0 ? reader.result.slice(separatorIndex + 1) : ''
        if (!base64) {
            reject(new Error('Empty image file data'))
            return
        }
        resolve(base64)
    }
    reader.readAsDataURL(file)
})

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
    const [uploadingImageCount, setUploadingImageCount] = useState(0)
    const [cleaningImageCount, setCleaningImageCount] = useState(0)
    const [imageUploadFailures, setImageUploadFailures] = useState<ImageUploadFailure[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [saveOutcome, setSaveOutcome] = useState<ImageFormSaveOutcome>('idle')
    const PAGE_SIZE = 50
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const questionFileInputRef = useRef<HTMLInputElement>(null)
    const answerFileInputRef = useRef<HTMLInputElement>(null)
    const formRef = useRef<HTMLFormElement>(null)
    const questionTextareaRef = useRef<HTMLTextAreaElement>(null)
    const notesTextareaRef = useRef<HTMLTextAreaElement>(null)
    const reviewInFlightIdsRef = useRef<Set<number>>(new Set())
    const uploadInFlightRef = useRef(0)
    const cleanupInFlightRef = useRef(0)
    const imageUploadFailuresRef = useRef<ImageUploadFailure[]>([])
    const nextImageUploadFailureIdRef = useRef(1)
    const saveInFlightRef = useRef(false)
    const pendingImagePathsRef = useRef<Set<string>>(new Set())

    const imageFormState: ImageFormState = isSaving
        ? 'saving'
        : cleaningImageCount > 0
            ? 'cleanup_in_flight'
            : uploadingImageCount > 0
                ? 'uploading'
                : imageUploadFailures.length > 0
                    ? 'upload_failed'
                    : saveOutcome === 'save_failed'
                        ? 'save_failed'
                        : saveOutcome === 'saved'
                            ? 'saved'
                            : showForm
                                ? 'ready_to_save'
                                : 'idle'

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

    const replaceImageUploadFailures = (failures: ImageUploadFailure[]) => {
        imageUploadFailuresRef.current = failures
        setImageUploadFailures(failures)
    }

    const addImageUploadFailure = (file: File, role: ImageRole, message: string) => {
        replaceImageUploadFailures([
            ...imageUploadFailuresRef.current,
            {
                id: nextImageUploadFailureIdRef.current++,
                role,
                filename: file.name || '未命名图片',
                message,
            },
        ])
    }

    const removeImageUploadFailure = (failureId: number) => {
        replaceImageUploadFailures(imageUploadFailuresRef.current.filter(failure => failure.id !== failureId))
    }

    const clearImageUploadFailures = (role: ImageRole) => {
        replaceImageUploadFailures(imageUploadFailuresRef.current.filter(failure => failure.role !== role))
    }

    const deletePendingImagePaths = async (paths: string[]): Promise<Set<string>> => {
        const deleted = new Set<string>()
        const uniquePaths = Array.from(new Set(paths.filter(path => pendingImagePathsRef.current.has(path))))
        if (uniquePaths.length === 0) return deleted
        if (!diary.mistakes.deleteImage) {
            logger.error('Mistake image cleanup API is unavailable')
            return deleted
        }

        cleanupInFlightRef.current += 1
        setCleaningImageCount(cleanupInFlightRef.current)
        try {
            await Promise.all(uniquePaths.map(async imagePath => {
                try {
                    await diary.mistakes.deleteImage!(imagePath)
                    pendingImagePathsRef.current.delete(imagePath)
                    deleted.add(imagePath)
                } catch (error) {
                    logger.error('Failed to clean up pending mistake image:', error instanceof Error ? error.message : String(error))
                }
            }))
        } finally {
            cleanupInFlightRef.current = Math.max(0, cleanupInFlightRef.current - 1)
            setCleaningImageCount(cleanupInFlightRef.current)
        }
        return deleted
    }

    const cleanupCurrentDraftImages = async (): Promise<boolean> => {
        const pendingPaths = Array.from(pendingImagePathsRef.current)
        const deleted = await deletePendingImagePaths(pendingPaths)
        if (deleted.size !== pendingPaths.length) {
            showToast('图片清理失败，请重试', 'error')
            return false
        }
        return true
    }

    const handleSubmit = async () => {
        if (!form.question.trim()) return
        if (uploadInFlightRef.current > 0) {
            showToast('请等待图片上传完成后再保存', 'error')
            return
        }
        if (cleanupInFlightRef.current > 0) {
            showToast('正在清理图片，请稍后', 'error')
            return
        }
        if (imageUploadFailuresRef.current.length > 0) {
            showToast('图片上传失败，请移除失败项后重试', 'error')
            return
        }
        if (saveInFlightRef.current) return

        saveInFlightRef.current = true
        setSaveOutcome('idle')
        setIsSaving(true)
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
            pendingImagePathsRef.current.clear()
            setSaveOutcome('saved')
            setForm({ subject_id: '', question: '', answer: '', notes: '', question_image_paths: [], answer_image_paths: [] })
            setShowForm(false)
            setEditingId(null)
            loadMistakes()
            showToast(editingId ? '修改已保存' : '已添加新的记录', 'success')
        } catch (e) {
            setSaveOutcome('save_failed')
            const pendingPaths = Array.from(pendingImagePathsRef.current)
            const deletedPaths = await deletePendingImagePaths(pendingPaths)
            if (deletedPaths.size > 0) {
                setForm(current => ({
                    ...current,
                    question_image_paths: current.question_image_paths.filter(path => !deletedPaths.has(path)),
                    answer_image_paths: current.answer_image_paths.filter(path => !deletedPaths.has(path)),
                }))
            }
            logger.error(e)
            showToast(
                deletedPaths.size === pendingPaths.length
                    ? '保存错题失败，请重试'
                    : '保存错题失败，图片清理未完成，请重试',
                'error',
            )
        } finally {
            saveInFlightRef.current = false
            setIsSaving(false)
        }
    }

    const handleEdit = async (m: Mistake) => {
        if (uploadInFlightRef.current > 0 || saveInFlightRef.current) return
        if (cleanupInFlightRef.current > 0) {
            showToast('正在清理图片，请稍后', 'error')
            return
        }
        if (!await cleanupCurrentDraftImages()) return
        replaceImageUploadFailures([])
        setSaveOutcome('idle')
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
        if (cleanupInFlightRef.current > 0) {
            showToast('正在清理图片，请稍后', 'error')
            return
        }
        const extension = getSupportedImageExtension(file)
        if (!extension) {
            addImageUploadFailure(file, role, '不支持的图片格式')
            showToast(`文件 ${file.name} 不是支持的图片格式，已拒绝上传`, 'error')
            return
        }
        if (file.size > MAX_IMAGE_FILE_BYTES) {
            addImageUploadFailure(file, role, '图片文件过大，请选择 10MB 以内的文件')
            showToast(`图片 ${file.name} 超过 10MB，已拒绝上传`, 'error')
            return
        }
        if (!diary.mistakes.saveImage) {
            addImageUploadFailure(file, role, '当前环境不支持图片上传')
            showToast('当前环境不支持错题图片上传', 'error')
            return
        }

        uploadInFlightRef.current += 1
        setUploadingImageCount(uploadInFlightRef.current)
        try {
            const base64 = await readFileAsBase64(file)
            const filename = await diary.mistakes.saveImage({
                data: base64,
                ext: extension,
                name: file.name,
                mimetype: file.type || undefined,
            })
            if (!filename || !filename.trim()) {
                throw new Error('Image upload returned an empty path')
            }
            pendingImagePathsRef.current.add(filename)
            appendImagePath(role, filename)
            showToast('图片已上传', 'success')
        } catch (error) {
            logger.error('Failed to upload mistake image:', error instanceof Error ? error.message : String(error))
            addImageUploadFailure(file, role, '上传失败，请移除失败项后重试')
            showToast(`图片 ${file.name || '未命名图片'} 上传失败，请移除失败项后重试`, 'error')
        } finally {
            uploadInFlightRef.current = Math.max(0, uploadInFlightRef.current - 1)
            setUploadingImageCount(uploadInFlightRef.current)
        }
    }

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>, role: ImageRole) => {
        const files = Array.from(e.target.files || [])
        if (files.length > 0) clearImageUploadFailures(role)
        files.forEach(file => void handleImageFile(file, role))
        e.target.value = ''
    }

    const handlePaste = (e: React.ClipboardEvent, role: ImageRole) => {
        if (!showForm || !e.clipboardData || !e.clipboardData.items) return
        const items = e.clipboardData.items
        for (let i = 0; i < items.length; i++) {
            const item = items[i]
            const file = item?.getAsFile()
            if (file) {
                clearImageUploadFailures(role)
                void handleImageFile(file, role)
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
        if (files.length > 0) clearImageUploadFailures(role)
        for (let i = 0; i < files.length; i++) {
            const file = files.item(i)
            if (file) void handleImageFile(file, role)
        }
    }

    const removeImagePath = async (role: ImageRole, index: number) => {
        if (cleanupInFlightRef.current > 0) {
            showToast('正在清理图片，请稍后', 'error')
            return
        }
        const rolePaths = role === 'question' ? form.question_image_paths : form.answer_image_paths
        const imagePath = rolePaths[index]
        if (!imagePath) return
        const nextForm = role === 'question'
            ? { ...form, question_image_paths: form.question_image_paths.filter((_, i) => i !== index) }
            : { ...form, answer_image_paths: form.answer_image_paths.filter((_, i) => i !== index) }
        setForm(nextForm)

        const remainsReferenced = [...nextForm.question_image_paths, ...nextForm.answer_image_paths].includes(imagePath)
        if (pendingImagePathsRef.current.has(imagePath) && !remainsReferenced) {
            const deleted = await deletePendingImagePaths([imagePath])
            if (!deleted.has(imagePath)) {
                setForm(current => role === 'question'
                    ? { ...current, question_image_paths: appendUniqueImagePath(current.question_image_paths, imagePath) }
                    : { ...current, answer_image_paths: appendUniqueImagePath(current.answer_image_paths, imagePath) })
                showToast('图片删除失败，请重试', 'error')
            }
        }
    }

    const handleCancelForm = async () => {
        if (uploadInFlightRef.current > 0 || saveInFlightRef.current) return
        if (cleanupInFlightRef.current > 0) {
            showToast('正在清理图片，请稍后', 'error')
            return
        }
        const pendingPaths = Array.from(pendingImagePathsRef.current)
        const deleted = await deletePendingImagePaths(pendingPaths)
        if (deleted.size !== pendingPaths.length) {
            showToast('新上传图片清理失败，请重试', 'error')
            return
        }
        replaceImageUploadFailures([])
        setSaveOutcome('idle')
        setShowForm(false)
        setEditingId(null)
        setForm({ subject_id: '', question: '', answer: '', notes: '', question_image_paths: [], answer_image_paths: [] })
    }

    const handleToggleForm = async () => {
        if (showForm) {
            await handleCancelForm()
            return
        }
        replaceImageUploadFailures([])
        setSaveOutcome('idle')
        setEditingId(null)
        setForm({ subject_id: '', question: '', answer: '', notes: '', question_image_paths: [], answer_image_paths: [] })
        setShowForm(true)
    }

    const appendUniqueImagePath = (paths: string[], imagePath: string): string[] => (
        paths.includes(imagePath) ? paths : [...paths, imagePath]
    )

    const moveImagePath = (fromRole: ImageRole, index: number) => {
        if (cleanupInFlightRef.current > 0) {
            showToast('正在清理图片，请稍后', 'error')
            return
        }
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
        const roleFailures = imageUploadFailures.filter(failure => failure.role === role)

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
                        disabled={cleaningImageCount > 0 || isSaving}
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
                        disabled={cleaningImageCount > 0 || isSaving}
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
                                        disabled={cleaningImageCount > 0 || isSaving}
                                        style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4 }}
                                        title={`${moveLabel}${previewLabel} ${idx + 1}`}
                                    >
                                        <ArrowRightLeft size={12} /> {moveLabel}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeImagePath(role, idx)}
                                        disabled={cleaningImageCount > 0 || isSaving}
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
                {roleFailures.map(failure => (
                    <div
                        key={failure.id}
                        className="text-xs"
                        style={{ marginTop: 'var(--space-xs)', color: 'var(--color-state-danger)', display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                        <span>{failure.filename}：{failure.message}</span>
                        <button
                            type="button"
                            className="button button-secondary text-xs"
                            aria-label={`移除失败图片 ${failure.filename}`}
                            onClick={() => removeImageUploadFailure(failure.id)}
                            disabled={cleaningImageCount > 0 || isSaving}
                        >
                            移除失败项
                        </button>
                    </div>
                ))}
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
                    <button
                        className="button button-primary"
                        onClick={handleToggleForm}
                        disabled={uploadingImageCount > 0 || cleaningImageCount > 0 || isSaving}
                        data-testid="mistake-add-btn"
                    >
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
                <form className="card"
                     ref={formRef}
                     data-testid="mistake-form"
                     data-image-form-state={imageFormState}
                     onSubmit={event => {
                         event.preventDefault()
                         void handleSubmit()
                     }}
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
                            <button
                                type="submit"
                                className="button button-primary"
                                disabled={uploadingImageCount > 0 || cleaningImageCount > 0 || imageUploadFailures.length > 0 || isSaving}
                                data-testid="mistake-submit-btn"
                            >
                                {uploadingImageCount > 0 ? '图片上传中...' : isSaving ? '保存中...' : editingId ? '保存' : '添加'}
                            </button>
                            <button
                                type="button"
                                className="button button-secondary"
                                onClick={() => void handleCancelForm()}
                                disabled={uploadingImageCount > 0 || cleaningImageCount > 0 || isSaving}
                            >
                                取消
                            </button>
                        </div>
                    </div>
                </form>
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
