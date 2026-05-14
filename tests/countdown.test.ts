import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXAM_EVENT_ID,
  getDaysLeft,
  normalizeCountdownEvents,
  parseLocalDate,
  sortUpcomingEvents,
} from '../src/utils/countdown'
import type { CountdownEvent } from '../src/types'

describe('countdown utilities', () => {
  it('parses YYYY-MM-DD as a local calendar date', () => {
    const parsed = parseLocalDate('2026-05-14')

    expect(parsed).not.toBeNull()
    expect(parsed?.getFullYear()).toBe(2026)
    expect(parsed?.getMonth()).toBe(4)
    expect(parsed?.getDate()).toBe(14)
    expect(parseLocalDate('2026-02-30')).toBeNull()
  })

  it('calculates today, tomorrow, and yesterday against local midnight', () => {
    const now = new Date(2026, 4, 14, 18, 30)

    expect(getDaysLeft('2026-05-14', now)).toBe(0)
    expect(getDaysLeft('2026-05-15', now)).toBe(1)
    expect(getDaysLeft('2026-05-13', now)).toBe(-1)
  })

  it('calculates cross-month and cross-year boundaries', () => {
    expect(getDaysLeft('2026-02-01', new Date(2026, 0, 31, 23, 59))).toBe(1)
    expect(getDaysLeft('2027-01-01', new Date(2026, 11, 31, 8, 0))).toBe(1)
  })

  it('sorts upcoming non-archived events by nearest date', () => {
    const events: CountdownEvent[] = [
      { id: 'ended', title: '已结束', date: '2026-05-12' },
      { id: 'later', title: '复试准备', date: '2026-06-10' },
      { id: 'soon', title: '报名开始', date: '2026-05-20' },
      { id: 'archived', title: '归档', date: '2026-05-18', archived: true },
    ]

    expect(sortUpcomingEvents(events, new Date(2026, 4, 14)).map(event => event.id)).toEqual([
      'soon',
      'later',
    ])
  })

  it('normalizes stored events and creates the default exam event from legacy examDate', () => {
    const events = normalizeCountdownEvents(undefined, '2026-12-21')

    expect(events).toEqual([
      expect.objectContaining({
        id: DEFAULT_EXAM_EVENT_ID,
        title: '考研初试',
        date: '2026-12-21',
        type: 'exam',
      }),
    ])
  })

  it('parses JSON events, drops invalid records, and syncs the built-in exam date', () => {
    const stored = JSON.stringify([
      { id: DEFAULT_EXAM_EVENT_ID, title: '旧考试', date: '2025-12-20', type: 'exam', pinned: true },
      { id: 'summer', title: '暑假开始', date: '2026-07-01', type: 'holiday' },
      { id: 'bad', title: '坏日期', date: '2026-02-30' },
    ])

    const events = normalizeCountdownEvents(stored, '2026-12-21')

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(expect.objectContaining({
      id: DEFAULT_EXAM_EVENT_ID,
      title: '考研初试',
      date: '2026-12-21',
      pinned: true,
    }))
    expect(events[1]).toEqual(expect.objectContaining({
      id: 'summer',
      title: '暑假开始',
      date: '2026-07-01',
      type: 'holiday',
    }))
  })
})
