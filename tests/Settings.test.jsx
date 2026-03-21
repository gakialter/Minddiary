import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import Settings from '../src/components/Settings'
import * as DiaryContextModule from '../src/contexts/DiaryContext'

// Mock useDiary
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

describe('Settings Component', () => {
  let settingsApi

  beforeEach(() => {
    // Add missing mocks to global.window.api for Settings
    global.window.api.updater = {
      check: vi.fn().mockResolvedValue({ success: true })
    }
    
    global.window.api.settings.selectBackupFolder = vi.fn().mockResolvedValue('D:\\NewBackupPath')

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
      update: vi.fn().mockResolvedValue(true)
    }

    DiaryContextModule.useDiary.mockReturnValue({
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
    
    // Check checkboxes
    const checkboxes = screen.getAllByRole('checkbox')
    // autoSave is false, autoBackup is true
    expect(checkboxes[0]).not.toBeChecked() // AutoSave
    expect(checkboxes[1]).toBeChecked() // AutoBackup
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
    expect(settingsApi.update).not.toHaveBeenCalled()

    // Advance timers by 500ms (debounce time)
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    // Now it should save
    expect(settingsApi.update).toHaveBeenCalledWith('pomodoroMinutes', 45)
  })

  it('allows manual save via button', async () => {
    await act(async () => {
      render(<Settings />)
    })

    const saveBtn = screen.getByText('保存设置')
    
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(settingsApi.update).toHaveBeenCalled()
  })
})
