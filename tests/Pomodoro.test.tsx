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
})
