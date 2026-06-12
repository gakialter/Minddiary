// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  IPC_VALIDATION_LIMITS,
  validateAiMessagesPayload,
  validateAiSummaryPayload,
  validateDateKeyPayload,
  validateEntryCreatePayload,
  validateEntryUpdatePayload,
  validateMistakeReviewPayload,
  validatePomodoroSessionPayload,
  validateStudyTaskCreatePayload,
} from '../electron/ipcValidation'

describe('IPC runtime payload validation', () => {
  it('rejects ai:chat messages that are not an array', () => {
    expect(() => validateAiMessagesPayload({ role: 'user', content: 'hello' })).toThrow('AI chat messages must be an array')
  })

  it('rejects unsupported AI message roles', () => {
    expect(() => validateAiMessagesPayload([
      { role: 'system', content: 'system' },
      { role: 'tool', content: 'hello' },
    ])).toThrow('AI message 1 role must be one of')
  })

  it('rejects AI message content that is not a string', () => {
    expect(() => validateAiMessagesPayload([
      { role: 'system', content: 'system' },
      { role: 'user', content: { text: 'hello' } },
    ])).toThrow('AI message 1 content must be a string')
  })

  it('accepts valid AI messages as normalized safe objects', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Summarize today.' },
    ]

    const result = validateAiMessagesPayload(messages)

    expect(result).toEqual(messages)
    expect(result).not.toBe(messages)
  })

  it('rejects ai:summarize input that exceeds the shared summary limit', () => {
    expect(() => validateAiSummaryPayload('x'.repeat(IPC_VALIDATION_LIMITS.aiSummaryInput + 1))).toThrow(
      'AI summary input must be at most',
    )
  })

  it('rejects invalid task type/status/source values', () => {
    const baseTask = {
      title: 'Review math',
      planned_date: '2026-06-03',
    }

    expect(() => validateStudyTaskCreatePayload({ ...baseTask, type: 'exam' })).toThrow('task type must be one of')
    expect(() => validateStudyTaskCreatePayload({ ...baseTask, status: 'blocked' })).toThrow('task status must be one of')
    expect(() => validateStudyTaskCreatePayload({ ...baseTask, source: 'external' })).toThrow('task source must be one of')
  })

  it('rejects task titles over the configured maximum length', () => {
    expect(() => validateStudyTaskCreatePayload({
      title: 'x'.repeat(IPC_VALIDATION_LIMITS.taskTitle + 1),
      planned_date: '2026-06-03',
    })).toThrow('task title is too long')
  })

  it('accepts valid task creation payloads unchanged', () => {
    const task = {
      title: 'Review English vocabulary',
      description: 'Unit 3',
      type: 'review',
      subject_id: null,
      related_mistake_id: 12,
      related_entry_id: 18,
      planned_date: '2026-06-03',
      estimate_minutes: 25,
      status: 'todo',
      source: 'manual',
    }

    expect(validateStudyTaskCreatePayload(task)).toBe(task)
  })

  it('validates task focus start date keys', () => {
    expect(validateDateKeyPayload('2026-06-03', 'task planned_date')).toBe('2026-06-03')
    expect(() => validateDateKeyPayload('2026/06/03', 'task planned_date')).toThrow('task planned_date must be YYYY-MM-DD')
    expect(() => validateDateKeyPayload(20260603, 'task planned_date')).toThrow('task planned_date must be YYYY-MM-DD')
  })

  it('rejects invalid pomodoro duration, date, and subject id payloads', () => {
    const baseSession = {
      subject_id: null,
      task_id: null,
      duration: 25,
      date_key: '2026-06-03',
      started_at: '2026-06-03 09:00:00',
      completed_at: '2026-06-03 09:25:00',
    }

    expect(() => validatePomodoroSessionPayload({ ...baseSession, duration: '25' })).toThrow('pomodoro duration must be a positive number')
    expect(() => validatePomodoroSessionPayload({ ...baseSession, date_key: ['2026-06-03'] })).toThrow('pomodoro date_key must be YYYY-MM-DD')
    expect(() => validatePomodoroSessionPayload({ ...baseSession, subject_id: '1' })).toThrow('pomodoro subject_id must be a positive integer or null')
    expect(() => validatePomodoroSessionPayload({ ...baseSession, task_id: 0 })).toThrow('pomodoro task_id must be a positive integer')
    expect(() => validatePomodoroSessionPayload({ ...baseSession, task_id: -1 })).toThrow('pomodoro task_id must be a positive integer')
    expect(() => validatePomodoroSessionPayload({ ...baseSession, task_id: 1.5 })).toThrow('pomodoro task_id must be a positive integer')
    expect(() => validatePomodoroSessionPayload({ ...baseSession, task_id: '1' })).toThrow('pomodoro task_id must be a positive integer')
  })

  it('accepts valid pomodoro session payloads unchanged', () => {
    const session = {
      subject_id: 1,
      task_id: 2,
      duration: 25,
      date_key: '2026-06-03',
      started_at: '2026-06-03 09:00:00',
      completed_at: '2026-06-03 09:25:00',
    }

    expect(validatePomodoroSessionPayload(session)).toBe(session)
  })

  it('rejects invalid mistake review ids and raw quality payloads', () => {
    const reviewData = {
      ease_factor: 2.5,
      review_interval: 1,
      next_review_date: '2026-06-04',
      review_count: 1,
    }

    expect(() => validateMistakeReviewPayload(0, reviewData)).toThrow('mistake id must be a positive integer')
    expect(() => validateMistakeReviewPayload(1, { quality: 6 })).toThrow('mistakes:review payload must contain review data, not raw quality')
  })

  it('rejects invalid mistake review data fields', () => {
    expect(() => validateMistakeReviewPayload(1, {
      ease_factor: 2.5,
      review_interval: 1,
      next_review_date: null,
      review_count: 1,
    })).toThrow('mistake next_review_date must be YYYY-MM-DD')
  })

  it('accepts valid mistake review payloads unchanged', () => {
    const reviewData = {
      ease_factor: 2.5,
      review_interval: 1,
      next_review_date: '2026-06-04',
      review_count: 1,
    }

    expect(validateMistakeReviewPayload(1, reviewData)).toEqual({ id: 1, data: reviewData })
  })

  it('rejects invalid entry create title, content, and date payloads', () => {
    const baseEntry = {
      date: '2026-06-03',
      title: 'Today',
      content: 'Study notes',
      mood: null,
    }

    expect(() => validateEntryCreatePayload({ ...baseEntry, title: ['Today'] })).toThrow('entry title must be a string')
    expect(() => validateEntryCreatePayload({ ...baseEntry, content: { blocks: [] } })).toThrow('entry content must be a string')
    expect(() => validateEntryCreatePayload({ ...baseEntry, date: null })).toThrow('entry date must be YYYY-MM-DD')
  })

  it('rejects invalid entry update title, content, and date payloads', () => {
    expect(() => validateEntryUpdatePayload({ title: ['Today'] })).toThrow('entry title must be a string')
    expect(() => validateEntryUpdatePayload({ content: { blocks: [] } })).toThrow('entry content must be a string')
    expect(() => validateEntryUpdatePayload({ date: [] })).toThrow('entry date must be YYYY-MM-DD')
  })

  it('accepts valid entry create and update payloads unchanged', () => {
    const createPayload = {
      date: '2026-06-03',
      title: 'Today',
      content: 'Study notes',
      mood: 'calm',
      images: ['local://attachments/a.png'],
    }
    const updatePayload = {
      title: 'Updated title',
      content: 'Updated content',
      date: '2026-06-04',
      mood: null,
    }

    expect(validateEntryCreatePayload(createPayload)).toBe(createPayload)
    expect(validateEntryUpdatePayload(updatePayload)).toBe(updatePayload)
  })
})
