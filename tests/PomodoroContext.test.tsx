import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, PomodoroStat, Subject } from '../src/types'

const mocks = vi.hoisted(() => ({
  useDiary: vi.fn(),
  subjectsGetAll: vi.fn(),
  pomodoroGetStats: vi.fn(),
  pomodoroGetDailyTotal: vi.fn(),
  pomodoroAddSession: vi.fn(),
  notificationShow: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  audioContextConstructor: vi.fn(),
  nativeNotification: vi.fn(),
  requestNotificationPermission: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: mocks.useDiary,
}))

vi.mock('../src/utils/logger', () => ({
  logger: {
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
  },
}))

import {
  PomodoroProvider,
  usePomodoroActions,
  usePomodoroData,
  usePomodoroTimer,
} from '../src/contexts/PomodoroContext'
import { useDiary } from '../src/contexts/DiaryContext'

vi.useFakeTimers()

class MockAudioContext {
  currentTime = 0
  destination = {}

  constructor() {
    mocks.audioContextConstructor()
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }
  }

  createOscillator() {
    return {
      type: 'sine',
      frequency: {
        setValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
  }

  close = vi.fn()
}

class MockNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = mocks.requestNotificationPermission

  constructor(title: string, options?: NotificationOptions) {
    mocks.nativeNotification(title, options)
  }
}

Object.defineProperty(window, 'AudioContext', {
  configurable: true,
  writable: true,
  value: MockAudioContext,
})

Object.defineProperty(window, 'webkitAudioContext', {
  configurable: true,
  writable: true,
  value: MockAudioContext,
})

Object.defineProperty(globalThis, 'Notification', {
  configurable: true,
  writable: true,
  value: MockNotification,
})

Object.defineProperty(window, 'Notification', {
  configurable: true,
  writable: true,
  value: MockNotification,
})

const SUBJECTS: Subject[] = [
  { id: 1, name: 'Math', color: '#0F766E' },
  { id: 2, name: 'English', color: '#C65A3A' },
]

const TODAY_STATS: PomodoroStat[] = [
  { subject_name: 'Math', color: '#0F766E', total_minutes: 25, session_count: 1 },
]

const ACTIVE_SESSION_STORAGE_KEY = 'pomodoro-active-session-v1'

const settingsData = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  theme: 'auto',
  examDate: '2026-12-25',
  dailyGoal: 8,
  autoSave: true,
  notifications: true,
  aiEndpoint: '',
  aiModel: 'gpt-3.5-turbo',
  pomodoroMinutes: 25,
  focusGuardEnabled: false,
  focusGuardIntervalSec: 5,
  focusWhitelist: [],
  autoBackup: false,
  backupPath: '',
  aiApiKeyMasked: null,
  aiApiKeyPresent: false,
  pomodoroSound: true,
  pomodoroAlert: true,
  ...overrides,
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <PomodoroProvider>{children}</PomodoroProvider>
)

const usePomodoroValues = () => ({
  timer: usePomodoroTimer(),
  data: usePomodoroData(),
  actions: usePomodoroActions(),
})

const renderPomodoroHook = () => renderHook(() => usePomodoroValues(), { wrapper })

const flushAsyncWork = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const waitForExpect = async (assertion: () => void) => {
  const currentTime = new Date(Date.now())
  vi.useRealTimers()
  try {
    await waitFor(assertion)
  } finally {
    vi.useFakeTimers()
    vi.setSystemTime(currentTime)
  }
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'))
  localStorage.clear()
  MockNotification.permission = 'granted'

  mocks.subjectsGetAll.mockResolvedValue(SUBJECTS)
  mocks.pomodoroGetStats.mockResolvedValue(TODAY_STATS)
  mocks.pomodoroGetDailyTotal.mockResolvedValue(25)
  mocks.pomodoroAddSession.mockResolvedValue({ success: true })
  mocks.notificationShow.mockResolvedValue(undefined)
  mocks.requestNotificationPermission.mockResolvedValue('granted')
  mocks.useDiary.mockReturnValue({
    settingsData: settingsData(),
    subjects: {
      getAll: mocks.subjectsGetAll,
    },
    pomodoro: {
      getStats: mocks.pomodoroGetStats,
      getDailyTotal: mocks.pomodoroGetDailyTotal,
      addSession: mocks.pomodoroAddSession,
    },
    notification: {
      show: mocks.notificationShow,
    },
  } as unknown as ReturnType<typeof useDiary>)

  vi.clearAllMocks()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.clearAllTimers()
  localStorage.clear()
  vi.clearAllMocks()
})

