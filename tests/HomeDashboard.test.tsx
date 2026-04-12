import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import HomeDashboard from '../src/components/HomeDashboard'
import * as DiaryContextModule from '../src/contexts/DiaryContext'
import type { TodayDashboardData } from '../src/types'

// Mock useDiary
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

// Mock useTodayStats — we control loading/error/data states
const mockRefresh = vi.fn()
let mockHookState: {
  data: TodayDashboardData
  loading: boolean
  error: string | null
  refresh: ReturnType<typeof vi.fn>
}

vi.mock('../src/hooks/useTodayStats', () => ({
  useTodayStats: () => mockHookState,
}))

const mockUseDiary = DiaryContextModule.useDiary as ReturnType<typeof vi.fn>

const FULL_DATA: TodayDashboardData = {
  todayEntry: { id: 1, title: '测试日记', wordCount: 320, mood: 'happy' },
  pomodoroToday: { totalMinutes: 45, sessionCount: 2 },
  dueReviewCount: 3,
  mistakeOverview: { total: 15, mastered: 12 },
  streakDays: 7,
  weeklyTrend: [
    { date: '2026-04-07', totalMinutes: 30 },
    { date: '2026-04-08', totalMinutes: 45 },
    { date: '2026-04-09', totalMinutes: 60 },
    { date: '2026-04-10', totalMinutes: 25 },
    { date: '2026-04-11', totalMinutes: 50 },
    { date: '2026-04-12', totalMinutes: 40 },
    { date: '2026-04-13', totalMinutes: 55 },
  ],
}

const EMPTY_DATA: TodayDashboardData = {
  todayEntry: null,
  pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
  dueReviewCount: 0,
  mistakeOverview: { total: 0, mastered: 0 },
  streakDays: 0,
  weeklyTrend: [],
}

describe('HomeDashboard Component', () => {
  const mockSetActiveView = vi.fn()

  beforeEach(() => {
    mockUseDiary.mockReturnValue({
      settingsData: { examDate: '2026-12-25' },
    })

    mockHookState = {
      data: FULL_DATA,
      loading: false,
      error: null,
      refresh: mockRefresh,
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─── Loading State ─────────────────────────────────────────────────────────
  it('renders loading state correctly', async () => {
    mockHookState = { data: EMPTY_DATA, loading: true, error: null, refresh: mockRefresh }

    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.getByText('加载今日看板...')).toBeInTheDocument()
  })

  // ─── Error State ───────────────────────────────────────────────────────────
  it('renders error state correctly', async () => {
    mockHookState = { data: EMPTY_DATA, loading: false, error: '网络连接失败', refresh: mockRefresh }

    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.getByText(/加载失败.*网络连接失败/)).toBeInTheDocument()
  })

  // ─── Full Data State ───────────────────────────────────────────────────────
  it('renders all cards with correct data', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    // Header
    expect(screen.getByText('今日看板')).toBeInTheDocument()

    // Pomodoro card
    expect(screen.getByText(/45/)).toBeInTheDocument()
    expect(screen.getByText(/2 个番茄钟/)).toBeInTheDocument()

    // Diary card — written state
    expect(screen.getByText('已写')).toBeInTheDocument()
    expect(screen.getByText(/320 字/)).toBeInTheDocument()

    // Mistake card — has due reviews
    expect(screen.getByText('错题欠债')).toBeInTheDocument()
    expect(screen.getByText(/待复习.*12\/15/)).toBeInTheDocument()

    // Streak card
    expect(screen.getByText('连续学习')).toBeInTheDocument()
    expect(screen.getByText('保持节奏，继续加油！')).toBeInTheDocument()

    // Quote card
    expect(screen.getByText('每日寄语')).toBeInTheDocument()
  })

  // ─── No Diary Written ──────────────────────────────────────────────────────
  it('shows "not written" when todayEntry is null', async () => {
    mockHookState = {
      data: { ...FULL_DATA, todayEntry: null },
      loading: false,
      error: null,
      refresh: mockRefresh,
    }

    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.getByText('待完成')).toBeInTheDocument()
    expect(screen.getByText('今天还没写日记')).toBeInTheDocument()
  })

  // ─── Zero Due Mistakes ─────────────────────────────────────────────────────
  it('shows celebration message when no mistakes are due', async () => {
    mockHookState = {
      data: { ...FULL_DATA, dueReviewCount: 0, mistakeOverview: { total: 10, mastered: 8 } },
      loading: false,
      error: null,
      refresh: mockRefresh,
    }

    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.getByText('清零')).toBeInTheDocument()
    expect(screen.getByText(/今日无欠债.*8\/10/)).toBeInTheDocument()
  })

  // ─── Quick Links Navigation ────────────────────────────────────────────────
  it('navigates to pomodoro via quick link', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    const btn = screen.getByText('开始专注')
    await act(async () => {
      fireEvent.click(btn)
    })

    expect(mockSetActiveView).toHaveBeenCalledWith('pomodoro')
  })

  it('navigates to editor via quick link', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    const btn = screen.getByText('写日记')
    await act(async () => {
      fireEvent.click(btn)
    })

    expect(mockSetActiveView).toHaveBeenCalledWith('editor')
  })

  it('navigates to mistakes via quick link', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    const btn = screen.getByText('复习错题')
    await act(async () => {
      fireEvent.click(btn)
    })

    expect(mockSetActiveView).toHaveBeenCalledWith('mistakes')
  })

  it('navigates to dashboard via quick link', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    const btn = screen.getByText('查看统计')
    await act(async () => {
      fireEvent.click(btn)
    })

    expect(mockSetActiveView).toHaveBeenCalledWith('dashboard')
  })

  // ─── Exam Countdown ────────────────────────────────────────────────────────
  it('renders exam countdown when examDate is set', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.getByText('距离考研还有')).toBeInTheDocument()
    expect(screen.getByText(/2026-12-25/)).toBeInTheDocument()
  })

  it('hides exam countdown when no examDate is set', async () => {
    mockUseDiary.mockReturnValue({ settingsData: { examDate: '' } })

    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.queryByText('距离考研还有')).not.toBeInTheDocument()
  })

  // ─── Weekly Trend ──────────────────────────────────────────────────────────
  it('renders weekly trend bars when data is available', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.getByText('近7日势态')).toBeInTheDocument()
    // 7 trend bars should be rendered
    const bars = document.querySelectorAll('.bento-trend-bar')
    expect(bars.length).toBe(7)
  })

  it('shows "暂无数据" when weeklyTrend is empty', async () => {
    mockHookState = {
      data: { ...FULL_DATA, weeklyTrend: [] },
      loading: false,
      error: null,
      refresh: mockRefresh,
    }

    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })
})
