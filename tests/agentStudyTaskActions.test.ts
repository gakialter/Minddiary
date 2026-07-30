import { describe, expect, it, vi } from 'vitest'
import type { StudyTask } from '../src/types'
import {
  buildConfirmedStudyTaskPayload,
  createConfirmedStudyTaskAction,
  executeConfirmedStudyTaskAction,
  validateConfirmedStudyTaskAction,
  type ConfirmedStudyTaskDraft,
  type StudyTaskActionConfirmationSnapshot,
} from '../src/utils/agentStudyTaskActions'

const todaySnapshot: StudyTaskActionConfirmationSnapshot = {
  mode: 'today_action',
  contextFingerprint: 'today-context-fixture',
  expectedCurrentDate: '2026-06-12',
  plannedDate: '2026-06-12',
}

const dailySnapshot: StudyTaskActionConfirmationSnapshot = {
  mode: 'daily_review',
  contextFingerprint: 'daily-context-fixture',
  expectedCurrentDate: '2026-06-12',
  plannedDate: '2026-06-13',
}

const todayDraft: ConfirmedStudyTaskDraft = {
  title: '复习函数极限错题',
  description: '今天到期,先处理薄弱点。',
  type: 'review',
  estimate_minutes: 10,
  subject_id: 1,
  related_mistake_id: 12,
  related_entry_id: 5,
  related_chapter_id: null,
}

const dailyDraft: ConfirmedStudyTaskDraft = {
  title: '复习函数极限错题',
  description: '截至次日到期,先处理薄弱点。',
  type: 'review',
  estimate_minutes: 10,
  subject_id: 1,
  related_mistake_id: 12,
  related_entry_id: null,
  related_chapter_id: null,
}

const makeTask = (overrides: Partial<StudyTask> = {}): StudyTask => ({
  id: 99,
  title: todayDraft.title,
  description: todayDraft.description,
  type: todayDraft.type,
  subject_id: todayDraft.subject_id,
  related_mistake_id: todayDraft.related_mistake_id,
  related_entry_id: todayDraft.related_entry_id,
  related_chapter_id: null,
  planned_date: todaySnapshot.plannedDate,
  estimate_minutes: todayDraft.estimate_minutes,
  status: 'todo',
  source: 'ai',
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
  ...overrides,
})

function createAction(
  snapshot = todaySnapshot,
  draft: unknown = todayDraft,
  actionId = 'suggestion-1',
) {
  return createConfirmedStudyTaskAction({ actionId, confirmationSnapshot: snapshot, draft })
}

