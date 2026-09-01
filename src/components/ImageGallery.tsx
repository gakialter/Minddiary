import { useState, useEffect, useRef } from 'react'
import { compressImages } from '../utils/imageCompressor'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { logger } from '../utils/logger'
import { Image as ImageIcon, Camera, Plus, Trash2 } from 'lucide-react'
import type { Attachment } from '../types'
import { toLocalAssetUrl } from '../utils/localAssetUrl'
import ClickableImage from './ClickableImage'
import ImagePreviewModal, { type PreviewImage } from './ImagePreviewModal'

interface ImageGalleryProps {
    entryId?: number
    ensureEntryId?: () => Promise<number | null>
    onImageInsert?: (url: string) => void
}

const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024

export default function ImageGallery({ entryId, ensureEntryId, onImageInsert }: ImageGalleryProps) {
    const { attachments: attachmentsAPI } = useDiary()
    const [attachments, setAttachments] = useState<Attachment[]>([])
    const [preview, setPreview] = useState<PreviewImage | null>(null)
    const [loading, setLoading] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const safeFileUrl = (filepath: string | undefined): string => toLocalAssetUrl(filepath, 'attachments')

    useEffect(() => {
        if (entryId) loadAttachments()
        else setAttachments([])
    }, [entryId])

    const loadAttachments = async () => {
        if (!entryId) return
        try {
            const data = await attachmentsAPI.getByEntry(entryId)
            setAttachments(data || [])
        } catch (e) { logger.error(e) }
    }

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement> | { target: HTMLInputElement }) => {
        const selectedFiles = Array.from(e.target.files || [])
        const invalidFiles = selectedFiles.filter(f => !f.type.startsWith('image/'))
        invalidFiles.forEach(file => {
            showToast(`文件 ${file.name} 不是图片，已拒绝上传`, 'error')
        })
        const oversizedFiles = selectedFiles.filter(f => f.type.startsWith('image/') && f.size > MAX_IMAGE_FILE_BYTES)
        oversizedFiles.forEach(file => {
            showToast(`图片 ${file.name} 超过 10MB，已拒绝上传`, 'error')
        })
        const files = selectedFiles.filter(f => f.type.startsWith('image/') && f.size <= MAX_IMAGE_FILE_BYTES)
        const targetEntryId = entryId || await ensureEntryId?.()
        if (!files.length || !targetEntryId) {
            return
        }

        setLoading(true)
        // Compress all selected images concurrently (max 4 in parallel) before
        // storing them.  This keeps SQLite BLOB sizes manageable and prevents
        // RAM spikes when users drop many high-resolution photos at once.
        const compressed = await compressImages(files, {
            maxWidth: 1280,
            maxHeight: 1280,
            quality: 0.82,
            maxSizeKB: 512,
        })

        let uploadedAny = false
        for (const { file, result, error } of compressed) {
            if (error || !result) {
                logger.error('Compression failed for', file.name, error)
                showToast(`图片 ${file.name} 处理失败`, 'error')
                continue
            }
            try {
                const attachment = await attachmentsAPI.save(targetEntryId, {
                    name: file.name,
                    data: result.base64,
                    mimetype: result.blob.type,
                })
                uploadedAny = true
                setAttachments(prev => [...prev, attachment])
                onImageInsert?.(safeFileUrl(attachment.filepath))
            } catch (err) { 
                logger.error('Failed to upload image:', err instanceof Error ? err.message : String(err))
                showToast(err instanceof Error ? err.message : `图片 ${file.name} 上传失败`, 'error')
            }
        }

        setLoading(false)
        if (entryId) loadAttachments()
        if (uploadedAny) {
            showToast('图片上传成功', 'success')
        }
        e.target.value = ''
    }

    const handleDelete = async (id: number) => {
        try {
            const deletedAttachment = attachments.find(att => att.id === id)
            await attachmentsAPI.delete(id)
            if (deletedAttachment && preview?.src === safeFileUrl(deletedAttachment.filepath)) setPreview(null)
            loadAttachments()
            showToast('图片已删除', 'success')
        } catch (e) {
            logger.error(e)
            showToast('删除失败', 'error')
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        const files = Array.from(e.dataTransfer.files)
        if (files.length && (entryId || ensureEntryId)) {
            const dt = new DataTransfer()
            files.forEach(f => dt.items.add(f))
            if (fileInputRef.current) {
                fileInputRef.current.files = dt.files
                handleFileSelect({ target: fileInputRef.current })
            }
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
    }

    if (!entryId && !ensureEntryId) {
        return (
            <section className="editor-attachment-gallery" aria-labelledby="editor-attachments-title">
                <div className="editor-attachment-gallery__header">
                    <h2 id="editor-attachments-title" className="editor-attachment-gallery__title">
                        <ImageIcon size={16} aria-hidden="true" />
                        图片附件
                    </h2>
                </div>
                <p className="editor-attachment-gallery__unavailable">请先保存日记后再添加图片</p>
            </section>
        )
    }

    return (
        <section className="editor-attachment-gallery" aria-labelledby="editor-attachments-title">
            <div className="editor-attachment-gallery__header">
                <div>
                    <h2 id="editor-attachments-title" className="editor-attachment-gallery__title">
                        <ImageIcon size={16} aria-hidden="true" />
                        图片附件
                    </h2>
                    <p className="editor-attachment-gallery__count">
                        {attachments.length > 0 ? `${attachments.length} 张图片` : '为这篇日记补充图像记录'}
                    </p>
                </div>
                <button
                    type="button"
                    className="button button-secondary editor-attachment-gallery__upload"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Plus size={14} aria-hidden="true" />
                    上传
                </button>
                <input
                    ref={fileInputRef} type="file" accept="image/*" multiple
                    aria-label="选择日记图片"
                    onChange={handleFileSelect} style={{ display: 'none' }}
                />
            </div>

            {/* Drop Zone (only if no images) */}
            {attachments.length === 0 && !loading && (
                <button
                    type="button"
                    className="editor-attachment-gallery__dropzone"
                    data-dragging={isDragging ? 'true' : 'false'}
                    aria-describedby="editor-attachment-upload-hint"
                    onDrop={handleDrop} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <span className="editor-attachment-gallery__dropzone-icon">
                        <Camera size={24} aria-hidden="true" />
                    </span>
                    <span className="editor-attachment-gallery__dropzone-title">点击或拖拽上传图片</span>
                    <span id="editor-attachment-upload-hint" className="editor-attachment-gallery__dropzone-hint">
                        支持 JPG、PNG、WebP，每个最大 10MB
                    </span>
                </button>
            )}

            {/* Thumbnail Grid */}
            {(attachments.length > 0 || loading) && (
                <div className="editor-attachment-gallery__grid"
                    onDrop={handleDrop} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
                >
                    {attachments.map(att => (
                        <div key={att.id} className="editor-attachment-gallery__item gallery-item">
                            <ClickableImage
                                src={safeFileUrl(att.filepath)}
                                alt={att.filename}
                                onPreview={setPreview}
                                ariaLabel={`放大查看日记图片 ${att.filename}`}
                                title={`放大查看 ${att.filename}`}
                                className="editor-attachment-gallery__preview"
                                imageStyle={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onImageError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                imageClassName="gallery-img"
                            />
                            <div className="editor-attachment-gallery__overlay gallery-overlay" style={{ pointerEvents: 'none' }}>
                                <button
                                    type="button"
                                    className="editor-attachment-gallery__delete"
                                    onClick={(e) => { e.stopPropagation(); handleDelete(att.id) }}
                                    style={{ pointerEvents: 'auto' }}
                                    title={`删除 ${att.filename}`}
                                    aria-label={`删除日记图片 ${att.filename}`}
                                >
                                    <Trash2 size={14} aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    ))}

                    {/* Add more button or drop target */}
                    {loading ? (
                        <div className="editor-attachment-gallery__loading" role="status" aria-live="polite">
                            <span>图片上传中…</span>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="editor-attachment-gallery__add-more"
                            data-dragging={isDragging ? 'true' : 'false'}
                            onClick={() => fileInputRef.current?.click()}
                            title="上传更多"
                            aria-label="上传更多图片"
                        >
                            <Plus size={20} aria-hidden="true" />
                        </button>
                    )}
                </div>
            )}

            <ImagePreviewModal image={preview} onClose={() => setPreview(null)} />
        </section>
    )
}
