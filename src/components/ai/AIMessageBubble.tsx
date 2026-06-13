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
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: isUser ? 'flex-end' : 'flex-start',
            animation: 'page-fade-in 0.3s cubic-bezier(0.2, 0, 0, 1)',
        }}>
            <div style={{
                maxWidth: '85%',
                padding: '12px 16px',
                borderRadius: 16,
                borderTopRightRadius: isUser ? 4 : 16,
                borderTopLeftRadius: !isUser ? 4 : 16,
                background: isUser ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: isUser ? 'white' : 'var(--text-primary)',
                boxShadow: isUser ? '0 4px 12px rgba(15, 118, 110, 0.2)' : 'none',
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
                                fontSize: 11,
                                padding: '2px 6px',
                                borderRadius: 999,
                                background: isUser ? 'rgba(255,255,255,0.18)' : 'var(--bg-secondary)',
                            }}>
                                {label}
                            </span>
                        ))}
                    </div>
                )}
                {message.attachments && message.attachments.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {message.attachments.map(attachment => (
                            <span key={`${attachment.kind}-${attachment.name}`} style={{ fontSize: 11, opacity: 0.85 }}>
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
                color: 'var(--text-muted)',
                fontSize: 11,
            }}>
                <span>{isUser ? '我' : '小研 AI'}</span>
                <button
                    type="button"
                    aria-label={isUser ? '复制用户消息' : '复制 AI 回复'}
                    title="复制"
                    onClick={() => onCopy(message.content)}
                    style={{ border: 'none', background: 'transparent', padding: 0, color: 'inherit', cursor: 'pointer', display: 'flex' }}
                >
                    <Copy size={12} aria-hidden />
                </button>
                {!isUser && onRegenerate && (
                    <button
                        type="button"
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
                        <RotateCcw size={12} aria-hidden />
                    </button>
                )}
            </div>
        </div>
    )
}