describe('agentStudyTaskActions', () => {
  it('accepts canonical Today Action and Daily Review fixtures', () => {
    expect(createAction()).toMatchObject({
      kind: 'create_study_task',
      actionId: 'suggestion-1',
      mode: 'today_action',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-12',
      draft: todayDraft,
    })
    expect(createAction(dailySnapshot, dailyDraft, 'daily-review-candidate-1')).toMatchObject({
      mode: 'daily_review',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-13',
      draft: dailyDraft,
    })
  })

  it.each([
    ['', 'required'],
    ['x'.repeat(81), '80 characters'],
  ])('rejects invalid title %j', (title, expectedError) => {
    expect(() => createAction(todaySnapshot, { ...todayDraft, title })).toThrow(expectedError)
  })

  it('rejects unsupported task types', () => {
    expect(() => createAction(todaySnapshot, { ...todayDraft, type: 'delete_task' })).toThrow('type is invalid')
  })

  it.each([
    [4, 'integer between 5 and 180'],
    [181, 'integer between 5 and 180'],
    [10.5, 'integer between 5 and 180'],
    [Number.NaN, 'integer between 5 and 180'],
  ])('rejects invalid estimate_minutes %s', (estimateMinutes, expectedError) => {
    expect(() => createAction(todaySnapshot, { ...todayDraft, estimate_minutes: estimateMinutes })).toThrow(expectedError)
  })

  it.each(['subject_id', 'related_mistake_id', 'related_entry_id', 'related_chapter_id'] as const)(
    'accepts positive number/null and rejects other %s values',
    field => {
      expect(createAction(todaySnapshot, { ...todayDraft, [field]: null }).draft[field]).toBeNull()
      expect(createAction(todaySnapshot, { ...todayDraft, [field]: 42 }).draft[field]).toBe(42)
      expect(() => createAction(todaySnapshot, { ...todayDraft, [field]: 0 })).toThrow('positive integer or null')
      expect(() => createAction(todaySnapshot, { ...todayDraft, [field]: '42' })).toThrow('positive integer or null')
    },
  )

  it.each([
    'id',
    'status',
    'source',
    'planned_date',
    'plannedDate',
    'created_at',
    'expectedCurrentDate',
    'contextFingerprint',
    'path',
    'sql',
    'tool',
    'priority',
  ])(
    'rejects unknown or system-owned draft field %s',
    field => {
      expect(() => createAction(todaySnapshot, { ...todayDraft, [field]: 'untrusted' })).toThrow('unsupported fields')
    },
  )

  it('rejects unknown and system-owned fields on the action envelope', () => {
    const action = createAction()
    expect(() => validateConfirmedStudyTaskAction({ ...action, status: 'done' }, todaySnapshot))
      .toThrow('unsupported fields')
  })

  it('enforces Today Action and Daily Review date invariants', () => {
    expect(() => createAction({ ...todaySnapshot, plannedDate: '2026-06-13' }))
      .toThrow('today_action plannedDate')
    expect(() => createAction({ ...dailySnapshot, plannedDate: dailySnapshot.expectedCurrentDate }))
      .toThrow('daily_review plannedDate')
  })

  it.each([
    ['2026-01-31', '2026-02-01'],
    ['2026-12-31', '2027-01-01'],
    ['2024-02-29', '2024-03-01'],
  ])('accepts Daily Review local next-date fixture %s -> %s', (expectedCurrentDate, plannedDate) => {
    expect(createAction({
      ...dailySnapshot,
      expectedCurrentDate,
      plannedDate,
    }).plannedDate).toBe(plannedDate)
  })

  it('rejects impossible local dates instead of normalizing them', () => {
    expect(() => createAction({
      ...todaySnapshot,
      expectedCurrentDate: '2026-02-31',
      plannedDate: '2026-02-31',
    })).toThrow('valid local date key')
  })

  it('rejects a context fingerprint that does not match the confirmation snapshot', () => {
    const action = createAction()
    expect(() => validateConfirmedStudyTaskAction(action, {
      ...todaySnapshot,
      contextFingerprint: 'newer-context-fixture',
    })).toThrow('contextFingerprint does not match')
  })

  it('builds a canonical NewStudyTask payload with local-only system fields', () => {
    expect(buildConfirmedStudyTaskPayload(createAction())).toEqual({
      title: todayDraft.title,
      description: todayDraft.description,
      type: todayDraft.type,
      subject_id: 1,
      related_mistake_id: 12,
      related_entry_id: 5,
      related_chapter_id: null,
      planned_date: '2026-06-12',
      estimate_minutes: 10,
      status: 'todo',
      source: 'ai',
    })
  })

  it('executes once through createForCurrentDate and returns the shared succeeded result', async () => {
    const task = makeTask()
    const createForCurrentDate = vi.fn().mockResolvedValue(task)

    await expect(executeConfirmedStudyTaskAction(
      createAction(),
      todaySnapshot,
      { createForCurrentDate },
    )).resolves.toEqual({
      actionId: 'suggestion-1',
      status: 'succeeded',
      task,
    })
    expect(createForCurrentDate).toHaveBeenCalledWith(
      expect.objectContaining({ planned_date: '2026-06-12', status: 'todo', source: 'ai' }),
      '2026-06-12',
    )
  })

  it('returns the shared failed result without retrying', async () => {
    const createForCurrentDate = vi.fn().mockRejectedValue(new Error('date gate rejected'))

    await expect(executeConfirmedStudyTaskAction(
      createAction(),
      todaySnapshot,
      { createForCurrentDate },
    )).resolves.toEqual({
      actionId: 'suggestion-1',
      status: 'failed',
      error: 'date gate rejected',
    })
    expect(createForCurrentDate).toHaveBeenCalledTimes(1)
  })

  it('does zero writes when the confirmation fingerprint is stale', async () => {
    const createForCurrentDate = vi.fn()

    await expect(executeConfirmedStudyTaskAction(
      createAction(),
      { ...todaySnapshot, contextFingerprint: 'newer-context-fixture' },
      { createForCurrentDate },
    )).resolves.toMatchObject({
      actionId: 'suggestion-1',
      status: 'failed',
      error: expect.stringContaining('contextFingerprint does not match'),
    })
    expect(createForCurrentDate).not.toHaveBeenCalled()
  })

  it('uses only the local action ID and never reads one from the draft', () => {
    expect(() => createAction(todaySnapshot, { ...todayDraft, actionId: 'model-action-id' }))
      .toThrow('unsupported fields')
    expect(createAction(todaySnapshot, todayDraft, 'local-client-id').actionId).toBe('local-client-id')
  })
})
