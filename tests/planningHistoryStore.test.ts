// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { runDatabaseMigrations } from '../electron/databaseMigrations'
import { createPlanningHistoryStore } from '../electron/planningHistory'
import { buildIdempotentAIStudyTaskRequestDigest } from '../electron/idempotentStudyTaskCreation'

const databases: Database.Database[] = []

function createStore(now = '2026-08-13T12:34:56.789Z') {
  const database = new BetterSqlite3(':memory:')
  databases.push(database)
  database.pragma('foreign_keys = ON')
  runDatabaseMigrations(database)
  database.prepare("INSERT INTO subjects (id, name) VALUES (1, '数学')").run()
  database.prepare(`
    INSERT INTO mistakes (id, subject_id, question, answer)
    VALUES (12, 1, '函数极限题', '答案')
  `).run()
  return {
    database,
    store: createPlanningHistoryStore({ database, now: () => new Date(now) }),
  }
}

const TODAY_CONTEXT = [
  { category: 'available_minutes', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
  { category: 'today_tasks', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'due_mistakes', preparation: 'prepared', disposition: 'partially_included', reasonCode: 'limit_applied' },
  { category: 'subjects', preparation: 'prepared', disposition: 'included', reasonCode: 'included_available' },
  { category: 'today_entry', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'chapters', preparation: 'not_integrated', disposition: 'excluded', reasonCode: 'not_integrated' },
  { category: 'focus_history', preparation: 'not_integrated', disposition: 'excluded', reasonCode: 'not_integrated' },
] as const

const DAILY_CONTEXT = [
  { category: 'today_tasks', preparation: 'prepared', disposition: 'included', reasonCode: 'included_available' },
  { category: 'candidate_date_tasks', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'pomodoro', preparation: 'source_unavailable', disposition: 'included', reasonCode: 'source_unavailable' },
  { category: 'subjects', preparation: 'prepared', disposition: 'included', reasonCode: 'included_available' },
  { category: 'today_entry', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'due_mistakes', preparation: 'prepared_empty', disposition: 'included_empty', reasonCode: 'no_record' },
  { category: 'available_minutes', preparation: 'prepared', disposition: 'included', reasonCode: 'included_required' },
] as const

function todayRun(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    entryPoint: 'today_action',
    planningDate: '2026-08-13',
    targetDate: '2026-08-13',
    generationResultKind: 'candidate_set',
    contextSummary: TODAY_CONTEXT,
    candidates: [{
      ordinal: 0,
      admissionOrigin: 'provider_validated',
      title: '  复习  函数极限  ',
      description: ' 今天到期，适合先处理。 ',
      type: 'review',
      estimateMinutes: 25,
      priority: 'high',
      subjectId: 1,
      relatedMistakeId: 12,
      relatedEntryId: null,
      userDisposition: 'selected_unconfirmed',
    }],
    ...overrides,
  }
}

function finalSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    title: '复习 函数极限',
    description: '今天到期,适合先处理。',
    type: 'review',
    estimateMinutes: 25,
    priority: 'high',
    subjectId: 1,
    relatedMistakeId: 12,
    relatedEntryId: null,
    ...overrides,
  }
}

