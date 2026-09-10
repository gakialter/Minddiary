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
        <div className="ai-attachments" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
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
                            border: `1px solid ${attachment.status === 'error' ? 'var(--color-danger-fg)' : 'var(--color-border-subtle)'}`,
                            background: 'var(--color-surface-subtle)',
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
                                background: 'var(--color-surface-base)',
                                color: 'var(--color-text-secondary)',
                            }}>
                                {attachment.status === 'reading' ? <Loader2 size={18} aria-hidden /> : attachment.kind === 'image' ? <ImageIcon size={18} aria-hidden /> : <FileText size={18} aria-hidden />}
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
                            <div className="text-muted" role={attachment.status === 'reading' ? 'status' : undefined} style={{ fontSize: 12 }}>
                                {attachment.status === 'reading' ? '读取中' : formatBytes(attachment.size)}
                                {attachment.kind === 'pdf' && attachment.pageCount ? ` · ${attachment.pageCount} 页` : ''}
                            </div>
                            {attachment.error && (
                                <div style={{ fontSize: 12, color: 'var(--color-danger-fg)' }}>{attachment.error}</div>
                            )}
                        </div>
                        <button
                            type="button"
                            className="ai-local-action"
                            aria-label={`删除附件 ${attachment.name}`}
                            title={`删除 ${attachment.name}`}
                            onClick={() => onRemove(attachment.id)}
                            style={{
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--color-text-secondary)',
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
