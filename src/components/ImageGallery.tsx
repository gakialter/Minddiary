import { useState, useEffect, useRef } from 'react'
import { compressImages } from '../utils/imageCompressor'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { logger } from '../utils/logger'
import { Image as ImageIcon, Camera } from 'lucide-react'
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
            <div style={{ padding: 'var(--space-lg)' }}>
                <p className="text-muted text-sm">请先保存日记后再添加图片</p>
            </div>
        )
    }

    return (
        <div style={{ padding: 'var(--space-lg)' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space)' }}>
                <h3 className="text-sm font-medium flex items-center gap-2">
                    <ImageIcon size={16} className="text-muted" /> 图片附件
                </h3>
                <button
                    className="button button-secondary"
                    style={{ fontSize: 12, padding: '2px 10px' }}
                    onClick={() => fileInputRef.current?.click()}
                >
                    + 上传
                </button>
                <input
                    ref={fileInputRef} type="file" accept="image/*" multiple
                    onChange={handleFileSelect} style={{ display: 'none' }}
                />
            </div>

            {/* Drop Zone (only if no images) */}
            {attachments.length === 0 && !loading && (
                <div
                    className="card empty-state-upload"
                    onDrop={handleDrop} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
                    style={{
                        padding: 'var(--space-2xl)', textAlign: 'center',
                        border: `2px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                        background: isDragging ? 'var(--bg-tertiary)' : 'transparent',
                        cursor: 'pointer', transition: 'all 0.3s', borderRadius: 'var(--radius-lg)'
                    }}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div style={{
                        width: 64, height: 64, margin: '0 auto var(--space)', borderRadius: 20,
                        background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text-muted)', boxShadow: 'var(--shadow-sm)'
                    }}><Camera size={28} /></div>
                    <p className="font-medium" style={{ marginBottom: 4 }}>点击或拖拽上传图片</p>
                    <p className="text-xs text-muted">支持 JPG, PNG, WebP (每个最大 10MB)</p>
                </div>
            )}

            {/* Thumbnail Grid */}
            {(attachments.length > 0 || loading) && (
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                    gap: 'var(--space-md)'
                }}
                    onDrop={handleDrop} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
                >
                    {attachments.map(att => (
                        <div key={att.id} className="gallery-item group" style={{
                            position: 'relative', aspectRatio: '1',
                            borderRadius: 'var(--radius)', overflow: 'hidden',
                            border: '1px solid var(--border-light)',
                            background: 'var(--bg-tertiary)'
                        }}>
                            <ClickableImage
                                src={safeFileUrl(att.filepath)}
                                alt={att.filename}
                                onPreview={setPreview}
                                ariaLabel={`放大查看日记图片 ${att.filename}`}
                                title={`放大查看 ${att.filename}`}
                                buttonStyle={{
                                    width: '100%',
                                    height: '100%',
                                    padding: 0,
                                    border: 'none',
                                    background: 'transparent',
                                    cursor: 'zoom-in',
                                    display: 'block',
                                }}
                                imageStyle={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease' }}
                                onImageError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                imageClassName="gallery-img"
                            />
                            <div className="gallery-overlay flex items-start justify-end" style={{
                                position: 'absolute', inset: 0, padding: 'var(--space-xs)',
                                background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 40%)',
                                opacity: 0, transition: 'opacity 0.2s',
                                pointerEvents: 'none'
                            }}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(att.id) }}
                                    style={{
                                        width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.6)',
                                        color: 'white', border: 'none', cursor: 'pointer', fontSize: 14,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        backdropFilter: 'blur(4px)',
                                        pointerEvents: 'auto'
                                    }}
                                    title="删除图片"
                                    aria-label="删除图片"
                                >×</button>
                            </div>
                        </div>
                    ))}

                    {/* Add more button or drop target */}
                    {loading ? (
                        <div style={{ aspectRatio: '1', borderRadius: 'var(--radius)', background: 'var(--bg-tertiary)', animation: 'pulse 1.5s infinite' }} />
                    ) : (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                aspectRatio: '1', borderRadius: 'var(--radius)',
                                border: `2px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                                background: isDragging ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: isDragging ? 'var(--accent)' : 'var(--text-muted)', fontSize: 28, transition: 'all 0.2s',

                            }}
                            title="上传更多"
                            aria-label="上传更多图片"
                        >+</div>
                    )}
                </div>
            )}

            <style>{`
                .gallery-item:hover .gallery-overlay { opacity: 1 !important; }
                .gallery-item:hover .gallery-img { transform: scale(1.05); }
            `}</style>

            <ImagePreviewModal image={preview} onClose={() => setPreview(null)} />
        </div>
    )
}
