import { FileText, Image as ImageIcon, Loader2, X } from 'lucide-react'
import ClickableImage from '../ClickableImage'
import { formatBytes, type AIComposerAttachment } from '../../utils/aiAttachmentPolicy'
import type { PreviewImage } from '../ImagePreviewModal'

interface AIAttachmentListProps {
    attachments: AIComposerAttachment[]
    onRemove: (id: string) => void
    onPreview: (image: PreviewImage) => void
}

export default function AIAttachmentList({ attachments, onRemove, onPreview }: AIAttachmentListProps) {
    if (attachments.length === 0) return null

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
            gap: 8,
        }}>
            {attachments.map(attachment => {
                const isImage = attachment.kind === 'image' && attachment.previewUrl
                return (
                    <div
                        key={attachment.id}
                        style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            padding: 8,
                            borderRadius: 'var(--radius-sm)',
                            border: `1px solid ${attachment.status === 'error' ? 'var(--danger, #C65A3A)' : 'var(--border-light)'}`,
                            background: 'var(--bg-tertiary)',
                            minWidth: 0,
                        }}
                    >
                        {isImage ? (
                            <ClickableImage
                                src={attachment.previewUrl!}
                                alt={attachment.name}
                                onPreview={onPreview}
                                ariaLabel={`预览附件 ${attachment.name}`}
                                title={`预览 ${attachment.name}`}
                                buttonStyle={{ width: 42, height: 42, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}
                                imageStyle={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        ) : (
                            <div style={{
                                width: 42,
                                height: 42,
                                borderRadius: 8,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                background: 'var(--bg-secondary)',
                                color: 'var(--text-muted)',
                            }}>
                                {attachment.status === 'reading' ? <Loader2 size={18} aria-hidden /> : attachment.kind === 'pdf' ? <FileText size={18} aria-hidden /> : <ImageIcon size={18} aria-hidden />}
                            </div>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div title={attachment.name} style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontSize: 12,
                                fontWeight: 600,
                            }}>
                                {attachment.name}
                            </div>
                            <div className="text-muted" style={{ fontSize: 11 }}>
                                {attachment.status === 'reading' ? '读取中' : formatBytes(attachment.size)}
                                {attachment.kind === 'pdf' && attachment.pageCount ? ` · ${attachment.pageCount} 页` : ''}
                            </div>
                            {attachment.error && (
                                <div style={{ fontSize: 11, color: 'var(--danger, #C65A3A)' }}>{attachment.error}</div>
                            )}
                        </div>
                        <button
                            type="button"
                            aria-label={`删除附件 ${attachment.name}`}
                            title={`删除 ${attachment.name}`}
                            onClick={() => onRemove(attachment.id)}
                            style={{
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                                padding: 2,
                                display: 'flex',
                                flexShrink: 0,
                            }}
                        >
                            <X size={14} aria-hidden />
                        </button>
                    </div>
                )
            })}
        </div>
    )
}
