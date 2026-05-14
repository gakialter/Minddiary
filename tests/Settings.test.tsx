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
    updateGeneral: ReturnType<typeof vi.fn>
    updateAI: ReturnType<typeof vi.fn>
    updateBackup: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
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
        aiApiKeyMasked: 'sk-***mock',
        aiApiKeyPresent: true,
        aiModel: 'gpt-4',
        autoSave: false,
        pomodoroMinutes: 30,
        autoBackup: true,
        backupPath: 'C:\\Backups',
        pomodoroSound: true,
        pomodoroAlert: true,
        countdownEvents: [
          { id: 'summer', title: '暑假开始', date: '2026-07-01', type: 'holiday' },
        ],
      }),
      updateGeneral: vi.fn().mockResolvedValue({ success: true }),
      updateAI: vi.fn().mockResolvedValue({ success: true }),
      updateBackup: vi.fn().mockResolvedValue({ success: true }),
    }

    mockUseDiary.mockReturnValue({
      settings: settingsApi,
      theme: 'system',
      changeTheme: vi.fn(),
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

  it('loads and displays settings from API (masked key)', async () => {
    await act(async () => {
      render(<Settings />)
    })

    expect(screen.getByDisplayValue('2026-12-25')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://api.mock.com')).toBeInTheDocument()
    // API key is masked per ADR-002 — no plaintext in the DOM
    expect(screen.getByText(/已配置（sk-\*\*\*mock）/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('30')).toBeInTheDocument()
    expect(screen.getByDisplayValue('C:\\Backups')).toBeInTheDocument()

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toBeChecked()      // pomodoroSound = default true
    expect(checkboxes[1]).toBeChecked()      // pomodoroAlert = default true
    expect(checkboxes[2]).not.toBeChecked()  // autoSave = false per mock
    expect(checkboxes[3]).toBeChecked()      // autoBackup = true per mock
  })

  it('debounces auto-saving via patch APIs', async () => {
    vi.useFakeTimers()
    await act(async () => {
      render(<Settings />)
    })

    const pomodoroInput = screen.getByDisplayValue('30')

    await act(async () => {
      fireEvent.change(pomodoroInput, { target: { value: '45' } })
    })

    // Shouldn't save immediately
    expect(settingsApi.updateGeneral).not.toHaveBeenCalled()

    // Advance timers by 500ms (debounce time)
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    // Auto-save fires all three patch APIs
    expect(settingsApi.updateGeneral).toHaveBeenCalledWith(
      expect.objectContaining({ pomodoroMinutes: 45 })
    )
    expect(settingsApi.updateAI).toHaveBeenCalled()
    expect(settingsApi.updateBackup).toHaveBeenCalled()
  })

  it('saves via patch APIs on button click', async () => {
    await act(async () => {
      render(<Settings />)
    })

    const saveBtn = screen.getByText('保存设置')

    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(settingsApi.updateGeneral).toHaveBeenCalled()
    expect(settingsApi.updateAI).toHaveBeenCalled()
    expect(settingsApi.updateBackup).toHaveBeenCalled()
  })

  it('adds, pins, and deletes countdown events in settings', async () => {
    vi.useFakeTimers()
    await act(async () => {
      render(<Settings />)
    })

    expect(screen.getByText('暑假开始')).toBeInTheDocument()
    settingsApi.updateGeneral.mockClear()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('关键日期标题'), { target: { value: '报名开始' } })
      fireEvent.change(screen.getByLabelText('关键日期日期'), { target: { value: '2026-09-01' } })
      fireEvent.change(screen.getByLabelText('关键日期类型'), { target: { value: 'deadline' } })
      fireEvent.click(screen.getByRole('button', { name: /添加日期/ }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(settingsApi.updateGeneral).toHaveBeenCalledWith(
      expect.objectContaining({
        countdownEvents: expect.arrayContaining([
          expect.objectContaining({
            title: '报名开始',
            date: '2026-09-01',
            type: 'deadline',
          }),
        ]),
      }),
    )

    settingsApi.updateGeneral.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '置顶 暑假开始' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(settingsApi.updateGeneral).toHaveBeenCalledWith(
      expect.objectContaining({
        countdownEvents: expect.arrayContaining([
          expect.objectContaining({
            id: 'summer',
            pinned: true,
          }),
        ]),
      }),
    )

    settingsApi.updateGeneral.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除 暑假开始' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    const calls = settingsApi.updateGeneral.mock.calls
    const lastPatch = calls[calls.length - 1]?.[0]
    expect(lastPatch?.countdownEvents.some((event: { id: string }) => event.id === 'summer')).toBe(false)
  })
})
