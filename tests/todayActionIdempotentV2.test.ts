// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildIdempotentAIStudyTaskRequestDigest,
  createIdempotentAIStudyTaskForCurrentDate,
  getCommittedAIStudyTaskOperationStatus,
  validateIdempotentAIStudyTaskCreateRequest,
  validateTodayActionCommittedStatusRequest,
} from '../electron/idempotentStudyTaskCreation'
import { runDatabaseMigrations } from '../electron/databaseMigrations'
import {
  TodayActionStaleReviewTokenStore,
  readAuthoritativeTodayActionChapterContext,
} from '../electron/todayActionChapterContext'
import type { NewStudyTask, StudyTask } from '../src/types'
import type { IdempotentAIStudyTaskCreateRequest } from '../src/types/api'

const OPERATION_ID = '77777777-7777-4777-8777-777777777777'
const EXPECTED_DATE = '2026-08-21'
const databases: Database.Database[] = []

function makeTodayV2Request(
  overrides: Partial<IdempotentAIStudyTaskCreateRequest> = {},
): IdempotentAIStudyTaskCreateRequest {
  return {
    operationId: OPERATION_ID,
    operationKind: 'today_action',
    actionContractVersion: 'confirmed-study-task-action.v2',
    expectedCurrentDate: EXPECTED_DATE,
    contextProjectionVersion: 'today-action.context-projection.v2',
    originalGenerationContextSignature: '1'.repeat(64),
    generationChapterSignature: '2'.repeat(64),
    latestReviewedChapterSignature: '2'.repeat(64),
    staleContextOverride: false,
    staleReviewToken: null,
    payload: {
      title: 'Read chapter',
      description: 'Continue bounded progress',
      type: 'focus',
      subject_id: 1,
      related_mistake_id: null,
      related_entry_id: null,
      related_chapter_id: null,
      planned_date: EXPECTED_DATE,
      estimate_minutes: 25,
      status: 'todo',
      source: 'ai',
    },
    ...overrides,
  }
}

