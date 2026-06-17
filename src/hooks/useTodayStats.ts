/**
 * useTodayStats.ts — Custom hook for the Today Dashboard.
 *
 * Fetches all today's statistics in a single batch IPC call via
 * the todayDashboard context API.  Manages loading/error/data state
 * internally to avoid polluting the global context.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { useCurrentLocalDateKey } from '../contexts/LocalDateContext'
import { logger } from '../utils/logger'
import type { TodayDashboardData } from '../types'

const EMPTY_STATE: TodayDashboardData = {
  todayEntry: null,
  pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
  commanderMetrics: {
    riskPoolCount: 0,
    lockedKnowledgeGrowth: 0,
    focusConversionRate: 0,
  },
  taskFocusToday: {
    effectiveTaskCount: 0,
    completedTaskCount: 0,
    completionRate: 0,
    focusedTaskCount: 0,
    focusCoverageRate: 0,
    focusedMinutes: 0,
    skippedTaskCount: 0,
    openWithoutFocusCount: 0,
    focusedOpenTaskCount: 0,
    unclosedTaskTitles: [],
  },
  streakDays: 0,
}

export function useTodayStats() {
  const { todayDashboard, dataRefreshVersion } = useDiary()
  const currentDateKey = useCurrentLocalDateKey()
  const [data, setData] = useState<TodayDashboardData>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await todayDashboard.getData(currentDateKey)
      if (requestId !== requestIdRef.current) return
      setData(result)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      logger.error('[useTodayStats] Failed to load:', err)
      setError(err instanceof Error ? err.message : '加载今日数据失败')
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [currentDateKey, todayDashboard])

  useEffect(() => {
    refresh()
  }, [refresh, dataRefreshVersion])

  return { data, loading, error, refresh, currentDateKey }
}
