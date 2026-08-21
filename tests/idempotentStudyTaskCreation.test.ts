// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { createHash } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  buildIdempotentAIStudyTaskRequestDigest,
  createIdempotentAIStudyTaskForCurrentDate,
  validateIdempotentAIStudyTaskCreateRequest,
} from '../electron/idempotentStudyTaskCreation'
import { runDatabaseMigrations } from '../electron/databaseMigrations'
import type { Mistake, NewStudyTask, StudyTask, Subject } from '../src/types'
import type { IdempotentAIStudyTaskCreateRequest } from '../src/types/api'
import {
  buildMistakeReviewContextSignatureString,
  prepareMistakeReviewSession,
} from '../src/utils/mistakeReviewSuggestions'

const OPERATION_ID = '123e4567-e89b-42d3-a456-426614174000'
const EXPECTED_DATE = '2026-07-30'
const NEXT_DATE = '2026-07-31'
const ACTION_CONTRACT_VERSION = 'confirmed-study-task-action.v1'

const BASE_PAYLOAD = {
  title: 'Review calculus',
  description: 'Focus on derivative mistakes',
  type: 'review',
  subject_id: null,
  related_mistake_id: null,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: EXPECTED_DATE,
  estimate_minutes: 25,
  status: 'todo',
  source: 'ai',
} satisfies Required<NewStudyTask>

type RequestOverrides = Partial<Omit<IdempotentAIStudyTaskCreateRequest, 'payload'>> & {
  payload?: Partial<Required<NewStudyTask>>
}

const databases: Database.Database[] = []

function makeRequest(overrides: RequestOverrides = {}): IdempotentAIStudyTaskCreateRequest {
  return {
    operationId: overrides.operationId ?? OPERATION_ID,
    operationKind: overrides.operationKind ?? 'today_action',
    actionContractVersion: overrides.actionContractVersion ?? ACTION_CONTRACT_VERSION,
    expectedCurrentDate: overrides.expectedCurrentDate ?? EXPECTED_DATE,
    payload: {
      ...BASE_PAYLOAD,
      ...overrides.payload,
    },
  }
}