function taskRequest(overrides: Record<string, unknown> = {}) {
  return {
    operationId: '33333333-3333-4333-8333-333333333333',
    operationKind: 'today_action',
    actionContractVersion: 'confirmed-study-task-action.v1',
    expectedCurrentDate: '2026-08-13',
    payload: {
      title: '复习 函数极限',
      description: '今天到期,适合先处理。',
      type: 'review',
      subject_id: 1,
      related_mistake_id: 12,
      related_entry_id: null,
      related_chapter_id: null,
      planned_date: '2026-08-13',
      estimate_minutes: 25,
      status: 'todo',
      source: 'ai',
    },
    ...overrides,
  }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('trusted-main planning history transition seam', () => {
  it('admits a repaired candidate at its first valid baseline and preserves ordinal gaps', () => {
    const { store } = createStore()
    store.create(todayRun({ candidates: [] }))

    const run = store.transition({
      kind: 'admit_repaired_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      candidate: {
        ordinal: 4,
        ...finalSnapshot({ title: '用户修复后候选' }),
        userDisposition: 'unselected',
      },
    })

    expect(run.candidates).toEqual([
      expect.objectContaining({
        ordinal: 4,
        admissionOrigin: 'provider_suggested_user_repaired',
        title: '用户修复后候选',
        editBefore: {},
        userDisposition: 'unselected',
      }),
    ])
  })

  it('computes exact net before/final edits from durable state and removes net-zero keys', () => {
    const { store } = createStore('2026-08-13T12:00:00.000Z')
    store.create(todayRun())

    const first = store.transition({
      kind: 'commit_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      candidate: finalSnapshot({ title: '复习导数错题', estimateMinutes: 30 }),
    })
    const second = store.transition({
      kind: 'commit_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      candidate: finalSnapshot({ title: '复习微分中值定理', estimateMinutes: 35 }),
    })
    const restoredEstimate = store.transition({
      kind: 'commit_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      candidate: finalSnapshot({ title: '复习微分中值定理', estimateMinutes: 25 }),
    })

    expect(first.candidates[0]?.editBefore).toEqual({
      title: '复习 函数极限',
      estimateMinutes: 25,
    })
    expect(second.candidates[0]?.editBefore).toEqual({
      title: '复习 函数极限',
      estimateMinutes: 25,
    })
    expect(restoredEstimate.candidates[0]?.editBefore).toEqual({
      title: '复习 函数极限',
    })
    expect(restoredEstimate.candidates[0]?.estimateMinutes).toBe(25)
  })

  it('atomically cleans incompatible relations when a full snapshot changes type', () => {
    const { store } = createStore()
    store.create(todayRun())

    expect(() => store.transition({
      kind: 'commit_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      candidate: finalSnapshot({ type: 'focus' }),
    })).toThrow(/relatedMistakeId/i)

    const changed = store.transition({
      kind: 'commit_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      candidate: finalSnapshot({ type: 'focus', relatedMistakeId: null }),
    })
    expect(changed.candidates[0]).toEqual(expect.objectContaining({
      type: 'focus',
      relatedMistakeId: null,
      editBefore: expect.objectContaining({ type: 'review', relatedMistakeId: 12 }),
    }))
  })

  it('toggles selected and unselected candidates and deletes removed audit children only', () => {
    const { database, store } = createStore()
    store.create(todayRun())
    const taskId = Number(database.prepare(`
      INSERT INTO study_tasks (title, planned_date, source)
      VALUES ('独立任务', '2026-08-13', 'ai')
    `).run().lastInsertRowid)

    expect(store.transition({
      kind: 'set_selection',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      selected: false,
    }).candidates[0]?.userDisposition).toBe('unselected')
    expect(store.transition({
      kind: 'set_selection',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      selected: true,
    }).candidates[0]?.userDisposition).toBe('selected_unconfirmed')
    expect(store.transition({
      kind: 'remove_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
    }).candidates).toEqual([])
    expect(database.prepare('SELECT id FROM study_tasks WHERE id = ?').get(taskId)).toEqual({ id: taskId })
  })

  it('keeps the first observed close and makes closed run semantic state immutable', () => {
    const { store } = createStore('2026-08-13T13:00:00.000Z')
    store.create(todayRun())

    const closed = store.transition({
      kind: 'close_run',
      runId: '11111111-1111-4111-8111-111111111111',
      reason: 'dialog_closed',
    })
    const secondClose = store.transition({
      kind: 'close_run',
      runId: '11111111-1111-4111-8111-111111111111',
      reason: 'regenerated',
    })

    expect(closed.closedAt).toBe('2026-08-13T13:00:00.000Z')
    expect(secondClose.closeReason).toBe('dialog_closed')
    expect(() => store.transition({
      kind: 'set_selection',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      selected: false,
    })).toThrow(/closed/i)
    expect(() => store.transition({
      kind: 'remove_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
    })).toThrow(/closed/i)
  })

  it('records app close only for runs observed by the current process', () => {
    const { store } = createStore('2026-08-13T13:00:00.000Z')
    const priorUnobserved = store.create(todayRun())
    const current = store.create(todayRun({
      id: '22222222-2222-4222-8222-222222222222',
    }))

    expect(priorUnobserved.closedAt).toBeNull()
    expect(current.closedAt).toBeNull()
    expect(store.closeRuns([current.id], 'app_closed')).toBe(1)
    expect(store.get('11111111-1111-4111-8111-111111111111')).toEqual(
      expect.objectContaining({
        closedAt: null,
        closeReason: null,
      }),
    )
    expect(store.get('22222222-2222-4222-8222-222222222222')).toEqual(
      expect.objectContaining({
        closedAt: '2026-08-13T13:00:00.000Z',
        closeReason: 'app_closed',
      }),
    )
  })

  it('does not allow renderer transitions to claim confirmation or write outcomes', () => {
    const { store } = createStore()
    store.create(todayRun())

    expect(() => store.transition({
      kind: 'confirm_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      operationId: '33333333-3333-4333-8333-333333333333',
      outcomeKind: 'created',
    })).toThrow(/kind|fields/i)
  })
})

