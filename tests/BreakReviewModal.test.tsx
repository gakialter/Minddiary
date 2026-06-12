import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BreakReviewModal from '../src/components/BreakReviewModal'
import type { Mistake } from '../src/types'

const mocks = vi.hoisted(() => ({
  getRandomDue: vi.fn(),
  review: vi.fn(),
  tasksFind: vi.fn(),
  tasksUpdate: vi.fn(),
  requestDataRefresh: vi.fn(),
  getLocalDateKey: vi.fn(() => '2026-05-19'),
  loggerError: vi.fn(),
  diary: undefined as unknown as {
    mistakes: {
      getRandomDue: ReturnType<typeof vi.fn>
      review: ReturnType<typeof vi.fn>
    }
    tasks: {
      find: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
    requestDataRefresh: ReturnType<typeof vi.fn>
  },
}))

mocks.diary = {
  mistakes: {
    getRandomDue: mocks.getRandomDue,
    review: mocks.review,
  },
  tasks: {
    find: mocks.tasksFind,
    update: mocks.tasksUpdate,
  },
  requestDataRefresh: mocks.requestDataRefresh,
}

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(() => mocks.diary),
}))

vi.mock('../src/utils/dateKey', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/utils/dateKey')>()
  return {
    ...actual,
    getLocalDateKey: mocks.getLocalDateKey,
  }
})

vi.mock('../src/utils/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}))

vi.mock('react-latex-next', () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}))

const dueMistake: Mistake = {
  id: 7,
  subject_id: null,
  question: 'Q',
  answer: 'A',
  notes: '',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  next_review_date: null,
  review_count: 0,
  image_path: null,
  answer_image_path: null,
  created_at: '2026-05-19T08:00:00Z',
}

beforeEach(() => {
  mocks.getRandomDue.mockResolvedValue(dueMistake)
  mocks.review.mockResolvedValue({ success: true, mistake: dueMistake })
  mocks.tasksFind.mockResolvedValue([])
  mocks.tasksUpdate.mockResolvedValue({ id: 1, status: 'done' })
  mocks.getLocalDateKey.mockReturnValue('2026-05-19')
  vi.clearAllMocks()
})

describe('BreakReviewModal', () => {
  it('loads due mistakes with the local date key and refreshes shared dashboard data after review', async () => {
    render(<BreakReviewModal onClose={vi.fn()} />)

    await waitFor(() => {
      expect(mocks.getRandomDue).toHaveBeenCalledWith('2026-05-19')
    })

    const revealButton = await screen.findByTestId('break-review-reveal-answer')
    fireEvent.click(revealButton)

    await waitFor(() => {
      expect(screen.getByTestId('break-review-quality-4')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('break-review-quality-4'))

    await waitFor(() => {
      expect(mocks.review).toHaveBeenCalledWith(7, expect.objectContaining({
        review_count: 1,
        next_review_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }))
      expect(mocks.requestDataRefresh).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps break-review answer images hidden until reveal', async () => {
    mocks.getRandomDue.mockResolvedValue({
      ...dueMistake,
      image_path: 'mistake_images/break-question.png',
      answer_image_path: 'mistake_images/break-answer.png',
    })

    const { container } = render(<BreakReviewModal onClose={vi.fn()} />)

    expect(await screen.findByText('Q')).toBeInTheDocument()
    expect(container.querySelector('img[alt="错题复习题目图片 1"]')).toBeInTheDocument()
    expect(container.querySelector('img[alt="错题复习答案图片 1"]')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('break-review-reveal-answer'))

    expect(container.querySelector('img[alt="错题复习答案图片 1"]')).toBeInTheDocument()
  })
})
