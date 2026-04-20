import { MOODS } from '../utils/helpers'
import MoodIcon from './MoodIcon'
import type { MoodId } from '../types'

interface MoodPickerProps {
  mood: MoodId | null
  onChange: (mood: MoodId | null) => void
}

function MoodPicker({ mood, onChange }: MoodPickerProps) {
  const handleSelect = (moodId: MoodId) => {
    // Toggle: click same mood to deselect
    onChange(moodId === mood ? null : moodId)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>今天的心情</div>
      <div className="flex gap-sm">
        {MOODS.map(m => (
          <button
            key={m.id}
            onClick={() => handleSelect(m.id)}
            title={m.label}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              width: 56, height: 56,
              borderRadius: 20, // smooth squircle
              border: mood === m.id ? '2px solid var(--accent)' : '2px solid transparent',
              background: mood === m.id ? 'var(--accent-light)' : 'transparent',
              cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.2, 0, 0, 1)',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { 
                if (mood !== m.id) {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                }
            }}
            onMouseLeave={(e) => { 
                if (mood !== m.id) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.transform = 'none';
                }
            }}
            onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.95)';
            }}
            onMouseUp={(e) => {
                e.currentTarget.style.transform = mood === m.id ? 'none' : 'translateY(-2px)';
            }}
          >
            <MoodIcon mood={m.id} size={26} />
            <span className="text-xs" style={{ marginTop: 2, color: mood === m.id ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: mood === m.id ? 600 : 400 }}>{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default MoodPicker