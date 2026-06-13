import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewTaskPickerDialog from '../src/components/ReviewTaskPickerDialog'
import type { Mistake, StudyTask } from '../src/types'

const makeMistake = (id: number): Mistake => ({
  id,
  subject_id: 1,
  question: `Mistake ${id}`,
  answer: 'Answer',
  notes: '',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  next_review_date: '2026-06-13',
  review_count: 0,
  created_at: '2026-06-13T00:00:00.000Z',
})

const makeTask = (id: number, mistakeId: number): StudyTask => ({
  id,
  title: `Review mistake ${mistakeId}`,
  description: 'Review this mistake',
  type: 'review',
  subject_id: 1,
  related_mistake_id: mistakeId,
  related_entry_id: null,
  planned_date: '2026-06-13',
  estimate_minutes: 10,
  status: 'todo',
  source: 'dashboard',
  created_at: '2026-06-13T00:00:00.000Z',
  updated_at: '2026-06-13T00:00:00.000Z',
})

describe('ReviewTaskPickerDialog', () => {
  const mocks = {
    mistakesGetAll: vi.fn(),
    tasksFind: vi.fn(),
    tasksCreate: vi.fn(),
    onClose: vi.fn(),
    onCreated: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mistakesGetAll.mockResolvedValue({
      data: [makeMistake(1), makeMistake(2)],
      total: 2,
      masteredTotal: 0,
    })
    mocks.tasksFind.mockResolvedValue([])
    mocks.tasksCreate.mockImplementation(async (task: { related_mistake_id?: number | null }) => {
      if (task.related_mistake_id === 2) throw new Error('create failed for mistake 2')
      return makeTask(10, task.related_mistake_id || 0)
    })
  })

  const renderDialog = () => render(
    <ReviewTaskPickerDialog
      date="2026-06-13"
      riskPoolCount={2}
      mistakesAPI={{ getAll: mocks.mistakesGetAll }}
      tasksAPI={{ find: mocks.tasksFind, create: mocks.tasksCreate }}
      onClose={mocks.onClose}
      onCreated={mocks.onCreated}
    />,
  )

  it('refreshes successful creations and reports partial failures', async () => {
    renderDialog()

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    })

    fireEvent.click(screen.getByTestId('review-task-select-all'))
    fireEvent.click(screen.getByTestId('review-task-create-selected'))

    await waitFor(() => {
      expect(mocks.tasksCreate).toHaveBeenCalledTimes(2)
      expect(mocks.onCreated).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/Created 1 task\(s\), but some task creation failed/)).toBeInTheDocument()
    })
  })
})
