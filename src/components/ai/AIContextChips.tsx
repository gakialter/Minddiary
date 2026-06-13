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
                        borderRadius: 999,
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-light)',
                        fontSize: 12,
                    }}
                >
                    {AI_CONTEXT_LABELS[kind]}
                    <button
                        type="button"
                        aria-label={`移除上下文 ${AI_CONTEXT_LABELS[kind]}`}
                        title={`移除 ${AI_CONTEXT_LABELS[kind]}`}
                        onClick={() => onRemove(kind)}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            color: 'var(--text-muted)',
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
