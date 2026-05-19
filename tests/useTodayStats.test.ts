import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodayDashboardData } from '../src/types'

const mocks = vi.hoisted(() => ({
  getData: vi.fn(),
  loggerError: vi.fn(),
  getTodayStr: vi.fn(() => '2026-05-04'),
  dataRefreshVersion: 0,
  todayDashboard: undefined as unknown as { getData: ReturnType<typeof vi.fn> },
}))

mocks.todayDashboard = {
  getData: mocks.getData,
}

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(() => ({
    todayDashboard: mocks.todayDashboard,
    dataRefreshVersion: mocks.dataRefreshVersion,
  })),
}))

vi.mock('../src/utils/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}))

vi.mock('../src/utils/helpers', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/utils/helpers')>()

  return {
    ...actual,
    getTodayStr: mocks.getTodayStr,
  }
})

import { useDiary } from '../src/contexts/DiaryContext'
import { getTodayStr } from '../src/utils/helpers'
import { logger } from '../src/utils/logger'
import { useTodayStats } from '../src/hooks/useTodayStats'

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

const FULL_DATA: TodayDashboardData = {
  todayEntry: {
    id: 1,
    title: '今日复盘',
    wordCount: 320,
    mood: 'happy',
  },
  pomodoroToday: { totalMinutes: 90, sessionCount: 3 },
  commanderMetrics: {
    riskPoolCount: 4,
    lockedKnowledgeGrowth: 12,
    focusConversionRate: 75,
  },
  streakDays: 8,
}

const UPDATED_DATA: TodayDashboardData = {
  todayEntry: {
    id: 2,
    title: '刷新后的复盘',
    wordCount: 480,
    mood: 'motivated',
  },
  pomodoroToday: { totalMinutes: 120, sessionCount: 4 },
  commanderMetrics: {
    riskPoolCount: 1,
    lockedKnowledgeGrowth: 18,
    focusConversionRate: 88,
  },
  streakDays: 9,
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.dataRefreshVersion = 0
  vi.mocked(getTodayStr).mockReturnValue('2026-05-04')
  vi.mocked(useDiary).mockReturnValue({
    todayDashboard: mocks.todayDashboard,
    dataRefreshVersion: mocks.dataRefreshVersion,
  } as unknown as ReturnType<typeof useDiary>)
})

describe('useTodayStats', () => {
  it('starts with empty loading state and then loads today stats successfully', async () => {
    const pending = deferred<TodayDashboardData>()
    const getData = vi.mocked(mocks.getData).mockReturnValueOnce(pending.promise)

    const { result } = renderHook(() => useTodayStats())

    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.data).toEqual(EMPTY_STATE)
    expect(getData).toHaveBeenCalledWith('2026-05-04')

    await act(async () => {
      pending.resolve(FULL_DATA)
      await pending.promise
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBeNull()
    expect(result.current.data).toEqual(FULL_DATA)
    expect(getData).toHaveBeenCalledTimes(1)
    expect(getTodayStr).toHaveBeenCalledTimes(1)
  })

  it('keeps empty data and stores the error message when loading fails', async () => {
    const getData = vi.mocked(mocks.getData).mockRejectedValueOnce(new Error('Network failure'))

    const { result } = renderHook(() => useTodayStats())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Network failure')
    expect(result.current.data).toEqual(EMPTY_STATE)
    expect(getData).toHaveBeenCalledWith('2026-05-04')
    expect(logger.error).toHaveBeenCalledWith('[useTodayStats] Failed to load:', expect.any(Error))
  })

  it('refreshes manually and replaces data with the latest result', async () => {
    const getData = vi.mocked(mocks.getData)
    getData.mockResolvedValueOnce(FULL_DATA)

    const { result } = renderHook(() => useTodayStats())

    await waitFor(() => {
      expect(result.current.data).toEqual(FULL_DATA)
    })
    expect(result.current.loading).toBe(false)

    getData.mockClear()
    getData.mockResolvedValueOnce(UPDATED_DATA)

    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.data).toEqual(UPDATED_DATA)
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(getData).toHaveBeenCalledTimes(1)
    expect(getData).toHaveBeenCalledWith('2026-05-04')
  })

  it('reloads when the shared data refresh version changes', async () => {
    const getData = vi.mocked(mocks.getData)
    getData.mockResolvedValueOnce(FULL_DATA)

    const { result, rerender } = renderHook(() => useTodayStats())

    await waitFor(() => {
      expect(result.current.data).toEqual(FULL_DATA)
    })

    getData.mockResolvedValueOnce(UPDATED_DATA)
    mocks.dataRefreshVersion = 1
    vi.mocked(useDiary).mockReturnValue({
      todayDashboard: mocks.todayDashboard,
      dataRefreshVersion: mocks.dataRefreshVersion,
    } as unknown as ReturnType<typeof useDiary>)

    rerender()

    await waitFor(() => {
      expect(result.current.data).toEqual(UPDATED_DATA)
    })
    expect(getData).toHaveBeenCalledTimes(2)
  })
})