describe('trusted confirmation correlation and retention', () => {
  it('claims only an exact selected candidate and fills a trusted bounded outcome', () => {
    const { store } = createStore('2026-08-13T14:00:00.000Z')
    const created = store.create(todayRun())
    const candidateId = created.candidates[0]!.id

    expect(store.claimConfirmation(candidateId, taskRequest())).toEqual({ claimed: true })
    expect(store.claimConfirmation(candidateId, taskRequest())).toEqual({ claimed: true })
    expect(() => store.claimConfirmation(candidateId, taskRequest({
      operationId: '44444444-4444-4444-8444-444444444444',
    }))).toThrow(/operation/i)
    expect(() => store.claimConfirmation(candidateId, taskRequest({
      payload: { ...taskRequest().payload as object, title: '不匹配' },
    }))).toThrow(/payload/i)

    expect(store.recordOutcome(candidateId, '33333333-3333-4333-8333-333333333333', 'uncertain'))
      .toEqual({ recorded: true })
    expect(store.claimConfirmation(candidateId, taskRequest())).toEqual({ claimed: true })
    expect(store.recordOutcome(candidateId, '33333333-3333-4333-8333-333333333333', 'created'))
      .toEqual({ recorded: true })
    expect(store.recordOutcome(candidateId, '33333333-3333-4333-8333-333333333333', 'created'))
      .toEqual({ recorded: true })
    expect(() => store.recordOutcome(candidateId, '33333333-3333-4333-8333-333333333333', 'replayed'))
      .toThrow(/outcome/i)
    expect(store.get('11111111-1111-4111-8111-111111111111')?.candidates[0]).toEqual(
      expect.objectContaining({ userDisposition: 'confirmed', outcomeKind: 'created' }),
    )
  })

  it('keeps a validation-failed candidate bound to O1 and accepts O2 only for a fresh generation candidate', () => {
    const { store } = createStore('2026-08-13T14:00:00.000Z')
    const firstRun = store.create(todayRun())
    const firstCandidateId = firstRun.candidates[0]!.id
    const firstRequest = taskRequest()
    const secondRequest = taskRequest({ operationId: '44444444-4444-4444-8444-444444444444' })

    expect(store.claimConfirmation(firstCandidateId, firstRequest)).toEqual({ claimed: true })
    expect(store.recordOutcome(firstCandidateId, firstRequest.operationId, 'validation_error'))
      .toEqual({ recorded: true })
    expect(() => store.claimConfirmation(firstCandidateId, secondRequest)).toThrow(/operation|outcome/i)

    const secondRun = store.create(todayRun({
      id: '22222222-2222-4222-8222-222222222222',
    }))
    const secondCandidateId = secondRun.candidates[0]!.id
    expect(secondCandidateId).not.toBe(firstCandidateId)
    expect(store.claimConfirmation(secondCandidateId, secondRequest)).toEqual({ claimed: true })
    expect(store.recordOutcome(secondCandidateId, secondRequest.operationId, 'created'))
      .toEqual({ recorded: true })

    expect(store.get(firstRun.id)?.candidates[0]).toEqual(expect.objectContaining({
      userDisposition: 'confirmed',
      outcomeKind: 'validation_error',
    }))
    expect(store.get(secondRun.id)?.candidates[0]).toEqual(expect.objectContaining({
      userDisposition: 'confirmed',
      outcomeKind: 'created',
    }))
  })

  it('allows same-operation outcome fill after close and silently ignores deleted history', () => {
    const { store } = createStore()
    const candidateId = store.create(todayRun()).candidates[0]!.id
    store.claimConfirmation(candidateId, taskRequest())
    store.transition({
      kind: 'close_run',
      runId: '11111111-1111-4111-8111-111111111111',
      reason: 'dialog_closed',
    })

    expect(store.recordOutcome(candidateId, '33333333-3333-4333-8333-333333333333', 'replayed'))
      .toEqual({ recorded: true })
    expect(store.delete('11111111-1111-4111-8111-111111111111')).toEqual({ deleted: true })
    expect(store.recordOutcome(candidateId, '33333333-3333-4333-8333-333333333333', 'created'))
      .toEqual({ recorded: false })
  })

  it('preserves logical source references and reports current source availability', () => {
    const { database, store } = createStore()
    const before = store.create(todayRun()).candidates[0]!

    expect(before.sourceRelations.subject).toEqual({ available: true, id: 1, label: '数学' })
    expect(before.sourceRelations.mistake).toEqual({ available: true, id: 12, label: '函数极限题' })
    database.prepare('DELETE FROM mistakes WHERE id = 12').run()
    database.prepare('DELETE FROM subjects WHERE id = 1').run()

    const after = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!
    expect(after.subjectId).toBe(1)
    expect(after.relatedMistakeId).toBe(12)
    expect(after.sourceRelations.subject).toEqual({ available: false, id: 1 })
    expect(after.sourceRelations.mistake).toEqual({ available: false, id: 12 })
  })

  it('resolves a current task only through a matching receipt digest and date relation', () => {
    const { database, store } = createStore()
    const candidateId = store.create(todayRun()).candidates[0]!.id
    const request = taskRequest()
    store.claimConfirmation(candidateId, request)
    const taskId = Number(database.prepare(`
      INSERT INTO study_tasks (
        title, description, type, subject_id, related_mistake_id, related_entry_id,
        related_chapter_id, planned_date, estimate_minutes, status, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', 'ai')
    `).run(
      '复习 函数极限', '今天到期,适合先处理。', 'review', 1, 12, null,
      null, '2026-08-13', 25,
    ).lastInsertRowid)
    database.prepare(`
      INSERT INTO study_task_action_receipts (
        operation_id, operation_kind, action_contract_version, request_digest,
        expected_current_date, planned_date, task_id
      ) VALUES (?, 'today_action', 'confirmed-study-task-action.v1', ?, '2026-08-13', '2026-08-13', ?)
    `).run(
      '33333333-3333-4333-8333-333333333333',
      buildIdempotentAIStudyTaskRequestDigest(request as never),
      taskId,
    )

    expect(store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.taskRelation)
      .toEqual({ available: true, title: '复习 函数极限', status: 'todo' })
    database.prepare('DELETE FROM study_tasks WHERE id = ?').run(taskId)
    expect(store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.taskRelation)
      .toEqual({ available: false })
  })

  it('retains only recent/newest runs and deleting history leaves tasks and receipts intact', () => {
    let currentNow = new Date('2026-07-01T00:00:00.000Z')
    const database = new BetterSqlite3(':memory:')
    databases.push(database)
    database.pragma('foreign_keys = ON')
    runDatabaseMigrations(database)
    const store = createPlanningHistoryStore({ database, now: () => currentNow })
    for (let index = 0; index < 101; index += 1) {
      currentNow = new Date(Date.UTC(2026, 7, 1, 0, index, 0))
      const suffix = index.toString(16).padStart(12, '0')
      store.create(todayRun({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
        generationResultKind: 'valid_empty',
        candidates: [],
      }))
    }
    const taskId = Number(database.prepare(`
      INSERT INTO study_tasks (title, planned_date, source)
      VALUES ('保留任务', '2026-08-01', 'ai')
    `).run().lastInsertRowid)
    database.prepare(`
      INSERT INTO study_task_action_receipts (
        operation_id, operation_kind, action_contract_version, request_digest,
        expected_current_date, planned_date, task_id
      ) VALUES ('55555555-5555-4555-8555-555555555555', 'today_action',
        'confirmed-study-task-action.v1', 'digest', '2026-08-01', '2026-08-01', ?)
    `).run(taskId)

    expect(store.listRecent({ limit: 50 }).items).toHaveLength(50)
    expect((database.prepare('SELECT COUNT(*) AS count FROM planning_runs').get() as { count: number }).count).toBe(100)
    expect(store.clear()).toEqual({ deletedCount: 100 })
    expect(database.prepare('SELECT id FROM study_tasks WHERE id = ?').get(taskId)).toEqual({ id: taskId })
    expect(database.prepare('SELECT task_id FROM study_task_action_receipts').get()).toEqual({ task_id: taskId })
  })

  it('removes runs older than 30 days when a new run is successfully created', () => {
    let currentNow = new Date('2026-06-01T00:00:00.000Z')
    const database = new BetterSqlite3(':memory:')
    databases.push(database)
    database.pragma('foreign_keys = ON')
    runDatabaseMigrations(database)
    const store = createPlanningHistoryStore({ database, now: () => currentNow })
    store.create(todayRun({ generationResultKind: 'valid_empty', candidates: [] }))
    currentNow = new Date('2026-08-01T00:00:00.000Z')
    store.create(todayRun({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      generationResultKind: 'valid_empty',
      candidates: [],
    }))

    expect(store.get('11111111-1111-4111-8111-111111111111')).toBeNull()
    expect(store.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).not.toBeNull()
  })
})

