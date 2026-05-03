import React from 'react'
import { Laugh, Smile, Meh, Annoyed, Zap, Frown, CircleDashed } from 'lucide-react'

interface MoodIconProps {
    mood: string | null | undefined
    size?: number
    style?: React.CSSProperties
}

function MoodIcon({ mood, size = 24, style = {} }: MoodIconProps) {
    const getIconProps = () => {
        // We use size * 0.55 so the icon fits nicely inside the circular badge
        const iconSize = Math.max(14, size * 0.55)
        
        switch (mood) {
            case 'motivated':
                return { icon: <Laugh size={iconSize} />, color: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 12%, transparent)' }
            case 'happy':
                return { icon: <Smile size={iconSize} />, color: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 12%, transparent)' }
            case 'calm':
                return { icon: <Meh size={iconSize} />, color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 12%, transparent)' }
            case 'tired':
                return { icon: <Annoyed size={iconSize} />, color: 'var(--text-secondary)', bg: 'color-mix(in srgb, var(--text-secondary) 12%, transparent)' }
            case 'anxious':
                return { icon: <Zap size={iconSize} />, color: 'var(--danger)', bg: 'color-mix(in srgb, var(--danger) 12%, transparent)' }
            case 'sad':
                return { icon: <Frown size={iconSize} />, color: 'color-mix(in srgb, var(--accent) 50%, var(--text-secondary))', bg: 'color-mix(in srgb, color-mix(in srgb, var(--accent) 50%, var(--text-secondary)) 12%, transparent)' }
            default:
                // Default empty state / unknown
                return { icon: <CircleDashed size={iconSize} />, color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' }
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
                color: props.color,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                // Soft border for contrast in light themes
                border: `1px solid ${props.bg.replace('0.12', '0.25')}`, 
                ...style
            }}
        >
            {React.cloneElement(props.icon as React.ReactElement, { strokeWidth: 2.2 })}
        </div>
    )
}

export default React.memo(MoodIcon)
