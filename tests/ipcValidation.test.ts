// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  IPC_VALIDATION_LIMITS,
  validateAiMessagesPayload,
  validateAiSummaryPayload,
  validateDateKeyPayload,
  validateEntryCreatePayload,
  validateEntryUpdatePayload,
  validateBulkSubjectChaptersPayload,
  validateConvertSubjectChaptersPayload,
  validateMistakeId,
  validateMistakeReviewPayload,
  validateMistakeWritePayload,
  validatePomodoroSessionPayload,
  validateSubjectChapterCompletedPayload,
  validateSubjectChapterPatchPayload,
  validateSubjectChapterReorderPayload,
  validateCreateSubjectChapterPayload,
  validateStudyTaskCreatePayload,
  validateStudyTaskQueryPayload,
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
      related_chapter_id: null,
      planned_date: '2026-06-03',
      estimate_minutes: 25,
      status: 'todo',
      source: 'manual',
    }

    expect(validateStudyTaskCreatePayload(task)).toBe(task)
  })

  it('accepts structured task query payloads and rejects unsupported fields', () => {
    const query = {
      planned_date: '2026-06-03',
      type: 'review',
      status: ['todo', 'doing'],
      related_mistake_id: 12,
      related_entry_id: null,
      related_chapter_id: 7,
    }

    expect(validateStudyTaskQueryPayload(query)).toBe(query)
    expect(() => validateStudyTaskQueryPayload({ ...query, title: 'not allowed' })).toThrow('unsupported field')
    expect(() => validateStudyTaskQueryPayload({ ...query, status: ['todo', 'blocked'] })).toThrow('task status[1] must be one of')
    expect(() => validateStudyTaskQueryPayload({ ...query, related_mistake_id: '12' })).toThrow('task related_mistake_id must be a positive integer')
    expect(() => validateStudyTaskQueryPayload({ ...query, related_chapter_id: '7' })).toThrow('task related_chapter_id must be a positive integer')
  })

  it('accepts nullable chapter task attribution and rejects invalid chapter ids', () => {
    const baseTask = { title: 'Chapter task', planned_date: '2026-06-21' }

    expect(validateStudyTaskCreatePayload({ ...baseTask, related_chapter_id: 7 })).toEqual({
      ...baseTask,
      related_chapter_id: 7,
    })
    expect(validateStudyTaskCreatePayload({ ...baseTask, related_chapter_id: null })).toEqual({
      ...baseTask,
      related_chapter_id: null,
    })
    for (const invalid of ['7', -1, 0, 1.5]) {
      expect(() => validateStudyTaskCreatePayload({ ...baseTask, related_chapter_id: invalid })).toThrow(
        'task related_chapter_id must be a positive integer',
      )
    }
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

  it('validates subject chapter create, bulk, conversion, patch, toggle, and reorder payloads', () => {
    const create = { subject_id: 1, title: '第一章 函数', notes: '重点', completed: false }
    expect(validateCreateSubjectChapterPayload(create)).toBe(create)
    expect(() => validateCreateSubjectChapterPayload({ ...create, subject_id: 0 })).toThrow('chapter subject_id must be a positive integer')
    expect(() => validateCreateSubjectChapterPayload({ ...create, title: 'x'.repeat(IPC_VALIDATION_LIMITS.chapterTitle + 1) })).toThrow('chapter title is too long')

    const bulk = {
      subject_id: 1,
      chapters: [
        { title: '第一章 函数' },
        { title: '第二章 导数', notes: '重点', completed: true },
      ],
    }
    expect(validateBulkSubjectChaptersPayload(bulk)).toBe(bulk)
    expect(() => validateBulkSubjectChaptersPayload({ subject_id: 1, chapters: [] })).toThrow('chapters must contain at least one chapter')
    expect(() => validateBulkSubjectChaptersPayload({
      subject_id: 1,
      chapters: new Array(IPC_VALIDATION_LIMITS.chapterBatch + 1).fill({ title: 'x' }),
    })).toThrow('chapters cannot contain more than')

    const conversion = { ...bulk, markCompletedCount: 1 }
    expect(validateConvertSubjectChaptersPayload(conversion)).toBe(conversion)
    expect(() => validateConvertSubjectChaptersPayload({ ...conversion, markCompletedCount: -1 })).toThrow('markCompletedCount must be a non-negative integer')

    expect(validateSubjectChapterPatchPayload({ title: '新标题', notes: '', completed: true })).toEqual({ title: '新标题', notes: '', completed: true })
    expect(validateSubjectChapterPatchPayload({})).toEqual({})
    expect(() => validateSubjectChapterPatchPayload({ sort_order: 1 })).toThrow('unsupported field')
    expect(() => validateSubjectChapterPatchPayload({ notes: 'x'.repeat(IPC_VALIDATION_LIMITS.chapterNotes + 1) })).toThrow('chapter notes is too long')

    expect(validateSubjectChapterCompletedPayload(true)).toBe(true)
    expect(validateSubjectChapterCompletedPayload(undefined)).toBeUndefined()
    expect(() => validateSubjectChapterCompletedPayload('true')).toThrow('chapter completed must be a boolean')

    expect(validateSubjectChapterReorderPayload([2, 1])).toEqual([2, 1])
    expect(() => validateSubjectChapterReorderPayload([1, 1])).toThrow('chapterIds must not contain duplicate ids')
    expect(() => validateSubjectChapterReorderPayload([])).toThrow('chapterIds must be a non-empty array')
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

  it('validates and strips mistake create and update payloads', () => {
    expect(validateMistakeWritePayload({
      id: 99,
      subject_id: 2,
      question: '问题',
      answer: '答案',
      notes: '笔记',
      mastered: false,
      ease_factor: 1.8,
      review_interval: 14,
      next_review_date: '2027-01-15',
      review_count: 4,
      image_path: null,
      answer_image_path: 'mistake_images/answer.png',
      created_at: 'ignored',
    })).toEqual({
      subject_id: 2,
      question: '问题',
      answer: '答案',
      notes: '笔记',
      mastered: false,
      ease_factor: 1.8,
      review_interval: 14,
      next_review_date: '2027-01-15',
      review_count: 4,
      image_path: null,
      answer_image_path: 'mistake_images/answer.png',
    })
    expect(validateMistakeId(2)).toBe(2)
    expect(validateMistakeWritePayload({ subject_id: 0 })).toEqual({ subject_id: null })
    expect(validateMistakeWritePayload({ mastered: 1 })).toEqual({ mastered: true })
    expect(validateMistakeWritePayload({ mastered: 0 })).toEqual({ mastered: false })
  })

  it('rejects invalid mistake ids and field types at the IPC boundary', () => {
    expect(() => validateMistakeId(0)).toThrow('mistake id must be a positive integer')
    expect(() => validateMistakeWritePayload(null)).toThrow('mistake payload must be an object')
    expect(() => validateMistakeWritePayload({ question: 42 })).toThrow('mistake question must be a string')
    expect(() => validateMistakeWritePayload({ subject_id: -1 })).toThrow('mistake subject_id must be a non-negative integer or null')
    expect(() => validateMistakeWritePayload({ mastered: 2 })).toThrow('mistake mastered must be a boolean or 0/1')
    expect(() => validateMistakeWritePayload({ image_path: [] })).toThrow('mistake image_path must be a string or null')
    expect(() => validateMistakeWritePayload({ ease_factor: 0 })).toThrow('mistake ease_factor must be a positive finite number')
    expect(() => validateMistakeWritePayload({ review_interval: 1.5 })).toThrow('mistake review_interval must be a non-negative integer')
    expect(() => validateMistakeWritePayload({ review_count: -1 })).toThrow('mistake review_count must be a non-negative integer')
    expect(() => validateMistakeWritePayload({ next_review_date: '2027-02-29' })).toThrow(
      'mistake next_review_date must be a valid calendar date or null',
    )
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
