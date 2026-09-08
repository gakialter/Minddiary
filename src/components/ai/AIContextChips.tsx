import { X } from 'lucide-react'
import { AI_CONTEXT_LABELS, type AIContextKind } from '../../utils/aiQuickPrompts'

interface AIContextChipsProps {
    contextKinds: AIContextKind[]
    onRemove: (kind: AIContextKind) => void
}

export default function AIContextChips({ contextKinds, onRemove }: AIContextChipsProps) {
    if (contextKinds.length === 0) return null

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {contextKinds.map(kind => (
                <span
                    key={kind}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-control)',
                        background: 'var(--color-surface-subtle)',
                        color: 'var(--color-text-secondary)',
                        border: '1px solid var(--color-border-subtle)',
                        fontSize: 12,
                    }}
                >
                    {AI_CONTEXT_LABELS[kind]}
                    <button
                        type="button"
                        className="ai-local-action"
                        aria-label={`移除上下文 ${AI_CONTEXT_LABELS[kind]}`}
                        title={`移除 ${AI_CONTEXT_LABELS[kind]}`}
                        onClick={() => onRemove(kind)}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                        }}
                    >
                        <X size={12} aria-hidden />
                    </button>
                </span>
            ))}
        </div>
    )
}
