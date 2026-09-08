import { Copy, RotateCcw } from 'lucide-react'
import MarkdownRenderer from '../common/MarkdownRenderer'
import type { PersistedAIAttachmentMeta } from '../../utils/aiAttachmentPolicy'

export interface AIChatMessage {
    role: 'user' | 'assistant'
    content: string
    id: number
    contextLabels?: string[]
    attachments?: PersistedAIAttachmentMeta[]
    canRegenerate?: boolean
}

interface AIMessageBubbleProps {
    message: AIChatMessage
    onCopy: (content: string) => void
    onRegenerate?: () => void
    regenerateDisabledReason?: string | null
}

export default function AIMessageBubble({
    message,
    onCopy,
    onRegenerate,
    regenerateDisabledReason,
}: AIMessageBubbleProps) {
    const isUser = message.role === 'user'

    return (
        <div className="ai-message" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: isUser ? 'flex-end' : 'flex-start',
        }}>
            <div className="ai-message__body" style={{
                maxWidth: '92%',
                padding: '12px 16px',
                borderRadius: 'var(--radius-object)',
                background: isUser ? 'var(--color-control-selected-bg)' : 'var(--color-surface-subtle)',
                color: isUser ? 'var(--color-control-selected-fg)' : 'var(--color-text-primary)',
                fontSize: 15,
                lineHeight: 1.6,
            }}>
                {isUser ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
                ) : (
                    <MarkdownRenderer className="ai-message-content">{message.content}</MarkdownRenderer>
                )}
                {message.contextLabels && message.contextLabels.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {message.contextLabels.map(label => (
                            <span key={label} style={{
                                fontSize: 12,
                                padding: '2px 6px',
                                borderRadius: 'var(--radius-control)',
                                background: 'var(--color-surface-base)',
                            }}>
                                {label}
                            </span>
                        ))}
                    </div>
                )}
                {message.attachments && message.attachments.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {message.attachments.map(attachment => (
                            <span key={`${attachment.kind}-${attachment.name}`} style={{ fontSize: 12 }}>
                                附件：{attachment.name}（{attachment.kind}，内容未持久化）
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                margin: '4px 8px 0 8px',
                color: 'var(--color-text-secondary)',
                fontSize: 12,
            }}>
                <span>{isUser ? '我' : '小研 AI'}</span>
                <button
                    type="button"
                    className="ai-local-action"
                    aria-label={isUser ? '复制用户消息' : '复制 AI 回复'}
                    title="复制"
                    onClick={() => onCopy(message.content)}
                    style={{ border: 'none', background: 'transparent', padding: 0, color: 'inherit', cursor: 'pointer', display: 'flex' }}
                >
                    <Copy size={16} aria-hidden />
                </button>
                {!isUser && onRegenerate && (
                    <button
                        type="button"
                        className="ai-local-action"
                        aria-label="重新生成 AI 回复"
                        title={regenerateDisabledReason || '重新生成'}
                        disabled={Boolean(regenerateDisabledReason)}
                        onClick={onRegenerate}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            color: 'inherit',
                            cursor: regenerateDisabledReason ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            opacity: regenerateDisabledReason ? 0.5 : 1,
                        }}
                    >
                        <RotateCcw size={16} aria-hidden />
                    </button>
                )}
            </div>
        </div>
    )
}
