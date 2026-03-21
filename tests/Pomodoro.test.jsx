import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import Pomodoro from '../src/components/Pomodoro'
import { PomodoroProvider } from '../src/contexts/PomodoroContext'
import * as DiaryContextModule from '../src/contexts/DiaryContext'

// Mock useDiary to return dummy APIs for the PomodoroProvider
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

describe('Pomodoro Component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    
    // Default mock implementation
    DiaryContextModule.useDiary.mockReturnValue({
      settingsData: { pomodoroMinutes: 25 },
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

  it('renders the core pomodoro UI in full page view', () => {
    render(
      <PomodoroProvider>
        <Pomodoro isWidget={false} />
      </PomodoroProvider>
    )
    
    // Should display modes
    expect(screen.getByText('专注')).toBeInTheDocument()
    expect(screen.getByText('短休')).toBeInTheDocument()
    expect(screen.getByText('长休')).toBeInTheDocument()

    // Should display initial time (25:00)
    expect(screen.getByText('25:00')).toBeInTheDocument()
    expect(screen.getByText('准备就绪')).toBeInTheDocument()

    // Start button
    expect(screen.getByText(/开始专注/)).toBeInTheDocument()
  })

  it('renders the mini widget correctly', () => {
    render(
      <PomodoroProvider>
        <Pomodoro isWidget={true} isCollapsed={false} />
      </PomodoroProvider>
    )
    
    // Mini widget should still show time
    expect(screen.getByText('25:00')).toBeInTheDocument()
    
    // Should have dragged title
    expect(screen.getByTitle('拖拽移动 · 点击打开番茄钟')).toBeInTheDocument()
  })

  it('starts the timer when play is clicked', async () => {
    render(
      <PomodoroProvider>
        <Pomodoro isWidget={false} />
      </PomodoroProvider>
    )

    const startBtn = screen.getByText(/开始专注/)
    fireEvent.click(startBtn)

    // Ensure state updates before advancing timers
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    // Text should change from 25:00 to 24:59
    expect(screen.getByText('24:59')).toBeInTheDocument()
    expect(screen.getByText('正在进行中...')).toBeInTheDocument()
    
    // Button changes to 暂停
    expect(screen.getByText(/暂停/)).toBeInTheDocument()
  })

  it('can switch to break modes and time updates', async () => {
    render(
      <PomodoroProvider>
        <Pomodoro isWidget={false} />
      </PomodoroProvider>
    )

    const shortBreakBtn = screen.getByText('短休')
    fireEvent.click(shortBreakBtn)

    // Should display short break time (5:00)
    expect(screen.getByText('05:00')).toBeInTheDocument()

    const longBreakBtn = screen.getByText('长休')
    fireEvent.click(longBreakBtn)

    // Should display long break time (15:00)
    expect(screen.getByText('15:00')).toBeInTheDocument()
  })
})
