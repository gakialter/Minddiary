import { describe, expect, it, vi } from 'vitest'
import type { StudyTask } from '../src/types'
import {
  buildConfirmedStudyTaskPayload,
  buildIdempotentAIStudyTaskCreateRequest,
  buildTodayActionStaleReviewAuthorizationRequest,
  createConfirmedStudyTaskOperationId,
  createConfirmedStudyTaskAction,
  executeConfirmedStudyTaskAction,
  validateConfirmedStudyTaskOperationId,
  validateConfirmedStudyTaskAction,
  type ConfirmedStudyTaskDraft,
  type StudyTaskActionConfirmationSnapshot,
} from '../src/utils/agentStudyTaskActions'
import {
  createAIStudyTaskGenerationProvenance,
  type AIStudyTaskGenerationProvenance,
} from '../src/utils/aiOperationContracts'

const TODAY_GENERATION_CONTEXT_SIGNATURE = 'b'.repeat(64)
const TODAY_GENERATION_CHAPTER_SIGNATURE = 'c'.repeat(64)

const todaySnapshot: StudyTaskActionConfirmationSnapshot = {
  mode: 'today_action',
  generation: createAIStudyTaskGenerationProvenance('today_action', TODAY_GENERATION_CONTEXT_SIGNATURE),
  confirmationContextSignature: 'today-generation-context-fixture',
  generationChapterSignature: TODAY_GENERATION_CHAPTER_SIGNATURE,
  latestReviewedChapterSignature: TODAY_GENERATION_CHAPTER_SIGNATURE,
  staleContextOverride: false,
  staleReviewToken: null,
  expectedCurrentDate: '2026-06-12',
  plannedDate: '2026-06-12',
}

const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const DAILY_OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const MISTAKE_OPERATION_ID = '33333333-3333-4333-8333-333333333333'
const MISTAKE_CONTEXT_SIGNATURE = 'a'.repeat(64)

const dailySnapshot: StudyTaskActionConfirmationSnapshot = {
  mode: 'daily_review',
  generation: createAIStudyTaskGenerationProvenance('daily_review', 'daily-generation-context-fixture'),
  confirmationContextSignature: 'daily-confirmation-context-fixture',
  expectedCurrentDate: '2026-06-12',
  plannedDate: '2026-06-13',
}

