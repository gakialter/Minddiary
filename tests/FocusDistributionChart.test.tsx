import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FocusDistributionChart from '../src/components/FocusDistributionChart'
import type { PomodoroStat } from '../src/types'

const createMockPomodoro = (
  getStatsRangeFn = vi.fn().mockResolvedValue([]),
  getStatsFn = vi.fn().mockResolvedValue([]),
) => ({
  getStats: getStatsFn,
  getStatsRange: getStatsRangeFn,
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

  it('shows empty state when getStatsRange returns no data', async () => {
    const mockPomodoro = createMockPomodoro(vi.fn().mockResolvedValue([]))

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-empty')).toBeInTheDocument()
    })
  })

  it('shows empty state when getStatsRange rejects', async () => {
    const mockPomodoro = createMockPomodoro(vi.fn().mockRejectedValue(new Error('DB error')))

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-empty')).toBeInTheDocument()
    })
  })

  it('renders a single subject as 100%', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([stat('Math', '#0F766E', 60, 3)]),
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    const legendItems = screen.getAllByTestId('focus-legend-item')
    expect(legendItems).toHaveLength(1)
    expect(legendItems[0]).toHaveTextContent('Math')
    expect(legendItems[0]).toHaveTextContent('1h')
    expect(legendItems[0]).toHaveTextContent('100%')
    expect(legendItems[0]).toHaveTextContent('3')
  })

  it('sorts multiple subjects by total_minutes descending', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([
        stat('English', '#854D0E', 20, 1),
        stat('Math', '#0F766E', 60, 3),
        stat('Politics', '#C65A3A', 10, 1),
      ]),
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    const legendItems = screen.getAllByTestId('focus-legend-item')
    expect(legendItems).toHaveLength(3)
    expect(legendItems[0]).toHaveTextContent('Math')
    expect(legendItems[0]).toHaveTextContent('67%')
    expect(legendItems[1]).toHaveTextContent('English')
    expect(legendItems[1]).toHaveTextContent('22%')
    expect(legendItems[2]).toHaveTextContent('Politics')
    expect(legendItems[2]).toHaveTextContent('11%')
  })

  it('displays a fallback label for empty subject_name', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([stat('', '', 45, 2)]),
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    expect(screen.getAllByTestId('focus-legend-item')[0]).toHaveTextContent(/\S/)
  })

  it('formats time correctly: 30m and 1h 30m', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([
        stat('Math', '#0F766E', 90, 4),
        stat('English', '#854D0E', 30, 2),
      ]),
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    const legendItems = screen.getAllByTestId('focus-legend-item')
    expect(legendItems[0]).toHaveTextContent('1h 30m')
    expect(legendItems[1]).toHaveTextContent('30m')
  })

  it('calls getStatsRange once when week range is selected', async () => {
    const getStatsRangeFn = vi.fn().mockResolvedValue([])
    const getStatsFn = vi.fn().mockResolvedValue([])
    const mockPomodoro = createMockPomodoro(getStatsRangeFn, getStatsFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })

    getStatsRangeFn.mockClear()
    getStatsFn.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-week'))
    })

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })
    expect(getStatsFn).not.toHaveBeenCalled()
  })

  it('displays center total in the donut chart', async () => {
    const mockPomodoro = createMockPomodoro(
      vi.fn().mockResolvedValue([
        stat('Math', '#0F766E', 75, 3),
        stat('English', '#854D0E', 45, 2),
      ]),
    )

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    expect(screen.getByText('2h')).toBeInTheDocument()
    expect(screen.getAllByText(/5/).length).toBeGreaterThan(0)
  })

  it('renders aggregated subject totals from week range stats', async () => {
    const getStatsRangeFn = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        stat('Math', '#0F766E', 60, 3),
        stat('English', '#854D0E', 40, 2),
      ])
    const mockPomodoro = createMockPomodoro(getStatsRangeFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-empty')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-week'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    })

    const legendItems = screen.getAllByTestId('focus-legend-item')
    expect(legendItems).toHaveLength(2)
    expect(legendItems[0]).toHaveTextContent('Math')
    expect(legendItems[0]).toHaveTextContent('1h')
    expect(legendItems[0]).toHaveTextContent('60%')
    expect(legendItems[0]).toHaveTextContent('3')
    expect(legendItems[1]).toHaveTextContent('English')
    expect(legendItems[1]).toHaveTextContent('40m')
    expect(legendItems[1]).toHaveTextContent('40%')
    expect(legendItems[1]).toHaveTextContent('2')
    expect(screen.getByText('1h 40m')).toBeInTheDocument()
  })

  it('calls getStatsRange once when month range is selected', async () => {
    const getStatsRangeFn = vi.fn().mockResolvedValue([])
    const getStatsFn = vi.fn().mockResolvedValue([])
    const mockPomodoro = createMockPomodoro(getStatsRangeFn, getStatsFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })

    getStatsRangeFn.mockClear()
    getStatsFn.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-month'))
    })

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })
    expect(getStatsFn).not.toHaveBeenCalled()
  })

  it('loads only the selected day in single-day mode', async () => {
    const getStatsRangeFn = vi.fn().mockResolvedValue([])
    const getStatsFn = vi.fn().mockResolvedValue([])
    const mockPomodoro = createMockPomodoro(getStatsRangeFn, getStatsFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })

    getStatsRangeFn.mockClear()
    getStatsRangeFn.mockResolvedValue([stat('Math', '#0F766E', 50, 2)])

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-single'))
    })
    await act(async () => {
      fireEvent.change(screen.getByTestId('focus-single-date'), {
        target: { value: '2026-05-03' },
      })
    })

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledWith('2026-05-03', '2026-05-03')
    })
    expect(getStatsFn).not.toHaveBeenCalled()
    expect(screen.getByTestId('focus-distribution-chart')).toBeInTheDocument()
    expect(screen.getAllByText('50m').length).toBeGreaterThan(0)
  })

  it('loads a custom date range including both start and end dates', async () => {
    const getStatsRangeFn = vi.fn().mockResolvedValue([])
    const getStatsFn = vi.fn().mockResolvedValue([])
    const mockPomodoro = createMockPomodoro(getStatsRangeFn, getStatsFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })

    getStatsRangeFn.mockResolvedValue([
      stat('Math', '#0F766E', 25, 1),
      stat('English', '#854D0E', 35, 1),
    ])

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-custom'))
    })
    getStatsRangeFn.mockClear()
    getStatsFn.mockClear()

    await act(async () => {
      fireEvent.change(screen.getByTestId('focus-range-start'), {
        target: { value: '2026-05-01' },
      })
      fireEvent.change(screen.getByTestId('focus-range-end'), {
        target: { value: '2026-05-03' },
      })
    })

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })
    expect(getStatsRangeFn).toHaveBeenCalledWith('2026-05-01', '2026-05-03')
    expect(getStatsFn).not.toHaveBeenCalled()
    expect(screen.getByText('1h')).toBeInTheDocument()
  })

  it('does not expand a one-year custom range into per-day getStats calls', async () => {
    const getStatsRangeFn = vi.fn().mockResolvedValue([])
    const getStatsFn = vi.fn().mockResolvedValue([])
    const mockPomodoro = createMockPomodoro(getStatsRangeFn, getStatsFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-custom'))
    })
    getStatsRangeFn.mockClear()
    getStatsFn.mockClear()

    await act(async () => {
      fireEvent.change(screen.getByTestId('focus-range-start'), {
        target: { value: '2025-01-01' },
      })
      fireEvent.change(screen.getByTestId('focus-range-end'), {
        target: { value: '2025-12-31' },
      })
    })

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })
    expect(getStatsRangeFn).toHaveBeenCalledWith('2025-01-01', '2025-12-31')
    expect(getStatsFn).not.toHaveBeenCalled()
  })

  it('shows a validation message and does not load stats when custom dates are invalid', async () => {
    const getStatsRangeFn = vi.fn().mockResolvedValue([])
    const getStatsFn = vi.fn().mockResolvedValue([])
    const mockPomodoro = createMockPomodoro(getStatsRangeFn, getStatsFn)

    render(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />)

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('focus-range-custom'))
    })
    getStatsRangeFn.mockClear()
    getStatsFn.mockClear()

    await act(async () => {
      fireEvent.change(screen.getByTestId('focus-range-start'), {
        target: { value: '2026-05-04' },
      })
      fireEvent.change(screen.getByTestId('focus-range-end'), {
        target: { value: '2026-05-03' },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('focus-range-error')).toBeInTheDocument()
    })
    expect(getStatsRangeFn).not.toHaveBeenCalled()
    expect(getStatsFn).not.toHaveBeenCalled()
  })

  it('reloads data when dataRefreshVersion changes', async () => {
    const getStatsRangeFn = vi.fn().mockResolvedValue([stat('Math', '#0F766E', 30, 1)])
    const mockPomodoro = createMockPomodoro(getStatsRangeFn)

    const { rerender } = render(
      <FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={0} />,
    )

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })

    getStatsRangeFn.mockClear()
    getStatsRangeFn.mockResolvedValue([stat('Math', '#0F766E', 60, 2)])

    rerender(<FocusDistributionChart pomodoro={mockPomodoro} dataRefreshVersion={1} />)

    await waitFor(() => {
      expect(getStatsRangeFn).toHaveBeenCalledTimes(1)
    })
  })
})