describe('trusted-main planning history create seam', () => {
  it('atomically creates a Today Action run and its valid candidates', () => {
    const { database, store } = createStore()

    const created = store.create(todayRun())

    expect(created).toEqual(expect.objectContaining({
      id: '11111111-1111-4111-8111-111111111111',
      entryPoint: 'today_action',
      planningDate: '2026-08-13',
      targetDate: '2026-08-13',
      generationResultKind: 'candidate_set',
      createdAt: '2026-08-13T12:34:56.789Z',
      closedAt: null,
      closeReason: null,
    }))
    expect(created.contextSummary).toEqual(TODAY_CONTEXT)
    expect(created.candidates).toEqual([
      expect.objectContaining({
        ordinal: 0,
        title: '复习 函数极限',
        description: '今天到期,适合先处理。',
        userDisposition: 'selected_unconfirmed',
        editBefore: {},
        outcomeKind: null,
      }),
    ])
    expect(database.prepare('SELECT COUNT(*) AS count FROM planning_runs').get()).toEqual({ count: 1 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM planning_run_candidates').get()).toEqual({ count: 1 })
    const contextJson = (database.prepare('SELECT context_summary_json FROM planning_runs').get() as { context_summary_json: string }).context_summary_json
    expect(contextJson).toBe(JSON.stringify(TODAY_CONTEXT))
    expect(contextJson).not.toContain('preparedCount')
    expect(contextJson).not.toContain('label')
  })

  it('creates valid-empty and Daily Review runs with frozen date semantics', () => {
    const { store } = createStore()

    const empty = store.create(todayRun({
      generationResultKind: 'valid_empty',
      candidates: [],
    }))
    const daily = store.create({
      id: '22222222-2222-4222-8222-222222222222',
      entryPoint: 'daily_review',
      planningDate: '2026-08-13',
      targetDate: '2026-08-14',
      generationResultKind: 'candidate_set',
      contextSummary: DAILY_CONTEXT,
      candidates: [{
        ordinal: 2,
        admissionOrigin: 'provider_validated',
        title: '整理明日重点',
        description: '从复盘结论安排次日任务。',
        type: 'focus',
        estimateMinutes: 30,
        priority: 'medium',
        subjectId: null,
        relatedMistakeId: null,
        relatedEntryId: null,
        userDisposition: 'unselected',
      }],
    })

    expect(empty.candidates).toEqual([])
    expect(daily.entryPoint).toBe('daily_review')
    expect(daily.candidates[0]?.ordinal).toBe(2)
  })

  it('uses immutable run metadata as the stable idempotent create identity', () => {
    const { database } = createStore()
    const onCreatedNew = vi.fn()
    const store = createPlanningHistoryStore({
      database,
      now: () => new Date('2026-08-13T12:34:56.789Z'),
      onCreatedNew,
    })
    const originalRequest = todayRun({
      candidates: [
        {
          ...(todayRun().candidates as Array<Record<string, unknown>>)[0],
          ordinal: 4,
          title: '第四项',
        },
        {
          ...(todayRun().candidates as Array<Record<string, unknown>>)[0],
          ordinal: 1,
          title: '第一项',
        },
      ],
    })
    const first = store.create(originalRequest)
    expect(onCreatedNew).toHaveBeenCalledOnce()
    expect(onCreatedNew).toHaveBeenCalledWith(first.id)

    expect(store.create(originalRequest)).toEqual(first)
    expect(store.create(todayRun({
      candidates: [{
        ...(todayRun().candidates as Array<Record<string, unknown>>)[0],
        title: '不同候选',
      }],
    }))).toEqual(first)
    expect(onCreatedNew).toHaveBeenCalledOnce()
    expect(store.get(first.id)?.candidates.map(candidate => candidate.title))
      .toEqual(['第一项', '第四项'])
    database.prepare('DELETE FROM mistakes WHERE id = 12').run()
    database.prepare('DELETE FROM subjects WHERE id = 1').run()
    expect(store.create(originalRequest)).toMatchObject({
      id: first.id,
      candidates: [
        expect.objectContaining({ title: '第一项' }),
        expect.objectContaining({ title: '第四项' }),
      ],
    })
    expect(() => store.create({
      ...originalRequest,
      contextSummary: TODAY_CONTEXT.map((item, index) => index === 1
        ? { category: 'today_tasks', preparation: 'prepared', disposition: 'included', reasonCode: 'included_available' }
        : item),
    })).toThrow(/conflict/i)
  })

  it('rejects an invalid candidate without leaving the run behind', () => {
    const { database, store } = createStore()

    expect(() => store.create(todayRun({
      candidates: [{
        ...(todayRun().candidates as Array<Record<string, unknown>>)[0],
        title: '',
      }],
    }))).toThrow(/title/i)

    expect(database.prepare('SELECT COUNT(*) AS count FROM planning_runs').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM planning_run_candidates').get()).toEqual({ count: 0 })
  })

  it.each([
    ['unknown context key', [{ ...TODAY_CONTEXT[0], label: 'secret' }, ...TODAY_CONTEXT.slice(1)]],
    ['wrong context order', [...TODAY_CONTEXT].reverse()],
    ['duplicate context category', [TODAY_CONTEXT[0], TODAY_CONTEXT[0], ...TODAY_CONTEXT.slice(2)]],
    ['invalid context tuple', [{ ...TODAY_CONTEXT[0], disposition: 'excluded' }, ...TODAY_CONTEXT.slice(1)]],
  ])('rejects %s without persisting a run', (_label, contextSummary) => {
    const { database, store } = createStore()

    expect(() => store.create(todayRun({ contextSummary }))).toThrow()

    expect(database.prepare('SELECT COUNT(*) AS count FROM planning_runs').get()).toEqual({ count: 0 })
  })

  it('rejects unknown/accessor payload fields and bounded text overflow before SQLite', () => {
    const { database, store } = createStore()
    const accessor = Object.defineProperty({}, 'id', {
      enumerable: true,
      get: () => { throw new Error('must not run') },
    })

    expect(() => store.create({ ...todayRun(), rawProviderResponse: 'secret' })).toThrow(/fields/i)
    expect(() => store.create(accessor)).toThrow()
    expect(() => store.create(todayRun({
      candidates: [{
        ...(todayRun().candidates as Array<Record<string, unknown>>)[0],
        title: '😀'.repeat(80),
      }],
    }))).toThrow(/current units/i)

    expect(database.prepare('SELECT COUNT(*) AS count FROM planning_runs').get()).toEqual({ count: 0 })
  })

  it('rejects over-six and duplicate-ordinal candidate arrays before persisting a run', () => {
    const { database, store } = createStore()
    const base = (todayRun().candidates as Array<Record<string, unknown>>)[0]!

    expect(() => store.create(todayRun({
      candidates: Array.from({ length: 7 }, (_, ordinal) => ({ ...base, ordinal })),
    }))).toThrow(/at most 6/i)
    expect(() => store.create(todayRun({
      candidates: [{ ...base, ordinal: 0 }, { ...base, ordinal: 0 }],
    }))).toThrow(/ordinal.*unique/i)

    expect(database.prepare('SELECT COUNT(*) AS count FROM planning_runs').get()).toEqual({ count: 0 })
  })

  it('returns a bounded unavailable error instead of projecting corrupt stored candidate state', () => {
    const { database, store } = createStore()
    store.create(todayRun())
    database.pragma('ignore_check_constraints = ON')
    database.prepare(`
      UPDATE planning_run_candidates
      SET estimate_minutes = 181
      WHERE planning_run_id = ?
    `).run('11111111-1111-4111-8111-111111111111')

    expect(() => store.get('11111111-1111-4111-8111-111111111111')).toThrow(/unavailable/i)
  })

  it('rejects a corrupt non-confirmed candidate that carries an outcome', () => {
    const { database, store } = createStore()
    store.create(todayRun())
    database.pragma('ignore_check_constraints = ON')
    database.prepare(`
      UPDATE planning_run_candidates
      SET outcome_kind = 'created', outcome_observed_at = '2026-08-13T12:35:00.000Z'
      WHERE planning_run_id = ?
    `).run('11111111-1111-4111-8111-111111111111')

    expect(() => store.get('11111111-1111-4111-8111-111111111111')).toThrow(/unavailable/i)
  })

  it('returns a bounded unavailable error for corrupt stored run date semantics', () => {
    const { database, store } = createStore()
    store.create(todayRun())
    database.pragma('ignore_check_constraints = ON')
    database.prepare(`
      UPDATE planning_runs
      SET planning_date = '2026-99-99', target_date = '2026-99-99'
      WHERE id = ?
    `).run('11111111-1111-4111-8111-111111111111')

    expect(() => store.get('11111111-1111-4111-8111-111111111111')).toThrow(/unavailable/i)
  })

  it('rejects stored edit history that is not a net diff', () => {
    const { database, store } = createStore()
    store.create(todayRun())
    database.prepare(`
      UPDATE planning_run_candidates
      SET edit_before_json = ?
      WHERE planning_run_id = ?
    `).run(
      JSON.stringify({ title: '复习 函数极限' }),
      '11111111-1111-4111-8111-111111111111',
    )

    expect(() => store.get('11111111-1111-4111-8111-111111111111')).toThrow(/unavailable/i)
  })

  it('rejects stored Daily Review edit history with an entry relation', () => {
    const { database, store } = createStore()
    store.create({
      id: '22222222-2222-4222-8222-222222222222',
      entryPoint: 'daily_review',
      planningDate: '2026-08-13',
      targetDate: '2026-08-14',
      generationResultKind: 'candidate_set',
      contextSummary: DAILY_CONTEXT,
      candidates: [{
        ordinal: 0,
        admissionOrigin: 'provider_validated',
        title: '整理明日重点',
        description: '从复盘结论安排次日任务。',
        type: 'focus',
        estimateMinutes: 30,
        priority: 'medium',
        subjectId: null,
        relatedMistakeId: null,
        relatedEntryId: null,
        userDisposition: 'unselected',
      }],
    })
    database.prepare(`
      UPDATE planning_run_candidates
      SET edit_before_json = '{"related_entry_id":99}'
      WHERE planning_run_id = ?
    `).run('22222222-2222-4222-8222-222222222222')

    expect(() => store.get('22222222-2222-4222-8222-222222222222')).toThrow(/unavailable/i)
  })

  it('returns a bounded unavailable error for impossible durable edit_before review relation', () => {
    const { database, store } = createStore()
    store.create(todayRun())
    database.prepare(`
      UPDATE planning_run_candidates
      SET type = 'focus', related_mistake_id = NULL,
          edit_before_json = '{"related_mistake_id":12}'
      WHERE planning_run_id = ?
    `).run('11111111-1111-4111-8111-111111111111')

    expect(() => store.get('11111111-1111-4111-8111-111111111111')).toThrow(/unavailable/i)
  })

  it('roundtrips a legal review-to-focus coupled type change through commit and read', () => {
    const { store } = createStore()
    store.create(todayRun())

    const run = store.transition({
      kind: 'commit_candidate',
      runId: '11111111-1111-4111-8111-111111111111',
      ordinal: 0,
      candidate: {
        title: '复习 函数极限',
        description: '今天到期,适合先处理。',
        type: 'focus',
        estimateMinutes: 25,
        priority: 'high',
        subjectId: 1,
        relatedMistakeId: null,
        relatedEntryId: null,
      },
    })

    const candidate = run.candidates[0]
    expect(candidate).toMatchObject({
      type: 'focus',
      relatedMistakeId: null,
      editBefore: {
        type: 'review',
        relatedMistakeId: 12,
      },
    })

    const readBack = store.get('11111111-1111-4111-8111-111111111111')
    expect(readBack?.candidates[0]).toMatchObject({
      type: 'focus',
      relatedMistakeId: null,
      editBefore: {
        type: 'review',
        relatedMistakeId: 12,
      },
    })
  })

  it('projects executionAttribution on get and listRecent results', () => {
    const { store } = createStore()
    store.create(todayRun())

    const record = store.get('11111111-1111-4111-8111-111111111111')
    expect(record).not.toBeNull()
    expect(record?.candidates[0]?.executionAttribution).toEqual({
      kind: 'not_confirmed',
      receiptValidated: false,
      taskId: null,
      taskCurrentTitle: null,
      taskCurrentStatus: null,
      semanticDrift: null,
      focus: {
        state: 'not_applicable',
        totalDurationMinutes: null,
        sessionCount: null,
        unavailableReason: null,
      },
    })

    const listResult = store.listRecent()
    expect(listResult.items[0]?.candidates[0]?.executionAttribution).toEqual(
      record?.candidates[0]?.executionAttribution,
    )
  })
})