const mistakeSnapshot: StudyTaskActionConfirmationSnapshot = {
  mode: 'mistake_review',
  generation: createAIStudyTaskGenerationProvenance('mistake_review', MISTAKE_CONTEXT_SIGNATURE),
  confirmationContextSignature: MISTAKE_CONTEXT_SIGNATURE,
  generationMistakeRef: 'm1',
  expectedCurrentDate: '2026-06-12',
  plannedDate: '2026-06-12',
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

const mistakeDraft: ConfirmedStudyTaskDraft = {
  title: '复习函数极限错题',
  description: '今天到期,先处理薄弱点。',
  type: 'review',
  estimate_minutes: 25,
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
  operationId = OPERATION_ID,
) {
  return createConfirmedStudyTaskAction({ operationId, confirmationSnapshot: snapshot, draft })
}

describe('agentStudyTaskActions', () => {
  it('generates and validates a lowercase UUID v4 operation ID', () => {
    expect(createConfirmedStudyTaskOperationId(() => OPERATION_ID)).toBe(OPERATION_ID)
    expect(validateConfirmedStudyTaskOperationId(OPERATION_ID)).toBe(OPERATION_ID)
    expect(() => validateConfirmedStudyTaskOperationId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase()))
      .toThrow('lowercase UUID v4')
    expect(() => validateConfirmedStudyTaskOperationId('11111111-1111-5111-8111-111111111111'))
      .toThrow('lowercase UUID v4')
    expect(() => createConfirmedStudyTaskOperationId(() => 'not-secure')).toThrow('lowercase UUID v4')
  })

  it('accepts canonical Today Action, Daily Review, and Mistake Review fixtures', () => {
    expect(createAction()).toMatchObject({
      kind: 'create_study_task',
      operationId: OPERATION_ID,
      mode: 'today_action',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-12',
      generationChapterSignature: TODAY_GENERATION_CHAPTER_SIGNATURE,
      latestReviewedChapterSignature: TODAY_GENERATION_CHAPTER_SIGNATURE,
      staleContextOverride: false,
      staleReviewToken: null,
      draft: todayDraft,
    })
    expect(createAction(dailySnapshot, dailyDraft, DAILY_OPERATION_ID)).toMatchObject({
      mode: 'daily_review',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-13',
      draft: dailyDraft,
    })
    expect(createAction(mistakeSnapshot, mistakeDraft, MISTAKE_OPERATION_ID)).toMatchObject({
      mode: 'mistake_review',
      generationMistakeRef: 'm1',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-12',
      draft: mistakeDraft,
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

  it.each(['subject_id', 'related_mistake_id', 'related_entry_id'] as const)(
    'accepts positive number/null and rejects other %s values',
    field => {
      expect(createAction(todaySnapshot, { ...todayDraft, [field]: null }).draft[field]).toBeNull()
      expect(createAction(todaySnapshot, { ...todayDraft, [field]: 42 }).draft[field]).toBe(42)
      expect(() => createAction(todaySnapshot, { ...todayDraft, [field]: 0 })).toThrow('positive integer or null')
      expect(() => createAction(todaySnapshot, { ...todayDraft, [field]: '42' })).toThrow('positive integer or null')
    },
  )

  it('hard-rejects a Today Action chapter relation while leaving Daily relation semantics unchanged', () => {
    expect(() => createAction(todaySnapshot, { ...todayDraft, related_chapter_id: 42 }))
      .toThrow('Today Action related_chapter_id must be null')
    expect(createAction(dailySnapshot, { ...dailyDraft, related_chapter_id: 42 }, DAILY_OPERATION_ID).draft.related_chapter_id)
      .toBe(42)
  })

  it('accepts an omitted related_chapter_id and normalizes it to null', () => {
    expect(createAction(todaySnapshot, {
      title: todayDraft.title,
      description: todayDraft.description,
      type: todayDraft.type,
      estimate_minutes: todayDraft.estimate_minutes,
      subject_id: todayDraft.subject_id,
      related_mistake_id: todayDraft.related_mistake_id,
      related_entry_id: todayDraft.related_entry_id,
    }).draft.related_chapter_id).toBeNull()
  })

  it('ignores a prototype-only related_chapter_id and normalizes it to null', () => {
    const draft = Object.assign(Object.create({ related_chapter_id: 42 }), {
      title: todayDraft.title,
      description: todayDraft.description,
      type: todayDraft.type,
      estimate_minutes: todayDraft.estimate_minutes,
      subject_id: todayDraft.subject_id,
      related_mistake_id: todayDraft.related_mistake_id,
      related_entry_id: todayDraft.related_entry_id,
    })

    expect(createAction(todaySnapshot, draft).draft.related_chapter_id).toBeNull()
  })

  it('accepts an own undefined related_chapter_id and normalizes it to null', () => {
    expect(createAction(todaySnapshot, {
      ...todayDraft,
      related_chapter_id: undefined,
    }).draft.related_chapter_id).toBeNull()
  })

  it.each([0, -1, 1.5, '42', {}])(
    'rejects invalid own related_chapter_id value %j',
    relatedChapterId => {
      expect(() => createAction(todaySnapshot, {
        ...todayDraft,
        related_chapter_id: relatedChapterId,
      })).toThrow('positive integer or null')
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
    'generation',
    'confirmationContextSignature',
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

  it('rejects unsupported non-enumerable and symbol own draft fields', () => {
    const nonEnumerableDraft = { ...todayDraft }
    Object.defineProperty(nonEnumerableDraft, 'hidden', { value: true, enumerable: false })
    expect(() => createAction(todaySnapshot, nonEnumerableDraft)).toThrow('unsupported fields: hidden')

    const symbolDraft = { ...todayDraft, [Symbol('hidden')]: true }
    expect(() => createAction(todaySnapshot, symbolDraft)).toThrow('unsupported fields: Symbol(hidden)')
  })

  it('rejects unknown and system-owned fields on the action envelope', () => {
    const action = createAction()
    expect(() => validateConfirmedStudyTaskAction({ ...action, status: 'done' }, todaySnapshot))
      .toThrow('unsupported fields')
    expect(() => createAction({ ...todaySnapshot, status: 'done' } as StudyTaskActionConfirmationSnapshot))
      .toThrow('unsupported fields')
  })

  it('does not accept required action fields inherited through the prototype chain', () => {
    const action = createAction()

    expect(() => validateConfirmedStudyTaskAction(Object.create(action), todaySnapshot))
      .toThrow('missing required fields')
    expect(() => createConfirmedStudyTaskAction({
      operationId: OPERATION_ID,
      confirmationSnapshot: Object.create(todaySnapshot),
      draft: todayDraft,
    })).toThrow('missing required fields')
    expect(() => createAction(todaySnapshot, Object.create(todayDraft)))
      .toThrow('missing required fields')
  })

  it('rejects a missing required related_entry_id', () => {
    expect(() => createAction(todaySnapshot, {
      title: todayDraft.title,
      description: todayDraft.description,
      type: todayDraft.type,
      estimate_minutes: todayDraft.estimate_minutes,
      subject_id: todayDraft.subject_id,
      related_mistake_id: todayDraft.related_mistake_id,
      related_chapter_id: todayDraft.related_chapter_id,
    })).toThrow('study task draft.related_entry_id')
  })

  it('enforces Today Action, Daily Review, and Mistake Review date invariants', () => {
    expect(() => createAction({ ...todaySnapshot, plannedDate: '2026-06-13' }))
      .toThrow('today_action plannedDate')
    expect(() => createAction({ ...dailySnapshot, plannedDate: dailySnapshot.expectedCurrentDate }))
      .toThrow('daily_review plannedDate')
    expect(() => createAction({ ...mistakeSnapshot, plannedDate: '2026-06-13' }, mistakeDraft, MISTAKE_OPERATION_ID))
      .toThrow('mistake_review plannedDate')
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

  it('allows generation and confirmation signatures to differ', () => {
    const action = createAction(dailySnapshot, dailyDraft)
    expect(action.generation.generationContextSignature).toBe('daily-generation-context-fixture')
    expect(action.confirmationContextSignature).toBe('daily-confirmation-context-fixture')
  })

  it('rejects provenance or confirmation context that does not match the confirmation snapshot', () => {
    const action = createAction()
    expect(() => validateConfirmedStudyTaskAction(action, {
      ...todaySnapshot,
      generation: createAIStudyTaskGenerationProvenance('today_action', 'd'.repeat(64)),
    })).toThrow('generation provenance does not match')
    expect(() => validateConfirmedStudyTaskAction(action, {
      ...todaySnapshot,
      confirmationContextSignature: 'newer-context-fixture',
    })).toThrow('confirmation context signature does not match')
  })

  it('cross-checks operation kind against mode', () => {
    expect(() => createAction({
      ...todaySnapshot,
      generation: createAIStudyTaskGenerationProvenance('daily_review', 'daily-context-fixture'),
    })).toThrow('operation kind does not match action mode')
  })

  it.each([
    'promptVersion',
    'responseSchemaVersion',
    'parserVersion',
    'policyVersion',
    'contextProjectionVersion',
    'actionContractVersion',
  ] as const)('rejects non-canonical %s even when action and snapshot carry the same forged tuple', field => {
    const forgedGeneration: AIStudyTaskGenerationProvenance = {
      ...todaySnapshot.generation,
      versions: {
        ...todaySnapshot.generation.versions,
        [field]: `forged-${field}`,
      },
    }
    const forgedSnapshot = { ...todaySnapshot, generation: forgedGeneration }
    const forgedAction = { ...createAction(), generation: forgedGeneration }

    expect(() => validateConfirmedStudyTaskAction(forgedAction, forgedSnapshot))
      .toThrow(`${field} is not canonical`)
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

  it('builds the frozen exact Today Action v2 privileged request', () => {
    const action = createAction()
    const request = buildIdempotentAIStudyTaskCreateRequest(action)

    expect(request).toEqual({
      operationId: OPERATION_ID,
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      expectedCurrentDate: '2026-06-12',
      contextProjectionVersion: 'today-action.context-projection.v2',
      originalGenerationContextSignature: TODAY_GENERATION_CONTEXT_SIGNATURE,
      generationChapterSignature: TODAY_GENERATION_CHAPTER_SIGNATURE,
      latestReviewedChapterSignature: TODAY_GENERATION_CHAPTER_SIGNATURE,
      staleContextOverride: false,
      staleReviewToken: null,
      payload: buildConfirmedStudyTaskPayload(action),
    })
    expect(Object.keys(request)).toEqual([
      'operationId',
      'operationKind',
      'actionContractVersion',
      'expectedCurrentDate',
      'contextProjectionVersion',
      'originalGenerationContextSignature',
      'generationChapterSignature',
      'latestReviewedChapterSignature',
      'staleContextOverride',
      'staleReviewToken',
      'payload',
    ])
  })

  it('builds an exact token-free stale-review authorization core', () => {
    const latestReviewedChapterSignature = 'd'.repeat(64)
    const request = buildTodayActionStaleReviewAuthorizationRequest({
      operationId: OPERATION_ID,
      generation: todaySnapshot.generation,
      generationChapterSignature: TODAY_GENERATION_CHAPTER_SIGNATURE,
      latestReviewedChapterSignature,
      expectedCurrentDate: todaySnapshot.expectedCurrentDate,
      draft: todayDraft,
    })
    expect(request).toEqual({
      operationId: OPERATION_ID,
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      expectedCurrentDate: '2026-06-12',
      contextProjectionVersion: 'today-action.context-projection.v2',
      originalGenerationContextSignature: TODAY_GENERATION_CONTEXT_SIGNATURE,
      generationChapterSignature: TODAY_GENERATION_CHAPTER_SIGNATURE,
      latestReviewedChapterSignature,
      staleContextOverride: true,
      payload: buildConfirmedStudyTaskPayload(createAction()),
    })
    expect(Object.keys(request)).toEqual([
      'operationId',
      'operationKind',
      'actionContractVersion',
      'expectedCurrentDate',
      'contextProjectionVersion',
      'originalGenerationContextSignature',
      'generationChapterSignature',
      'latestReviewedChapterSignature',
      'staleContextOverride',
      'payload',
    ])
  })

  it('accepts only structurally authorized stale-review state in a Today confirmation snapshot', () => {
    const reviewedSignature = 'd'.repeat(64)
    const token = 'e'.repeat(64)
    const overrideSnapshot: StudyTaskActionConfirmationSnapshot = {
      ...todaySnapshot,
      latestReviewedChapterSignature: reviewedSignature,
      staleContextOverride: true,
      staleReviewToken: token,
    }
    expect(createAction(overrideSnapshot)).toMatchObject({
      latestReviewedChapterSignature: reviewedSignature,
      staleContextOverride: true,
      staleReviewToken: token,
    })
    expect(() => createAction({ ...overrideSnapshot, staleReviewToken: 'E'.repeat(64) }))
      .toThrow('staleReviewToken')
    expect(() => createAction({ ...todaySnapshot, latestReviewedChapterSignature: reviewedSignature }))
      .toThrow('must match generationChapterSignature')
  })

  it('builds a C5 v2 privileged request carrying the whole-context proof and candidate alias', () => {
    const action = createAction(mistakeSnapshot, mistakeDraft, MISTAKE_OPERATION_ID)
    expect(buildIdempotentAIStudyTaskCreateRequest(action)).toEqual({
      operationId: MISTAKE_OPERATION_ID,
      operationKind: 'mistake_review',
      actionContractVersion: 'confirmed-mistake-review-task-action.v2',
      expectedCurrentDate: '2026-06-12',
      contextProjectionVersion: 'mistake-review.context-projection.v1',
      generationContextSignature: MISTAKE_CONTEXT_SIGNATURE,
      generationMistakeRef: 'm1',
      payload: buildConfirmedStudyTaskPayload(action),
    })
  })

  it('executes once through the idempotent route and returns the shared succeeded result', async () => {
    const task = makeTask()
    const createIdempotentAIStudyTaskForCurrentDate = vi.fn().mockResolvedValue({
      ok: true,
      operationId: OPERATION_ID,
      task,
      replayed: false,
    })

    await expect(executeConfirmedStudyTaskAction(
      createAction(),
      todaySnapshot,
      { createIdempotentAIStudyTaskForCurrentDate },
    )).resolves.toEqual({
      operationId: OPERATION_ID,
      status: 'succeeded',
      task,
      replayed: false,
    })
    expect(createIdempotentAIStudyTaskForCurrentDate).toHaveBeenCalledWith(expect.objectContaining({
      operationId: OPERATION_ID,
      operationKind: 'today_action',
      expectedCurrentDate: '2026-06-12',
      payload: expect.objectContaining({ planned_date: '2026-06-12', status: 'todo', source: 'ai' }),
    }))
  })

  it('accepts a replayed task whose estimate was legitimately edited after creation', async () => {
    const task = makeTask({ estimate_minutes: 240 })
    const createIdempotentAIStudyTaskForCurrentDate = vi.fn().mockResolvedValue({
      ok: true,
      operationId: OPERATION_ID,
      task,
      replayed: true,
    })

    await expect(executeConfirmedStudyTaskAction(
      createAction(),
      todaySnapshot,
      { createIdempotentAIStudyTaskForCurrentDate },
    )).resolves.toEqual({
      operationId: OPERATION_ID,
      status: 'succeeded',
      task,
      replayed: true,
    })
  })

  it('classifies a rejected bridge result as uncertain without retrying', async () => {
    const createIdempotentAIStudyTaskForCurrentDate = vi.fn().mockRejectedValue(new Error('transport lost'))

    await expect(executeConfirmedStudyTaskAction(
      createAction(),
      todaySnapshot,
      { createIdempotentAIStudyTaskForCurrentDate },
    )).resolves.toEqual({
      operationId: OPERATION_ID,
      status: 'uncertain',
      error: expect.stringContaining('结果不确定'),
    })
    expect(createIdempotentAIStudyTaskForCurrentDate).toHaveBeenCalledTimes(1)
  })

  it('keeps a structured domain rejection definite', async () => {
    const createIdempotentAIStudyTaskForCurrentDate = vi.fn().mockResolvedValue({
      ok: false,
      operationId: OPERATION_ID,
      code: 'DATE_MISMATCH',
      message: 'date gate rejected',
    })

    await expect(executeConfirmedStudyTaskAction(
      createAction(),
      todaySnapshot,
      { createIdempotentAIStudyTaskForCurrentDate },
    )).resolves.toEqual({
      operationId: OPERATION_ID,
      status: 'failed',
      code: 'DATE_MISMATCH',
      error: 'date gate rejected',
    })
  })

  it.each([
    null,
    { ok: true, operationId: OPERATION_ID, task: { id: 0 }, replayed: false },
    { ok: true, operationId: OPERATION_ID, task: { id: 1 }, replayed: false },
    { ok: true, operationId: OPERATION_ID, task: { ...makeTask(), extra: true }, replayed: false },
    {
      ok: true,
      operationId: OPERATION_ID,
      task: makeTask({ planned_date: '2026-02-30' }),
      replayed: false,
    },
    { ok: true, operationId: OPERATION_ID, task: makeTask({ estimate_minutes: 0 }), replayed: false },
    { ok: true, operationId: OPERATION_ID, task: makeTask({ estimate_minutes: 10.5 }), replayed: false },
    { ok: true, operationId: DAILY_OPERATION_ID, task: makeTask(), replayed: false },
    { ok: false, operationId: OPERATION_ID, code: 'UNKNOWN', message: 'unknown' },
    { ok: false, operationId: OPERATION_ID, code: 'DATE_MISMATCH', message: 'stale', extra: true },
  ])('keeps malformed or mismatched bridge response %j uncertain', async response => {
    const createIdempotentAIStudyTaskForCurrentDate = vi.fn().mockResolvedValue(response)

    await expect(executeConfirmedStudyTaskAction(
      createAction(),
      todaySnapshot,
      { createIdempotentAIStudyTaskForCurrentDate },
    )).resolves.toEqual({
      operationId: OPERATION_ID,
      status: 'uncertain',
      error: expect.stringContaining('结果不确定'),
    })
  })

  it('does zero writes when the confirmation context does not match', async () => {
    const createIdempotentAIStudyTaskForCurrentDate = vi.fn()

    await expect(executeConfirmedStudyTaskAction(
      createAction(),
      { ...todaySnapshot, confirmationContextSignature: 'newer-context-fixture' },
      { createIdempotentAIStudyTaskForCurrentDate },
    )).resolves.toMatchObject({
      operationId: OPERATION_ID,
      status: 'failed',
      error: expect.stringContaining('confirmation context signature does not match'),
    })
    expect(createIdempotentAIStudyTaskForCurrentDate).not.toHaveBeenCalled()
  })

  it('uses only the local operation ID and never reads one from the draft', () => {
    expect(() => createAction(todaySnapshot, { ...todayDraft, operationId: OPERATION_ID }))
      .toThrow('unsupported fields')
    expect(createAction(todaySnapshot, todayDraft, DAILY_OPERATION_ID).operationId).toBe(DAILY_OPERATION_ID)
    expect(() => createAction(todaySnapshot, todayDraft, 'local-client-id')).toThrow('lowercase UUID v4')
  })
})
