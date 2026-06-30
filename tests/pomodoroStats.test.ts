import { describe, expect, it } from 'vitest'
import {
  aggregatePomodoroStats,
  getDateKeysBetween,
  summarizePomodoroStats,
} from '../src/utils/pomodoroStats'
import type { PomodoroStat } from '../src/types'

const stat = (name: string, color: string, mins: number, sessions: number): PomodoroStat => ({
  subject_name: name,
  color,
  total_minutes: mins,
  session_count: sessions,
})

describe('pomodoroStats utilities', () => {
  it('returns inclusive local date keys for a valid custom range', () => {
    expect(getDateKeysBetween('2026-05-01', '2026-05-03')).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ])
  })

  it('returns an empty range when the start date is after the end date', () => {
    expect(getDateKeysBetween('2026-05-04', '2026-05-03')).toEqual([])
  })

  it('aggregates focus minutes by subject across count-up and countdown records', () => {
    const result = aggregatePomodoroStats([
      [stat('数学', '#0F766E', 25, 1), stat('英语', '#854D0E', 15, 1)],
      [stat('数学', '#0F766E', 17, 1), stat('', '', 10, 1)],
    ])

    expect(result).toEqual([
      { subject_name: '数学', color: '#0F766E', total_minutes: 42, session_count: 2 },
      { subject_name: '英语', color: '#854D0E', total_minutes: 15, session_count: 1 },
      { subject_name: '未分类', color: '', total_minutes: 10, session_count: 1 },
    ])
  })

  it('uses session count and subject name tie-breakers after range aggregation', () => {
    const result = aggregatePomodoroStats([
      [stat('Beta', '#854D0E', 30, 1), stat('Alpha', '#0F766E', 20, 1), stat('Gamma', '#C65A3A', 25, 2)],
      [stat('Beta', '#854D0E', 10, 1), stat('Alpha', '#0F766E', 20, 1), stat('Gamma', '#C65A3A', 15, 1)],
    ])

    expect(result.map(({ subject_name, total_minutes, session_count }) => ({
      subject_name,
      total_minutes,
      session_count,
    }))).toEqual([
      { subject_name: 'Gamma', total_minutes: 40, session_count: 3 },
      { subject_name: 'Alpha', total_minutes: 40, session_count: 2 },
      { subject_name: 'Beta', total_minutes: 40, session_count: 2 },
    ])
  })

  it('summarizes total focus time, session count, and average minutes', () => {
    expect(summarizePomodoroStats([
      { subject_name: '数学', color: '#0F766E', total_minutes: 42, session_count: 2 },
      { subject_name: '英语', color: '#854D0E', total_minutes: 18, session_count: 1 },
    ])).toEqual({
      totalMinutes: 60,
      totalSessions: 3,
      averageMinutes: 20,
    })
  })
})
