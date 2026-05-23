import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FocusDistributionChart from '../src/components/FocusDistributionChart'
import type { PomodoroStat } from '../src/types'

const createMockPomodoro = (getStatsFn = vi.fn()) => ({
  getStats: getStatsFn,
})

const stat = (name: string, color: string, mins: number, sessions: number): PomodoroStat => ({
  subject_name: name,
  color,
  total_minutes: mins,
  session_count: sessions,
})

describe('FocusDistributionChart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows empty state when getStats returns no data', async () => {
    const mockPomodoro = createMockPomodoro(vi.fn().mockResolvedValue([]))

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-empty')).toBeInTheDocument()
    })
    expect(screen.getByText('选定时间范围内暂无专注记录')).toBeInTheDocument()
  })

  it('shows empty state when getStats rejects', async () => {
    const mockPomodoro = createMockPomodoro(vi.fn().mockRejectedValue(new Error('DB error')))

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-empty')).toBeInTheDocument()
    })
  })

  it('renders a single subject as 100%', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([stat('数学', '#0F766E', 60, 3)])
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    const legendItems = screen.getAllByTestId('focus-legend-item')
    expect(legendItems).toHaveLength(1)
    expect(legendItems[0]).toHaveTextContent('数学')
    expect(legendItems[0]).toHaveTextContent('1h')
    expect(legendItems[0]).toHaveTextContent('100%')
    expect(legendItems[0]).toHaveTextContent('3 🍅')
  })

  it('sorts multiple subjects by total_minutes descending', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([
        stat('英语', '#854D0E', 20, 1),
        stat('数学', '#0F766E', 60, 3),
        stat('政治', '#C65A3A', 10, 1),
      ])
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    const legendItems = screen.getAllByTestId('focus-legend-item')
    expect(legendItems).toHaveLength(3)

    // First item should be 数学 (60m — highest)
    expect(legendItems[0]).toHaveTextContent('数学')
    expect(legendItems[0]).toHaveTextContent('67%')

    // Second item should be 英语 (20m)
    expect(legendItems[1]).toHaveTextContent('英语')
    expect(legendItems[1]).toHaveTextContent('22%')

    // Third item should be 政治 (10m — lowest)
    expect(legendItems[2]).toHaveTextContent('政治')
    expect(legendItems[2]).toHaveTextContent('11%')
  })

  it('displays "未分类" for empty subject_name', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([
        stat('', '', 45, 2),
      ])
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    expect(screen.getByText('未分类')).toBeInTheDocument()
  })

  it('formats time correctly: 30m and 1h 30m', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([
        stat('数学', '#0F766E', 90, 4),
        stat('英语', '#854D0E', 30, 2),
      ])
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    const legendItems = screen.getAllByTestId('focus-legend-item')
    // 数学: 90m → "1h 30m"
    expect(legendItems[0]).toHaveTextContent('1h 30m')
    // 英语: 30m → "30m"
    expect(legendItems[1]).toHaveTextContent('30m')
  })

  it('calls getStats 7 times when "近 7 天" is selected', async () => {
    const getStatsFn = vi.fn().mockResolvedValue([])
    const mockPomodoro = createMockPomodoro(getStatsFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    // Wait for initial load (today = 1 call)
    await waitFor(() => {
      expect(getStatsFn).toHaveBeenCalledTimes(1)
    })

    // Clear call count and click "近 7 天"
    getStatsFn.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-week'))
    })

    await waitFor(() => {
      expect(getStatsFn).toHaveBeenCalledTimes(7)
    })
  })

  it('displays center total in the donut chart', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([
        stat('数学', '#0F766E', 75, 3),
        stat('英语', '#854D0E', 45, 2),
      ])
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    // Total: 120m = 2h, 5 sessions
    expect(screen.getByText('2h')).toBeInTheDocument()
    expect(screen.getByText('共 5 番茄')).toBeInTheDocument()
  })

  it('aggregates same subject across multiple days in 7-day range', async () => {
    // Each getStats call returns per-day data; we need 1 call for initial 'today' load,
    // then 7 calls when switching to 'week'.
    const getStatsFn = vi.fn()
      // Initial load (today): return empty so chart shows empty state
      .mockResolvedValueOnce([])

    const mockPomodoro = createMockPomodoro(getStatsFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    // Wait for initial load to complete
    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-empty')).toBeInTheDocument()
    })

    // Now set up per-day mocks for 7-day range: 数学 appears on 3 days, 英语 on 2 days
    getStatsFn.mockClear()
    getStatsFn
      .mockResolvedValueOnce([stat('数学', '#0F766E', 30, 1)])                              // day 1
      .mockResolvedValueOnce([])                                                             // day 2
      .mockResolvedValueOnce([stat('数学', '#0F766E', 20, 1), stat('英语', '#854D0E', 15, 1)]) // day 3
      .mockResolvedValueOnce([])                                                             // day 4
      .mockResolvedValueOnce([stat('英语', '#854D0E', 25, 1)])                               // day 5
      .mockResolvedValueOnce([stat('数学', '#0F766E', 10, 1)])                               // day 6
      .mockResolvedValueOnce([])                                                             // day 7

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-week'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    // 数学: 30+20+10 = 60m, 3 sessions. 英语: 15+25 = 40m, 2 sessions.
    const legendItems = screen.getAllByTestId('focus-legend-item')
    expect(legendItems).toHaveLength(2)

    // Sorted desc: 数学 (60m) first, 英语 (40m) second
    expect(legendItems[0]).toHaveTextContent('数学')
    expect(legendItems[0]).toHaveTextContent('1h')
    expect(legendItems[0]).toHaveTextContent('60%')
    expect(legendItems[0]).toHaveTextContent('3 🍅')

    expect(legendItems[1]).toHaveTextContent('英语')
    expect(legendItems[1]).toHaveTextContent('40m')
    expect(legendItems[1]).toHaveTextContent('40%')
    expect(legendItems[1]).toHaveTextContent('2 🍅')

    // Center total: 100m = 1h 40m, 5 sessions
    expect(screen.getByText('1h 40m')).toBeInTheDocument()
    expect(screen.getByText('共 5 番茄')).toBeInTheDocument()
  })

  it('calls getStats 30 times when "近 30 天" is selected', async () => {
    const getStatsFn = vi.fn().mockResolvedValue([])
    const mockPomodoro = createMockPomodoro(getStatsFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(getStatsFn).toHaveBeenCalledTimes(1)
    })

    getStatsFn.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-month'))
    })

    await waitFor(() => {
      expect(getStatsFn).toHaveBeenCalledTimes(30)
    })
  })

  it('reloads data when dataRefreshVersion changes', async () => {
    const getStatsFn = vi.fn().mockResolvedValue([stat('数学', '#0F766E', 30, 1)])
    const mockPomodoro = createMockPomodoro(getStatsFn)

    const { rerender } = render(
      <FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />
    )

    await waitFor(() => {
      expect(getStatsFn).toHaveBeenCalledTimes(1)
    })

    getStatsFn.mockClear()
    getStatsFn.mockResolvedValue([stat('数学', '#0F766E', 60, 2)])

    rerender(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={1} />)

    await waitFor(() => {
      expect(getStatsFn).toHaveBeenCalledTimes(1)
    })
  })
})
