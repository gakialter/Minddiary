import type { AIQuickPromptViewModel } from '../../utils/aiQuickPrompts'

interface AIQuickPromptMenuProps {
    prompts: AIQuickPromptViewModel[]
    onSelect: (prompt: AIQuickPromptViewModel) => void
    compact?: boolean
}

export default function AIQuickPromptMenu({ prompts, onSelect, compact = false }: AIQuickPromptMenuProps) {
    return (
        <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: compact ? 6 : 'var(--space-md)',
            justifyContent: compact ? 'flex-start' : 'center',
            width: '100%',
        }}>
            {prompts.map(prompt => (
                <button
                    key={prompt.id}
                    type="button"
                    className="button button-secondary ai-quick-prompt"
                    style={{
                        padding: compact ? '5px 10px' : '8px 16px',
                        borderRadius: 'var(--radius-control)',
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--color-text-secondary)',
                        opacity: prompt.disabledReason ? 0.55 : 1,
                    }}
                    disabled={Boolean(prompt.disabledReason)}
                    title={prompt.disabledReason || prompt.label}
                    onClick={() => onSelect(prompt)}
                >
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.8 }}>{prompt.icon}</span>
                    <span style={{ fontSize: compact ? 12 : 13, fontWeight: 500 }}>{prompt.label}</span>
                </button>
            ))}
        </div>
    )
}
