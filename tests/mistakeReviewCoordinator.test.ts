import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  settleMistakeReviewTask,
  submitMistakeReview,
} from '../src/utils/mistakeReviewCoordinator'
import type { Mistake, StudyTask } from '../src/types'

const mistake: Mistake = {
  id: 12,
  subject_id: 2,
  question: 'Question',
  answer: 'Answer',
  notes: '',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  next_review_date: '2026-06-07',
  review_count: 0,
  image_path: null,
  answer_image_path: null,
  created_at: '2026-06-07T08:00:00.000Z',
}

const makeTask = (overrides: Partial<StudyTask> = {}): StudyTask => ({
  id: 1,
  title: 'Review task',
  description: '',
  type: 'review',
  subject_id: 2,
  related_mistake_id: 12,
  related_entry_id: null,
  planned_date: '2026-06-07',
  estimate_minutes: 10,
  status: 'todo',
  source: 'dashboard',
  created_at: '2026-06-07T00:00:00.000Z',
  updated_at: '2026-06-07T00:00:00.000Z',
  ...overrides,
})

describe('mistakeReviewCoordinator', () => {
  const mistakesAPI = {
    review: vi.fn(),
  }
  const tasksAPI = {
    find: vi.fn(),
    update: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mistakesAPI.review.mockResolvedValue({ success: true, mistake })
    tasksAPI.find.mockResolvedValue([])
    tasksAPI.update.mockImplementation(async (id: number, patch: Partial<StudyTask>) => ({
      ...makeTask({ id }),
      ...patch,
    }))
  })

  it('saves SM-2 first and does not complete unrelated tasks when there is no exact task link', async () => {
    const result = await submitMistakeReview({
      mistake,
      quality: 4,
      reviewDate: '2026-06-07',
      mistakesAPI,
      tasksAPI,
    })

    expect(mistakesAPI.review).toHaveBeenCalledWith(12, expect.objectContaining({ review_count: 1 }))
    expect(tasksAPI.find).toHaveBeenCalledWith({
      type: 'review',
      planned_date: '2026-06-07',
      status: ['todo', 'doing'],
      related_mistake_id: 12,
    })
    expect(tasksAPI.update).not.toHaveBeenCalled()
    expect(result.taskSettlementStatus).toBe('none')
  })

  it('completes one active exact review task after SM-2 succeeds', async () => {
    tasksAPI.find.mockResolvedValue([makeTask({ id: 5 })])

    const result = await submitMistakeReview({
      mistake,
      quality: 5,
      reviewDate: '2026-06-07',
      mistakesAPI,
      tasksAPI,
    })

    expect(tasksAPI.update).toHaveBeenCalledWith(5, { status: 'done' })
    expect(result).toEqual(expect.objectContaining({
      taskSettlementStatus: 'completed',
      completedTask: expect.objectContaining({ id: 5, status: 'done' }),
    }))
  })

  it('returns a conflict without picking a task when multiple active exact tasks match', async () => {
    tasksAPI.find.mockResolvedValue([makeTask({ id: 5 }), makeTask({ id: 6, title: 'Duplicate' })])

    const result = await submitMistakeReview({
      mistake,
      quality: 4,
      reviewDate: '2026-06-07',
      mistakesAPI,
      tasksAPI,
    })

    expect(tasksAPI.update).not.toHaveBeenCalled()
    expect(result.taskSettlementStatus).toBe('conflict')
    expect(result.conflictTasks.map(task => task.id)).toEqual([5, 6])
  })

  it('does not settle a task when SM-2 review fails', async () => {
    mistakesAPI.review.mockRejectedValue(new Error('review failed'))
    tasksAPI.find.mockResolvedValue([makeTask({ id: 5 })])

    await expect(submitMistakeReview({
      mistake,
      quality: 4,
      reviewDate: '2026-06-07',
      mistakesAPI,
      tasksAPI,
    })).rejects.toThrow('review failed')

    expect(tasksAPI.find).not.toHaveBeenCalled()
    expect(tasksAPI.update).not.toHaveBeenCalled()
  })

  it('keeps review saved when task update fails and allows task-only retry', async () => {
    tasksAPI.find.mockResolvedValue([makeTask({ id: 5 })])
    tasksAPI.update.mockRejectedValueOnce(new Error('task update failed'))

    const result = await submitMistakeReview({
      mistake,
      quality: 4,
      reviewDate: '2026-06-07',
      mistakesAPI,
      tasksAPI,
    })

    expect(result).toEqual(expect.objectContaining({
      reviewSaved: true,
      taskSettlementStatus: 'failed',
      settlementError: 'task update failed',
    }))
    expect(mistakesAPI.review).toHaveBeenCalledTimes(1)

    tasksAPI.update.mockResolvedValueOnce(makeTask({ id: 5, status: 'done' }))
    await expect(settleMistakeReviewTask({
      mistakeId: 12,
      reviewDate: '2026-06-07',
      tasksAPI,
    })).resolves.toEqual(expect.objectContaining({
      taskSettlementStatus: 'completed',
      completedTask: expect.objectContaining({ id: 5, status: 'done' }),
    }))
    expect(mistakesAPI.review).toHaveBeenCalledTimes(1)
  })
})
