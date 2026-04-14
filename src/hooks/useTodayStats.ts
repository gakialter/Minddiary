/**
 * useTodayStats.ts — Custom hook for the Today Dashboard.
 *
 * Fetches all today's statistics in a single batch IPC call via
 * the todayDashboard context API.  Manages loading/error/data state
 * internally to avoid polluting the global context.
 */
import { useState, useEffect, useCallback } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { getTodayStr } from '../utils/helpers'
import type { TodayDashboardData } from '../types'

const EMPTY_STATE: TodayDashboardData = {
  todayEntry: null,
  pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
  commanderMetrics: {
    riskPoolCount: 0,
    lockedKnowledgeGrowth: 0,
    focusConversionRate: 0,
  },
  streakDays: 0,
}

export function useTodayStats() {
  const { todayDashboard } = useDiary()
  const [data, setData] = useState<TodayDashboardData>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await todayDashboard.getData(getTodayStr())
      setData(result)
    } catch (err) {
      console.error('[useTodayStats] Failed to load:', err)
      setError(err instanceof Error ? err.message : '加载今日数据失败')
    } finally {
      setLoading(false)
    }
  }, [todayDashboard])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
