// Shared constants and helper functions for MindDiary
import { getLocalDateKey } from './dateKey'
import type { MoodOption } from '../types'

// ==================== Mood Constants ====================
export const MOODS: MoodOption[] = [
  { id: 'motivated', label: '动力满满' },
  { id: 'happy', label: '开心' },
  { id: 'calm', label: '平静' },
  { id: 'tired', label: '疲惫' },
  { id: 'anxious', label: '焦虑' },
  { id: 'sad', label: '低落' },
]

// ==================== Date Helpers ====================
export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function getTodayStr(): string {
  return getLocalDateKey()
}

// ==================== Text Helpers ====================
export function calculateWordCount(text: string | null | undefined): number {
  return (text || '').replace(/\s/g, '').length
}

/**
 * Parse a string-stored boolean (settings values, localStorage, etc.)
 * back to a boolean with a given default.
 */
export function coerceBoolean(value: unknown, defaultValue: boolean): boolean {
  return String(value ?? String(defaultValue)) === 'true'
}
