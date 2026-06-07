import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MistakeReviewModal from '../src/components/MistakeReviewModal'
import type { Mistake } from '../src/types'

const mocks = vi.hoisted(() => ({
  getRandomDue: vi.fn(),
  review: vi.fn(),
  requestDataRefresh: vi.fn(),
  getLocalDateKey: vi.fn(() => '2026-06-07'),
  loggerError: vi.fn(),
  diary: undefined as unknown as {
    mistakes: {
      getRandomDue: ReturnType<typeof vi.fn>
      review: ReturnType<typeof vi.fn>
    }
    requestDataRefresh: ReturnType<typeof vi.fn>
  },
}))

mocks.diary = {
  mistakes: {
    getRandomDue: mocks.getRandomDue,
    review: mocks.review,
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
  id: 12,
  subject_id: 2,
  subject_name: 'Math',
  subject_color: '#f00',
  question: 'Manual question',
  answer: 'Manual answer',
  notes: 'Manual notes',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  next_review_date: '2026-06-07',
  review_count: 0,
  image_path: null,
  created_at: '2026-06-07T08:00:00Z',
}

beforeEach(() => {
  mocks.getRandomDue.mockResolvedValue(dueMistake)
  mocks.review.mockResolvedValue({ success: true })
  mocks.getLocalDateKey.mockReturnValue('2026-06-07')
  vi.clearAllMocks()
})

describe('MistakeReviewModal', () => {
  it('loads a manual subject-scoped due mistake and hides answer content until reveal', async () => {
    render(<MistakeReviewModal onClose={vi.fn()} variant="manual" subjectId={2} />)

    await waitFor(() => {
      expect(mocks.getRandomDue).toHaveBeenCalledWith('2026-06-07', 2)
    })

    expect(await screen.findByText('Manual question')).toBeInTheDocument()
    expect(screen.queryByText('Manual answer')).not.toBeInTheDocument()
    expect(screen.queryByText('Manual notes')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mistake-review-quality-4')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('mistake-review-reveal-answer'))

    expect(screen.getByText('Manual answer')).toBeInTheDocument()
    expect(screen.getByText('Manual notes')).toBeInTheDocument()
    expect(screen.getByTestId('mistake-review-quality-4')).toBeInTheDocument()
  })

  it('submits SM-2 review through the existing review API and can load another card', async () => {
    mocks.getRandomDue
      .mockResolvedValueOnce(dueMistake)
      .mockResolvedValueOnce(null)

    render(<MistakeReviewModal onClose={vi.fn()} variant="manual" />)

    fireEvent.click(await screen.findByTestId('mistake-review-reveal-answer'))
    fireEvent.click(screen.getByTestId('mistake-review-quality-4'))

    await waitFor(() => {
      expect(mocks.review).toHaveBeenCalledWith(12, expect.objectContaining({
        review_count: 1,
        next_review_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }))
      expect(mocks.requestDataRefresh).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: /再来一题/ }))

    await waitFor(() => {
      expect(mocks.getRandomDue).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText('当前没有待复习错题')).toBeInTheDocument()
  })

  it('shows a clear empty state when no due mistake exists', async () => {
    const onClose = vi.fn()
    mocks.getRandomDue.mockResolvedValue(null)

    render(<MistakeReviewModal onClose={onClose} variant="manual" subjectId={3} />)

    expect(await screen.findByText('当前没有待复习错题')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回错题本' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