function insertTask(database: Database.Database, task: NewStudyTask): StudyTask {
  const taskId = Number(database.prepare(`
    INSERT INTO study_tasks (
      title,
      description,
      type,
      subject_id,
      related_mistake_id,
      related_entry_id,
      related_chapter_id,
      planned_date,
      estimate_minutes,
      status,
      source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.title,
    task.description ?? '',
    task.type ?? 'custom',
    task.subject_id ?? null,
    task.related_mistake_id ?? null,
    task.related_entry_id ?? null,
    task.related_chapter_id ?? null,
    task.planned_date,
    task.estimate_minutes ?? 25,
    task.status ?? 'todo',
    task.source ?? 'manual',
  ).lastInsertRowid)

  return database.prepare(`
    SELECT
      id,
      title,
      description,
      type,
      subject_id,
      related_mistake_id,
      related_entry_id,
      related_chapter_id,
      planned_date,
      estimate_minutes,
      status,
      source,
      created_at,
      updated_at
    FROM study_tasks
    WHERE id = ?
  `).get(taskId) as StudyTask
}

function createHarness(currentDate = EXPECTED_DATE) {
  const database = new BetterSqlite3(':memory:')
  databases.push(database)
  database.pragma('foreign_keys = ON')
  runDatabaseMigrations(database)
  let currentDateKey = currentDate
  const getCurrentDateKey = vi.fn(() => currentDateKey)
  const createTask = vi.fn((task: NewStudyTask) => insertTask(database, task))
  return {
    database,
    getCurrentDateKey,
    createTask,
    setCurrentDate: (value: string) => {
      currentDateKey = value
    },
  }
}

function execute(
  harness: ReturnType<typeof createHarness>,
  request: unknown = makeRequest(),
) {
  return createIdempotentAIStudyTaskForCurrentDate(request, harness)
}

function countRows(database: Database.Database, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) {
    database.close()
  }
})

describe('idempotent AI study task request validation and digest', () => {
  it('re-projects shuffled own fields into a normalized canonical request', () => {
    const payload = {
      source: 'ai',
      status: 'todo',
      estimate_minutes: 25,
      planned_date: EXPECTED_DATE,
      related_chapter_id: null,
      related_entry_id: null,
      related_mistake_id: null,
      subject_id: null,
      type: 'review',
      description: '  Line one\nline two  ',
      title: 'Ｍａｔｈ\u200b   review',
    }
    const request = {
      payload,
      expectedCurrentDate: EXPECTED_DATE,
      actionContractVersion: ACTION_CONTRACT_VERSION,
      operationKind: 'today_action',
      operationId: OPERATION_ID,
    }

    const canonical = validateIdempotentAIStudyTaskCreateRequest(request)

    expect(Object.keys(canonical)).toEqual([
      'operationId',
      'operationKind',
      'actionContractVersion',
      'expectedCurrentDate',
      'payload',
    ])
    expect(Object.keys(canonical.payload)).toEqual([
      'title',
      'description',
      'type',
      'subject_id',
      'related_mistake_id',
      'related_entry_id',
      'related_chapter_id',
      'planned_date',
      'estimate_minutes',
      'status',
      'source',
    ])
    expect(canonical.payload.title).toBe('Math review')
    expect(canonical.payload.description).toBe('Line one line two')
  })

  it('locks the manually ordered canonical UTF-8 SHA-256 fixture', () => {
    expect(buildIdempotentAIStudyTaskRequestDigest(makeRequest())).toBe(
      '55952fa2d0e899a89728442042e142c4c5b04e039d1ed08b876174d12b2db070',
    )
  })

  it('is independent of input key order and binds the full normalized description', () => {
    const reordered: IdempotentAIStudyTaskCreateRequest = {
      payload: {
        source: 'ai',
        status: 'todo',
        estimate_minutes: 25,
        planned_date: EXPECTED_DATE,
        related_chapter_id: null,
        related_entry_id: null,
        related_mistake_id: null,
        subject_id: null,
        type: 'review',
        description: 'Focus on derivative mistakes',
        title: 'Review calculus',
      },
      expectedCurrentDate: EXPECTED_DATE,
      actionContractVersion: ACTION_CONTRACT_VERSION,
      operationKind: 'today_action',
      operationId: OPERATION_ID,
    }

    expect(buildIdempotentAIStudyTaskRequestDigest(reordered)).toBe(
      buildIdempotentAIStudyTaskRequestDigest(makeRequest()),
    )
    expect(buildIdempotentAIStudyTaskRequestDigest(makeRequest({
      payload: { description: 'Focus on integral mistakes' },
    }))).not.toBe(buildIdempotentAIStudyTaskRequestDigest(makeRequest()))
  })

  it('rejects non-enumerable and symbol extras at both exact-key boundaries', () => {
    const requestWithHiddenPayloadExtra = makeRequest()
    Object.defineProperty(requestWithHiddenPayloadExtra.payload, 'hidden', {
      value: 'private',
      enumerable: false,
    })
    const requestWithSymbolExtra = makeRequest()
    Object.defineProperty(requestWithSymbolExtra, Symbol('extra'), {
      value: true,
      enumerable: false,
    })

    expect(() => validateIdempotentAIStudyTaskCreateRequest(requestWithHiddenPayloadExtra)).toThrow(/exactly/)
    expect(() => validateIdempotentAIStudyTaskCreateRequest(requestWithSymbolExtra)).toThrow(/exactly/)
  })

  it.each([
    ['uppercase UUID', makeRequest({ operationId: OPERATION_ID.toUpperCase() })],
    ['wrong UUID version', makeRequest({ operationId: '123e4567-e89b-12d3-a456-426614174000' })],
    ['unsupported action contract', makeRequest({ actionContractVersion: 'confirmed-study-task-action.v2' })],
    ['impossible date', makeRequest({ expectedCurrentDate: '2026-02-30', payload: { planned_date: '2026-02-30' } })],
    ['today invariant mismatch', makeRequest({ payload: { planned_date: NEXT_DATE } })],
    ['non-todo status', makeRequest({ payload: { status: 'doing' } })],
    ['non-ai source', makeRequest({ payload: { source: 'manual' } })],
    ['unsafe identifier', makeRequest({ payload: { subject_id: Number.MAX_SAFE_INTEGER + 1 } })],
    ['short estimate', makeRequest({ payload: { estimate_minutes: 4 } })],
    ['empty normalized title', makeRequest({ payload: { title: '\u200b\n' } })],
    ['oversized description', makeRequest({ payload: { description: 'x'.repeat(241) } })],
  ])('rejects %s', (_label, request) => {
    expect(() => validateIdempotentAIStudyTaskCreateRequest(request)).toThrow()
  })

  it('accepts the next actual date only for daily review', () => {
    const request = makeRequest({
      operationKind: 'daily_review',
      payload: { planned_date: NEXT_DATE },
    })

    expect(validateIdempotentAIStudyTaskCreateRequest(request)).toEqual(request)
    expect(() => validateIdempotentAIStudyTaskCreateRequest(makeRequest({
      operationKind: 'daily_review',
    }))).toThrow(/invariant/)
  })
})

describe('idempotent AI study task persistence', () => {
  it('creates the canonical task and receipt atomically on the first request', () => {
    const harness = createHarness()
    const request = makeRequest({
      payload: {
        title: '  Ｍａｔｈ   review ',
        description: ' Derivatives\n and limits ',
      },
    })

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: true,
      operationId: OPERATION_ID,
      replayed: false,
      task: {
        title: 'Math review',
        description: 'Derivatives and limits',
        planned_date: EXPECTED_DATE,
        status: 'todo',
        source: 'ai',
      },
    })
    expect(harness.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Math review',
      description: 'Derivatives and limits',
      related_chapter_id: null,
      status: 'todo',
      source: 'ai',
    }))
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
    expect(harness.database.prepare(`
      SELECT
        operation_id,
        operation_kind,
        action_contract_version,
        request_digest,
        expected_current_date,
        planned_date,
        task_id
      FROM study_task_action_receipts
    `).get()).toEqual({
      operation_id: OPERATION_ID,
      operation_kind: 'today_action',
      action_contract_version: ACTION_CONTRACT_VERSION,
      request_digest: buildIdempotentAIStudyTaskRequestDigest(request),
      expected_current_date: EXPECTED_DATE,
      planned_date: EXPECTED_DATE,
      task_id: 1,
    })
  })

  it('replays the same task for the same operation without creating another row', () => {
    const harness = createHarness()

    const first = execute(harness)
    const replay = execute(harness)

    expect(first).toMatchObject({ ok: true, replayed: false, task: { id: 1 } })
    expect(replay).toMatchObject({ ok: true, replayed: true, task: { id: 1 } })
    expect(harness.createTask).toHaveBeenCalledOnce()
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
  })

  it('returns an idempotency conflict with zero new writes for a changed same-ID request', () => {
    const harness = createHarness()
    const originalRequest = makeRequest()
    const originalDigest = buildIdempotentAIStudyTaskRequestDigest(originalRequest)
    execute(harness, originalRequest)

    const result = execute(harness, makeRequest({
      payload: { description: 'A different confirmed description' },
    }))

    expect(result).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' })
    expect(harness.createTask).toHaveBeenCalledOnce()
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
    expect(harness.database.prepare(`
      SELECT request_digest
      FROM study_task_action_receipts
      WHERE operation_id = ?
    `).get(OPERATION_ID)).toEqual({ request_digest: originalDigest })
    expect(execute(harness, originalRequest)).toMatchObject({
      ok: true,
      replayed: true,
      task: { id: 1 },
    })
  })

  it('replays an existing receipt before the date gate after local-date rollover', () => {
    const harness = createHarness()
    execute(harness)
    harness.getCurrentDateKey.mockClear()
    harness.setCurrentDate(NEXT_DATE)

    const replay = execute(harness)

    expect(replay).toMatchObject({ ok: true, replayed: true, task: { id: 1 } })
    expect(harness.getCurrentDateKey).not.toHaveBeenCalled()
    expect(harness.createTask).toHaveBeenCalledOnce()
  })

  it('rejects a new stale-date request without writing task or receipt rows', () => {
    const harness = createHarness(NEXT_DATE)

    const result = execute(harness)

    expect(result).toMatchObject({ ok: false, code: 'DATE_MISMATCH' })
    expect(harness.createTask).not.toHaveBeenCalled()
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('returns RESULT_DELETED after the referenced task is deleted with ON DELETE SET NULL', () => {
    const harness = createHarness()
    execute(harness)
    harness.database.prepare('DELETE FROM study_tasks WHERE id = 1').run()

    const result = execute(harness)

    expect(result).toMatchObject({ ok: false, code: 'RESULT_DELETED' })
    expect(harness.database.prepare('SELECT task_id FROM study_task_action_receipts').get()).toEqual({ task_id: null })
    expect(harness.createTask).toHaveBeenCalledOnce()
  })

  it('returns INTEGRITY_ERROR when a matching receipt points to a missing task', () => {
    const harness = createHarness()
    execute(harness)
    harness.database.pragma('foreign_keys = OFF')
    harness.database.prepare('DELETE FROM study_tasks WHERE id = 1').run()
    harness.database.pragma('foreign_keys = ON')

    const result = execute(harness)

    expect(result).toMatchObject({ ok: false, code: 'INTEGRITY_ERROR' })
    expect(harness.createTask).toHaveBeenCalledOnce()
  })

  it('returns INTEGRITY_ERROR for a corrupt matching receipt task identifier', () => {
    const harness = createHarness()
    execute(harness)
    harness.database.pragma('foreign_keys = OFF')
    harness.database.prepare("UPDATE study_task_action_receipts SET task_id = 'corrupt'").run()
    harness.database.pragma('foreign_keys = ON')

    const result = execute(harness)

    expect(result).toMatchObject({ ok: false, code: 'INTEGRITY_ERROR' })
    expect(harness.createTask).toHaveBeenCalledOnce()
  })

  it('rolls back an inserted task when createTask fails', () => {
    const harness = createHarness()
    harness.createTask.mockImplementationOnce((task) => {
      insertTask(harness.database, task)
      throw new Error('forced create failure')
    })

    const result = execute(harness)

    expect(result).toMatchObject({ ok: false, code: 'INTEGRITY_ERROR' })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rolls back the task when receipt insertion fails', () => {
    const harness = createHarness()
    harness.database.exec(`
      CREATE TRIGGER fail_receipt_insert
      BEFORE INSERT ON study_task_action_receipts
      BEGIN
        SELECT RAISE(ABORT, 'forced receipt failure');
      END;
    `)

    const result = execute(harness)

    expect(result).toMatchObject({ ok: false, code: 'INTEGRITY_ERROR' })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rolls back both rows when the date changes immediately before commit', () => {
    const harness = createHarness()
    harness.getCurrentDateKey
      .mockReturnValueOnce(EXPECTED_DATE)
      .mockReturnValueOnce(NEXT_DATE)

    const result = execute(harness)

    expect(result).toMatchObject({ ok: false, code: 'DATE_MISMATCH' })
    expect(harness.createTask).toHaveBeenCalledOnce()
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('returns INVALID_REQUEST without touching SQLite for an unsupported extra field', () => {
    const harness = createHarness()
    const request = makeRequest()
    Object.defineProperty(request.payload, 'secret', {
      value: 'must not persist',
      enumerable: false,
    })

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: false,
      operationId: OPERATION_ID,
      code: 'INVALID_REQUEST',
    })
    expect(harness.getCurrentDateKey).not.toHaveBeenCalled()
    expect(harness.createTask).not.toHaveBeenCalled()
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })
})

describe('mistake_review idempotent AI study task persistence', () => {
  const MISTAKE_CONTRACT_VERSION = 'confirmed-mistake-review-task-action.v2'
  const LEGACY_MISTAKE_CONTRACT_VERSION = 'confirmed-mistake-review-task-action.v1'
  const CONTEXT_PROJECTION_VERSION = 'mistake-review.context-projection.v1'
  const MISTAKE_OP_ID = '33333333-3333-4333-8333-333333333333'

  function insertSubject(database: Database.Database, name = 'Math'): number {
    return Number(database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').run(name, '#2563eb').lastInsertRowid)
  }

  function insertMistake(
    database: Database.Database,
    overrides: {
      subject_id?: number | null
      question?: string
      mastered?: number
      next_review_date?: string | null
      review_count?: number
    } = {},
  ): number {
    const subjectId = overrides.subject_id === undefined ? insertSubject(database) : overrides.subject_id
    return Number(database.prepare(`
      INSERT INTO mistakes (
        subject_id,
        question,
        answer,
        notes,
        mastered,
        ease_factor,
        review_interval,
        next_review_date,
        review_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      subjectId,
      overrides.question ?? 'Test Question',
      'Answer',
      'Notes',
      overrides.mastered ?? 0,
      2.5,
      1,
      overrides.next_review_date === undefined ? EXPECTED_DATE : overrides.next_review_date,
      overrides.review_count ?? 1,
    ).lastInsertRowid)
  }

  function buildCurrentProof(database: Database.Database, selectedMistakeId: number) {
    const mistakes = database.prepare(`
      SELECT id, subject_id, question, answer, notes, mastered, ease_factor,
             review_interval, next_review_date, review_count, created_at, updated_at
      FROM mistakes
    `).all() as Array<Record<string, unknown> & { mastered: number }>
    const canonicalMistakes = mistakes.map(row => ({ ...row, mastered: Boolean(row.mastered) })) as unknown as Mistake[]
    const subjects = database.prepare('SELECT id, name, color FROM subjects').all() as Subject[]
    const activeReviewTasks = database.prepare(`
      SELECT id, title, description, type, subject_id, related_mistake_id,
             related_entry_id, related_chapter_id, planned_date, estimate_minutes,
             status, source, created_at, updated_at
      FROM study_tasks
      WHERE type = 'review' AND planned_date = ? AND status IN ('todo', 'doing')
    `).all(EXPECTED_DATE) as StudyTask[]
    const session = prepareMistakeReviewSession({
      mistakes: canonicalMistakes,
      subjects,
      activeReviewTasks,
      currentDate: EXPECTED_DATE,
    })
    const generationMistakeRef = [...session.aliasMap.entries()]
      .find(([, mistake]) => mistake.id === selectedMistakeId)?.[0] ?? 'm1'
    const generationContextSignature = createHash('sha256')
      .update(buildMistakeReviewContextSignatureString(session.projection), 'utf8')
      .digest('hex')
    return { generationContextSignature, generationMistakeRef, session }
  }

  function makeMistakeRequest(
    harness: ReturnType<typeof createHarness>,
    overrides: {
      operationId?: string
      subject_id?: number
      related_mistake_id?: number
      actionContractVersion?: string
      planned_date?: string
      status?: string
      source?: string
      type?: string
      related_entry_id?: number | null
      related_chapter_id?: number | null
    } = {},
  ): IdempotentAIStudyTaskCreateRequest {
    const subjectId = overrides.subject_id ?? insertSubject(harness.database)
    const mistakeId = overrides.related_mistake_id ?? insertMistake(harness.database, { subject_id: subjectId })
    const proof = buildCurrentProof(harness.database, mistakeId)

    return {
      operationId: overrides.operationId ?? MISTAKE_OP_ID,
      operationKind: 'mistake_review',
      actionContractVersion: overrides.actionContractVersion ?? MISTAKE_CONTRACT_VERSION,
      expectedCurrentDate: EXPECTED_DATE,
      contextProjectionVersion: CONTEXT_PROJECTION_VERSION,
      generationContextSignature: proof.generationContextSignature,
      generationMistakeRef: proof.generationMistakeRef,
      payload: {
        title: 'Review Mistake',
        description: 'Overdue mistake review',
        type: (overrides.type ?? 'review') as any,
        subject_id: subjectId,
        related_mistake_id: mistakeId,
        related_entry_id: overrides.related_entry_id ?? null,
        related_chapter_id: overrides.related_chapter_id ?? null,
        planned_date: overrides.planned_date ?? EXPECTED_DATE,
        estimate_minutes: 25,
        status: (overrides.status ?? 'todo') as any,
        source: (overrides.source ?? 'ai') as any,
      },
    } as IdempotentAIStudyTaskCreateRequest
  }

  it('creates a task and receipt for a valid fresh mistake_review request', () => {
    const harness = createHarness()
    const request = makeMistakeRequest(harness)
    const mistakeBefore = harness.database.prepare(`
      SELECT review_count, ease_factor, review_interval, next_review_date, mastered
      FROM mistakes WHERE id = ?
    `).get(request.payload.related_mistake_id)
    const planningBefore = {
      runs: countRows(harness.database, 'planning_runs'),
      candidates: countRows(harness.database, 'planning_run_candidates'),
    }

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: true,
      operationId: MISTAKE_OP_ID,
      replayed: false,
      task: {
        title: 'Review Mistake',
        type: 'review',
        subject_id: request.payload.subject_id,
        related_mistake_id: request.payload.related_mistake_id,
        planned_date: EXPECTED_DATE,
        status: 'todo',
        source: 'ai',
      },
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
    expect(harness.database.prepare(`
      SELECT review_count, ease_factor, review_interval, next_review_date, mastered
      FROM mistakes WHERE id = ?
    `).get(request.payload.related_mistake_id)).toEqual(mistakeBefore)
    expect(countRows(harness.database, 'planning_runs')).toBe(planningBefore.runs)
    expect(countRows(harness.database, 'planning_run_candidates')).toBe(planningBefore.candidates)
  })

  it.each([
    ['question excerpt', "UPDATE mistakes SET question = 'Changed canonical question' WHERE id = ?"],
    ['review count', 'UPDATE mistakes SET review_count = review_count + 1 WHERE id = ?'],
    ['overdue days', "UPDATE mistakes SET next_review_date = '2026-07-29' WHERE id = ?"],
  ])('rejects a new v2 request after %s drift with zero business writes', (_label, sql) => {
    const harness = createHarness()
    const request = makeMistakeRequest(harness)
    harness.database.prepare(sql).run(request.payload.related_mistake_id)

    const result = execute(harness, request)

    expect(result).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
    expect(countRows(harness.database, 'planning_runs')).toBe(0)
    expect(countRows(harness.database, 'planning_run_candidates')).toBe(0)
  })

  it('does not reject a raw question change whose canonical truncated excerpt is unchanged', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database)
    const prefix = 'Q'.repeat(120)
    const mistakeId = insertMistake(harness.database, { subject_id: subjectId, question: `${prefix} first suffix` })
    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: mistakeId })
    harness.database.prepare('UPDATE mistakes SET question = ? WHERE id = ?').run(`${prefix} second suffix`, mistakeId)

    expect(execute(harness, request)).toMatchObject({ ok: true, replayed: false })
  })

  it('rejects canonical subject name drift', () => {
    const harness = createHarness()
    const request = makeMistakeRequest(harness)
    harness.database.prepare("UPDATE subjects SET name = 'Changed Subject' WHERE id = ?")
      .run(request.payload.subject_id)

    expect(execute(harness, request)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects when another current top-12 item drifts', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database)
    const selectedId = insertMistake(harness.database, { subject_id: subjectId, question: 'Selected' })
    const otherId = insertMistake(harness.database, { subject_id: subjectId, question: 'Other' })
    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: selectedId })
    harness.database.prepare("UPDATE mistakes SET question = 'Other changed' WHERE id = ?").run(otherId)

    expect(execute(harness, request)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('allows changes outside top-12 when canonical top-12 bytes stay unchanged', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database)
    const ids = Array.from({ length: 13 }, (_, index) => insertMistake(harness.database, {
      subject_id: subjectId,
      question: `Question ${index + 1}`,
    }))
    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: ids[0] })
    harness.database.prepare("UPDATE mistakes SET question = 'Outside changed' WHERE id = ?").run(ids[12])

    expect(execute(harness, request)).toMatchObject({ ok: true, replayed: false })
  })

  it('rejects top-12 membership/order drift', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database)
    const selectedId = insertMistake(harness.database, { subject_id: subjectId, question: 'Selected' })
    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: selectedId })
    insertMistake(harness.database, { subject_id: subjectId, question: 'New null-first', next_review_date: null })

    expect(execute(harness, request)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects alias-to-authoritative-ID remap even when provider-visible projection bytes are identical', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database, 'Same')
    const id1 = insertMistake(harness.database, {
      subject_id: subjectId,
      question: 'Same',
      next_review_date: EXPECTED_DATE,
      review_count: 1,
    })
    const id2 = insertMistake(harness.database, {
      subject_id: subjectId,
      question: 'Same',
      next_review_date: null,
      review_count: 1,
    })
    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: id2 })
    expect(request.generationMistakeRef).toBe('m1')
    harness.database.prepare('UPDATE mistakes SET next_review_date = ? WHERE id = ?').run(null, id1)
    harness.database.prepare('UPDATE mistakes SET next_review_date = ? WHERE id = ?').run(EXPECTED_DATE, id2)
    expect(buildCurrentProof(harness.database, id2).generationContextSignature)
      .toBe(request.generationContextSignature)

    expect(execute(harness, request)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('makes the v2 digest sensitive to operation ID, signature, alias, and payload', () => {
    const harness = createHarness()
    const request = makeMistakeRequest(harness)
    const digest = buildIdempotentAIStudyTaskRequestDigest(request)
    const variants = [
      { ...request, operationId: '44444444-4444-4444-8444-444444444444' },
      { ...request, generationContextSignature: 'b'.repeat(64) },
      { ...request, generationMistakeRef: 'm2' },
      { ...request, payload: { ...request.payload, title: 'Different title' } },
    ]
    for (const variant of variants) {
      expect(buildIdempotentAIStudyTaskRequestDigest(variant)).not.toBe(digest)
    }
  })

  it('matches an independent frozen C5 v2 digest oracle covering contextProjectionVersion', () => {
    const request: IdempotentAIStudyTaskCreateRequest = {
      operationId: MISTAKE_OP_ID,
      operationKind: 'mistake_review',
      actionContractVersion: MISTAKE_CONTRACT_VERSION,
      expectedCurrentDate: EXPECTED_DATE,
      contextProjectionVersion: CONTEXT_PROJECTION_VERSION,
      generationContextSignature: 'a'.repeat(64),
      generationMistakeRef: 'm1',
      payload: {
        title: 'Review Mistake',
        description: 'Overdue mistake review',
        type: 'review',
        subject_id: 1,
        related_mistake_id: 1,
        related_entry_id: null,
        related_chapter_id: null,
        planned_date: EXPECTED_DATE,
        estimate_minutes: 25,
        status: 'todo',
        source: 'ai',
      },
    }

    expect(buildIdempotentAIStudyTaskRequestDigest(request))
      .toBe('0e94beda9be7b43c72fa31fe21ee6bb6247d0c8fc92b8b95daf51279c0aa3328')
  })

  it.each(['mastered', 'not_due', 'subject_relation', 'subject_missing', 'collision'] as const)(
    'blocks the authoritative %s hard gate after generation',
    gate => {
      const harness = createHarness()
      const request = makeMistakeRequest(harness)
      const mistakeId = request.payload.related_mistake_id as number
      if (gate === 'mastered') {
        harness.database.prepare('UPDATE mistakes SET mastered = 1 WHERE id = ?').run(mistakeId)
      } else if (gate === 'not_due') {
        harness.database.prepare("UPDATE mistakes SET next_review_date = '2026-08-01' WHERE id = ?").run(mistakeId)
      } else if (gate === 'subject_relation') {
        const sameProjectedNameSubject = insertSubject(harness.database, 'Math')
        harness.database.prepare('UPDATE mistakes SET subject_id = ? WHERE id = ?')
          .run(sameProjectedNameSubject, mistakeId)
        expect(buildCurrentProof(harness.database, mistakeId).generationContextSignature)
          .toBe(request.generationContextSignature)
      } else if (gate === 'subject_missing') {
        harness.database.pragma('foreign_keys = OFF')
        harness.database.prepare('DELETE FROM subjects WHERE id = ?').run(request.payload.subject_id)
        harness.database.pragma('foreign_keys = ON')
      } else {
        insertTask(harness.database, {
          title: 'Existing review',
          type: 'review',
          planned_date: EXPECTED_DATE,
          status: 'todo',
          subject_id: request.payload.subject_id,
          related_mistake_id: mistakeId,
          estimate_minutes: 25,
          source: 'manual',
        })
      }

      const taskCountBefore = countRows(harness.database, 'study_tasks')
      expect(execute(harness, request)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
      expect(countRows(harness.database, 'study_tasks')).toBe(taskCountBefore)
      expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
    },
  )

  it.each([
    ['missing signature', (request: any) => { delete request.generationContextSignature }],
    ['short signature', (request: any) => { request.generationContextSignature = 'a'.repeat(63) }],
    ['uppercase signature', (request: any) => { request.generationContextSignature = 'A'.repeat(64) }],
    ['non-hex signature', (request: any) => { request.generationContextSignature = 'g'.repeat(64) }],
    ['missing projection version', (request: any) => { delete request.contextProjectionVersion }],
    ['wrong projection version', (request: any) => { request.contextProjectionVersion = 'mistake-review.context-projection.v2' }],
    ['missing alias', (request: any) => { delete request.generationMistakeRef }],
    ['alias m0', (request: any) => { request.generationMistakeRef = 'm0' }],
    ['alias m13', (request: any) => { request.generationMistakeRef = 'm13' }],
    ['arbitrary alias', (request: any) => { request.generationMistakeRef = 'selected' }],
    ['extra key', (request: any) => { request.extra = true }],
  ])('rejects malformed C5 v2 proof: %s', (_label, mutate) => {
    const harness = createHarness()
    const request: any = makeMistakeRequest(harness)
    mutate(request)

    expect(execute(harness, request)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects mistake_review with INVALID_REQUEST when mistake is already mastered', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database)
    const mistakeId = insertMistake(harness.database, { subject_id: subjectId, mastered: 1 })
    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: mistakeId })

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects mistake_review with INVALID_REQUEST when mistake is not due for review', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database)
    const mistakeId = insertMistake(harness.database, { subject_id: subjectId, next_review_date: '2026-08-01' }) // future
    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: mistakeId })

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects mistake_review with INVALID_REQUEST when referenced mistake does not exist', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database)
    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: 9999 })

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects mistake_review with INVALID_REQUEST when mistake has null subject', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database)
    const mistakeId = insertMistake(harness.database, { subject_id: null })
    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: mistakeId })

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects mistake_review with INVALID_REQUEST when referenced subject does not exist', () => {
    const harness = createHarness()
    const mistakeId = insertMistake(harness.database)
    const request = makeMistakeRequest(harness, { subject_id: 9999, related_mistake_id: mistakeId })

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects mistake_review with INVALID_REQUEST when mistake subject does not match payload subject', () => {
    const harness = createHarness()
    const subject1 = insertSubject(harness.database, 'Subject 1')
    const subject2 = insertSubject(harness.database, 'Subject 2')
    const mistakeId = insertMistake(harness.database, { subject_id: subject1 })
    const request = makeMistakeRequest(harness, { subject_id: subject2, related_mistake_id: mistakeId })

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects mistake_review with INVALID_REQUEST when an active same-day review task already exists', () => {
    const harness = createHarness()
    const subjectId = insertSubject(harness.database)
    const mistakeId = insertMistake(harness.database, { subject_id: subjectId })

    // Existing active review task for same date and mistake
    insertTask(harness.database, {
      title: 'Existing Review',
      type: 'review',
      planned_date: EXPECTED_DATE,
      status: 'todo',
      subject_id: subjectId,
      related_mistake_id: mistakeId,
      estimate_minutes: 25,
      source: 'manual',
    })

    const request = makeMistakeRequest(harness, { subject_id: subjectId, related_mistake_id: mistakeId })
    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('rejects cross-pair contract version (mistake_review with confirmed-study-task-action.v1)', () => {
    const harness = createHarness()
    const request = makeMistakeRequest(harness, { actionContractVersion: 'confirmed-study-task-action.v1' })

    const result = execute(harness, request)

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('replays existing receipt without revalidating current mistake state (historical truth wins)', () => {
    const harness = createHarness()
    const request = makeMistakeRequest(harness)

    const firstResult = execute(harness, request)
    expect(firstResult.ok).toBe(true)

    // Now change every relevant current-domain field after the operation completed.
    harness.database.prepare('UPDATE mistakes SET question = ?, mastered = 1, next_review_date = ? WHERE id = ?')
      .run('Changed after completion', '2026-12-31', request.payload.related_mistake_id)

    // Replay with exact same request
    const replayResult = execute(harness, request)
    expect(replayResult).toMatchObject({
      ok: true,
      operationId: MISTAKE_OP_ID,
      replayed: true,
    })
  })

  function toLegacyRequest(request: IdempotentAIStudyTaskCreateRequest): IdempotentAIStudyTaskCreateRequest {
    return {
      operationId: request.operationId,
      operationKind: 'mistake_review',
      actionContractVersion: LEGACY_MISTAKE_CONTRACT_VERSION,
      expectedCurrentDate: request.expectedCurrentDate,
      payload: request.payload,
    }
  }

  function seedLegacyReceipt(
    harness: ReturnType<typeof createHarness>,
    request: IdempotentAIStudyTaskCreateRequest,
  ): StudyTask {
    const task = insertTask(harness.database, request.payload)
    const digest = buildIdempotentAIStudyTaskRequestDigest(request)
    harness.database.prepare(`
      INSERT INTO study_task_action_receipts (
        operation_id, operation_kind, action_contract_version, request_digest,
        expected_current_date, planned_date, task_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.operationId,
      request.operationKind,
      request.actionContractVersion,
      digest,
      request.expectedCurrentDate,
      request.payload.planned_date,
      task.id,
    )
    return task
  }

  it('replays an exact historical C5 v1 request from its matching receipt', () => {
    const harness = createHarness()
    const legacy = toLegacyRequest(makeMistakeRequest(harness))
    const task = seedLegacyReceipt(harness, legacy)

    expect(execute(harness, legacy)).toMatchObject({
      ok: true,
      replayed: true,
      task: { id: task.id },
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
  })

  it('rejects a receipt-less C5 v1 request with zero writes', () => {
    const harness = createHarness()
    const legacy = toLegacyRequest(makeMistakeRequest(harness))

    expect(execute(harness, legacy)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('conflicts when a C5 v2 request hits an existing C5 v1 receipt', () => {
    const harness = createHarness()
    const v2 = makeMistakeRequest(harness)
    seedLegacyReceipt(harness, toLegacyRequest(v2))

    expect(execute(harness, v2)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' })
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
  })

  it.each([
    ['signature', { generationContextSignature: 'b'.repeat(64) }],
    ['alias', { generationMistakeRef: 'm2' }],
    ['payload', { payload: { title: 'Conflicting title' } }],
  ])('returns IDEMPOTENCY_CONFLICT when a replay changes v2 %s', (_label, change) => {
    const harness = createHarness()
    const request = makeMistakeRequest(harness)
    expect(execute(harness, request)).toMatchObject({ ok: true })
    const conflict = {
      ...request,
      ...change,
      payload: 'payload' in change ? { ...request.payload, ...change.payload } : request.payload,
    }

    expect(execute(harness, conflict)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' })
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
  })
})
