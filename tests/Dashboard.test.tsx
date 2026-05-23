import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../src/components/Dashboard'
import type { TodayDashboardData } from '../src/types'

const mocks = vi.hoisted(() => ({
  dataRefreshVersion: 0,
  pomodoroGetRange: vi.fn(),
  pomodoroGetStats: vi.fn(),
  dashboardStreak: vi.fn(),
  entryDatesRange: vi.fn(),
  mistakesGetAll: vi.fn(),
  mistakesGetDueCount: vi.fn(),
  todayDashboardGetData: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(() => ({
    pomodoro: {
      getRange: mocks.pomodoroGetRange,
      getStats: mocks.pomodoroGetStats,
    },
    dashboard: {
      streak: mocks.dashboardStreak,
      entryDatesRange: mocks.entryDatesRange,
    },
    mistakes: {
      getAll: mocks.mistakesGetAll,
      getDueCount: mocks.mistakesGetDueCount,
    },
    todayDashboard: {
      getData: mocks.todayDashboardGetData,
    },
    settingsData: {},
    dataRefreshVersion: mocks.dataRefreshVersion,
  })),
}))

vi.mock('../src/utils/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}))

const todayData = (riskPoolCount: number): TodayDashboardData => ({
  todayEntry: null,
  pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
  commanderMetrics: {
    riskPoolCount,
    lockedKnowledgeGrowth: 0,
    focusConversionRate: 0,
  },
  streakDays: 3,
})

beforeEach(() => {
  mocks.dataRefreshVersion = 0
  mocks.pomodoroGetRange.mockResolvedValue([])
  mocks.pomodoroGetStats.mockResolvedValue([])
  mocks.dashboardStreak.mockResolvedValue(99)
  mocks.entryDatesRange.mockResolvedValue([])
  mocks.mistakesGetAll.mockResolvedValue({ data: [], total: 0, masteredTotal: 0 })
  mocks.mistakesGetDueCount.mockResolvedValue(99)
  mocks.todayDashboardGetData.mockResolvedValue(todayData(2))
  vi.clearAllMocks()
})

describe('Dashboard', () => {
  it('uses todayDashboard riskPoolCount as the single due-review count source and reloads on refresh signal', async () => {
    const { rerender } = render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-due-mistakes')).toHaveTextContent('2')
    })

    expect(mocks.todayDashboardGetData).toHaveBeenCalled()
    expect(mocks.mistakesGetDueCount).not.toHaveBeenCalled()

    mocks.todayDashboardGetData.mockResolvedValueOnce(todayData(1))
    mocks.dataRefreshVersion = 1
    rerender(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-due-mistakes')).toHaveTextContent('1')
    })
  })

  it('renders the focus distribution module', async () => {
    mocks.pomodoroGetStats.mockResolvedValue([
      { subject_name: '数学', color: '#0F766E', total_minutes: 60, session_count: 3 },
    ])

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('专注分布')).toBeInTheDocument()
    })
  })
})