function insertTask(database: Database.Database, task: NewStudyTask): StudyTask {
  const id = Number(database.prepare(`
    INSERT INTO study_tasks (
      title, description, type, subject_id, related_mistake_id, related_entry_id,
      related_chapter_id, planned_date, estimate_minutes, status, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  return database.prepare('SELECT * FROM study_tasks WHERE id = ?').get(id) as StudyTask
}

function createHarness() {
  const database = new BetterSqlite3(':memory:')
  databases.push(database)
  database.pragma('foreign_keys = ON')
  runDatabaseMigrations(database)
  const createTask = vi.fn((task: NewStudyTask) => insertTask(database, task))
  return {
    database,
    createTask,
    getCurrentDateKey: vi.fn(() => EXPECTED_DATE),
  }
}

function countRows(database: Database.Database, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count
}

function readStatusWriteSnapshot(database: Database.Database) {
  return {
    changes: (database.prepare('SELECT total_changes() AS count').get() as { count: number }).count,
    tasks: countRows(database, 'study_tasks'),
    receipts: countRows(database, 'study_task_action_receipts'),
    planningRuns: countRows(database, 'planning_runs'),
    planningCandidates: countRows(database, 'planning_run_candidates'),
    chapters: countRows(database, 'subject_chapters'),
  }
}

function staleAuthorizationCore(request: IdempotentAIStudyTaskCreateRequest) {
  return {
    operationId: request.operationId,
    operationKind: 'today_action' as const,
    actionContractVersion: 'confirmed-study-task-action.v2' as const,
    expectedCurrentDate: request.expectedCurrentDate,
    contextProjectionVersion: 'today-action.context-projection.v2' as const,
    originalGenerationContextSignature: request.originalGenerationContextSignature!,
    generationChapterSignature: request.generationChapterSignature!,
    latestReviewedChapterSignature: request.latestReviewedChapterSignature!,
    staleContextOverride: true as const,
    payload: request.payload,
  }
}

function makeCommittedStatusRequest() {
  return {
    operationId: OPERATION_ID,
    operationKind: 'today_action' as const,
    actionContractVersion: 'confirmed-study-task-action.v2' as const,
    expectedCurrentDate: EXPECTED_DATE,
    plannedDate: EXPECTED_DATE,
  }
}

function commitFreshTodayV2(harness: ReturnType<typeof createHarness>) {
  const chapterSignature = readAuthoritativeTodayActionChapterContext(harness.database)
    .currentChapterSignature
  const request = makeTodayV2Request({
    generationChapterSignature: chapterSignature,
    latestReviewedChapterSignature: chapterSignature,
    payload: { ...makeTodayV2Request().payload, subject_id: null },
  })
  expect(createIdempotentAIStudyTaskForCurrentDate(request, harness)).toMatchObject({
    ok: true,
    replayed: false,
  })
  return request
}

function makeLegacyTodayRequest(
  overrides: Partial<IdempotentAIStudyTaskCreateRequest> = {},
): IdempotentAIStudyTaskCreateRequest {
  return {
    operationId: OPERATION_ID,
    operationKind: 'today_action',
    actionContractVersion: 'confirmed-study-task-action.v1',
    expectedCurrentDate: EXPECTED_DATE,
    payload: { ...makeTodayV2Request().payload, subject_id: null },
    ...overrides,
  }
}

function insertReceipt(
  database: Database.Database,
  request: IdempotentAIStudyTaskCreateRequest,
  taskId: number | null,
  requestDigest = buildIdempotentAIStudyTaskRequestDigest(request),
) {
  database.prepare(`
    INSERT INTO study_task_action_receipts (
      operation_id, operation_kind, action_contract_version, request_digest,
      expected_current_date, planned_date, task_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    request.operationId,
    request.operationKind,
    request.actionContractVersion,
    requestDigest,
    request.expectedCurrentDate,
    request.payload.planned_date,
    taskId,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) database.close()
})

describe('Today Action v2 privileged idempotency', () => {
  it('validates the exact v2 envelope and locks its canonical digest order', () => {
    const canonical = validateIdempotentAIStudyTaskCreateRequest(makeTodayV2Request())

    expect(Object.keys(canonical)).toEqual([
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
    expect(buildIdempotentAIStudyTaskRequestDigest(canonical)).toBe(
      '87c36d2fbad192db8713dd855a5828fa275e95f1a10664129843dbddd69ea875',
    )
  })

  it.each([
    ['null', null],
    ['empty', ''],
    ['63 hex', 'a'.repeat(63)],
    ['65 hex', 'a'.repeat(65)],
    ['uppercase', 'A'.repeat(64)],
    ['non-hex', 'g'.repeat(64)],
  ])('structurally rejects override=true with %s token', (_label, staleReviewToken) => {
    expect(() => validateIdempotentAIStudyTaskCreateRequest(makeTodayV2Request({
      staleContextOverride: true,
      staleReviewToken,
      latestReviewedChapterSignature: '3'.repeat(64),
    }))).toThrow(/staleReviewToken/)
  })

  it('separates stale-review syntax from live authorization at the structural boundary', () => {
    expect(validateIdempotentAIStudyTaskCreateRequest(makeTodayV2Request({
      staleContextOverride: true,
      staleReviewToken: 'a'.repeat(64),
      latestReviewedChapterSignature: '3'.repeat(64),
    }))).toMatchObject({ staleContextOverride: true, staleReviewToken: 'a'.repeat(64) })
    expect(() => validateIdempotentAIStudyTaskCreateRequest(makeTodayV2Request({
      staleContextOverride: false,
      staleReviewToken: 'a'.repeat(64),
    }))).toThrow(/stale-review state/)
    expect(() => validateIdempotentAIStudyTaskCreateRequest(makeTodayV2Request({
      staleContextOverride: false,
      latestReviewedChapterSignature: '3'.repeat(64),
    }))).toThrow(/stale-review state/)
  })

  it('makes every frozen v2 proof field, token, and payload byte digest-sensitive', () => {
    const request = makeTodayV2Request({
      staleContextOverride: true,
      staleReviewToken: 'a'.repeat(64),
      latestReviewedChapterSignature: '3'.repeat(64),
    })
    const original = buildIdempotentAIStudyTaskRequestDigest(request)
    const variants = [
      { ...request, operationId: '88888888-8888-4888-8888-888888888888' },
      { ...request, originalGenerationContextSignature: '4'.repeat(64) },
      { ...request, generationChapterSignature: '5'.repeat(64) },
      { ...request, latestReviewedChapterSignature: '6'.repeat(64) },
      { ...request, staleReviewToken: 'b'.repeat(64) },
      { ...request, payload: { ...request.payload, description: 'Changed' } },
    ]

    for (const variant of variants) {
      expect(buildIdempotentAIStudyTaskRequestDigest(variant)).not.toBe(original)
    }
  })

  it('blocks a receipt-less request when authoritative chapter projection drifted', () => {
    const harness = createHarness()
    harness.database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').run('Math', '#2563eb')
    harness.database.prepare(`
      INSERT INTO subject_chapters (subject_id, title, completed, sort_order)
      VALUES (1, 'Generated chapter', 0, 0)
    `).run()
    const generationChapterSignature = readAuthoritativeTodayActionChapterContext(
      harness.database,
    ).currentChapterSignature
    const request = makeTodayV2Request({
      generationChapterSignature,
      latestReviewedChapterSignature: generationChapterSignature,
    })
    harness.database.prepare("UPDATE subject_chapters SET title = 'Drifted chapter' WHERE id = 1").run()

    const result = createIdempotentAIStudyTaskForCurrentDate(request, harness)

    expect(result).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(harness.createTask).not.toHaveBeenCalled()
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it.each([
    {
      label: 'emitted membership',
      mutate(database: Database.Database) {
        database.prepare(`
          INSERT INTO subject_chapters (subject_id, title, completed, sort_order)
          VALUES (1, 'New emitted member', 0, 1)
        `).run()
      },
    },
    {
      label: 'emitted ordering',
      mutate(database: Database.Database) {
        database.prepare("UPDATE subject_chapters SET sort_order = 3 WHERE title = 'Anchor'").run()
      },
    },
  ])('blocks $label drift before a receipt-less write', ({ mutate }) => {
    const harness = createHarness()
    harness.database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').run('Math', '#2563eb')
    harness.database.exec(`
      INSERT INTO subject_chapters (subject_id, title, completed, sort_order)
      VALUES
        (1, 'Before', 1, 0),
        (1, 'Anchor', 0, 1),
        (1, 'After', 0, 2)
    `)
    const generationChapterSignature = readAuthoritativeTodayActionChapterContext(
      harness.database,
    ).currentChapterSignature
    mutate(harness.database)

    expect(createIdempotentAIStudyTaskForCurrentDate(makeTodayV2Request({
      generationChapterSignature,
      latestReviewedChapterSignature: generationChapterSignature,
    }), harness)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(harness.createTask).not.toHaveBeenCalled()
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('allows hidden chapter drift when the bounded projection bytes remain identical', () => {
    const harness = createHarness()
    harness.database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').run('Math', '#2563eb')
    harness.database.exec(`
      INSERT INTO subject_chapters (subject_id, title, completed, sort_order)
      VALUES
        (1, 'Anchor', 0, 0),
        (1, 'After one', 0, 1),
        (1, 'After two', 0, 2),
        (1, 'Hidden old', 0, 3)
    `)
    const generationContext = readAuthoritativeTodayActionChapterContext(harness.database)
    harness.database.prepare("UPDATE subject_chapters SET title = 'Hidden new' WHERE sort_order = 3").run()
    const currentContext = readAuthoritativeTodayActionChapterContext(harness.database)
    expect(currentContext.chapterProjectionJson).toBe(generationContext.chapterProjectionJson)
    expect(currentContext.currentChapterSignature).toBe(generationContext.currentChapterSignature)

    expect(createIdempotentAIStudyTaskForCurrentDate(makeTodayV2Request({
      generationChapterSignature: generationContext.currentChapterSignature,
      latestReviewedChapterSignature: generationContext.currentChapterSignature,
    }), harness)).toMatchObject({ ok: true, replayed: false })
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
  })

  it('replays an exact committed v2 request before live date and chapter freshness checks', () => {
    const harness = createHarness()
    harness.database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').run('Math', '#2563eb')
    const generationChapterSignature = readAuthoritativeTodayActionChapterContext(
      harness.database,
    ).currentChapterSignature
    const request = makeTodayV2Request({
      generationChapterSignature,
      latestReviewedChapterSignature: generationChapterSignature,
    })
    expect(createIdempotentAIStudyTaskForCurrentDate(request, harness)).toMatchObject({
      ok: true,
      replayed: false,
      task: { id: 1 },
    })
    harness.database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').run('Changed', '#ef4444')
    harness.getCurrentDateKey.mockReturnValue('2026-08-22')
    harness.getCurrentDateKey.mockClear()

    expect(createIdempotentAIStudyTaskForCurrentDate(request, harness)).toMatchObject({
      ok: true,
      replayed: true,
      task: { id: 1 },
    })
    expect(harness.getCurrentDateKey).not.toHaveBeenCalled()
    expect(harness.createTask).toHaveBeenCalledOnce()
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
  })

  it('consumes an exact stale-review token only after commit and lets receipt authority replay it', () => {
    const harness = createHarness()
    harness.database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').run('Math', '#2563eb')
    harness.database.prepare(`
      INSERT INTO subject_chapters (subject_id, title, completed, sort_order)
      VALUES (1, 'Reviewed current chapter', 0, 0)
    `).run()
    const latestReviewedChapterSignature = readAuthoritativeTodayActionChapterContext(
      harness.database,
    ).currentChapterSignature
    const token = 'a'.repeat(64)
    const tokenStore = new TodayActionStaleReviewTokenStore(() => token)
    const trustedSession = { id: 'trusted-main-window' }
    const request = makeTodayV2Request({
      generationChapterSignature: '2'.repeat(64),
      latestReviewedChapterSignature,
      staleContextOverride: true,
      staleReviewToken: token,
    })
    const core = staleAuthorizationCore(request)
    expect(tokenStore.issue(trustedSession, core)).toBe(token)

    expect(createIdempotentAIStudyTaskForCurrentDate(request, {
      ...harness,
      trustedSession,
      tokenStore,
    })).toMatchObject({ ok: true, replayed: false, task: { id: 1 } })
    expect(tokenStore.check(token, trustedSession, core)).toBe(false)

    harness.database.prepare("UPDATE subject_chapters SET title = 'After commit drift' WHERE id = 1").run()
    harness.getCurrentDateKey.mockReturnValue('2026-08-22')
    harness.getCurrentDateKey.mockClear()
    expect(createIdempotentAIStudyTaskForCurrentDate(request, {
      ...harness,
      trustedSession: {},
      tokenStore: new TodayActionStaleReviewTokenStore(),
    })).toMatchObject({ ok: true, replayed: true, task: { id: 1 } })
    expect(harness.getCurrentDateKey).not.toHaveBeenCalled()
    expect(harness.createTask).toHaveBeenCalledOnce()

    expect(createIdempotentAIStudyTaskForCurrentDate({
      ...request,
      staleReviewToken: 'b'.repeat(64),
    }, {
      ...harness,
      trustedSession: {},
      tokenStore: new TodayActionStaleReviewTokenStore(),
    })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' })
    expect(harness.getCurrentDateKey).not.toHaveBeenCalled()
  })

  it('rejects a syntactically valid but unauthorized token with zero writes', () => {
    const harness = createHarness()
    const currentSignature = readAuthoritativeTodayActionChapterContext(harness.database)
      .currentChapterSignature
    const result = createIdempotentAIStudyTaskForCurrentDate(makeTodayV2Request({
      generationChapterSignature: '2'.repeat(64),
      latestReviewedChapterSignature: currentSignature,
      staleContextOverride: true,
      staleReviewToken: 'f'.repeat(64),
      payload: { ...makeTodayV2Request().payload, subject_id: null },
    }), {
      ...harness,
      trustedSession: {},
      tokenStore: new TodayActionStaleReviewTokenStore(),
    })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(harness.createTask).not.toHaveBeenCalled()
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('invalidates an authorized token when chapter state drifts a second time', () => {
    const harness = createHarness()
    const reviewedSignature = readAuthoritativeTodayActionChapterContext(harness.database)
      .currentChapterSignature
    const token = 'c'.repeat(64)
    const tokenStore = new TodayActionStaleReviewTokenStore(() => token)
    const trustedSession = {}
    const request = makeTodayV2Request({
      payload: { ...makeTodayV2Request().payload, subject_id: null },
      generationChapterSignature: '2'.repeat(64),
      latestReviewedChapterSignature: reviewedSignature,
      staleContextOverride: true,
      staleReviewToken: token,
    })
    const core = staleAuthorizationCore(request)
    tokenStore.issue(trustedSession, core)
    harness.database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').run('New', '#16a34a')
    harness.database.prepare(`
      INSERT INTO subject_chapters (subject_id, title, completed, sort_order)
      VALUES (1, 'Second drift', 0, 0)
    `).run()

    expect(createIdempotentAIStudyTaskForCurrentDate(request, {
      ...harness,
      trustedSession,
      tokenStore,
    })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
    expect(tokenStore.check(token, trustedSession, core)).toBe(false)
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)
  })

  it('retains token authorization after rollback and consumes it after the exact retry commits', () => {
    const harness = createHarness()
    const reviewedSignature = readAuthoritativeTodayActionChapterContext(harness.database)
      .currentChapterSignature
    const token = 'd'.repeat(64)
    const tokenStore = new TodayActionStaleReviewTokenStore(() => token)
    const trustedSession = {}
    const request = makeTodayV2Request({
      payload: { ...makeTodayV2Request().payload, subject_id: null },
      generationChapterSignature: '2'.repeat(64),
      latestReviewedChapterSignature: reviewedSignature,
      staleContextOverride: true,
      staleReviewToken: token,
    })
    const core = staleAuthorizationCore(request)
    tokenStore.issue(trustedSession, core)
    harness.database.exec(`
      CREATE TRIGGER fail_today_receipt_insert
      BEFORE INSERT ON study_task_action_receipts
      BEGIN
        SELECT RAISE(ABORT, 'forced receipt rollback');
      END;
    `)

    expect(createIdempotentAIStudyTaskForCurrentDate(request, {
      ...harness,
      trustedSession,
      tokenStore,
    })).toMatchObject({ ok: false, code: 'INTEGRITY_ERROR' })
    expect(tokenStore.check(token, trustedSession, core)).toBe(true)
    expect(countRows(harness.database, 'study_tasks')).toBe(0)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(0)

    harness.database.exec('DROP TRIGGER fail_today_receipt_insert')
    expect(createIdempotentAIStudyTaskForCurrentDate(request, {
      ...harness,
      trustedSession,
      tokenStore,
    })).toMatchObject({ ok: true, replayed: false, task: { id: 1 } })
    expect(tokenStore.check(token, trustedSession, core)).toBe(false)
  })

  it('replays historical Today v1 only from a matching receipt and rejects receipt-less v1', () => {
    const noReceiptHarness = createHarness()
    const legacy = makeLegacyTodayRequest()
    expect(createIdempotentAIStudyTaskForCurrentDate(legacy, noReceiptHarness)).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    })
    expect(countRows(noReceiptHarness.database, 'study_tasks')).toBe(0)
    expect(countRows(noReceiptHarness.database, 'study_task_action_receipts')).toBe(0)

    const replayHarness = createHarness()
    const task = insertTask(replayHarness.database, legacy.payload)
    insertReceipt(replayHarness.database, legacy, task.id)
    replayHarness.getCurrentDateKey.mockReturnValue('2026-08-22')
    replayHarness.getCurrentDateKey.mockClear()
    expect(createIdempotentAIStudyTaskForCurrentDate(legacy, replayHarness)).toMatchObject({
      ok: true,
      replayed: true,
      task: { id: task.id },
    })
    expect(replayHarness.getCurrentDateKey).not.toHaveBeenCalled()
    expect(replayHarness.createTask).not.toHaveBeenCalled()
  })

  it('rejects forged Today chapter relations before matching receipt resolution for v1 and v2', () => {
    const harness = createHarness()
    const legacy = makeLegacyTodayRequest()
    const task = insertTask(harness.database, legacy.payload)
    insertReceipt(harness.database, legacy, task.id)

    for (const request of [legacy, makeTodayV2Request({
      payload: { ...makeTodayV2Request().payload, subject_id: null },
    })]) {
      const forged = {
        ...request,
        payload: { ...request.payload, related_chapter_id: 99 },
      }
      expect(createIdempotentAIStudyTaskForCurrentDate(forged, harness)).toMatchObject({
        ok: false,
        code: 'INVALID_REQUEST',
      })
    }
    expect(harness.createTask).not.toHaveBeenCalled()
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
  })

  it('fails closed when a committed Today result has a corrupt chapter relation', () => {
    const harness = createHarness()
    const request = commitFreshTodayV2(harness)
    harness.database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)').run('Math', '#2563eb')
    harness.database.prepare(`
      INSERT INTO subject_chapters (subject_id, title, completed, sort_order)
      VALUES (1, 'Forbidden relation', 0, 0)
    `).run()
    harness.database.prepare('UPDATE study_tasks SET related_chapter_id = 1 WHERE id = 1').run()

    expect(createIdempotentAIStudyTaskForCurrentDate(request, harness)).toMatchObject({
      ok: false,
      code: 'INTEGRITY_ERROR',
    })
    expect(harness.createTask).toHaveBeenCalledOnce()
  })

  it('conflicts across Today v1/v2 receipts before live freshness authorization', () => {
    const v1Harness = createHarness()
    const legacy = makeLegacyTodayRequest()
    const legacyTask = insertTask(v1Harness.database, legacy.payload)
    insertReceipt(v1Harness.database, legacy, legacyTask.id)
    const v2 = makeTodayV2Request({
      payload: { ...makeTodayV2Request().payload, subject_id: null },
      staleContextOverride: true,
      staleReviewToken: 'f'.repeat(64),
      latestReviewedChapterSignature: '3'.repeat(64),
    })
    expect(createIdempotentAIStudyTaskForCurrentDate(v2, v1Harness)).toMatchObject({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
    })

    const v2Harness = createHarness()
    commitFreshTodayV2(v2Harness)
    expect(createIdempotentAIStudyTaskForCurrentDate(legacy, v2Harness)).toMatchObject({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
    })
  })

  it('keeps Daily Review v1 receipt-less new writes unchanged', () => {
    const harness = createHarness()
    const request: IdempotentAIStudyTaskCreateRequest = {
      operationId: '99999999-9999-4999-8999-999999999999',
      operationKind: 'daily_review',
      actionContractVersion: 'confirmed-study-task-action.v1',
      expectedCurrentDate: EXPECTED_DATE,
      payload: {
        ...makeTodayV2Request().payload,
        subject_id: null,
        planned_date: '2026-08-22',
      },
    }

    expect(createIdempotentAIStudyTaskForCurrentDate(request, harness)).toMatchObject({
      ok: true,
      replayed: false,
      task: { planned_date: '2026-08-22' },
    })
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
  })

  it.each([
    ['matching', false, 'ok'],
    ['conflicting', true, 'IDEMPOTENCY_CONFLICT'],
  ] as const)('resolves a %s transaction-local raced receipt before date/token/freshness', (
    _label,
    conflict,
    expected,
  ) => {
    const harness = createHarness()
    const request = makeTodayV2Request({
      payload: { ...makeTodayV2Request().payload, subject_id: null },
      generationChapterSignature: '2'.repeat(64),
      latestReviewedChapterSignature: '3'.repeat(64),
      staleContextOverride: true,
      staleReviewToken: 'f'.repeat(64),
    })
    const task = insertTask(harness.database, request.payload)
    let seeded = false
    const wrappedDatabase = {
      prepare: harness.database.prepare.bind(harness.database),
      transaction<T>(operation: () => T) {
        return harness.database.transaction(() => {
          if (!seeded) {
            seeded = true
            insertReceipt(
              harness.database,
              request,
              task.id,
              conflict ? 'e'.repeat(64) : buildIdempotentAIStudyTaskRequestDigest(request),
            )
          }
          return operation()
        })
      },
    } as unknown as Database.Database
    const getCurrentDateKey = vi.fn(() => { throw new Error('date gate must not run') })

    const result = createIdempotentAIStudyTaskForCurrentDate(request, {
      database: wrappedDatabase,
      createTask: harness.createTask,
      getCurrentDateKey,
    })

    if (expected === 'ok') {
      expect(result).toMatchObject({ ok: true, replayed: true, task: { id: task.id } })
    } else {
      expect(result).toMatchObject({ ok: false, code: expected })
    }
    expect(getCurrentDateKey).not.toHaveBeenCalled()
    expect(harness.createTask).not.toHaveBeenCalled()
    expect(countRows(harness.database, 'study_tasks')).toBe(1)
    expect(countRows(harness.database, 'study_task_action_receipts')).toBe(1)
  })
})

describe('Today Action committed-operation status', () => {
  it('validates the exact bounded status request before any database access', () => {
    const request = {
      operationId: OPERATION_ID,
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      expectedCurrentDate: EXPECTED_DATE,
      plannedDate: EXPECTED_DATE,
    }
    expect(validateTodayActionCommittedStatusRequest(request)).toEqual(request)
    expect(() => validateTodayActionCommittedStatusRequest({ ...request, extra: true })).toThrow(/exactly/)
    expect(() => validateTodayActionCommittedStatusRequest({ ...request, plannedDate: '2026-08-22' }))
      .toThrow(/plannedDate/)

    const database = {
      prepare: vi.fn(() => { throw new Error('database must not be read') }),
    } as unknown as Database.Database
    expect(() => getCommittedAIStudyTaskOperationStatus({ ...request, operationId: 'INVALID' }, { database }))
      .toThrow(/lowercase UUID v4/)
    expect(database.prepare).not.toHaveBeenCalled()
  })

  it('returns bounded NOT_COMMITTED and RECOVERED_COMMITTED outcomes without writes', () => {
    const harness = createHarness()
    const statusRequest = makeCommittedStatusRequest()
    const emptySnapshot = readStatusWriteSnapshot(harness.database)
    expect(getCommittedAIStudyTaskOperationStatus(statusRequest, harness)).toEqual({
      status: 'NOT_COMMITTED',
      operationId: OPERATION_ID,
    })
    expect(readStatusWriteSnapshot(harness.database)).toEqual(emptySnapshot)

    commitFreshTodayV2(harness)
    const before = readStatusWriteSnapshot(harness.database)
    const recovered = getCommittedAIStudyTaskOperationStatus(statusRequest, harness)

    expect(recovered).toMatchObject({
      status: 'RECOVERED_COMMITTED',
      operationId: OPERATION_ID,
      task: { id: 1, related_chapter_id: null, planned_date: EXPECTED_DATE },
    })
    expect(Object.keys(recovered)).toEqual(['status', 'operationId', 'task'])
    const serialized = JSON.stringify(recovered)
    for (const forbidden of [
      'request_digest', 'receipt', 'signature', 'staleReviewToken', 'payload', 'SELECT', 'stack',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(readStatusWriteSnapshot(harness.database)).toEqual(before)
  })

  it('distinguishes metadata conflict, deleted result, and corrupt receipt/task relation', () => {
    const conflictHarness = createHarness()
    commitFreshTodayV2(conflictHarness)
    conflictHarness.database.prepare(`
      UPDATE study_task_action_receipts
      SET action_contract_version = 'confirmed-study-task-action.v1'
    `).run()
    const conflictBefore = readStatusWriteSnapshot(conflictHarness.database)
    expect(getCommittedAIStudyTaskOperationStatus(makeCommittedStatusRequest(), conflictHarness)).toEqual({
      status: 'IDEMPOTENCY_CONFLICT',
      operationId: OPERATION_ID,
    })
    expect(readStatusWriteSnapshot(conflictHarness.database)).toEqual(conflictBefore)

    const deletedHarness = createHarness()
    commitFreshTodayV2(deletedHarness)
    deletedHarness.database.prepare('DELETE FROM study_tasks WHERE id = 1').run()
    const deletedBefore = readStatusWriteSnapshot(deletedHarness.database)
    expect(getCommittedAIStudyTaskOperationStatus(makeCommittedStatusRequest(), deletedHarness)).toEqual({
      status: 'RESULT_DELETED',
      operationId: OPERATION_ID,
    })
    expect(readStatusWriteSnapshot(deletedHarness.database)).toEqual(deletedBefore)

    const corruptReceiptHarness = createHarness()
    commitFreshTodayV2(corruptReceiptHarness)
    corruptReceiptHarness.database.prepare("UPDATE study_task_action_receipts SET request_digest = 'CORRUPT'").run()
    const corruptReceiptBefore = readStatusWriteSnapshot(corruptReceiptHarness.database)
    expect(getCommittedAIStudyTaskOperationStatus(makeCommittedStatusRequest(), corruptReceiptHarness)).toEqual({
      status: 'INTEGRITY_ERROR',
      operationId: OPERATION_ID,
    })
    expect(readStatusWriteSnapshot(corruptReceiptHarness.database)).toEqual(corruptReceiptBefore)

    const corruptRelationHarness = createHarness()
    commitFreshTodayV2(corruptRelationHarness)
    corruptRelationHarness.database.prepare('INSERT INTO subjects (name, color) VALUES (?, ?)')
      .run('Math', '#2563eb')
    corruptRelationHarness.database.prepare(`
      INSERT INTO subject_chapters (subject_id, title, completed, sort_order)
      VALUES (1, 'Forbidden task relation', 0, 0)
    `).run()
    corruptRelationHarness.database.prepare('UPDATE study_tasks SET related_chapter_id = 1 WHERE id = 1').run()
    const corruptRelationBefore = readStatusWriteSnapshot(corruptRelationHarness.database)
    expect(getCommittedAIStudyTaskOperationStatus(makeCommittedStatusRequest(), corruptRelationHarness)).toEqual({
      status: 'INTEGRITY_ERROR',
      operationId: OPERATION_ID,
    })
    expect(readStatusWriteSnapshot(corruptRelationHarness.database)).toEqual(corruptRelationBefore)
  })
})
