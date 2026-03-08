import { useState, useEffect, useRef } from 'react'
import { compressImages } from '../utils/imageCompressor'
import { useDiary } from '../contexts/DiaryContext'

export default function ImageGallery({ entryId, onImageInsert }) {
    const { attachments: attachmentsAPI } = useDiary()
    const [attachments, setAttachments] = useState([])
    const [preview, setPreview] = useState(null)
    const [loading, setLoading] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef(null)

    useEffect(() => {
        if (entryId) loadAttachments()
        else setAttachments([])
    }, [entryId])

    const loadAttachments = async () => {
        try {
            const data = await attachmentsAPI.getByEntry(entryId)
            setAttachments(data || [])
        } catch (e) { console.error(e) }
    }

    const handleFileSelect = async (e) => {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'))
        if (!files.length || !entryId) return

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

        for (const { file, result, error } of compressed) {
            if (error || !result) {
                console.error('Compression failed for', file.name, error)
                continue
            }
            try {
                await attachmentsAPI.save(entryId, {
                    name: file.name,
                    data: result.base64,
                    mimetype: result.blob.type,
                })
            } catch (err) { console.error('Failed to upload:', err) }
        }

        setLoading(false)
        loadAttachments()
        e.target.value = ''
    }

    const handleDelete = async (id) => {
        try {
            await attachmentsAPI.delete(id)
            if (preview?.id === id) setPreview(null)
            loadAttachments()
        } catch (e) { console.error(e) }
    }

    const handleDrop = (e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
        if (files.length && entryId) {
            const dt = new DataTransfer()
            files.forEach(f => dt.items.add(f))
            if (fileInputRef.current) {
                fileInputRef.current.files = dt.files
                handleFileSelect({ target: fileInputRef.current })
            }
        }
    }

    const handleDragOver = (e) => {
        e.preventDefault()
        e.stopPropagation()
    }

    const handleDragEnter = (e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(true)
    }

    const handleDragLeave = (e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
    }

    if (!entryId) {
        return (
            <div style={{ padding: 'var(--space-lg)' }}>
                <p className="text-muted text-sm">请先保存日记后再添加图片</p>
            </div>
        )
    }

    return (
        <div style={{ padding: 'var(--space-lg)' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space)' }}>
                <h3 className="text-sm font-medium">🖼️ 图片附件</h3>
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
                        fontSize: 28, boxShadow: 'var(--shadow-sm)'
                    }}>📷</div>
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
                            cursor: 'pointer', border: '1px solid var(--border-light)',
                            background: 'var(--bg-tertiary)'
                        }}>
                            <img
                                src={`file://${att.filepath}`}
                                alt={att.filename}
                                onClick={() => setPreview(att)}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease' }}
                                onError={(e) => { e.target.style.display = 'none' }}
                                className="gallery-img"
                            />
                            <div className="gallery-overlay flex items-start justify-end" style={{
                                position: 'absolute', inset: 0, padding: 'var(--space-xs)',
                                background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 40%)',
                                opacity: 0, transition: 'opacity 0.2s'
                            }}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(att.id) }}
                                    style={{
                                        width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.6)',
                                        color: 'white', border: 'none', cursor: 'pointer', fontSize: 14,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        backdropFilter: 'blur(4px)'
                                    }}
                                    title="删除图片"
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
                        >+</div>
                    )}
                </div>
            )}

            <style>{`
                .gallery-item:hover .gallery-overlay { opacity: 1 !important; }
                .gallery-item:hover .gallery-img { transform: scale(1.05); }
            `}</style>

            {/* Preview Modal */}
            {preview && (
                <div
                    onClick={() => setPreview(null)}
                    style={{
                        position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 1000, cursor: 'pointer'
                    }}
                >
                    <img
                        src={`file://${preview.filepath}`}
                        alt={preview.filename}
                        style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)' }}
                    />
                </div>
            )}
        </div>
    )
}
