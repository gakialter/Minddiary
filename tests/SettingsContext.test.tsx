import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockSettings, STORAGE_KEYS } from '../src/data/mockData'
import type { AppSettings } from '../src/types'
import type { ElectronSettingsAPI, SanitizedSettings } from '../src/types/api'
import { DEFAULT_EXAM_EVENT_ID } from '../src/utils/countdown'

const mocks = vi.hoisted(() => ({
  isElectron: true,
  loggerError: vi.fn(),
  matchMediaMatches: false,
  matchMediaListeners: new Set<EventListenerOrEventListenerObject>(),
}))

vi.mock('../src/utils/apiAdapter', () => ({
  get IS_ELECTRON() {
    return mocks.isElectron
  },
}))

vi.mock('../src/utils/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}))

import { SettingsProvider, useSettings } from '../src/contexts/SettingsContext'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string): MediaQueryList => ({
    matches: mocks.matchMediaMatches,
    media: query,
    onchange: null,
    addEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === 'change') mocks.matchMediaListeners.add(listener)
    }),
    removeEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === 'change') mocks.matchMediaListeners.delete(listener)
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList),
})

const settingsFrom = (overrides: Partial<AppSettings> = {}): SanitizedSettings => (
  { ...mockSettings, ...overrides } as unknown as SanitizedSettings
)

