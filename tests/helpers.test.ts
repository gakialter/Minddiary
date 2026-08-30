import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MOODS,
  calculateWordCount,
  coerceBoolean,
  formatShortDate,
  getTodayStr,
} from '../src/utils/helpers'

describe('MOODS', () => {
  it('exports six mood options with id and label fields', () => {
    expect(MOODS).toHaveLength(6)
    expect(MOODS.map(mood => mood.id)).toEqual([
      'motivated',
      'happy',
      'calm',
      'tired',
      'anxious',
      'sad',
    ])

    for (const mood of MOODS) {
      expect(mood).toEqual({
        id: expect.any(String),
        label: expect.any(String),
      })
      expect(mood.id).not.toBe('')
      expect(mood.label).not.toBe('')
    }
  })
})

describe('formatShortDate', () => {
  it('formats an ISO date as a short Chinese date', () => {
    expect(formatShortDate('2026-04-20')).toMatch(/\d{1,2}月\d{1,2}日/)
  })
})

describe('getTodayStr', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the current date in zero-padded YYYY-MM-DD format', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T12:00:00Z'))

    expect(getTodayStr()).toBe('2026-05-04')
    expect(getTodayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('calculateWordCount', () => {
  it('returns zero for null, undefined, or empty strings', () => {
    expect(calculateWordCount(null)).toBe(0)
    expect(calculateWordCount(undefined)).toBe(0)
    expect(calculateWordCount('')).toBe(0)
  })

  it('counts non-whitespace characters in ordinary Chinese and English text', () => {
    expect(calculateWordCount('Hello世界')).toBe(7)
    expect(calculateWordCount('考研日记')).toBe(4)
  })

  it('ignores spaces, newlines, and tabs', () => {
    expect(calculateWordCount('A B\nC')).toBe(3)
    expect(calculateWordCount('A B\nC\t中 文')).toBe(5)
  })
})

describe('coerceBoolean', () => {
  it('returns true for boolean true and string true', () => {
    expect(coerceBoolean(true, false)).toBe(true)
    expect(coerceBoolean('true', false)).toBe(true)
  })

  it('returns false for boolean false and string false', () => {
    expect(coerceBoolean(false, true)).toBe(false)
    expect(coerceBoolean('false', true)).toBe(false)
  })

  it('returns false for non-true strings', () => {
    expect(coerceBoolean('yes', true)).toBe(false)
    expect(coerceBoolean('1', true)).toBe(false)
  })

  it('falls back to the provided default for nullish values', () => {
    expect(coerceBoolean(undefined, true)).toBe(true)
    expect(coerceBoolean(undefined, false)).toBe(false)
    expect(coerceBoolean(null, true)).toBe(true)
    expect(coerceBoolean(null, false)).toBe(false)
  })
})