afterAll(() => {
  vi.useRealTimers()
})

describe('PomodoroContext', () => {
  it.each([
    [usePomodoroTimer, 'usePomodoroTimer must be used within PomodoroProvider'],
    [usePomodoroData, 'usePomodoroData must be used within PomodoroProvider'],
    [usePomodoroActions, 'usePomodoroActions must be used within PomodoroProvider'],
  ])('throws when %p is rendered without PomodoroProvider', (hook, message) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const suppressWindowError = (event: ErrorEvent) => event.preventDefault()

    window.addEventListener('error', suppressWindowError)
    try {
      expect(() => renderHook(() => hook())).toThrow(message)
    } finally {
      window.removeEventListener('error', suppressWindowError)
    }

    expect(consoleError).toHaveBeenCalled()
  })

  it('loads subjects and today stats on mount with default timer state', async () => {
    const { result } = renderPomodoroHook()

    expect(result.current.timer.mode.id).toBe('work')
    expect(result.current.timer.timeLeft).toBe(25 * 60)
    expect(result.current.timer.isRunning).toBe(false)

    await flushAsyncWork()
    await waitForExpect(() => {
      expect(mocks.subjectsGetAll).toHaveBeenCalledTimes(1)
      expect(mocks.pomodoroGetStats).toHaveBeenCalledWith('2026-05-05')
      expect(mocks.pomodoroGetDailyTotal).toHaveBeenCalledWith('2026-05-05')
    })

    expect(result.current.data.subjects).toEqual(SUBJECTS)
    expect(result.current.data.todayStats).toEqual(TODAY_STATS)
    expect(result.current.data.todayTotal).toBe(25)
  })

  it('starts, pauses, and resets the timer', async () => {
    const { result } = renderPomodoroHook()

    await act(async () => {
      result.current.actions.toggleTimer()
    })

    expect(result.current.timer.isRunning).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    expect(result.current.timer.timeLeft).toBe(24 * 60)

    await act(async () => {
      result.current.actions.toggleTimer()
    })

    expect(result.current.timer.isRunning).toBe(false)
    const pausedTime = result.current.timer.timeLeft

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    expect(result.current.timer.timeLeft).toBe(pausedTime)

    await act(async () => {
      result.current.actions.resetTimer()
    })

    expect(result.current.timer.timeLeft).toBe(25 * 60)
    expect(result.current.timer.isRunning).toBe(false)
  })

  it('restores a running work session after reload and continues counting down', async () => {
    const first = renderPomodoroHook()

    await act(async () => {
      first.result.current.actions.toggleTimer()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    expect(first.result.current.timer.mode.id).toBe('work')
    expect(first.result.current.timer.isRunning).toBe(true)
    expect(first.result.current.timer.timeLeft).toBe(24 * 60)

    first.unmount()

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    const second = renderPomodoroHook()
    await flushAsyncWork()

    expect(second.result.current.timer.mode.id).toBe('work')
    expect(second.result.current.timer.isRunning).toBe(true)
    expect(second.result.current.timer.timeLeft).toBeGreaterThanOrEqual(24 * 60 - 1)
    expect(second.result.current.timer.timeLeft).toBeLessThanOrEqual(24 * 60)
    const activeSessionWrites = setItemSpy.mock.calls
      .filter(([key]) => key === ACTIVE_SESSION_STORAGE_KEY)
      .map(([, value]) => JSON.parse(String(value)) as { isRunning: boolean; modeId: string; timeLeft: number; endTimeMs: number | null })

    expect(activeSessionWrites.length).toBeGreaterThan(0)
    expect(activeSessionWrites[0]).toEqual(expect.objectContaining({
      modeId: 'work',
      isRunning: true,
    }))
    expect(activeSessionWrites[0]!.timeLeft).toBeGreaterThanOrEqual(24 * 60 - 1)
    expect(activeSessionWrites[0]!.timeLeft).toBeLessThanOrEqual(24 * 60)
    expect(activeSessionWrites[0]!.endTimeMs).toEqual(expect.any(Number))

    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })

    expect(second.result.current.timer.timeLeft).toBeGreaterThanOrEqual(23 * 60 + 29)
    expect(second.result.current.timer.timeLeft).toBeLessThanOrEqual(23 * 60 + 30)
  })

  it('restores a paused custom session after reload and resumes from the paused time', async () => {
    localStorage.setItem('pomodoro-custom-minutes', '10')
    const first = renderPomodoroHook()

    await act(async () => {
      first.result.current.actions.setMode(first.result.current.timer.dynamicModes.CUSTOM!)
    })
    await waitForExpect(() => {
      expect(first.result.current.timer.mode.id).toBe('custom')
      expect(first.result.current.timer.timeLeft).toBe(10 * 60)
    })

    await act(async () => {
      first.result.current.actions.toggleTimer()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    await act(async () => {
      first.result.current.actions.toggleTimer()
    })

    expect(first.result.current.timer.isRunning).toBe(false)
    expect(first.result.current.timer.timeLeft).toBe(9 * 60)

    first.unmount()

    const second = renderPomodoroHook()
    await flushAsyncWork()

    expect(second.result.current.timer.mode.id).toBe('custom')
    expect(second.result.current.timer.isRunning).toBe(false)
    expect(second.result.current.timer.timeLeft).toBe(9 * 60)

    await act(async () => {
      second.result.current.actions.toggleTimer()
    })
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })

    expect(second.result.current.timer.timeLeft).toBe(8 * 60 + 30)
  })

  it('clears the persisted active session on reset and remounts as idle work', async () => {
    const first = renderPomodoroHook()

    await act(async () => {
      first.result.current.actions.toggleTimer()
    })

    expect(localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).not.toBeNull()

    await act(async () => {
      first.result.current.actions.resetTimer()
    })

    expect(localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBeNull()

    first.unmount()
    const second = renderPomodoroHook()
    await flushAsyncWork()

    expect(second.result.current.timer.mode.id).toBe('work')
    expect(second.result.current.timer.timeLeft).toBe(25 * 60)
    expect(second.result.current.timer.isRunning).toBe(false)
  })

  it('completes a recently expired running work session during reload only once', async () => {
    vi.setSystemTime(new Date(2026, 4, 5, 8, 0, 0))
    const first = renderPomodoroHook()

    await act(async () => {
      first.result.current.actions.toggleTimer()
    })

    first.unmount()

    await act(async () => {
      vi.advanceTimersByTime(25 * 60 * 1000 + 5_000)
    })

    const second = renderPomodoroHook()
    await flushAsyncWork()

    await waitForExpect(() => {
      expect(mocks.pomodoroAddSession).toHaveBeenCalledTimes(1)
    })

    expect(mocks.pomodoroAddSession).toHaveBeenCalledWith(expect.objectContaining({
      subject_id: null,
      duration: 25,
      date_key: '2026-05-05',
      started_at: expect.stringMatching(/^2026-05-05 08:00:/),
      completed_at: expect.stringMatching(/^2026-05-05 08:25:/),
    }))
    expect(localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBeNull()
    expect(second.result.current.timer.mode.id).toBe('short_break')
    expect(second.result.current.timer.isRunning).toBe(false)

    second.unmount()
    const third = renderPomodoroHook()
    await flushAsyncWork()

    expect(mocks.pomodoroAddSession).toHaveBeenCalledTimes(1)
    expect(third.result.current.timer.mode.id).toBe('work')
    expect(third.result.current.timer.isRunning).toBe(false)
  })

  it('discards a stale active session without recording it', async () => {
    const now = new Date(2026, 4, 5, 8, 0, 0).getTime()
    vi.setSystemTime(now)
    localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify({
      version: 1,
      modeId: 'work',
      modeTime: 25 * 60,
      customMinutes: 30,
      selectedSubject: null,
      timeLeft: 20 * 60,
      isRunning: true,
      startedAtMs: now - 13 * 60 * 60 * 1000,
      endTimeMs: now - 12 * 60 * 60 * 1000,
      savedAtMs: now - 13 * 60 * 60 * 1000,
    }))

    const { result } = renderPomodoroHook()
    await flushAsyncWork()

    expect(mocks.pomodoroAddSession).not.toHaveBeenCalled()
    expect(localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBeNull()
    expect(result.current.timer.mode.id).toBe('work')
    expect(result.current.timer.timeLeft).toBe(25 * 60)
    expect(result.current.timer.isRunning).toBe(false)
  })

  it('does not increase the countdown after a backward system clock jump', async () => {
    const { result } = renderPomodoroHook()

    await act(async () => {
      result.current.actions.toggleTimer()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    const beforeJump = result.current.timer.timeLeft
    expect(beforeJump).toBe(24 * 60)

    await act(async () => {
      vi.setSystemTime(new Date(Date.now() - 5 * 60 * 1000))
      vi.advanceTimersByTime(1_000)
    })

    expect(result.current.timer.timeLeft).toBeLessThanOrEqual(beforeJump)
    expect(result.current.timer.progress).toBeGreaterThanOrEqual(0)
    expect(result.current.timer.progress).toBeLessThanOrEqual(1)
  })

  it('discards a running session after a large forward system clock jump', async () => {
    const { result } = renderPomodoroHook()

    await act(async () => {
      result.current.actions.toggleTimer()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    expect(localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).not.toBeNull()

    await act(async () => {
      vi.setSystemTime(new Date(Date.now() + 13 * 60 * 60 * 1000))
      vi.advanceTimersByTime(1_000)
    })
    await flushAsyncWork()

    expect(mocks.pomodoroAddSession).not.toHaveBeenCalled()
    expect(localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBeNull()
    expect(result.current.timer.mode.id).toBe('work')
    expect(result.current.timer.timeLeft).toBe(25 * 60)
    expect(result.current.timer.isRunning).toBe(false)
  })

  it('records a completed work session, notifies the user, and switches to short break', async () => {
    const { result } = renderPomodoroHook()

    await act(async () => {
      result.current.actions.toggleTimer()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000)
    })
    await flushAsyncWork()

    await waitForExpect(() => {
      expect(result.current.timer.isRunning).toBe(false)
      expect(result.current.timer.mode.id).toBe('short_break')
    })

    expect(mocks.pomodoroAddSession).toHaveBeenCalledWith(expect.objectContaining({
      subject_id: null,
      duration: 25,
      date_key: '2026-05-05',
      started_at: expect.stringMatching(/^2026-05-05 /),
      completed_at: expect.stringMatching(/^2026-05-05 /),
    }))
    expect(mocks.notificationShow).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
    )
    expect(mocks.nativeNotification).toHaveBeenCalledWith(expect.any(String), {
      body: expect.any(String),
      icon: '/favicon.ico',
    })
    expect(mocks.audioContextConstructor).toHaveBeenCalled()
  })

  it('stores custom minutes and uses them when switching to custom mode', async () => {
    localStorage.setItem('pomodoro-custom-minutes', '20')
    const { result } = renderPomodoroHook()

    expect(result.current.data.customMinutes).toBe(20)

    await act(async () => {
      result.current.actions.setCustomMinutes(30)
    })

    await waitForExpect(() => {
      expect(result.current.data.customMinutes).toBe(30)
    })
    expect(localStorage.getItem('pomodoro-custom-minutes')).toBe('30')

    await act(async () => {
      result.current.actions.setMode(result.current.timer.dynamicModes.CUSTOM!)
    })

    await waitForExpect(() => {
      expect(result.current.timer.mode.id).toBe('custom')
      expect(result.current.timer.timeLeft).toBe(30 * 60)
    })
  })

  it('preserves a paused custom timer and resumes from the paused time', async () => {
    localStorage.setItem('pomodoro-custom-minutes', '10')
    const { result } = renderPomodoroHook()

    await act(async () => {
      result.current.actions.setMode(result.current.timer.dynamicModes.CUSTOM!)
    })
    await waitForExpect(() => {
      expect(result.current.timer.mode.id).toBe('custom')
      expect(result.current.timer.timeLeft).toBe(10 * 60)
    })

    await act(async () => {
      result.current.actions.toggleTimer()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    expect(result.current.timer.timeLeft).toBe(9 * 60)

    await act(async () => {
      result.current.actions.toggleTimer()
    })

    expect(result.current.timer.isRunning).toBe(false)
    expect(result.current.timer.timeLeft).toBe(9 * 60)

    await act(async () => {
      result.current.actions.toggleTimer()
    })
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })

    expect(result.current.timer.timeLeft).toBe(8 * 60 + 30)
  })

  it('resets a paused custom timer back to the full custom duration', async () => {
    localStorage.setItem('pomodoro-custom-minutes', '10')
    const { result } = renderPomodoroHook()

    await act(async () => {
      result.current.actions.setMode(result.current.timer.dynamicModes.CUSTOM!)
    })
    await waitForExpect(() => {
      expect(result.current.timer.timeLeft).toBe(10 * 60)
    })

    await act(async () => {
      result.current.actions.toggleTimer()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    await act(async () => {
      result.current.actions.toggleTimer()
    })

    expect(result.current.timer.timeLeft).toBe(9 * 60)

    await act(async () => {
      result.current.actions.resetTimer()
    })

    expect(result.current.timer.isRunning).toBe(false)
    expect(result.current.timer.timeLeft).toBe(10 * 60)
  })

  it('updates the displayed custom time when custom minutes change while idle', async () => {
    const { result } = renderPomodoroHook()

    await act(async () => {
      result.current.actions.setMode(result.current.timer.dynamicModes.CUSTOM!)
    })
    await waitForExpect(() => {
      expect(result.current.timer.mode.id).toBe('custom')
      expect(result.current.timer.timeLeft).toBe(30 * 60)
    })

    await act(async () => {
      result.current.actions.setCustomMinutes(45)
    })

    await waitForExpect(() => {
      expect(result.current.data.customMinutes).toBe(45)
      expect(result.current.timer.timeLeft).toBe(45 * 60)
    })
    expect(localStorage.getItem('pomodoro-custom-minutes')).toBe('45')
  })

  it('does not overwrite a paused custom countdown when custom minutes change', async () => {
    localStorage.setItem('pomodoro-custom-minutes', '10')
    const { result } = renderPomodoroHook()

    await act(async () => {
      result.current.actions.setMode(result.current.timer.dynamicModes.CUSTOM!)
    })
    await waitForExpect(() => {
      expect(result.current.timer.timeLeft).toBe(10 * 60)
    })

    await act(async () => {
      result.current.actions.toggleTimer()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    await act(async () => {
      result.current.actions.toggleTimer()
    })

    expect(result.current.timer.timeLeft).toBe(9 * 60)

    await act(async () => {
      result.current.actions.setCustomMinutes(20)
    })

    await waitForExpect(() => {
      expect(result.current.data.customMinutes).toBe(20)
    })
    expect(localStorage.getItem('pomodoro-custom-minutes')).toBe('20')
    expect(result.current.timer.timeLeft).toBe(9 * 60)

    await act(async () => {
      result.current.actions.resetTimer()
    })

    expect(result.current.timer.timeLeft).toBe(20 * 60)
    expect(result.current.timer.mode.time).toBe(20 * 60)
  })

  it('loads the new local day total on startup instead of inheriting yesterday', async () => {
    vi.setSystemTime(new Date(2026, 4, 18, 0, 10, 0))
    mocks.pomodoroGetStats.mockImplementation(async (date: string) => (
      date === '2026-05-17' ? TODAY_STATS : []
    ))
    mocks.pomodoroGetDailyTotal.mockImplementation(async (date: string) => (
      date === '2026-05-17' ? 25 : 0
    ))

    const { result } = renderPomodoroHook()

    await flushAsyncWork()
    await waitForExpect(() => {
      expect(mocks.pomodoroGetStats).toHaveBeenCalledWith('2026-05-18')
      expect(mocks.pomodoroGetDailyTotal).toHaveBeenCalledWith('2026-05-18')
    })

    expect(result.current.data.todayTotal).toBe(0)
    expect(result.current.data.todayStats).toEqual([])
  })

  it('writes a new completed session to the session start local date key', async () => {
    vi.setSystemTime(new Date(2026, 4, 18, 8, 0, 0))
    mocks.pomodoroGetDailyTotal.mockImplementation(async (date: string) => (
      date === '2026-05-18' ? 25 : 0
    ))

    const { result } = renderPomodoroHook()
    await flushAsyncWork()

    await act(async () => {
      result.current.actions.toggleTimer()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000)
    })
    await flushAsyncWork()

    expect(mocks.pomodoroAddSession).toHaveBeenCalledWith(expect.objectContaining({
      subject_id: null,
      duration: 25,
      date_key: '2026-05-18',
      started_at: expect.stringMatching(/^2026-05-18 /),
      completed_at: expect.stringMatching(/^2026-05-18 /),
    }))
    expect(mocks.pomodoroAddSession).not.toHaveBeenCalledWith(expect.objectContaining({
      date_key: '2026-05-17',
    }))
  })

  it('refreshes today total when the app stays open across local midnight', async () => {
    vi.setSystemTime(new Date(2026, 4, 17, 23, 55, 0))
    mocks.pomodoroGetStats.mockImplementation(async (date: string) => (
      date === '2026-05-17' ? TODAY_STATS : []
    ))
    mocks.pomodoroGetDailyTotal.mockImplementation(async (date: string) => (
      date === '2026-05-17' ? 25 : 0
    ))

    const { result } = renderPomodoroHook()
    await flushAsyncWork()
    expect(result.current.data.todayTotal).toBe(25)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
    })
    await flushAsyncWork()

    expect(mocks.pomodoroGetDailyTotal).toHaveBeenCalledWith('2026-05-18')
    expect(result.current.data.todayTotal).toBe(0)
  })
})
