// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { createStudyTaskForCurrentDate } from '../electron/dateBoundTaskCreation'
import type { NewStudyTask, StudyTask } from '../src/types'
import {
  createConfirmedStudyTaskAction,
  executeConfirmedStudyTaskAction,
  type StudyTaskActionConfirmationSnapshot,
} from '../src/utils/agentStudyTaskActions'
import { createAIStudyTaskGenerationProvenance } from '../src/utils/aiOperationContracts'

const taskInput: NewStudyTask = {
  title: 'Date-bound candidate',
  planned_date: '2026-06-01',
  status: 'todo',
  source: 'ai',
}

const createdTask: StudyTask = {
  id: 1,
  title: taskInput.title,
  description: '',
  type: 'custom',
  subject_id: null,
  related_mistake_id: null,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: taskInput.planned_date,
  estimate_minutes: 25,
  status: 'todo',
  source: 'ai',
  created_at: '2026-05-31T15:59:59.000Z',
  updated_at: '2026-05-31T15:59:59.000Z',
}

describe('date-bound main-process task creation', () => {
  it('rejects a stale expected date before invoking the database write', () => {
    const createTask = vi.fn(() => createdTask)

    expect(() => createStudyTaskForCurrentDate(taskInput, '2026-05-31', {
      getCurrentDateKey: () => '2026-06-01',
      createTask,
      runInTransaction: operation => operation(),
    })).toThrow('The current local date changed before task creation')

    expect(createTask).not.toHaveBeenCalled()
  })

  it('creates when the expected date remains current across the synchronous transaction', () => {
    const createTask = vi.fn(() => createdTask)

    expect(createStudyTaskForCurrentDate(taskInput, '2026-05-31', {
      getCurrentDateKey: () => '2026-05-31',
      createTask,
      runInTransaction: operation => operation(),
    })).toEqual(createdTask)

    expect(createTask).toHaveBeenCalledWith(taskInput)
  })

  it('rolls back when the local date changes during the SQLite transaction', () => {
    const database = new BetterSqlite3(':memory:')
    database.exec('CREATE TABLE writes (id INTEGER PRIMARY KEY)')
    const dates = ['2026-05-31', '2026-06-01']

    try {
      expect(() => createStudyTaskForCurrentDate(taskInput, '2026-05-31', {
        getCurrentDateKey: () => dates.shift() ?? '2026-06-01',
        createTask: () => {
          database.prepare('INSERT INTO writes DEFAULT VALUES').run()
          return createdTask
        },
        runInTransaction: operation => database.transaction(operation)(),
      })).toThrow('The current local date changed before task creation')

      const row = database.prepare('SELECT COUNT(*) AS count FROM writes').get() as { count: number }
      expect(row.count).toBe(0)
    } finally {
      database.close()
    }
  })

  it('keeps SQLite unchanged when a stale Today Action reaches the main date gate', async () => {
    const database = new BetterSqlite3(':memory:')
    database.exec('CREATE TABLE writes (id INTEGER PRIMARY KEY)')
    const confirmationSnapshot: StudyTaskActionConfirmationSnapshot = {
      mode: 'today_action',
      generation: createAIStudyTaskGenerationProvenance('today_action', 'a'.repeat(64)),
      confirmationContextSignature: 'today-before-midnight',
      generationChapterSignature: 'b'.repeat(64),
      latestReviewedChapterSignature: 'b'.repeat(64),
      staleContextOverride: false,
      staleReviewToken: null,
      expectedCurrentDate: '2026-05-31',
      plannedDate: '2026-05-31',
    }
    const action = createConfirmedStudyTaskAction({
      operationId: '11111111-1111-4111-8111-111111111111',
      confirmationSnapshot,
      draft: {
        title: 'Old-date Today candidate',
        description: 'Confirmed after the local date changed.',
        type: 'focus',
        estimate_minutes: 25,
        subject_id: null,
        related_mistake_id: null,
        related_entry_id: null,
        related_chapter_id: null,
      },
    })

    try {
      const result = await executeConfirmedStudyTaskAction(action, confirmationSnapshot, {
        createIdempotentAIStudyTaskForCurrentDate: async request => {
          try {
            const task = createStudyTaskForCurrentDate(request.payload, request.expectedCurrentDate, {
              getCurrentDateKey: () => '2026-06-01',
              createTask: () => {
                database.prepare('INSERT INTO writes DEFAULT VALUES').run()
                return createdTask
              },
              runInTransaction: operation => database.transaction(operation)(),
            })
            return { ok: true, operationId: request.operationId, task, replayed: false }
          } catch (error) {
            return {
              ok: false,
              operationId: request.operationId,
              code: 'DATE_MISMATCH' as const,
              message: error instanceof Error ? error.message : String(error),
            }
          }
        },
      })

      expect(result).toMatchObject({
        operationId: '11111111-1111-4111-8111-111111111111',
        status: 'failed',
        error: expect.stringContaining('current local date changed'),
      })
      expect(database.prepare('SELECT COUNT(*) AS count FROM writes').get()).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })
})
