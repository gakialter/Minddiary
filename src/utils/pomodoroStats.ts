import { getLocalDateKey, isDateKey } from './dateKey'
import type { PomodoroStat } from '../types'

export interface AggregatedPomodoroStat {
  subject_name: string
  color: string
  total_minutes: number
  session_count: number
}

export interface PomodoroStatsSummary {
  totalMinutes: number
  totalSessions: number
  averageMinutes: number
}

function parseDateKey(value: string): Date | null {
  if (!isDateKey(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return getLocalDateKey(date) === value ? date : null
}

export function getDateKeysBetween(startDate: string, endDate: string): string[] {
  const start = parseDateKey(startDate)
  const end = parseDateKey(endDate)
  if (!start || !end || start.getTime() > end.getTime()) return []

  const dates: string[] = []
  const cursor = new Date(start)
  while (cursor.getTime() <= end.getTime()) {
    dates.push(getLocalDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

export function aggregatePomodoroStats(allDayStats: PomodoroStat[][]): AggregatedPomodoroStat[] {
  const merged = new Map<string, AggregatedPomodoroStat>()

  for (const dayStats of allDayStats) {
    for (const stat of dayStats) {
      const totalMinutes = Number(stat.total_minutes)
      const sessionCount = Number(stat.session_count)
      if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) continue
      if (!Number.isFinite(sessionCount) || sessionCount <= 0) continue

      const key = stat.subject_name || '未分类'
      const existing = merged.get(key)
      if (existing) {
        existing.total_minutes += totalMinutes
        existing.session_count += sessionCount
      } else {
        merged.set(key, {
          subject_name: key,
          color: stat.color || '',
          total_minutes: totalMinutes,
          session_count: sessionCount,
        })
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.total_minutes - a.total_minutes)
}

export function summarizePomodoroStats(stats: AggregatedPomodoroStat[]): PomodoroStatsSummary {
  const totalMinutes = stats.reduce((sum, stat) => sum + stat.total_minutes, 0)
  const totalSessions = stats.reduce((sum, stat) => sum + stat.session_count, 0)

  return {
    totalMinutes,
    totalSessions,
    averageMinutes: totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0,
  }
}

export function formatPomodoroMinutes(minutes: number): string {
  const roundedMinutes = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0))
  if (roundedMinutes < 60) return `${roundedMinutes}m`
  const hours = Math.floor(roundedMinutes / 60)
  const restMinutes = roundedMinutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}
