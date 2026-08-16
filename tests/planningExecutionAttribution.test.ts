// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
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
      description: ' 今天到期,适合先处理。 ',
      type: 'review',
      estimateMinutes: 25,
      priority: 'high',
      subjectId: 1,
      relatedMistakeId: 12,
      relatedEntryId: null,
      userDisposition: 'selected_unconfirmed',
    }],
    ...overrides,
  } as any
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
  } as any
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('Planning History Execution Attribution', () => {
  describe('Attribution Matrix', () => {
    it('case 1: verified_linked - confirmed candidate + outcome=created + valid receipt + existing task', () => {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', 'ai')
      `).run('复习 函数极限', '今天到期,适合先处理。', 'review', 1, 12, '2026-08-13', 25).lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      store.recordOutcome(candidateId, req.operationId, 'created')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('verified_linked')
      expect(attribution.receiptValidated).toBe(true)
      expect(attribution.taskId).toBe(taskId)
      expect(attribution.taskCurrentTitle).toBe('复习 函数极限')
      expect(attribution.taskCurrentStatus).toBe('todo')
    })

    it('case 2: task_deleted - confirmed + outcome=created + valid receipt + task deleted', () => {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', 'ai')
      `).run('复习 函数极限', '今天到期,适合先处理。', 'review', 1, 12, '2026-08-13', 25).lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      database.prepare('DELETE FROM study_tasks WHERE id = ?').run(taskId)

      store.recordOutcome(candidateId, req.operationId, 'created')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('task_deleted')
      expect(attribution.receiptValidated).toBe(true)
      expect(attribution.taskId).toBeNull()
      expect(attribution.taskCurrentTitle).toBeNull()
      expect(attribution.taskCurrentStatus).toBeNull()
      expect(attribution.semanticDrift).toBeNull()
    })

    it('case 3: task_deleted via receipt.task_id=null - confirmed + outcome=created + receipt with task_id=null', () => {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date)

      store.recordOutcome(candidateId, req.operationId, 'created')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('task_deleted')
      expect(attribution.receiptValidated).toBe(true)
      expect(attribution.taskId).toBeNull()
      expect(attribution.taskCurrentTitle).toBeNull()
    })

    it('case 4: integrity_inconsistency - confirmed + outcome=created + NO receipt', () => {
      const { store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)
      store.recordOutcome(candidateId, req.operationId, 'created')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('integrity_inconsistency')
      expect(attribution.receiptValidated).toBe(false)
    })

    it('case 5: verified_linked from uncertain - confirmed + outcome=uncertain + valid receipt + existing task', () => {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', 'ai')
      `).run('复习 函数极限', '今天到期,适合先处理。', 'review', 1, 12, '2026-08-13', 25).lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      store.recordOutcome(candidateId, req.operationId, 'uncertain')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('verified_linked')
      expect(attribution.receiptValidated).toBe(true)
    })

    it('case 6: unresolved - confirmed + outcome=uncertain + NO receipt', () => {
      const { store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)
      store.recordOutcome(candidateId, req.operationId, 'uncertain')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('unresolved')
    })

    it('case 7: known_conflict - confirmed + outcome=conflict + receipt exists', () => {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, 'different-digest', req.expectedCurrentDate, req.payload.planned_date)

      store.recordOutcome(candidateId, req.operationId, 'conflict')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('known_conflict')
      expect(attribution.receiptValidated).toBe(false)
    })

    it('case 8: no_execution_expected (date_mismatch) - confirmed + outcome=date_mismatch', () => {
      const { store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)
      store.recordOutcome(candidateId, req.operationId, 'date_mismatch')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('no_execution_expected')
    })

    it('case 9: no_execution_expected (validation_error) - confirmed + outcome=validation_error', () => {
      const { store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)
      store.recordOutcome(candidateId, req.operationId, 'validation_error')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('no_execution_expected')
    })

    it('case 10: integrity_inconsistency (integrity_error) - confirmed + outcome=integrity_error', () => {
      const { store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)
      store.recordOutcome(candidateId, req.operationId, 'integrity_error')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('integrity_inconsistency')
    })

    it('case 11: not_confirmed - unselected candidate', () => {
      const { store } = createStore()
      store.create(todayRun())
      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.kind).toBe('not_confirmed')
      expect(attribution.receiptValidated).toBe(false)
      expect(attribution.taskId).toBeNull()
      expect(attribution.taskCurrentTitle).toBeNull()
      expect(attribution.taskCurrentStatus).toBeNull()
      expect(attribution.semanticDrift).toBeNull()
      expect(attribution.focus.state).toBe('not_applicable')
    })
  })

  describe('Semantic Drift Tests', () => {
    it('reports no drift when task matches candidate exactly', () => {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', 'ai')
      `).run('复习 函数极限', '今天到期,适合先处理。', 'review', 1, 12, '2026-08-13', 25).lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      store.recordOutcome(candidateId, req.operationId, 'created')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.semanticDrift!.hasDrift).toBe(false)
      expect(Object.keys(attribution.semanticDrift!.differences)).toHaveLength(0)
    })

    it('reports drift when fields are modified, but ignores status and source', () => {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'done', 'dashboard')
      `).run('修改后的标题', '修改后的描述', 'focus', null, null, '2026-08-14', 30).lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      store.recordOutcome(candidateId, req.operationId, 'created')

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.semanticDrift!.hasDrift).toBe(true)
      expect(attribution.semanticDrift!.differences.title).toEqual({ candidateValue: '复习 函数极限', currentValue: '修改后的标题' })
      expect(attribution.semanticDrift!.differences.description).toEqual({ candidateValue: '今天到期,适合先处理。', currentValue: '修改后的描述' })
      expect(attribution.semanticDrift!.differences.type).toEqual({ candidateValue: 'review', currentValue: 'focus' })
      expect(attribution.semanticDrift!.differences.subjectId).toEqual({ candidateValue: 1, currentValue: null })
      expect(attribution.semanticDrift!.differences.relatedMistakeId).toEqual({ candidateValue: 12, currentValue: null })
      expect(attribution.semanticDrift!.differences.plannedDate).toEqual({ candidateValue: '2026-08-13', currentValue: '2026-08-14' })
      expect(attribution.semanticDrift!.differences.estimateMinutes).toEqual({ candidateValue: 25, currentValue: 30 })
    })
  })

  describe('Focus Attribution (Pomodoro)', () => {
    function setupTaskWithPomodoros(durations: number[]) {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', 'ai')
      `).run('复习 函数极限', '今天到期,适合先处理。', 'review', 1, 12, '2026-08-13', 25).lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      for (const duration of durations) {
        database.prepare('INSERT INTO pomodoro_sessions (task_id, duration) VALUES (?, ?)').run(taskId, duration)
      }

      store.recordOutcome(candidateId, req.operationId, 'created')
      return { store, database, taskId }
    }

    it('sums valid positive minutes durations', () => {
      const { store } = setupTaskWithPomodoros([25])
      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.focus.state).toBe('available')
      expect(attribution.focus.totalDurationMinutes).toBe(25)
      expect(attribution.focus.sessionCount).toBe(1)
    })

    it('handles fractional and multiple sessions correctly', () => {
      const { store } = setupTaskWithPomodoros([25, 2.5, 0.5])
      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.focus.state).toBe('available')
      expect(attribution.focus.totalDurationMinutes).toBe(28)
      expect(attribution.focus.sessionCount).toBe(3)
    })

    it('handles zero sessions', () => {
      const { store } = setupTaskWithPomodoros([])
      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.focus.state).toBe('available')
      expect(attribution.focus.totalDurationMinutes).toBe(0)
      expect(attribution.focus.sessionCount).toBe(0)
    })

    it('reports corrupt_data on 0 duration', () => {
      const { store } = setupTaskWithPomodoros([0])
      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.focus.state).toBe('corrupt_data')
    })

    it('reports corrupt_data on negative duration', () => {
      const { store } = setupTaskWithPomodoros([-1])
      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.focus.state).toBe('corrupt_data')
    })

    it('Task Deleted Focus Test - verifies focus state is unavailable when task is deleted', () => {
      const { store, database, taskId } = setupTaskWithPomodoros([25])
      database.prepare('DELETE FROM study_tasks WHERE id = ?').run(taskId)

      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.focus.state).toBe('unavailable')
      expect(attribution.focus.unavailableReason).toBe('task_deleted')
      expect(attribution.focus.totalDurationMinutes).toBeNull()
      expect(attribution.focus.sessionCount).toBeNull()
    })
  })

  describe('listRecent includes executionAttribution', () => {
    it('verifies listRecent results also have executionAttribution populated', () => {
      const { store } = createStore()
      store.create(todayRun())

      const results = store.listRecent()
      const candidate = results.items[0]!.candidates[0]!
      expect(candidate.executionAttribution).not.toBeNull()
      expect(candidate.executionAttribution!.kind).toBe('not_confirmed')
    })
  })

  describe('C2 Regression Tests', () => {
    it('verifies existing C2 fields remain intact and are unchanged', () => {
      const { store } = createStore()
      store.create(todayRun())

      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id
      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const run = store.get('11111111-1111-4111-8111-111111111111')!
      const candidate = run.candidates[0]!

      expect(candidate.sourceRelations.subject).toEqual({ available: true, id: 1, label: '数学' })
      expect(candidate.sourceRelations.mistake).toEqual({ available: true, id: 12, label: '函数极限题' })
      expect(candidate.editBefore).toEqual({})
      expect(candidate.outcomeKind).toBeNull()
      expect(candidate.taskRelation).toEqual({ available: false })
      expect(candidate.executionAttribution!.kind).toBe('unresolved')
    })
  })

  describe('Individual Semantic Drift Fields', () => {
    function setupTaskWithDrift(taskPatch: Record<string, unknown>) {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const baseTask = {
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
        ...taskPatch,
      }

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, related_entry_id, related_chapter_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        baseTask.title,
        baseTask.description,
        baseTask.type,
        baseTask.subject_id,
        baseTask.related_mistake_id,
        baseTask.related_entry_id,
        baseTask.related_chapter_id,
        baseTask.planned_date,
        baseTask.estimate_minutes,
        baseTask.status,
        baseTask.source,
      ).lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      store.recordOutcome(candidateId, req.operationId, 'created')
      return store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
    }

    it('detects relatedChapterId drift when task gains a chapter', () => {
      const { database, store } = createStore()
      database.prepare("INSERT INTO subject_chapters (id, subject_id, title, notes, completed, sort_order) VALUES (5, 1, '极限章节', '', 0, 1)").run()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, related_entry_id, related_chapter_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('复习 函数极限', '今天到期,适合先处理。', 'review', 1, 12, null, 5, '2026-08-13', 25, 'todo', 'ai').lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      store.recordOutcome(candidateId, req.operationId, 'created')
      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.semanticDrift!.hasDrift).toBe(true)
      expect(attribution.semanticDrift!.differences.relatedChapterId).toEqual({
        candidateValue: null,
        currentValue: 5,
      })
    })

    it('detects relatedEntryId drift when task links an entry', () => {
      const { database, store } = createStore()
      database.prepare("INSERT INTO entries (id, date, title, content, word_count) VALUES (7, '2026-08-13', '日记', '', 0)").run()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, related_entry_id, related_chapter_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('复习 函数极限', '今天到期,适合先处理。', 'review', 1, 12, 7, null, '2026-08-13', 25, 'todo', 'ai').lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      store.recordOutcome(candidateId, req.operationId, 'created')
      const attribution = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
      expect(attribution.semanticDrift!.hasDrift).toBe(true)
      expect(attribution.semanticDrift!.differences.relatedEntryId).toEqual({
        candidateValue: null,
        currentValue: 7,
      })
    })

    it('detects estimateMinutes drift', () => {
      const attribution = setupTaskWithDrift({ estimate_minutes: 45 })
      expect(attribution.semanticDrift!.hasDrift).toBe(true)
      expect(attribution.semanticDrift!.differences.estimateMinutes).toEqual({
        candidateValue: 25,
        currentValue: 45,
      })
    })

    it('detects plannedDate drift', () => {
      const attribution = setupTaskWithDrift({ planned_date: '2026-08-15' })
      expect(attribution.semanticDrift!.hasDrift).toBe(true)
      expect(attribution.semanticDrift!.differences.plannedDate).toEqual({
        candidateValue: '2026-08-13',
        currentValue: '2026-08-15',
      })
    })
  })

  describe('Corrupt Stored Task Data', () => {
    function setupTaskWithCorruptData(corruptColumns: Record<string, unknown>) {
      const { database, store } = createStore()
      store.create(todayRun())
      const candidateId = store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.id

      const req = taskRequest()
      store.claimConfirmation(candidateId, req)

      const cols = {
        title: '复习 函数极限',
        description: '今天到期,适合先处理。',
        type: 'review',
        subject_id: 1,
        related_mistake_id: 12,
        planned_date: '2026-08-13',
        estimate_minutes: 25,
        status: 'todo',
        source: 'ai',
        ...corruptColumns,
      }

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cols.title, cols.description, cols.type, cols.subject_id, cols.related_mistake_id, cols.planned_date, cols.estimate_minutes, cols.status, cols.source).lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      store.recordOutcome(candidateId, req.operationId, 'created')
      return store.get('11111111-1111-4111-8111-111111111111')!.candidates[0]!.executionAttribution!
    }

    it('reports integrity_inconsistency on invalid task status', () => {
      const attribution = setupTaskWithCorruptData({ status: 'INVALID_STATUS' })
      expect(attribution.kind).toBe('integrity_inconsistency')
      expect(attribution.receiptValidated).toBe(true)
      expect(attribution.taskCurrentTitle).toBeNull()
    })

    it('reports integrity_inconsistency on invalid task type', () => {
      const attribution = setupTaskWithCorruptData({ type: 'INVALID_TYPE' })
      expect(attribution.kind).toBe('integrity_inconsistency')
    })

    it('reports integrity_inconsistency on invalid task estimate_minutes (out of range)', () => {
      const attribution = setupTaskWithCorruptData({ estimate_minutes: 999 })
      expect(attribution.kind).toBe('integrity_inconsistency')
    })

    it('reports integrity_inconsistency on invalid task source', () => {
      const attribution = setupTaskWithCorruptData({ source: 'INVALID_SOURCE' })
      expect(attribution.kind).toBe('integrity_inconsistency')
    })
  })

  describe('Source Relation Batching & Normalization', () => {
    it('resolves subject, mistake, and entry relations via batch maps', () => {
      const { database, store } = createStore()
      database.prepare("INSERT INTO subjects (id, name) VALUES (2, '物理')").run()
      database.prepare("INSERT INTO mistakes (id, subject_id, question, answer) VALUES (20, 2, '牛顿第一定律', '答案')").run()
      database.prepare("INSERT INTO entries (id, date, title, content, word_count) VALUES (10, '2026-08-13', '学习总结', '内容', 10)").run()

      store.create(todayRun({
        candidates: [{
          ordinal: 0,
          admissionOrigin: 'provider_validated',
          title: '物理复习',
          description: '物理力学',
          type: 'review',
          estimateMinutes: 30,
          priority: 'medium',
          subjectId: 2,
          relatedMistakeId: 20,
          relatedEntryId: 10,
          userDisposition: 'unselected',
        }],
      }))

      const run = store.get('11111111-1111-4111-8111-111111111111')!
      const candidate = run.candidates[0]!
      expect(candidate.sourceRelations.subject).toEqual({ available: true, id: 2, label: '物理' })
      expect(candidate.sourceRelations.mistake).toEqual({ available: true, id: 20, label: '牛顿第一定律' })
      expect(candidate.sourceRelations.entry).toEqual({ available: true, id: 10, label: '学习总结' })
    })

    it('reports available: false when related subject was deleted', () => {
      const { database, store } = createStore()
      database.prepare("INSERT INTO subjects (id, name) VALUES (999, '化学')").run()
      database.prepare("INSERT INTO mistakes (id, subject_id, question, answer) VALUES (99, 999, '化学实验', '答案')").run()

      store.create(todayRun({
        candidates: [{
          ordinal: 0,
          admissionOrigin: 'provider_validated',
          title: '化学复习',
          description: '化学实验',
          type: 'review',
          estimateMinutes: 30,
          priority: 'medium',
          subjectId: 999,
          relatedMistakeId: 99,
          relatedEntryId: null,
          userDisposition: 'unselected',
        }],
      }))

      database.prepare('DELETE FROM mistakes WHERE id = 99').run()
      database.prepare('DELETE FROM subjects WHERE id = 999').run()

      const run = store.get('11111111-1111-4111-8111-111111111111')!
      expect(run.candidates[0]!.sourceRelations.subject).toEqual({ available: false, id: 999 })
      expect(run.candidates[0]!.sourceRelations.mistake).toEqual({ available: false, id: 99 })
    })

    it('batches current and editBefore relations in single queries', () => {
      const { database, store } = createStore()
      database.prepare("INSERT INTO subjects (id, name) VALUES (3, '化学')").run()
      database.prepare("INSERT INTO mistakes (id, subject_id, question, answer) VALUES (30, 3, '化学错题', '')").run()

      store.create(todayRun())

      // Commit candidate changing subject from 1 to 3, and mistake to 30
      store.transition({
        kind: 'commit_candidate',
        runId: '11111111-1111-4111-8111-111111111111',
        ordinal: 0,
        candidate: {
          title: '复习 函数极限',
          description: '今天到期,适合先处理。',
          type: 'review',
          estimateMinutes: 25,
          priority: 'high',
          subjectId: 3,
          relatedMistakeId: 30,
          relatedEntryId: null,
        },
      })

      const run = store.get('11111111-1111-4111-8111-111111111111')!
      const candidate = run.candidates[0]!
      expect(candidate.sourceRelations.subject).toEqual({ available: true, id: 3, label: '化学' })
      expect(candidate.sourceRelations.mistake).toEqual({ available: true, id: 30, label: '化学错题' })
      expect(candidate.editBeforeSourceRelations.subject).toEqual({ available: true, id: 1, label: '数学' })
      expect(candidate.editBeforeSourceRelations.mistake).toEqual({ available: true, id: 12, label: '函数极限题' })
    })
  })

  describe('Query Boundedness', () => {
    it('executes bounded batch query rounds regardless of candidate count in get()', () => {
      const { database, store } = createStore()
      database.prepare("INSERT INTO subjects (id, name) VALUES (2, '英语')").run()
      database.prepare("INSERT INTO subjects (id, name) VALUES (3, '政治')").run()
      database.prepare("INSERT INTO mistakes (id, subject_id, question, answer) VALUES (13, 2, '错题2', '')").run()
      database.prepare("INSERT INTO mistakes (id, subject_id, question, answer) VALUES (14, 3, '错题3', '')").run()

      store.create(todayRun({
        candidates: [
          {
            ordinal: 0,
            admissionOrigin: 'provider_validated',
            title: '候选1',
            description: '说明1',
            type: 'review',
            estimateMinutes: 25,
            priority: 'high',
            subjectId: 1,
            relatedMistakeId: 12,
            relatedEntryId: null,
            userDisposition: 'unselected',
          },
          {
            ordinal: 1,
            admissionOrigin: 'provider_validated',
            title: '候选2',
            description: '说明2',
            type: 'review',
            estimateMinutes: 30,
            priority: 'medium',
            subjectId: 2,
            relatedMistakeId: 13,
            relatedEntryId: null,
            userDisposition: 'unselected',
          },
          {
            ordinal: 2,
            admissionOrigin: 'provider_validated',
            title: '候选3',
            description: '说明3',
            type: 'review',
            estimateMinutes: 35,
            priority: 'low',
            subjectId: 3,
            relatedMistakeId: 14,
            relatedEntryId: null,
            userDisposition: 'unselected',
          },
        ],
      }))

      let prepareCount = 0
      const originalPrepare = database.prepare.bind(database)
      database.prepare = ((sql: string) => {
        prepareCount++
        return originalPrepare(sql)
      }) as any

      const run = store.get('11111111-1111-4111-8111-111111111111')!
      expect(run.candidates).toHaveLength(3)

      // Total queries prepared during get() must be bounded (1 run + 1 candidates + 3 relations = 5 queries)
      expect(prepareCount).toBeLessThanOrEqual(8)
    })

    it('executes page-level bounded batch queries across many runs in listRecent()', () => {
      const { database, store } = createStore()
      database.prepare("INSERT INTO subjects (id, name) VALUES (2, '英语')").run()
      database.prepare("INSERT INTO subjects (id, name) VALUES (3, '政治')").run()
      database.prepare("INSERT INTO mistakes (id, subject_id, question, answer) VALUES (13, 2, '错题2', '')").run()
      database.prepare("INSERT INTO mistakes (id, subject_id, question, answer) VALUES (14, 3, '错题3', '')").run()
      database.prepare("INSERT INTO entries (id, date, title, content, word_count) VALUES (7, '2026-08-13', '日记1', '', 0)").run()
      database.prepare("INSERT INTO entries (id, date, title, content, word_count) VALUES (8, '2026-08-13', '日记2', '', 0)").run()

      // Create 12 distinct planning runs with multiple candidates and relations
      const totalRuns = 12
      for (let i = 0; i < totalRuns; i++) {
        const hex = i.toString(16).padStart(12, '0')
        const runId = `00000000-0000-4000-8000-${hex}`
        const candidateCount = (i % 3) + 1 // 1 to 3 candidates per run
        const candidates = []
        for (let o = 0; o < candidateCount; o++) {
          const subjectId = (o % 3) + 1
          const mistakeId = subjectId === 1 ? 12 : subjectId === 2 ? 13 : 14
          const entryId = o === 0 ? null : (o === 1 ? 7 : 8)
          candidates.push({
            ordinal: o,
            admissionOrigin: 'provider_validated' as const,
            title: `任务 ${i}-${o}`,
            description: `描述 ${i}-${o}`,
            type: (o === 0 ? 'review' : 'custom') as any,
            estimateMinutes: 25 + o * 5,
            priority: 'high' as const,
            subjectId,
            relatedMistakeId: o === 0 ? mistakeId : null,
            relatedEntryId: o === 0 ? null : entryId,
            userDisposition: (i % 2 === 0 && o === 0) ? 'selected_unconfirmed' : 'unselected',
          })
        }
        store.create({
          id: runId,
          entryPoint: 'today_action',
          planningDate: '2026-08-13',
          targetDate: '2026-08-13',
          generationResultKind: 'candidate_set',
          contextSummary: TODAY_CONTEXT,
          candidates,
        })
      }

      // Add editBefore relation via transition on run 0
      store.transition({
        kind: 'commit_candidate',
        runId: '00000000-0000-4000-8000-000000000000',
        ordinal: 0,
        candidate: {
          title: '任务 0-0 修改后',
          description: '描述 0-0 修改后',
          type: 'review',
          estimateMinutes: 40,
          priority: 'medium',
          subjectId: 3,
          relatedMistakeId: 14,
          relatedEntryId: null,
        },
      })

      // Confirm candidate on run 2 and set up receipt, task, and pomodoro
      const run2CandidateId = store.get('00000000-0000-4000-8000-000000000002')!.candidates[0]!.id
      const req = taskRequest({
        operationId: '22222222-2222-4222-8222-222222222222',
        payload: {
          title: '任务 2-0',
          description: '描述 2-0',
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
      })
      store.claimConfirmation(run2CandidateId, req)

      const taskId = Number(database.prepare(`
        INSERT INTO study_tasks (title, description, type, subject_id, related_mistake_id, related_entry_id, related_chapter_id, planned_date, estimate_minutes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('任务 2-0', '描述 2-0', 'review', 1, 12, null, null, '2026-08-13', 25, 'todo', 'ai').lastInsertRowid)

      const digest = buildIdempotentAIStudyTaskRequestDigest(req)
      database.prepare(`
        INSERT INTO study_task_action_receipts (operation_id, operation_kind, action_contract_version, request_digest, expected_current_date, planned_date, task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.operationId, req.operationKind, req.actionContractVersion, digest, req.expectedCurrentDate, req.payload.planned_date, taskId)

      database.prepare(`
        INSERT INTO pomodoro_sessions (id, task_id, duration)
        VALUES (101, ?, 25)
      `).run(taskId)

      store.recordOutcome(run2CandidateId, req.operationId, 'created')

      // Measure queries executed during listRecent
      const preparedSqls: string[] = []
      const originalPrepare = database.prepare.bind(database)
      database.prepare = ((sql: string) => {
        preparedSqls.push(sql.trim())
        return originalPrepare(sql)
      }) as any

      const result = store.listRecent({ limit: 20 })
      expect(result.items).toHaveLength(totalRuns)

      // Query count assertion:
      // 1 planning_runs + 1 planning_run_candidates + 3 batchRelations + 1 batchReceipts + 1 batchTasks + 1 batchPomodoro = 8 queries maximum
      expect(preparedSqls.length).toBeLessThanOrEqual(8)

      // Query shape assertions:
      // 1. Exactly 1 planning_run_candidates query with WHERE planning_run_id IN (...)
      const candidateQueries = preparedSqls.filter(sql => sql.includes('FROM planning_run_candidates'))
      expect(candidateQueries).toHaveLength(1)
      expect(candidateQueries[0]).toMatch(/WHERE planning_run_id IN \(/i)

      // 2. Relation queries batch with IN (...)
      const subjectQueries = preparedSqls.filter(sql => sql.includes('FROM subjects'))
      expect(subjectQueries).toHaveLength(1)
      expect(subjectQueries[0]).toMatch(/WHERE id IN \(/i)

      const mistakeQueries = preparedSqls.filter(sql => sql.includes('FROM mistakes'))
      expect(mistakeQueries).toHaveLength(1)
      expect(mistakeQueries[0]).toMatch(/WHERE id IN \(/i)

      const entryQueries = preparedSqls.filter(sql => sql.includes('FROM entries'))
      expect(entryQueries).toHaveLength(1)
      expect(entryQueries[0]).toMatch(/WHERE id IN \(/i)

      // 3. Receipt, task, and pomodoro queries batch with IN (...)
      const receiptQueries = preparedSqls.filter(sql => sql.includes('FROM study_task_action_receipts'))
      expect(receiptQueries).toHaveLength(1)
      expect(receiptQueries[0]).toMatch(/WHERE operation_id IN \(/i)

      const taskQueries = preparedSqls.filter(sql => sql.includes('FROM study_tasks'))
      expect(taskQueries).toHaveLength(1)
      expect(taskQueries[0]).toMatch(/WHERE id IN \(/i)

      const pomodoroQueries = preparedSqls.filter(sql => sql.includes('FROM pomodoro_sessions'))
      expect(pomodoroQueries).toHaveLength(1)
      expect(pomodoroQueries[0]).toMatch(/WHERE task_id IN \(/i)

      // 4. Compare query count: 1 run vs 12 runs
      preparedSqls.length = 0
      store.listRecent({ limit: 1 })
      const oneRunQueryCount = preparedSqls.length
      expect(oneRunQueryCount).toBeLessThanOrEqual(8)
    })
  })
})
