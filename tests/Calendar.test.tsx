import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Calendar from '../src/components/Calendar'
import * as DiaryContext from '../src/contexts/DiaryContext'

// Mock dependencies
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn()
}))

vi.mock('../src/components/MoodIcon', () => ({
  default: ({ mood }: { mood: string | null }) => <div data-testid={`mood-icon-${mood || 'none'}`} />
}))

describe('Calendar Component', () => {
  const mockGetDatesWithEntries = vi.fn()
  const mockGetRange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2023-10-15T12:00:00.000Z'))
    
    // Set up default mocks
    const mockDiary: any = {
      entries: {
        getDatesWithEntries: mockGetDatesWithEntries
      },
      pomodoro: {
        getRange: mockGetRange
      }
    }
    vi.spyOn(DiaryContext, 'useDiary').mockReturnValue(mockDiary)
    
    // Default returns
    mockGetDatesWithEntries.mockResolvedValue([])
    mockGetRange.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const renderCalendar = async (selectedDate = '2023-10-15') => {
    await act(async () => {
      render(<Calendar selectedDate={selectedDate} onSelectDate={vi.fn()} />)
    })
    
    // Wait for the async loadMonthEntries to finish
    await vi.waitFor(() => {
      expect(mockGetDatesWithEntries).toHaveBeenCalled()
      expect(mockGetRange).toHaveBeenCalled()
    })
  }

  it('1. 有日记但无专注记录时，仍显示 mood 和“已记录”', async () => {
    mockGetDatesWithEntries.mockResolvedValue([
      { date: '2023-10-05', mood: 'happy' }
    ])
    mockGetRange.mockResolvedValue([])

    await renderCalendar()
    
    // Calendar cell mood + Legend mood = 2 instances of mood-icon-happy
    const happyIcons = screen.getAllByTestId('mood-icon-happy')
    expect(happyIcons.length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText('已记录')).toBeInTheDocument()
  })

  it('2. 无日记但有 30 分钟专注记录时，显示 level 1 标记', async () => {
    mockGetDatesWithEntries.mockResolvedValue([])
    mockGetRange.mockResolvedValue([
      { date: '2023-10-06', total_minutes: 30, session_count: 1 }
    ])

    await renderCalendar()
    
    // Check if 30m badge is rendered
    expect(await screen.findByText('30m')).toBeInTheDocument()
    // It should not show '已记录'
    expect(screen.queryByText('已记录')).not.toBeInTheDocument()
  })

  it('3. 60 分钟显示 level 2', async () => {
    mockGetDatesWithEntries.mockResolvedValue([])
    mockGetRange.mockResolvedValue([
      { date: '2023-10-07', total_minutes: 65, session_count: 2 }
    ])

    await renderCalendar()
    
    expect(await screen.findByText('65m')).toBeInTheDocument()
  })

  it('4. 120 分钟显示 level 3', async () => {
    mockGetDatesWithEntries.mockResolvedValue([])
    mockGetRange.mockResolvedValue([
      { date: '2023-10-08', total_minutes: 130, session_count: 4 }
    ])

    await renderCalendar()
    
    expect(await screen.findByText('130m')).toBeInTheDocument()
  })

  it('5. 同一天有日记和专注记录时，两者共存', async () => {
    mockGetDatesWithEntries.mockResolvedValue([
      { date: '2023-10-10', mood: 'calm' }
    ])
    mockGetRange.mockResolvedValue([
      { date: '2023-10-10', total_minutes: 45, session_count: 2 }
    ])

    await renderCalendar()
    
    // Both should exist — calendar cell + legend = 2+ instances
    const calmIcons = screen.getAllByTestId('mood-icon-calm')
    expect(calmIcons.length).toBeGreaterThanOrEqual(2)
    expect(await screen.findByText('已记录')).toBeInTheDocument()
    // The focus level marker is a small circle (since mood takes center), so we don't see "45m" text
    // The test confirms no "45m" text is rendered when mood is present
    expect(screen.queryByText('45m')).not.toBeInTheDocument()
  })

  it('7. 切换月份时调用对应月份的 getRange', async () => {
    await renderCalendar()
    
    // Initially called with Oct dates
    expect(mockGetRange).toHaveBeenCalledWith('2023-10-01', '2023-10-31')
    
    // Clear mock calls to specifically wait for the next call
    mockGetRange.mockClear()
    
    // 模拟点击下个月
    const fireEvent = (await import('@testing-library/react')).fireEvent
    fireEvent.click(screen.getByText('下个月 →'))
    
    await vi.waitFor(() => {
      expect(mockGetRange).toHaveBeenCalledWith('2023-11-01', '2023-11-30')
    })
  })

  it('8. 低于 30 分钟不显示专注标记', async () => {
    mockGetDatesWithEntries.mockResolvedValue([])
    mockGetRange.mockResolvedValue([
      { date: '2023-10-06', total_minutes: 25, session_count: 1 }
    ])

    await renderCalendar()
    expect(screen.queryByText('25m')).not.toBeInTheDocument()
  })

  it('9. pomodoro.getRange 失败时仍显示日记', async () => {
    mockGetDatesWithEntries.mockResolvedValue([
      { date: '2023-10-05', mood: 'happy' }
    ])
    mockGetRange.mockRejectedValue(new Error('Network error'))

    await renderCalendar()
    
    const happyIcons = screen.getAllByTestId('mood-icon-happy')
    expect(happyIcons.length).toBeGreaterThanOrEqual(2)
  })

  it('10. entries.getDatesWithEntries 失败时仍显示专注标记', async () => {
    mockGetDatesWithEntries.mockRejectedValue(new Error('Network error'))
    mockGetRange.mockResolvedValue([
      { date: '2023-10-06', total_minutes: 40, session_count: 1 }
    ])

    await renderCalendar()
    expect(await screen.findByText('40m')).toBeInTheDocument()
  })

  it('11. goToToday 使用本地日期', async () => {
    const mockOnSelectDate = vi.fn()
    
    await act(async () => {
      render(<Calendar selectedDate="2023-10-15" onSelectDate={mockOnSelectDate} />)
    })

    const fireEvent = (await import('@testing-library/react')).fireEvent
    fireEvent.click(screen.getByText('回到今天'))

    // The fake system time was set to '2023-10-15T12:00:00.000Z' in beforeEach
    // The local date formatter `toDateStr` formats the local Date object.
    const today = new Date()
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    expect(mockOnSelectDate).toHaveBeenCalledWith(expected)
  })
})
