import React from 'react'

function MoodIcon({ mood, size = 24, style = {} }) {
    const getIconProps = () => {
        switch (mood) {
            case 'motivated':
                return {
                    bg: 'linear-gradient(135deg, #FF9F0A, #FF3B30)',
                    shadow: 'rgba(255, 59, 48, 0.4)',
                    svg: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                    )
                }
            case 'happy':
                return {
                    bg: 'linear-gradient(135deg, #32D74B, #34C759)',
                    shadow: 'rgba(52, 199, 89, 0.4)',
                    svg: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                            <line x1="9" y1="9" x2="9.01" y2="9" />
                            <line x1="15" y1="9" x2="15.01" y2="9" />
                        </svg>
                    )
                }
            case 'calm':
                return {
                    bg: 'linear-gradient(135deg, #0A84FF, #5E5CE6)',
                    shadow: 'rgba(10, 132, 255, 0.4)',
                    svg: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="8" y1="15" x2="16" y2="15" />
                            <line x1="9" y1="9" x2="9.01" y2="9" />
                            <line x1="15" y1="9" x2="15.01" y2="9" />
                        </svg>
                    )
                }
            case 'tired':
                return {
                    bg: 'linear-gradient(135deg, #8E8E93, #AEAEC0)',
                    shadow: 'rgba(142, 142, 147, 0.4)',
                    svg: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M8 15h8" />
                            <path d="M8 9L10 11L8 9ZM16 9L14 11L16 9Z" strokeLinecap="round" />
                        </svg>
                    )
                }
            case 'anxious':
                return {
                    bg: 'linear-gradient(135deg, #FF453A, #FF3B30)',
                    shadow: 'rgba(255, 69, 58, 0.4)',
                    svg: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M8 15c1.5-1 2.5-1 4 0s2.5 1 4 0" />
                            <line x1="9" y1="9" x2="9.01" y2="9" />
                            <line x1="15" y1="9" x2="15.01" y2="9" />
                        </svg>
                    )
                }
            case 'sad':
                return {
                    bg: 'linear-gradient(135deg, #A2845E, #8C6D46)',
                    shadow: 'rgba(162, 132, 94, 0.4)',
                    svg: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M8 16s1.5-2 4-2 4 2 4 2" />
                            <line x1="9" y1="9" x2="9.01" y2="9" />
                            <line x1="15" y1="9" x2="15.01" y2="9" />
                            <path d="M15 12v1" strokeWidth="1.5" />
                        </svg>
                    )
                }
            default:
                // Default text fallback
                return {
                    bg: 'var(--bg-tertiary)',
                    shadow: 'rgba(0,0,0,0.1)',
                    svg: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                    )
                }
        }
    }

    const props = getIconProps()

    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: '50%',
                background: props.bg,
                boxShadow: `0 2px 8px ${props.shadow}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: size * 0.2,
                flexShrink: 0,
                ...style
            }}
        >
            {props.svg}
        </div>
    )
}

export default React.memo(MoodIcon)
