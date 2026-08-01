// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  buildIdempotentAIStudyTaskRequestDigest,
  createIdempotentAIStudyTaskForCurrentDate,
  validateIdempotentAIStudyTaskCreateRequest,
} from '../electron/idempotentStudyTaskCreation'
import { runDatabaseMigrations } from '../electron/databaseMigrations'
import type { NewStudyTask, StudyTask } from '../src/types'
import type { IdempotentAIStudyTaskCreateRequest } from '../src/types/api'

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
