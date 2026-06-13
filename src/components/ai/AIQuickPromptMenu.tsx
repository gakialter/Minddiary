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
                    className="flex items-center gap-2 cursor-pointer whitespace-nowrap"
                    style={{
                        padding: compact ? '5px 10px' : '8px 16px',
                        borderRadius: 9999,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: prompt.disabledReason ? 'var(--text-muted)' : 'var(--text-secondary)',
                        transition: 'all 0.2s',
                        opacity: prompt.disabledReason ? 0.55 : 1,
                    }}
                    disabled={Boolean(prompt.disabledReason)}
                    title={prompt.disabledReason || prompt.label}
                    onClick={() => onSelect(prompt)}
                    onMouseEnter={event => {
                        if (prompt.disabledReason) return
                        Object.assign(event.currentTarget.style, {
                            background: 'var(--bg-tertiary)',
                            color: 'var(--text-primary)',
                            borderColor: 'transparent',
                            transform: 'translateY(-1px)',
                        })
                    }}
                    onMouseLeave={event => {
                        Object.assign(event.currentTarget.style, {
                            background: 'transparent',
                            color: prompt.disabledReason ? 'var(--text-muted)' : 'var(--text-secondary)',
                            borderColor: 'var(--border)',
                            transform: 'translateY(0)',
                        })
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.8 }}>{prompt.icon}</span>
                    <span style={{ fontSize: compact ? 12 : 13, fontWeight: 500 }}>{prompt.label}</span>
                </button>
            ))}
        </div>
    )
}
