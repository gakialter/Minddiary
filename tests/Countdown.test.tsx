import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Countdown from '../src/components/Countdown'
import * as DiaryContextModule from '../src/contexts/DiaryContext'

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

const mockUseDiary = DiaryContextModule.useDiary as ReturnType<typeof vi.fn>

describe('Countdown component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 14, 12, 0))
    mockUseDiary.mockReturnValue({
      settingsData: {
        examDate: '2026-12-21',
        countdownEvents: [],
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('displays the nearest upcoming countdown event', () => {
    mockUseDiary.mockReturnValue({
      settingsData: {
        examDate: '2026-12-21',
        countdownEvents: [
          { id: 'summer', title: '暑假开始', date: '2026-06-26', type: 'holiday' },
          { id: 'print', title: '准考证打印', date: '2026-12-01', type: 'deadline' },
        ],
      },
    })

    render(<Countdown />)

    expect(screen.getByText('距暑假开始 43 天')).toBeInTheDocument()
  })

  it('prioritizes the nearest pinned event over unpinned events', () => {
    mockUseDiary.mockReturnValue({
      settingsData: {
        examDate: '2026-12-21',
        countdownEvents: [
          { id: 'summer', title: '暑假开始', date: '2026-06-26', type: 'holiday' },
          { id: 'deadline', title: '报名开始', date: '2026-09-01', type: 'deadline', pinned: true },
        ],
      },
    })

    render(<Countdown />)

    expect(screen.getByText('距报名开始 110 天')).toBeInTheDocument()
  })

  it('falls back to legacy examDate when countdownEvents is missing', () => {
    mockUseDiary.mockReturnValue({
      settingsData: {
        examDate: '2026-12-21',
      },
    })

    render(<Countdown />)

    expect(screen.getByText('距考研初试 221 天')).toBeInTheDocument()
  })

  it('uses the persisted custom title for the built-in primary target', () => {
    mockUseDiary.mockReturnValue({
      settingsData: {
        examDate: '2026-12-21',
        countdownEvents: [
          {
            id: 'default-exam',
            title: '公务员考试',
            date: '2026-12-21',
            type: 'exam',
          },
        ],
      },
    })

    render(<Countdown />)

    expect(screen.getByText('距公务员考试 221 天')).toBeInTheDocument()
    expect(screen.queryByText(/考研初试/)).not.toBeInTheDocument()
  })

  it('shows ended text instead of a negative day badge', () => {
    mockUseDiary.mockReturnValue({
      settingsData: {
        examDate: '',
        countdownEvents: [
          { id: 'exam-done', title: '考研初试', date: '2026-05-10', type: 'exam' },
        ],
      },
    })

    render(<Countdown />)

    expect(screen.getByText('考研初试已结束')).toBeInTheDocument()
    expect(screen.queryByText(/-\d+\s*天/)).not.toBeInTheDocument()
  })
})
