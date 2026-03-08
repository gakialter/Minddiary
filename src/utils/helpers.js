// Shared constants and helper functions for MindDiary

// ==================== Mood Constants ====================
export const MOODS = [
  { id: 'motivated', emoji: '💪', label: '动力满满' },
  { id: 'happy', emoji: '😊', label: '开心' },
  { id: 'calm', emoji: '😐', label: '平静' },
  { id: 'tired', emoji: '😫', label: '疲惫' },
  { id: 'anxious', emoji: '😰', label: '焦虑' },
  { id: 'sad', emoji: '😢', label: '低落' },
]

export const MOOD_EMOJI_MAP = MOODS.reduce((map, m) => {
  map[m.id] = m.emoji
  return map
}, {})

export function getMoodEmoji(mood) {
  return MOOD_EMOJI_MAP[mood] || '📝'
}

export function getMoodLabel(mood) {
  const found = MOODS.find(m => m.id === mood)
  return found ? found.label : ''
}

// ==================== Date Helpers ====================
export function formatShortDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function getTodayStr() {
  return new Date().toISOString().split('T')[0]
}

// ==================== Text Helpers ====================
export function calculateWordCount(text) {
  return (text || '').replace(/\s/g, '').length
}