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
  let statusCallback: (status: unknown) => void = () => {}

  beforeEach(() => {
    statusCallback = () => {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = {
      ...((window as any).api),
      updater: {
        check: vi.fn().mockResolvedValue({ success: true }),
        install: vi.fn().mockResolvedValue(undefined),
        onStatusChange: vi.fn((cb: (status: unknown) => void) => {
          statusCallback = cb
          return vi.fn()
        }),
      },
      settings: {
        selectBackupFolder: vi.fn().mockResolvedValue('D:\\NewBackupPath')
      },
    }

    // Mock getStatus on the window object
    ;(window as any).api.updater.getStatus = vi.fn().mockResolvedValue({ status: 'idle' })

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
        focusGuardEnabled: false,
        focusGuardIntervalSec: 5,
        focusWhitelist: [],
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

  it('renders and saves focus mode whitelist settings', async () => {
    vi.useFakeTimers()
    await act(async () => {
      render(<Settings />)
    })

    expect(screen.getByText('专注模式')).toBeInTheDocument()
    expect(screen.getByText(/当前没有白名单/)).toBeInTheDocument()

    settingsApi.updateGeneral.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('启用专注白名单提醒'))
      fireEvent.change(screen.getByLabelText('检测间隔（秒）'), { target: { value: '10' } })
      fireEvent.change(screen.getByLabelText('应用名称或进程名'), { target: { value: 'chrome.exe' } })
      fireEvent.click(screen.getByRole('button', { name: '手动添加' }))
    })

    expect(screen.getAllByText('chrome.exe').length).toBeGreaterThan(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(settingsApi.updateGeneral).toHaveBeenCalledWith(
      expect.objectContaining({
        focusGuardEnabled: true,
        focusGuardIntervalSec: 10,
        focusWhitelist: expect.arrayContaining([
          expect.objectContaining({
            name: 'chrome.exe',
            processName: 'chrome.exe',
            enabled: true,
          }),
        ]),
      }),
    )

    settingsApi.updateGeneral.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除 chrome.exe' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    const calls = settingsApi.updateGeneral.mock.calls
    const lastPatch = calls[calls.length - 1]?.[0]
    expect(lastPatch?.focusWhitelist).toEqual([])
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

  it('renames the primary target and preserves the title through date and ordinary-event changes', async () => {
    vi.useFakeTimers()
    await act(async () => {
      render(<Settings />)
    })

    const primaryTitle = screen.getByLabelText('主目标名称')
    expect(primaryTitle).toHaveValue('考研初试')
    settingsApi.updateGeneral.mockClear()

    await act(async () => {
      fireEvent.change(primaryTitle, { target: { value: '  公务员考试  ' } })
      fireEvent.blur(primaryTitle)
      fireEvent.change(screen.getByLabelText('主目标日期'), { target: { value: '2027-01-10' } })
      await vi.advanceTimersByTimeAsync(500)
    })

    let calls = settingsApi.updateGeneral.mock.calls
    let lastPatch = calls[calls.length - 1]?.[0]
    expect(lastPatch).toEqual(expect.objectContaining({
      examDate: '2027-01-10',
      countdownEvents: expect.arrayContaining([
        expect.objectContaining({
          id: 'default-exam',
          title: '公务员考试',
          date: '2027-01-10',
          type: 'exam',
        }),
      ]),
    }))
    expect(screen.getByRole('button', { name: '删除 公务员考试' })).toBeDisabled()

    settingsApi.updateGeneral.mockClear()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('关键日期标题'), { target: { value: '论文提交' } })
      fireEvent.change(screen.getByLabelText('关键日期日期'), { target: { value: '2026-11-01' } })
      fireEvent.click(screen.getByRole('button', { name: /添加日期/ }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    calls = settingsApi.updateGeneral.mock.calls
    lastPatch = calls[calls.length - 1]?.[0]
    expect(lastPatch?.countdownEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'default-exam', title: '公务员考试', date: '2027-01-10' }),
      expect.objectContaining({ title: '论文提交', date: '2026-11-01' }),
    ]))
  })

  it('rejects empty, whitespace-only, and overlong primary target titles before saving', async () => {
    vi.useFakeTimers()
    await act(async () => {
      render(<Settings />)
    })
    settingsApi.updateGeneral.mockClear()

    const primaryTitle = screen.getByLabelText('主目标名称')
    for (const invalidTitle of ['', '   ', '目'.repeat(41)]) {
      await act(async () => {
        fireEvent.change(primaryTitle, { target: { value: invalidTitle } })
      })
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /保存设置/ })).toBeDisabled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(settingsApi.updateGeneral).not.toHaveBeenCalled()
    }
  })

  it('resets an invalid primary title draft without briefly enabling stale settings', async () => {
    await act(async () => {
      render(<Settings />)
    })
    const primaryTitle = screen.getByLabelText('主目标名称')
    fireEvent.change(primaryTitle, { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('主目标名称不能为空')
    expect(screen.getByRole('button', { name: /保存设置/ })).toBeDisabled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重置' }))
    })

    expect(primaryTitle).toHaveValue('考研初试')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保存设置/ })).toBeEnabled()
  })

  // ==================== Update Status Tests ====================

  it('subscribes to onStatusChange on mount', async () => {
    await act(async () => {
      render(<Settings />)
    })
    expect((window as any).api.updater.onStatusChange).toHaveBeenCalledTimes(1)
  })

  it('calls getStatus on mount to initialize cached status', async () => {
    (window as any).api.updater.getStatus.mockResolvedValueOnce({ status: 'downloaded', version: '1.9.0' })
    await act(async () => {
      render(<Settings />)
    })
    
    // It should fetch initial status and show restart button
    const installBtn = await screen.findByTestId('update-install-btn')
    expect(installBtn).toBeInTheDocument()
    expect(installBtn.textContent).toContain('1.9.0')
  })

  it('cleans up updater subscription on unmount', async () => {
    const mockCleanup = vi.fn()
    ;(window as any).api.updater.onStatusChange.mockReturnValueOnce(mockCleanup)

    let unmount: () => void
    await act(async () => {
      const res = render(<Settings />)
      unmount = res.unmount
    })

    unmount!()
    expect(mockCleanup).toHaveBeenCalledTimes(1)
  })

  it('calls updater.check when check button is clicked', async () => {
    await act(async () => {
      render(<Settings />)
    })
    const btn = screen.getByTestId('update-check-btn')
    await act(async () => {
      fireEvent.click(btn)
    })
    expect((window as any).api.updater.check).toHaveBeenCalledTimes(1)
  })

  it('shows "\u5df2\u662f\u6700\u65b0\u7248\u672c" on not-available status', async () => {
    await act(async () => {
      render(<Settings />)
    })
    // Initially no status line
    expect(screen.queryByTestId('update-status')).not.toBeInTheDocument()

    await act(async () => {
      statusCallback({ status: 'not-available' })
    })
    expect(screen.getByText('已是最新版本')).toBeInTheDocument()
  })

  it('shows the bundled current release notes and v1.17.0 in browser fallback', async () => {
    ;(window as any).api = undefined
    await act(async () => {
      render(<Settings />)
    })

    expect(screen.getByText('当前版本：')).toBeInTheDocument()
    expect(screen.getByText('v1.17.0')).toBeInTheDocument()
    expect(screen.getByTestId('current-release-notes')).toHaveTextContent('今日任务')
    expect(screen.getByTestId('current-release-notes')).toHaveTextContent('Windows 自动更新完整 E2E 仍待后续验收')
  })

  it('shows remote release notes and release date when an update is available', async () => {
    await act(async () => {
      render(<Settings />)
    })
    await act(async () => {
      statusCallback({
        status: 'available',
        version: '1.12.0',
        releaseNotes: 'Added a safer update summary.',
        releaseDate: '2026-06-20T08:00:00.000Z',
      })
    })

    const notes = screen.getByTestId('remote-release-notes')
    expect(notes).toHaveTextContent('最新版本：v1.12.0')
    expect(notes).toHaveTextContent('Added a safer update summary.')
    expect(notes).toHaveTextContent('发布时间：')
  })

  it('falls back safely when remote release notes are missing', async () => {
    await act(async () => {
      render(<Settings />)
    })
    await act(async () => {
      statusCallback({ status: 'available', version: '1.12.0' })
    })

    expect(screen.getByText('暂时无法获取更新日志')).toBeInTheDocument()
  })

  it('renders remote release note HTML as inert text', async () => {
    await act(async () => {
      render(<Settings />)
    })
    await act(async () => {
      statusCallback({ status: 'available', version: '1.12.0', releaseNotes: '<img src=x onerror=alert(1)>' })
    })

    const notes = screen.getByTestId('remote-release-notes')
    expect(notes).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(notes.querySelector('img')).toBeNull()
  })

  it('shows download progress bar', async () => {
    await act(async () => {
      render(<Settings />)
    })
    await act(async () => {
      statusCallback({ status: 'downloading', percent: 43, bytesPerSecond: 1258291, transferred: 5000000, total: 12000000 })
    })
    expect(screen.getByText(/43%/)).toBeInTheDocument()
    expect(screen.getByTestId('update-progress-bar')).toBeInTheDocument()
    expect(screen.getByText('1.2 MB/s')).toBeInTheDocument()
  })

  it('shows "\u91cd\u542f\u5b89\u88c5" button on downloaded status', async () => {
    await act(async () => {
      render(<Settings />)
    })
    await act(async () => {
      statusCallback({ status: 'downloaded', version: '1.9.0' })
    })
    const installBtn = screen.getByTestId('update-install-btn')
    expect(installBtn).toBeInTheDocument()
    expect(installBtn.textContent).toContain('重启安装')
    expect(installBtn.textContent).toContain('1.9.0')
  })

  it('calls updater.install when restart button is clicked', async () => {
    await act(async () => {
      render(<Settings />)
    })
    await act(async () => {
      statusCallback({ status: 'downloaded', version: '1.9.0' })
    })
    const installBtn = screen.getByTestId('update-install-btn')
    await act(async () => {
      fireEvent.click(installBtn)
    })
    expect((window as any).api.updater.install).toHaveBeenCalledTimes(1)
  })

  it('shows error message on error status', async () => {
    await act(async () => {
      render(<Settings />)
    })
    await act(async () => {
      statusCallback({ status: 'error', message: '网络连接失败' })
    })
    expect(screen.getByText('网络连接失败')).toBeInTheDocument()
    expect(screen.getByTestId('current-release-notes')).toBeInTheDocument()
    // Button should show "\u91cd\u8bd5" text
    const btn = screen.getByTestId('update-check-btn')
    expect(btn.textContent).toContain('重\u8bd5')
  })
})
