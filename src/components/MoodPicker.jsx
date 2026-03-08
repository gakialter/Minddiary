import { MOODS } from '../utils/helpers'
import MoodIcon from './MoodIcon'

function MoodPicker({ mood, onChange }) {
  const handleSelect = (moodId) => {
    // Toggle: click same mood to deselect
    onChange(moodId === mood ? null : moodId)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <div className="text-sm text-muted">今天的心情</div>
      <div className="flex gap-xs">
        {MOODS.map(m => (
          <button
            key={m.id}
            onClick={() => handleSelect(m.id)}
            title={m.label}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              width: 64, height: 64,
              borderRadius: 'var(--radius)',
              border: mood === m.id ? '1px solid var(--accent)' : '1px solid transparent',
              background: mood === m.id ? 'rgba(139,92,246,0.2)' : 'var(--bg-tertiary)',
              cursor: 'pointer', transition: 'all 0.15s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { if (mood !== m.id) e.currentTarget.style.background = 'var(--border)' }}
            onMouseLeave={(e) => { if (mood !== m.id) e.currentTarget.style.background = 'var(--bg-tertiary)' }}
          >
            <MoodIcon mood={m.id} size={32} />
            <span className="text-xs text-secondary" style={{ marginTop: 4 }}>{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default MoodPicker