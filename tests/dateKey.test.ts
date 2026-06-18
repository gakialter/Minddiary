import { describe, expect, it } from 'vitest'
import { getDelayUntilNextLocalDate, getLocalDateKey, getUtcDateKey, isDateKey, toLocalDateTimeString } from '../src/utils/dateKey'

describe('dateKey utilities', () => {
  it('formats date keys from local calendar fields', () => {
    const date = new Date(2026, 4, 18, 0, 30, 0)

    expect(getLocalDateKey(date)).toBe('2026-05-18')
    expect(getLocalDateKey(date)).toBe([
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-'))
  })

  it('keeps local date-time strings aligned to the local date key', () => {
    const date = new Date(2026, 4, 18, 8, 5, 6)

    expect(toLocalDateTimeString(date)).toBe('2026-05-18 08:05:06')
  })

  it('exposes UTC key separately so callers do not accidentally use it for today totals', () => {
    const date = new Date(2026, 4, 18, 0, 30, 0)

    expect(getUtcDateKey(date)).toBe(date.toISOString().slice(0, 10))
    expect(isDateKey(getLocalDateKey(date))).toBe(true)
    expect(isDateKey('2026-5-18')).toBe(false)
  })

  it('calculates delay to the next local calendar boundary instead of a fixed day', () => {
    const oneHourBeforeMidnight = new Date(2026, 4, 18, 23, 0, 0)

    expect(getDelayUntilNextLocalDate(oneHourBeforeMidnight)).toBe(60 * 60 * 1000)
  })

  it('keeps a positive full-day delay at an exact local midnight boundary', () => {
    const midnight = new Date(2026, 4, 18, 0, 0, 0)

    expect(getDelayUntilNextLocalDate(midnight)).toBe(24 * 60 * 60 * 1000)
  })
})
