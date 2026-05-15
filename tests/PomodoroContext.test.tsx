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

    expect(mocks.pomodoroAddSession).toHaveBeenCalledWith({
      subject_id: null,
      duration: 25,
    })
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
})