const createSettingsApiMock = (): ElectronSettingsAPI => ({
  getAll: vi.fn<ElectronSettingsAPI['getAll']>().mockResolvedValue(settingsFrom()),
  updateGeneral: vi.fn<ElectronSettingsAPI['updateGeneral']>().mockResolvedValue({ success: true }),
  updateAI: vi.fn<ElectronSettingsAPI['updateAI']>().mockResolvedValue({ success: true }),
  updateBackup: vi.fn<ElectronSettingsAPI['updateBackup']>().mockResolvedValue({ success: true }),
  selectBackupFolder: vi.fn<ElectronSettingsAPI['selectBackupFolder']>().mockResolvedValue(null),
  selectBackupFile: vi.fn<ElectronSettingsAPI['selectBackupFile']>().mockResolvedValue(null),
  restoreBackupFromZip: vi.fn<ElectronSettingsAPI['restoreBackupFromZip']>().mockResolvedValue({ success: false }),
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
)

const renderSettingsHook = () => renderHook(() => useSettings(), { wrapper })

const dispatchSystemThemeChange = (matches: boolean) => {
  mocks.matchMediaMatches = matches
  const event = { matches, media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent
  mocks.matchMediaListeners.forEach(listener => {
    if (typeof listener === 'function') {
      listener(event)
    } else {
      listener.handleEvent(event)
    }
  })
}

beforeEach(() => {
  mocks.isElectron = true
  mocks.matchMediaMatches = false
  mocks.matchMediaListeners.clear()
  localStorage.clear()
  window.api.settings = createSettingsApiMock()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SettingsContext', () => {
  it('throws when useSettings is rendered without SettingsProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const suppressWindowError = (event: ErrorEvent) => event.preventDefault()

    window.addEventListener('error', suppressWindowError)
    try {
      expect(() => renderHook(() => useSettings())).toThrow(
        'useSettings must be used within SettingsProvider',
      )
    } finally {
      window.removeEventListener('error', suppressWindowError)
    }
    expect(consoleError).toHaveBeenCalled()
  })

  it('initializes settings from window.api.settings in Electron', async () => {
    mocks.isElectron = true
    vi.mocked(window.api.settings.getAll).mockResolvedValue(settingsFrom({
      theme: 'dark',
      dailyGoal: 12,
    }))

    const { result } = renderSettingsHook()

    expect(window.api.settings.getAll).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(result.current.settingsReady).toBe(true)
    })

    expect(result.current.settingsData).toEqual(expect.objectContaining({
      theme: 'dark',
      dailyGoal: 12,
    }))
  })

  it('initializes browser settings from localStorage and writes defaults when storage is empty', async () => {
    mocks.isElectron = false
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    const { result } = renderSettingsHook()

    await waitFor(() => {
      expect(result.current.settingsReady).toBe(true)
    })

    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.SETTINGS)
    expect(window.api.settings.getAll).not.toHaveBeenCalled()
    expect(setItemSpy).toHaveBeenCalledWith(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify(mockSettings),
    )
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).toBe(JSON.stringify(mockSettings))
  })

  it('migrates legacy browser examDate-only settings to the default primary event', async () => {
    mocks.isElectron = false
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({
      examDate: '2027-02-20',
      theme: 'light',
    }))

    const { result } = renderSettingsHook()
    await waitFor(() => expect(result.current.settingsReady).toBe(true))

    expect(result.current.settingsData.examDate).toBe('2027-02-20')
    expect(result.current.settingsData.countdownEvents).toEqual([
      expect.objectContaining({
        id: DEFAULT_EXAM_EVENT_ID,
        title: '考研初试',
        date: '2027-02-20',
      }),
    ])
  })

  it('keeps a custom primary title and mirrors its date when legacy examDate is missing', async () => {
    mocks.isElectron = false
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({
      countdownEvents: [
        {
          id: DEFAULT_EXAM_EVENT_ID,
          title: '论文提交',
          date: '2027-03-15',
          type: 'exam',
          pinned: true,
          archived: false,
        },
      ],
    }))

    const { result } = renderSettingsHook()
    await waitFor(() => expect(result.current.settingsReady).toBe(true))

    expect(result.current.settingsData.examDate).toBe('2027-03-15')
    expect(result.current.settingsData.countdownEvents?.[0]).toEqual(expect.objectContaining({
      title: '论文提交',
      date: '2027-03-15',
      pinned: true,
      archived: false,
    }))

    await act(async () => {
      await result.current.settings.updateGeneral({
        countdownEvents: [
          {
            id: 'registration',
            title: '报名截止',
            date: '2027-02-01',
            type: 'deadline',
          },
        ],
      })
    })
    expect(result.current.settingsData.examDate).toBe('2027-03-15')
    expect(result.current.settingsData.countdownEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: DEFAULT_EXAM_EVENT_ID,
        title: '论文提交',
        date: '2027-03-15',
        pinned: true,
        archived: false,
      }),
      expect.objectContaining({ id: 'registration', title: '报名截止' }),
    ]))
  })

  it('persists a renamed primary target across browser provider reloads', async () => {
    mocks.isElectron = false
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(mockSettings))
    const first = renderSettingsHook()
    await waitFor(() => expect(first.result.current.settingsReady).toBe(true))

    await act(async () => {
      await first.result.current.settings.updateGeneral({
        examDate: '2027-04-01',
        countdownEvents: [
          {
            id: DEFAULT_EXAM_EVENT_ID,
            title: '教师资格证',
            date: '2027-04-01',
            type: 'exam',
            pinned: true,
          },
        ],
      })
    })
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}').countdownEvents[0].title)
        .toBe('教师资格证')
    })
    first.unmount()

    const second = renderSettingsHook()
    await waitFor(() => expect(second.result.current.settingsReady).toBe(true))
    expect(second.result.current.settingsData.examDate).toBe('2027-04-01')
    expect(second.result.current.settingsData.countdownEvents?.[0]).toEqual(expect.objectContaining({
      title: '教师资格证',
      date: '2027-04-01',
    }))
  })

  it('recovers malformed browser settings without blocking initialization', async () => {
    mocks.isElectron = false
    localStorage.setItem(STORAGE_KEYS.SETTINGS, '{not-json')

    const { result } = renderSettingsHook()
    await waitFor(() => expect(result.current.settingsReady).toBe(true))

    expect(mocks.loggerError).toHaveBeenCalledWith('[SettingsContext] Ignored malformed browser settings')
    expect(result.current.settingsData.countdownEvents).toEqual([
      expect.objectContaining({
        id: DEFAULT_EXAM_EVENT_ID,
        title: '考研初试',
      }),
    ])
  })

  it('rejects an invalid primary title before calling the Electron settings API', async () => {
    const { result } = renderSettingsHook()
    await waitFor(() => expect(result.current.settingsReady).toBe(true))

    await expect(result.current.settings.updateGeneral({
      examDate: '2027-05-01',
      countdownEvents: [
        {
          id: DEFAULT_EXAM_EVENT_ID,
          title: '   ',
          date: '2027-05-01',
          type: 'exam',
        },
      ],
    })).rejects.toThrow('主目标名称不能为空')
    await expect(result.current.settings.updateGeneral({
      examDate: '2027-02-30',
    })).rejects.toThrow('Invalid examDate: expected a valid YYYY-MM-DD date')
    await expect(result.current.settings.updateGeneral({
      examDate: '2027-05-01',
      countdownEvents: [
        {
          id: DEFAULT_EXAM_EVENT_ID,
          title: '教师资格证',
          date: '2027-05-01',
          type: 'exam',
        },
        {
          id: DEFAULT_EXAM_EVENT_ID,
          title: '   ',
          date: '2027-05-01',
          type: 'exam',
        },
      ],
    })).rejects.toThrow('主目标名称不能为空')
    expect(window.api.settings.updateGeneral).not.toHaveBeenCalled()
  })

  it('computes isDarkMode as true when theme is dark', async () => {
    vi.mocked(window.api.settings.getAll).mockResolvedValue(settingsFrom({ theme: 'dark' }))

    const { result } = renderSettingsHook()

    await waitFor(() => {
      expect(result.current.settingsReady).toBe(true)
    })

    expect(result.current.theme).toBe('dark')
    expect(result.current.isDarkMode).toBe(true)
  })

  it('computes isDarkMode as false when theme is light', async () => {
    mocks.matchMediaMatches = true
    vi.mocked(window.api.settings.getAll).mockResolvedValue(settingsFrom({ theme: 'light' }))

    const { result } = renderSettingsHook()

    await waitFor(() => {
      expect(result.current.settingsReady).toBe(true)
    })

    expect(result.current.theme).toBe('light')
    expect(result.current.isDarkMode).toBe(false)
  })

  it.each(['auto', 'system'])(
    'computes isDarkMode as true when theme is %s and system dark mode matches',
    async theme => {
      mocks.matchMediaMatches = true
      vi.mocked(window.api.settings.getAll).mockResolvedValue(settingsFrom({ theme }))

      const { result } = renderSettingsHook()

      await waitFor(() => {
        expect(result.current.settingsReady).toBe(true)
      })

      expect(result.current.theme).toBe('system')
      expect(result.current.settingsData.theme).toBe('system')
      expect(result.current.isDarkMode).toBe(true)
    },
  )

  it('updates system theme mode when prefers-color-scheme changes', async () => {
    mocks.matchMediaMatches = false
    vi.mocked(window.api.settings.getAll).mockResolvedValue(settingsFrom({ theme: 'system' }))

    const { result } = renderSettingsHook()

    await waitFor(() => {
      expect(result.current.settingsReady).toBe(true)
    })

    expect(result.current.theme).toBe('system')
    expect(result.current.isDarkMode).toBe(false)

    await act(async () => {
      dispatchSystemThemeChange(true)
    })

    expect(result.current.isDarkMode).toBe(true)

    await act(async () => {
      dispatchSystemThemeChange(false)
    })

    expect(result.current.isDarkMode).toBe(false)
  })

  it('updates general settings when changeTheme is called', async () => {
    vi.mocked(window.api.settings.getAll).mockResolvedValue(settingsFrom({ theme: 'dark' }))

    const { result } = renderSettingsHook()

    await waitFor(() => {
      expect(result.current.settingsReady).toBe(true)
    })

    await act(async () => {
      await result.current.changeTheme('light')
    })

    expect(window.api.settings.updateGeneral).toHaveBeenCalledWith({ theme: 'light' })
    expect(result.current.settingsData.theme).toBe('light')
    expect(result.current.isDarkMode).toBe(false)
  })

  it('updates AI settings through Electron API and reflects API key state locally', async () => {
    mocks.isElectron = true
    vi.mocked(window.api.settings.getAll).mockResolvedValue(settingsFrom({
      aiEndpoint: 'old-url',
      aiApiKeyMasked: null,
      aiApiKeyPresent: false,
    }))

    const { result } = renderSettingsHook()

    await waitFor(() => {
      expect(result.current.settingsReady).toBe(true)
    })

    await act(async () => {
      await result.current.settings.updateAI({
        aiEndpoint: 'new-url',
        aiApiKey: 'test-key',
      })
    })

    expect(window.api.settings.updateAI).toHaveBeenCalledWith({
      aiEndpoint: 'new-url',
      aiApiKey: 'test-key',
    })
    expect(result.current.settingsData.aiEndpoint).toBe('new-url')
    expect(result.current.settingsData.aiApiKeyPresent).toBe(true)
    expect(result.current.settingsData.aiApiKeyMasked).toBe('********')

    await act(async () => {
      await result.current.settings.updateAI({ clearAiApiKey: true })
    })

    expect(window.api.settings.updateAI).toHaveBeenLastCalledWith({ clearAiApiKey: true })
    expect(result.current.settingsData.aiApiKeyPresent).toBe(false)
    expect(result.current.settingsData.aiApiKeyMasked).toBeNull()
  })
})
