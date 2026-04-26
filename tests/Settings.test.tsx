import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import Settings from '../src/components/Settings'
import * as DiaryContextModule from '../src/contexts/DiaryContext'

// Mock useDiary
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

const mockUseDiary = DiaryContextModule.useDiary as ReturnType<typeof vi.fn>

describe('Settings Component', () => {
  let settingsApi: {
    getAll: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    setAll: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    // Add missing mocks to global.window.api for Settings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = {
      ...((window as any).api),
      updater: {
        check: vi.fn().mockResolvedValue({ success: true })
      },
      settings: {
        selectBackupFolder: vi.fn().mockResolvedValue('D:\\NewBackupPath')
      },
    }

    settingsApi = {
      getAll: vi.fn().mockResolvedValue({
        examDate: '2026-12-25',
        aiEndpoint: 'https://api.mock.com',
        aiApiKey: 'sk-mock',
        aiModel: 'gpt-4',
        autoSave: false,
        pomodoroMinutes: 30,
        autoBackup: true,
        backupPath: 'C:\\Backups'
      }),
      update: vi.fn().mockResolvedValue(true),
      setAll: vi.fn().mockResolvedValue({ success: true })
    }

    mockUseDiary.mockReturnValue({
      settings: settingsApi,
      theme: 'system',
      changeTheme: vi.fn(),
      // Mocks for exportData
      entries: { getAll: vi.fn().mockResolvedValue([]) },
      tags: { getAll: vi.fn().mockResolvedValue([]) },
      subjects: { getAll: vi.fn().mockResolvedValue([]) },
      mistakes: { getAll: vi.fn().mockResolvedValue([]) },
      pomodoro: { getRange: vi.fn().mockResolvedValue([]) },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('loads and displays settings from API', async () => {
    await act(async () => {
      render(<Settings />)
    })

    // Check if values are populated
    expect(screen.getByDisplayValue('2026-12-25')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://api.mock.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('sk-mock')).toBeInTheDocument()
    expect(screen.getByDisplayValue('30')).toBeInTheDocument() // Pomodoro minutes
    expect(screen.getByDisplayValue('C:\\Backups')).toBeInTheDocument()

    // Check checkboxes — order in DOM:
    // [0] pomodoroSound (default true), [1] pomodoroAlert (default true)
    // [2] autoSave (false per mock),    [3] autoBackup (true per mock)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toBeChecked()      // pomodoroSound = default true
    expect(checkboxes[1]).toBeChecked()      // pomodoroAlert = default true
    expect(checkboxes[2]).not.toBeChecked()  // autoSave = false per mock
    expect(checkboxes[3]).toBeChecked()      // autoBackup = true per mock
  })

  it('debounces auto-saving when a setting changes', async () => {
    vi.useFakeTimers()
    await act(async () => {
      render(<Settings />)
    })

    // Change Pomodoro minutes
    const pomodoroInput = screen.getByDisplayValue('30')
    
    await act(async () => {
      fireEvent.change(pomodoroInput, { target: { value: '45' } })
    })

    // Shouldn't save immediately
    expect(settingsApi.setAll).not.toHaveBeenCalled()

    // Advance timers by 500ms (debounce time)
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    // Now it should save via batched setAll
    expect(settingsApi.setAll).toHaveBeenCalled()
  })

  it('allows manual save via button', async () => {
    await act(async () => {
      render(<Settings />)
    })

    const saveBtn = screen.getByText('保存设置')
    
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(settingsApi.setAll).toHaveBeenCalled()
  })
})
