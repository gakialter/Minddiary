import React from 'react'
import { Flame, Smile, Coffee, BatteryWarning, Activity, Frown, CircleDashed } from 'lucide-react'

function MoodIcon({ mood, size = 24, style = {} }) {
    const getIconProps = () => {
        // We use size * 0.55 so the icon fits nicely inside the circular badge
        const iconSize = Math.max(14, size * 0.55)
        
        switch (mood) {
            case 'motivated':
                return { icon: <Flame size={iconSize} />, color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' } // Amber
            case 'happy':
                return { icon: <Smile size={iconSize} />, color: '#10B981', bg: 'rgba(16,185,129,0.12)' } // Emerald
            case 'calm':
                return { icon: <Coffee size={iconSize} />, color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' } // Blue
            case 'tired':
                return { icon: <BatteryWarning size={iconSize} />, color: '#6B7280', bg: 'rgba(107,114,128,0.12)' } // Gray
            case 'anxious':
                return { icon: <Activity size={iconSize} />, color: '#EF4444', bg: 'rgba(239,68,68,0.12)' } // Red
            case 'sad':
                return { icon: <Frown size={iconSize} />, color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)' } // Violet
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
            {React.cloneElement(props.icon, { strokeWidth: 2.2 })}
        </div>
    )
}

export default React.memo(MoodIcon)
