import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import HomeDashboard from '../src/components/HomeDashboard'
import * as DiaryContextModule from '../src/contexts/DiaryContext'
import type { TodayDashboardData } from '../src/types'

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

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
  todayEntry: { id: 1, title: '测试', wordCount: 320, mood: 'happy' },
  pomodoroToday: { totalMinutes: 45, sessionCount: 2 },
  commanderMetrics: {
    riskPoolCount: 6,
    lockedKnowledgeGrowth: 8,
    focusConversionRate: 75,
  },
  streakDays: 7,
}

const EMPTY_DATA: TodayDashboardData = {
  todayEntry: null,
  pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
  commanderMetrics: {
    riskPoolCount: 0,
    lockedKnowledgeGrowth: 0,
    focusConversionRate: 0,
  },
  streakDays: 0,
}

describe('HomeDashboard Component - Commander Engine', () => {
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

  it('renders loading state correctly', async () => {
    mockHookState = { data: EMPTY_DATA, loading: true, error: null, refresh: mockRefresh }
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument()
  })

  it('renders error state correctly', async () => {
    mockHookState = { data: EMPTY_DATA, loading: false, error: '网络连接失败', refresh: mockRefresh }
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })
    expect(screen.getByText(/加载失败.*网络连接失败/)).toBeInTheDocument()
  })

  it('renders Commander Hero title and metrics', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    expect(screen.getByText(/今天有 6 个高风险知识点待抢救/)).toBeInTheDocument()
    expect(screen.getByText('72 小时风险池')).toBeInTheDocument()
    expect(screen.getByText('稳定记忆净增')).toBeInTheDocument()
    expect(screen.getByText('有效专注转化率')).toBeInTheDocument()
  })

  it('toggles expansion layer details and shows the decision explanation', async () => {
    await act(async () => {
      render(<HomeDashboard setActiveView={mockSetActiveView} />)
    })

    const toggleBtn = screen.getByTestId('dashboard-details-toggle')
    expect(screen.queryByTestId('dashboard-state-explanation')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(toggleBtn)
    })
    expect(screen.getByTestId('dashboard-state-explanation')).toHaveTextContent('待复习错题 6 ≥ 5')
  })

  it('cta handles navigation properly', async () => {
    const mockMistakeFilterIntent = vi.fn()

    await act(async () => {
      render(
        <HomeDashboard
          setActiveView={mockSetActiveView}
          onMistakeFilterIntent={mockMistakeFilterIntent}
        />,
      )
    })

    const ctaBtn = screen.getByTestId('dashboard-cta')
    await act(async () => {
      fireEvent.click(ctaBtn)
    })

    expect(mockMistakeFilterIntent).toHaveBeenCalledWith('due')
    expect(mockSetActiveView).toHaveBeenCalledWith('mistakes')
  })
})
