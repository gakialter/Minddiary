import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXAM_EVENT_ID,
  DEFAULT_EXAM_TITLE,
  getPrimaryCountdownEvent,
  getPrimaryCountdownTitleError,
  getDaysLeft,
  normalizeCountdownEvents,
  normalizeCountdownSettings,
  parseLocalDate,
  PRIMARY_COUNTDOWN_TITLE_MAX_LENGTH,
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

  it('parses JSON events, drops invalid records, and syncs the primary date without resetting its title', () => {
    const stored = JSON.stringify([
      { id: DEFAULT_EXAM_EVENT_ID, title: '公务员考试', date: '2025-12-20', type: 'exam', pinned: true, archived: true },
      { id: 'summer', title: '暑假开始', date: '2026-07-01', type: 'holiday' },
      { id: 'bad', title: '坏日期', date: '2026-02-30' },
    ])

    const events = normalizeCountdownEvents(stored, '2026-12-21')

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(expect.objectContaining({
      id: DEFAULT_EXAM_EVENT_ID,
      title: '公务员考试',
      date: '2026-12-21',
      pinned: true,
      archived: true,
    }))
    expect(events[1]).toEqual(expect.objectContaining({
      id: 'summer',
      title: '暑假开始',
      date: '2026-07-01',
      type: 'holiday',
    }))
  })

  it('keeps the primary title while changing its date and keeps its date while changing its title', () => {
    const initial = normalizeCountdownEvents([
      {
        id: DEFAULT_EXAM_EVENT_ID,
        title: '教师资格证',
        date: '2026-09-01',
        type: 'deadline',
      },
    ], '2026-12-01')
    expect(getPrimaryCountdownEvent(initial)).toEqual(expect.objectContaining({
      title: '教师资格证',
      date: '2026-12-01',
      type: 'exam',
    }))

    const renamed = normalizeCountdownEvents(initial.map(event => (
      event.id === DEFAULT_EXAM_EVENT_ID ? { ...event, title: '毕业设计' } : event
    )), '2026-12-01')
    expect(getPrimaryCountdownEvent(renamed)).toEqual(expect.objectContaining({
      title: '毕业设计',
      date: '2026-12-01',
    }))
  })

  it('normalizes blank primary titles to the default and deterministically keeps the first duplicate', () => {
    const events = normalizeCountdownEvents([
      {
        id: DEFAULT_EXAM_EVENT_ID,
        title: '   ',
        date: '2026-10-01',
        type: 'exam',
        pinned: true,
      },
      {
        id: DEFAULT_EXAM_EVENT_ID,
        title: '不应保留',
        date: '2026-11-01',
        type: 'exam',
      },
    ])

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(expect.objectContaining({
      id: DEFAULT_EXAM_EVENT_ID,
      title: DEFAULT_EXAM_TITLE,
      date: '2026-10-01',
      pinned: true,
    }))
  })

  it('mirrors a primary event date into legacy examDate when the old field is missing', () => {
    expect(normalizeCountdownSettings([
      {
        id: DEFAULT_EXAM_EVENT_ID,
        title: '论文提交',
        date: '2027-01-15',
        type: 'deadline',
      },
    ])).toEqual({
      examDate: '2027-01-15',
      countdownEvents: [
        expect.objectContaining({
          id: DEFAULT_EXAM_EVENT_ID,
          title: '论文提交',
          date: '2027-01-15',
          type: 'exam',
        }),
      ],
    })
  })

  it('does not change the primary target when ordinary events are added, pinned, archived, or removed', () => {
    const primary = {
      id: DEFAULT_EXAM_EVENT_ID,
      title: '自定义截止日期',
      date: '2026-12-31',
      type: 'exam' as const,
      pinned: true,
      archived: false,
    }
    const withOrdinary = normalizeCountdownEvents([
      primary,
      { id: 'paper', title: '论文提交', date: '2026-10-01', type: 'deadline', pinned: true },
    ], primary.date)
    const withoutOrdinary = normalizeCountdownEvents(
      withOrdinary.filter(event => event.id !== 'paper'),
      primary.date,
    )

    expect(getPrimaryCountdownEvent(withOrdinary)).toEqual(primary)
    expect(getPrimaryCountdownEvent(withoutOrdinary)).toEqual(primary)
  })

  it('safely drops malformed legacy settings without throwing', () => {
    expect(normalizeCountdownEvents('not-json', '2026-12-21')).toEqual([
      expect.objectContaining({
        id: DEFAULT_EXAM_EVENT_ID,
        title: DEFAULT_EXAM_TITLE,
        date: '2026-12-21',
      }),
    ])
    expect(normalizeCountdownEvents([
      null,
      { id: 42, title: [], date: 'not-a-date' },
    ], '2026-12-21')).toHaveLength(1)
  })

  it('uses one consistent 1-40 character validation rule for the primary title', () => {
    expect(getPrimaryCountdownTitleError('')).toBe('主目标名称不能为空')
    expect(getPrimaryCountdownTitleError('   ')).toBe('主目标名称不能为空')
    expect(getPrimaryCountdownTitleError('公务员考试 2027！')).toBeNull()
    expect(getPrimaryCountdownTitleError('a'.repeat(PRIMARY_COUNTDOWN_TITLE_MAX_LENGTH))).toBeNull()
    expect(getPrimaryCountdownTitleError('a'.repeat(PRIMARY_COUNTDOWN_TITLE_MAX_LENGTH + 1)))
      .toContain(String(PRIMARY_COUNTDOWN_TITLE_MAX_LENGTH))
  })
})
