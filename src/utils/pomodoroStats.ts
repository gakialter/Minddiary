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

  return Array.from(merged.values()).sort((a, b) =>
    b.total_minutes - a.total_minutes
    || b.session_count - a.session_count
    || a.subject_name.localeCompare(b.subject_name)
  )
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
