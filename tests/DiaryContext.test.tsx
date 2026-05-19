import { render, renderHook } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../src/types'

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  useData: vi.fn(),
}))

vi.mock('../src/contexts/SettingsContext', () => ({
  SettingsProvider: ({ children }: { children: ReactNode }) => children,
  useSettings: mocks.useSettings,
}))

vi.mock('../src/contexts/DataContext', () => ({
  DataProvider: ({ children }: { children: ReactNode }) => children,
  useData: mocks.useData,
}))

import { DiaryProvider, useDiary } from '../src/contexts/DiaryContext'
import { useData } from '../src/contexts/DataContext'
import { useSettings } from '../src/contexts/SettingsContext'

type SettingsValue = ReturnType<typeof useSettings>
type DataValue = ReturnType<typeof useData>

const mockSettingsData: AppSettings = {
  theme: 'dark',
  examDate: '2026-12-25',
  dailyGoal: 500,
  autoSave: true,
  notifications: true,
  aiEndpoint: 'https://api.example.test/v1',
  aiModel: 'mock-model',
  pomodoroMinutes: 25,
  focusGuardEnabled: false,
  focusGuardIntervalSec: 5,
  focusWhitelist: [],
  autoBackup: false,
  backupPath: 'C:\\Backups',
  aiApiKeyMasked: null,
  aiApiKeyPresent: false,
}

const makeSettingsValue = (overrides: Partial<SettingsValue> = {}): SettingsValue => ({
  settingsData: mockSettingsData,
  settingsReady: true,
  theme: 'dark',
  isDarkMode: true,
  changeTheme: vi.fn(),
  settings: {
    getAll: vi.fn(),
    updateGeneral: vi.fn(),
    updateAI: vi.fn(),
    updateBackup: vi.fn(),
    selectBackupFolder: vi.fn(),
  },
  ...overrides,
})

const makeDataValue = (overrides: Partial<DataValue> = {}): DataValue => ({
  dataReady: true,
  initErrors: ['mock warning'],
  dataRefreshVersion: 0,
  requestDataRefresh: vi.fn(),
  entries: {
    getAll: vi.fn(),
    getByDate: vi.fn(),
    getById: vi.fn(),
    getDatesWithEntries: vi.fn(),
    search: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tags: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setEntryTags: vi.fn(),
    getEntryTags: vi.fn(),
    getEntryTagsBatch: vi.fn(),
  },
  mistakes: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    toggleMastered: vi.fn(),
    review: vi.fn(),
    getDueCount: vi.fn(),
    getRandomDue: vi.fn(),
  },
  subjects: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  pomodoro: {
    getStats: vi.fn(),
    getRange: vi.fn(),
    addSession: vi.fn(),
    getDailyTotal: vi.fn(),
  },
  dashboard: {
    streak: vi.fn(),
    entryDatesRange: vi.fn(),
  },
  todayDashboard: {
    getData: vi.fn(),
  },
  exportUtil: {
    showSaveDialog: vi.fn(),
    writeFile: vi.fn(),
    toPDF: vi.fn(),
  },
  notification: {
    show: vi.fn(),
  },
  ai: {
    chat: vi.fn(),
  },
  attachments: {
    getByEntry: vi.fn(),
    getByEntries: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  },
  templates: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  ...overrides,
})

const wrapper = ({ children }: { children: ReactNode }) => <DiaryProvider>{children}</DiaryProvider>

class TestErrorBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { error: Error | null }
> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError(error)
  }

  render() {
    return this.state.error ? null : this.props.children
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSettings).mockReturnValue(makeSettingsValue())
  vi.mocked(useData).mockReturnValue(makeDataValue())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DiaryContext', () => {
  it('throws when useDiary is rendered without DiaryProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn()
    const suppressWindowError = (event: ErrorEvent) => event.preventDefault()
    const Consumer = () => {
      useDiary()
      return null
    }

    window.addEventListener('error', suppressWindowError)
    try {
      render(
        <TestErrorBoundary onError={onError}>
          <Consumer />
        </TestErrorBoundary>,
      )
    } finally {
      window.removeEventListener('error', suppressWindowError)
    }

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'useDiary must be used within DiaryProvider' }),
    )
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('bridges settings and data context values through DiaryProvider', () => {
    const settingsValue = makeSettingsValue({
      theme: 'dark',
      settingsData: { ...mockSettingsData, dailyGoal: 800 },
    })
    const dataValue = makeDataValue({
      initErrors: ['data init warning'],
    })
    vi.mocked(useSettings).mockReturnValue(settingsValue)
    vi.mocked(useData).mockReturnValue(dataValue)

    const { result } = renderHook(() => useDiary(), { wrapper })

    expect(result.current.theme).toBe(settingsValue.theme)
    expect(result.current.settingsData).toBe(settingsValue.settingsData)
    expect(result.current.isDarkMode).toBe(settingsValue.isDarkMode)
    expect(result.current.changeTheme).toBe(settingsValue.changeTheme)
    expect(result.current.settings).toBe(settingsValue.settings)
    expect(result.current.entries).toBe(dataValue.entries)
    expect(result.current.tags).toBe(dataValue.tags)
    expect(result.current.mistakes).toBe(dataValue.mistakes)
    expect(result.current.subjects).toBe(dataValue.subjects)
    expect(result.current.initErrors).toBe(dataValue.initErrors)
  })

  it('sets isReady to true when settings and data are both ready', () => {
    vi.mocked(useSettings).mockReturnValue(makeSettingsValue({ settingsReady: true }))
    vi.mocked(useData).mockReturnValue(makeDataValue({ dataReady: true }))

    const { result } = renderHook(() => useDiary(), { wrapper })

    expect(result.current.isReady).toBe(true)
  })

  it('sets isReady to false when settings are not ready', () => {
    vi.mocked(useSettings).mockReturnValue(makeSettingsValue({ settingsReady: false }))
    vi.mocked(useData).mockReturnValue(makeDataValue({ dataReady: true }))

    const { result } = renderHook(() => useDiary(), { wrapper })

    expect(result.current.isReady).toBe(false)
  })

  it('sets isReady to false when data is not ready', () => {
    vi.mocked(useSettings).mockReturnValue(makeSettingsValue({ settingsReady: true }))
    vi.mocked(useData).mockReturnValue(makeDataValue({ dataReady: false }))

    const { result } = renderHook(() => useDiary(), { wrapper })

    expect(result.current.isReady).toBe(false)
  })
})
