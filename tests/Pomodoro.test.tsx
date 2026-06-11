import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import Pomodoro from '../src/components/Pomodoro'
import { PomodoroProvider } from '../src/contexts/PomodoroContext'
import * as DiaryContextModule from '../src/contexts/DiaryContext'

// Mock useDiary to return dummy APIs for the PomodoroProvider
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

const mockUseDiary = DiaryContextModule.useDiary as ReturnType<typeof vi.fn>

describe('Pomodoro Component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    window.api.focusGuard.getActiveApp = vi.fn().mockResolvedValue(null)
    window.api.window.setFullScreen = vi.fn().mockResolvedValue(true)
    window.api.window.isFullScreen = vi.fn().mockResolvedValue(false)
    window.api.window.onFullScreenChange = vi.fn().mockReturnValue(() => {})
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      writable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: vi.fn(() => true),
    })
    
    // Default mock implementation
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession: vi.fn().mockResolvedValue(true),
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      }
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const renderPomodoro = async (isWidget = false) => {
    await act(async () => {
      render(
        <PomodoroProvider>
          <Pomodoro isWidget={isWidget} onExpand={() => {}} isCollapsed={false} />
        </PomodoroProvider>
      )
    })
  }

  const flushAsyncWork = async () => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('renders the core pomodoro UI in full page view', async () => {
    await renderPomodoro()
    
    // Should display modes via testid
    expect(screen.getByTestId('pomodoro-mode-work')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-mode-short_break')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-mode-long_break')).toBeInTheDocument()

    // Should display initial time (25:00)
    expect(screen.getByText('25:00')).toBeInTheDocument()
    expect(screen.getByText('准备就绪')).toBeInTheDocument()

    // Start button
    expect(screen.getByTestId('pomodoro-start-btn')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-enter-zen-btn')).toBeInTheDocument()
  })

  it('renders the mini widget correctly', async () => {
    await renderPomodoro(true)
    
    // Mini widget should still show time
    expect(screen.getByTestId('pomodoro-widget')).toBeInTheDocument()
    expect(screen.getByText('25:00')).toBeInTheDocument()
    
    // Should have draggable title
    expect(screen.getByTitle('拖拽移动 · 点击打开番茄钟')).toBeInTheDocument()
    expect(screen.queryByTestId('pomodoro-enter-zen-btn')).not.toBeInTheDocument()
  })

  it('starts the timer when play is clicked', async () => {
    await renderPomodoro()

    const startBtn = screen.getByTestId('pomodoro-start-btn')
    fireEvent.click(startBtn)

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByText('24:59')).toBeInTheDocument()
    expect(screen.getByText('正在进行中...')).toBeInTheDocument()
    
    // Button changes to 暂停
    expect(screen.getByText(/暂停/)).toBeInTheDocument()
  })

  it('can switch to break modes and time updates', async () => {
    await renderPomodoro()

    const shortBreakBtn = screen.getByTestId('pomodoro-mode-short_break')
    fireEvent.click(shortBreakBtn)

    expect(screen.getByText('05:00')).toBeInTheDocument()

    const longBreakBtn = screen.getByTestId('pomodoro-mode-long_break')
    fireEvent.click(longBreakBtn)

    expect(screen.getByText('15:00')).toBeInTheDocument()
  })

  it('labels the idle start button by the current timer mode', async () => {
    await renderPomodoro()

    expect(screen.getByTestId('pomodoro-start-btn')).toHaveTextContent('开始专注')

    fireEvent.click(screen.getByTestId('pomodoro-mode-short_break'))
    expect(screen.getByTestId('pomodoro-start-btn')).toHaveTextContent('开始短休')

    fireEvent.click(screen.getByTestId('pomodoro-mode-long_break'))
    expect(screen.getByTestId('pomodoro-start-btn')).toHaveTextContent('开始长休')

    fireEvent.click(screen.getByTestId('pomodoro-mode-custom'))
    expect(screen.getByTestId('pomodoro-start-btn')).toHaveTextContent('开始计时')
  })

  it('enters Zen mode and requests Electron fullscreen', async () => {
    await renderPomodoro()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })

    expect(screen.getByTestId('focus-zen-mode')).toBeInTheDocument()
    expect(screen.getByTestId('focus-zen-time')).toHaveTextContent('25:00')
    expect(window.api.window.setFullScreen).toHaveBeenCalledWith(true)
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled()
  })

  it('starts the current timer when entering Zen while idle', async () => {
    await renderPomodoro()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId('focus-zen-time')).toHaveTextContent('24:59')
    expect(screen.getAllByText(/暂停/).length).toBeGreaterThan(0)
  })

  it('exits Zen without stopping or resetting the timer', async () => {
    await renderPomodoro()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await act(async () => {
      fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))
      fireEvent.click(screen.getByTestId('focus-zen-exit-btn'))
    })

    expect(screen.queryByTestId('focus-zen-mode')).not.toBeInTheDocument()
    expect(window.api.window.setFullScreen).toHaveBeenLastCalledWith(false)
    expect(screen.getByText('24:59')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByText('24:58')).toBeInTheDocument()
  })

  it('exits Zen with Escape', async () => {
    await renderPomodoro()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    expect(screen.queryByTestId('focus-zen-mode')).not.toBeInTheDocument()
    expect(window.api.window.setFullScreen).toHaveBeenLastCalledWith(false)
  })

  it('falls back to document fullscreen when Electron fullscreen API is unavailable', async () => {
    const electronSetFullScreen = window.api.window.setFullScreen
    delete (window.api.window as Partial<typeof window.api.window>).setFullScreen
    await renderPomodoro()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })

    expect(screen.getByTestId('focus-zen-mode')).toBeInTheDocument()
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled()

    window.api.window.setFullScreen = electronSetFullScreen
  })

  it('auto-exits Zen overlay when timer reaches 0 without resetting', async () => {
    // Use a very short timer (1 minute = 60s) for fast completion
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 1, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession: vi.fn().mockResolvedValue(true),
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })

    await renderPomodoro()

    // Enter Zen mode (also starts the timer)
    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })

    expect(screen.getByTestId('focus-zen-mode')).toBeInTheDocument()

    // Advance timer to just before completion
    await act(async () => {
      vi.advanceTimersByTime(59_000)
    })

    // Zen should still be visible
    expect(screen.getByTestId('focus-zen-mode')).toBeInTheDocument()

    // Advance past the last second so timeLeft reaches 0
    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })

    // Zen overlay should now be gone
    expect(screen.queryByTestId('focus-zen-mode')).not.toBeInTheDocument()

    // Fullscreen was exited
    expect(window.api.window.setFullScreen).toHaveBeenLastCalledWith(false)

    // The reset button should still exist and the timer should NOT have been
    // forcibly reset — the PomodoroContext handles mode transitions on its own
    expect(screen.getByTestId('pomodoro-reset-btn')).toBeInTheDocument()
  })

  it('mode buttons are enabled when work mode is idle', async () => {
    await renderPomodoro()

    expect(screen.getByTestId('pomodoro-mode-short_break')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-long_break')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-custom')).not.toBeDisabled()
  })

  it('disables non-current mode buttons when work timer is running', async () => {
    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId('pomodoro-mode-work')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-short_break')).toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-long_break')).toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-custom')).toBeDisabled()
  })

  it('disables non-current mode buttons when work timer is paused', async () => {
    await renderPomodoro()

    // Start
    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    // Pause
    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))

    expect(screen.getByTestId('pomodoro-mode-short_break')).toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-long_break')).toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-custom')).toBeDisabled()
  })

  it('disables non-current mode buttons when custom timer is running', async () => {
    await renderPomodoro()

    // Switch to custom
    fireEvent.click(screen.getByTestId('pomodoro-mode-custom'))

    // Start custom timer
    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId('pomodoro-mode-custom')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-work')).toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-short_break')).toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-long_break')).toBeDisabled()
  })

  it('re-enables mode buttons after reset', async () => {
    await renderPomodoro()

    // Start and pause
    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId('pomodoro-mode-short_break')).toBeDisabled()

    // Reset
    fireEvent.click(screen.getByTestId('pomodoro-reset-btn'))

    expect(screen.getByTestId('pomodoro-mode-short_break')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-long_break')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-custom')).not.toBeDisabled()
  })

  it('does not disable mode buttons when short_break timer is running', async () => {
    await renderPomodoro()

    // Switch to short break
    fireEvent.click(screen.getByTestId('pomodoro-mode-short_break'))

    // Start short break timer
    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByTestId('pomodoro-mode-work')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-long_break')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-custom')).not.toBeDisabled()
  })

  it('renders stopwatch mode controls and saves after at least one minute', async () => {
    const addSession = vi.fn().mockResolvedValue(true)
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })

    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-mode-stopwatch'))
    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-finish-stopwatch-btn')).toBeDisabled()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(61_000)
    })

    expect(screen.getByText('01:01')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-finish-stopwatch-btn')).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-finish-stopwatch-btn'))
    })

    expect(addSession).toHaveBeenCalledWith(expect.objectContaining({
      duration: 1,
    }))
    expect(screen.getByText('00:00')).toBeInTheDocument()
  })

  it('shows the countdown finish button only for active work/custom countdowns', async () => {
    await renderPomodoro()

    expect(screen.queryByTestId('pomodoro-finish-countdown-btn')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    expect(screen.getByTestId('pomodoro-finish-countdown-btn')).toBeDisabled()

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByTestId('pomodoro-finish-countdown-btn')).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-reset-btn'))
    })
    fireEvent.click(screen.getByTestId('pomodoro-mode-custom'))
    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    expect(screen.getByTestId('pomodoro-finish-countdown-btn')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-reset-btn'))
    })
    fireEvent.click(screen.getByTestId('pomodoro-mode-short_break'))
    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    expect(screen.queryByTestId('pomodoro-finish-countdown-btn')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-reset-btn'))
    })
    fireEvent.click(screen.getByTestId('pomodoro-mode-stopwatch'))
    expect(screen.getByTestId('pomodoro-finish-stopwatch-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('pomodoro-finish-countdown-btn')).not.toBeInTheDocument()
  })

  it('confirms and saves an interrupted countdown once from the full page', async () => {
    const addSession = vi.fn().mockResolvedValue(true)
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })
    const confirmMock = vi.mocked(window.confirm)
    confirmMock.mockReturnValue(true)

    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(65_000)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-finish-countdown-btn'))
      fireEvent.click(screen.getByTestId('pomodoro-finish-countdown-btn'))
    })

    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('1 分 05 秒'))
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('1 分钟计入统计'))
    await flushAsyncWork()
    expect(addSession).toHaveBeenCalledTimes(1)
    expect(addSession).toHaveBeenCalledWith(expect.objectContaining({
      duration: 1,
    }))
    expect(screen.queryByTestId('pomodoro-finish-countdown-btn')).not.toBeInTheDocument()
  })

  it('does not save when interrupted countdown confirmation is cancelled', async () => {
    const addSession = vi.fn().mockResolvedValue(true)
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })
    vi.mocked(window.confirm).mockReturnValue(false)

    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(65_000)
    })
    fireEvent.click(screen.getByTestId('pomodoro-finish-countdown-btn'))

    expect(addSession).not.toHaveBeenCalled()
    expect(screen.getByTestId('pomodoro-finish-countdown-btn')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('23:54')).toBeInTheDocument()
  })

  it('saves an interrupted countdown from Zen and exits fullscreen on success', async () => {
    const addSession = vi.fn().mockResolvedValue(true)
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })
    vi.mocked(window.confirm).mockReturnValue(true)

    await renderPomodoro()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })
    await act(async () => {
      vi.advanceTimersByTime(65_000)
      fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))
    })

    const zenFinishButton = screen.getByTestId('focus-zen-finish-countdown-btn')
    expect(zenFinishButton).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(zenFinishButton)
    })

    await flushAsyncWork()
    expect(addSession).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('focus-zen-mode')).not.toBeInTheDocument()
    expect(window.api.window.setFullScreen).toHaveBeenLastCalledWith(false)
  })

  it('keeps Zen open and retryable when interrupted save fails', async () => {
    const addSession = vi.fn().mockRejectedValue(new Error('insert failed'))
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })
    vi.mocked(window.confirm).mockReturnValue(true)

    await renderPomodoro()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })
    await act(async () => {
      vi.advanceTimersByTime(65_000)
      fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-zen-finish-countdown-btn'))
    })

    await flushAsyncWork()
    expect(addSession).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('focus-zen-mode')).toBeInTheDocument()
    expect(screen.getByTestId('focus-zen-finish-countdown-btn')).not.toBeDisabled()
    expect(window.api.window.setFullScreen).not.toHaveBeenLastCalledWith(false)
  })

  it('does not show the Zen countdown finish button for break or stopwatch modes', async () => {
    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-mode-short_break'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })
    fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))
    expect(screen.queryByTestId('focus-zen-finish-countdown-btn')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    fireEvent.click(screen.getByTestId('pomodoro-mode-stopwatch'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })
    fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))
    expect(screen.queryByTestId('focus-zen-finish-countdown-btn')).not.toBeInTheDocument()
  })

  it('keeps interrupted countdown retryable after save failure', async () => {
    const addSession = vi.fn()
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce(true)
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })
    vi.mocked(window.confirm).mockReturnValue(true)

    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(65_000)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-finish-countdown-btn'))
    })
    await flushAsyncWork()
    expect(addSession).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('pomodoro-finish-countdown-btn')).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-finish-countdown-btn'))
    })
    await flushAsyncWork()
    expect(addSession).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('pomodoro-finish-countdown-btn')).not.toBeInTheDocument()
  })

  it('disables page start and reset controls during interrupted countdown settlement', async () => {
    let rejectAddSession: (reason?: unknown) => void = () => {}
    const addSession = vi.fn()
      .mockReturnValueOnce(new Promise((_, reject) => {
        rejectAddSession = reject
      }))
      .mockResolvedValueOnce(true)
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })
    vi.mocked(window.confirm).mockReturnValue(true)

    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(65_000)
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-finish-countdown-btn'))
      await Promise.resolve()
    })

    expect(screen.getByTestId('pomodoro-start-btn')).toBeDisabled()
    expect(screen.getByTestId('pomodoro-reset-btn')).toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-work')).toBeDisabled()
    expect(screen.getByTestId('pomodoro-finish-countdown-btn')).toBeDisabled()
    expect(screen.getByText('23:55')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    fireEvent.click(screen.getByTestId('pomodoro-reset-btn'))
    fireEvent.click(screen.getByTestId('pomodoro-mode-work'))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('23:55')).toBeInTheDocument()

    await act(async () => {
      rejectAddSession(new Error('insert failed'))
      await Promise.resolve()
    })
    await flushAsyncWork()

    expect(screen.getByTestId('pomodoro-start-btn')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-reset-btn')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-mode-work')).not.toBeDisabled()
    expect(screen.getByTestId('pomodoro-finish-countdown-btn')).not.toBeDisabled()
    expect(screen.getByText('23:55')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-finish-countdown-btn'))
    })
    await flushAsyncWork()

    expect(addSession).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('pomodoro-finish-countdown-btn')).not.toBeInTheDocument()
  })

  it('keeps Zen spacebar from resuming the timer while interrupted save is pending', async () => {
    let rejectAddSession: (reason?: unknown) => void = () => {}
    const addSession = vi.fn().mockReturnValueOnce(new Promise((_, reject) => {
      rejectAddSession = reject
    }))
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })
    vi.mocked(window.confirm).mockReturnValue(true)

    await renderPomodoro()

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-enter-zen-btn'))
    })
    await act(async () => {
      vi.advanceTimersByTime(65_000)
      fireEvent.mouseMove(screen.getByTestId('focus-zen-mode'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-zen-finish-countdown-btn'))
      await Promise.resolve()
    })

    expect(screen.getByTestId('focus-zen-toggle-btn')).toBeDisabled()
    expect(screen.getByTestId('focus-zen-time')).toHaveTextContent('23:55')

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('focus-zen-time')).toHaveTextContent('23:55')

    await act(async () => {
      rejectAddSession(new Error('insert failed'))
      await Promise.resolve()
    })
    await flushAsyncWork()

    expect(screen.getByTestId('focus-zen-mode')).toBeInTheDocument()
    expect(screen.getByTestId('focus-zen-toggle-btn')).not.toBeDisabled()
    expect(screen.getByTestId('focus-zen-finish-countdown-btn')).not.toBeDisabled()
  })

  it('uses the exact countdown elapsed time for interrupted save confirmation when ticks are stale', async () => {
    const addSession = vi.fn().mockResolvedValue(true)
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })
    const confirmMock = vi.mocked(window.confirm)
    confirmMock.mockReturnValue(true)

    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(8 * 60_000)
    })
    expect(screen.getByText('17:00')).toBeInTheDocument()

    vi.setSystemTime(new Date(Date.now() + 2 * 60_000))
    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-finish-countdown-btn'))
    })
    await flushAsyncWork()

    const confirmation = String(confirmMock.mock.calls[confirmMock.mock.calls.length - 1]?.[0] ?? '')
    expect(confirmation).toMatch(/10.*00/)
    expect(confirmation).toMatch(/10.*\S/)
    expect(addSession).toHaveBeenCalledWith(expect.objectContaining({
      duration: 10,
    }))
  })

  it('uses the confirmation preview snapshot for final interrupted save duration and completed time', async () => {
    vi.setSystemTime(new Date(2026, 4, 5, 8, 0, 0))
    const addSession = vi.fn().mockResolvedValue(true)
    mockUseDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25, focusGuardEnabled: false },
      settings: { updateGeneral: vi.fn().mockResolvedValue({ success: true }) },
      subjects: { getAll: vi.fn().mockResolvedValue([{ id: 1, name: 'Math' }]) },
      pomodoro: {
        getStats: vi.fn().mockResolvedValue([]),
        getDailyTotal: vi.fn().mockResolvedValue(0),
        addSession,
      },
      notification: {
        show: vi.fn().mockResolvedValue(true),
      },
    })
    const confirmMock = vi.mocked(window.confirm)
    confirmMock.mockImplementation(() => {
      vi.setSystemTime(new Date(Date.now() + 35_000))
      return true
    })

    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(89_000)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('pomodoro-finish-countdown-btn'))
    })
    await flushAsyncWork()

    const confirmation = String(confirmMock.mock.calls[confirmMock.mock.calls.length - 1]?.[0] ?? '')
    expect(confirmation).toContain('1 分 29 秒')
    expect(confirmation).toContain('1 分钟计入统计')
    expect(addSession).toHaveBeenCalledWith(expect.objectContaining({
      duration: 1,
      completed_at: '2026-05-05 08:01:29',
    }))
  })

  it('warns before resetting an active countdown but resets idle immediately', async () => {
    const confirmMock = vi.mocked(window.confirm)
    await renderPomodoro()

    fireEvent.click(screen.getByTestId('pomodoro-reset-btn'))
    expect(confirmMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('pomodoro-start-btn'))
    await act(async () => {
      vi.advanceTimersByTime(1_000)
    })

    confirmMock.mockReturnValueOnce(false)
    fireEvent.click(screen.getByTestId('pomodoro-reset-btn'))
    expect(confirmMock).toHaveBeenCalledWith('重置将放弃本次尚未保存的专注记录。确定继续吗？')
    expect(screen.getByTestId('pomodoro-finish-countdown-btn')).toBeInTheDocument()
    expect(screen.getByText('24:59')).toBeInTheDocument()

    confirmMock.mockReturnValueOnce(true)
    fireEvent.click(screen.getByTestId('pomodoro-reset-btn'))
    expect(screen.queryByTestId('pomodoro-finish-countdown-btn')).not.toBeInTheDocument()
    expect(screen.getByText('25:00')).toBeInTheDocument()
  })
})
