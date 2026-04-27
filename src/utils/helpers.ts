// Shared constants and helper functions for MindDiary
import type { MoodId, MoodOption } from '../types'

// ==================== Mood Constants ====================
export const MOODS: MoodOption[] = [
  { id: 'motivated', label: '动力满满' },
  { id: 'happy', label: '开心' },
  { id: 'calm', label: '平静' },
  { id: 'tired', label: '疲惫' },
  { id: 'anxious', label: '焦虑' },
  { id: 'sad', label: '低落' },
]

export function getMoodLabel(mood: MoodId | string | null | undefined): string {
  if (!mood) return ''
  const found = MOODS.find(m => m.id === mood)
  return found ? found.label : ''
}

// ==================== Date Helpers ====================
export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function getTodayStr(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ==================== Text Helpers ====================
export function calculateWordCount(text: string | null | undefined): number {
  return (text || '').replace(/\s/g, '').length
}