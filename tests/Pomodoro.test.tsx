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

  it('renders the core pomodoro UI in full page view', async () => {
    await act(async () => {
      render(
        <PomodoroProvider>
          <Pomodoro isWidget={false} onExpand={() => {}} isCollapsed={false} />
        </PomodoroProvider>
      )
    })
    
    // Should display modes via testid
    expect(screen.getByTestId('pomodoro-mode-work')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-mode-short_break')).toBeInTheDocument()
    expect(screen.getByTestId('pomodoro-mode-long_break')).toBeInTheDocument()

    // Should display initial time (25:00)
    expect(screen.getByText('25:00')).toBeInTheDocument()
    expect(screen.getByText('准备就绪')).toBeInTheDocument()

    // Start button
    expect(screen.getByTestId('pomodoro-start-btn')).toBeInTheDocument()
  })

  it('renders the mini widget correctly', async () => {
    await act(async () => {
      render(
        <PomodoroProvider>
          <Pomodoro isWidget={true} isCollapsed={false} onExpand={() => {}} />
        </PomodoroProvider>
      )
    })
    
    // Mini widget should still show time
    expect(screen.getByTestId('pomodoro-widget')).toBeInTheDocument()
    expect(screen.getByText('25:00')).toBeInTheDocument()
    
    // Should have draggable title
    expect(screen.getByTitle('拖拽移动 · 点击打开番茄钟')).toBeInTheDocument()
  })

  it('starts the timer when play is clicked', async () => {
    await act(async () => {
      render(
        <PomodoroProvider>
          <Pomodoro isWidget={false} onExpand={() => {}} isCollapsed={false} />
        </PomodoroProvider>
      )
    })

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
    await act(async () => {
      render(
        <PomodoroProvider>
          <Pomodoro isWidget={false} onExpand={() => {}} isCollapsed={false} />
        </PomodoroProvider>
      )
    })

    const shortBreakBtn = screen.getByTestId('pomodoro-mode-short_break')
    fireEvent.click(shortBreakBtn)

    expect(screen.getByText('05:00')).toBeInTheDocument()

    const longBreakBtn = screen.getByTestId('pomodoro-mode-long_break')
    fireEvent.click(longBreakBtn)

    expect(screen.getByText('15:00')).toBeInTheDocument()
  })
})
