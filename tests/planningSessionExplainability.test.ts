import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StudyTask } from '../src/types'
import {
  addPlanningSessionCandidate,
  applyPlanningCandidateOutcome,
  buildPlanningCandidateSnapshot,
  confirmPlanningCandidateRecord,
  createPlanningCandidateRecord,
  createPlanningSessionExplainability,
  mapStudyTaskActionExecutionResult,
  qualifyPlanningCandidateId,
  removePlanningCandidateRecord,
  resetPlanningSessionExplainability,
  updatePlanningCandidateRecord,
  type PlanningCandidateSnapshotInput,
  type PlanningContextDecision,
} from '../src/utils/planningSessionExplainability'

const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const FIXED_UNCERTAIN_OUTCOME = {
  kind: 'uncertain',
  operationId: OPERATION_ID,
  message: '结果尚无法确认，需要用户手动检查',
} as const

const baseSnapshot: PlanningCandidateSnapshotInput = {
  title: '复习函数极限',
  description: '今天到期，适合先处理。',
  type: 'review',
  estimateMinutes: 25,
  priority: 'high',
  subjectId: 1,
  relatedMistakeId: 12,
  relatedEntryId: null,
}

const contextDecisions: PlanningContextDecision[] = [{
  category: 'due_mistakes',
  label: '今日到期错题',
  preparation: 'prepared',
  disposition: 'partially_included',
  reasonCode: 'limit_applied',
  preparedCount: 15,
  includedCount: 12,
  limit: 12,
}]

const task: StudyTask = {
  id: 42,
  title: '复习函数极限',
  description: '今天到期，适合先处理。',
  type: 'review',
  subject_id: 1,
  related_mistake_id: 12,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: '2026-06-12',
  estimate_minutes: 25,
  status: 'todo',
  source: 'ai',
  created_at: '2026-06-12T00:00:00.000Z',
  updated_at: '2026-06-12T00:00:00.000Z',
}

function candidate(selected = true) {
  return createPlanningCandidateRecord({
    generationId: 'today-action-generation-1',
    clientId: 'suggestion-1',
    snapshot: baseSnapshot,
    selected,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('planning session candidate identity and snapshots', () => {
  it('qualifies a stable client identity by generation', () => {
    expect(qualifyPlanningCandidateId('generation-1', 'suggestion-1')).toBe('generation-1:suggestion-1')
    expect(qualifyPlanningCandidateId('generation-2', 'suggestion-1')).not.toBe(
      qualifyPlanningCandidateId('generation-1', 'suggestion-1'),
    )
  })

  it('stores one bounded initial and current snapshot with net changed fields', () => {
    const initial = candidate()
    const edited = updatePlanningCandidateRecord(initial, {
      ...baseSnapshot,
      title: '复习导数错题',
      estimateMinutes: 30,
    }, true)

    expect(edited.initial.title).toBe('复习函数极限')
    expect(edited.current.title).toBe('复习导数错题')
    expect(edited.changedFields).toEqual(['title', 'estimateMinutes'])
    expect(edited.decision).toBe('retained_selected')
  })

  it('clears net changes when a candidate is restored to its initial values', () => {
    const initial = candidate()
    const edited = updatePlanningCandidateRecord(initial, { ...baseSnapshot, description: '改过的说明' }, true)
    const restored = updatePlanningCandidateRecord(edited, baseSnapshot, true)

    expect(restored.current).toEqual(restored.initial)
    expect(restored.changedFields).toEqual([])
  })

  it('keeps removed distinct from retained unselected', () => {
    const initial = candidate()
    const unselected = updatePlanningCandidateRecord(initial, baseSnapshot, false)
    const removed = removePlanningCandidateRecord(initial)

    expect(unselected.decision).toBe('retained_unselected')
    expect(removed.decision).toBe('removed')
    expect(unselected.candidateId).toBe(removed.candidateId)
  })

  it('keeps selected distinct from confirmed after automatic checkbox clearing', () => {
    const unselected = updatePlanningCandidateRecord(candidate(), baseSnapshot, false)
    const selected = updatePlanningCandidateRecord(unselected, baseSnapshot, true)
    const confirmed = confirmPlanningCandidateRecord(selected, OPERATION_ID)

    expect(selected.decision).toBe('retained_selected')
    expect(selected.selected).toBe(true)
    expect(confirmed.decision).toBe('confirmed')
    expect(confirmed.selected).toBe(false)
    expect(confirmed.operationId).toBe(OPERATION_ID)
  })

  it('admits a repaired provider suggestion at its first valid snapshot and preserves that origin', () => {
    const empty = createPlanningSessionExplainability({
      generationId: 'today-action-generation-1',
      contextDecisions: [],
      candidates: [],
    })
    const admitted = addPlanningSessionCandidate(empty, {
      clientId: 'suggestion-1',
      snapshot: baseSnapshot,
      selected: false,
    })
    const initial = admitted.candidates[0]!

    expect(initial.admissionOrigin).toBe('provider_suggested_user_repaired')
    expect(initial.initial).toEqual(initial.current)
    expect(initial.changedFields).toEqual([])

    const edited = updatePlanningCandidateRecord(initial, {
      ...baseSnapshot,
      title: '用户后续编辑',
    }, true)
    const restored = updatePlanningCandidateRecord(edited, baseSnapshot, false)
    const removed = removePlanningCandidateRecord(restored)
    const confirmed = confirmPlanningCandidateRecord(edited, OPERATION_ID)
    const observed = applyPlanningCandidateOutcome(confirmed, {
      operationId: OPERATION_ID,
      status: 'succeeded',
      task,
      replayed: false,
    }, OPERATION_ID)

    expect(edited.changedFields).toEqual(['title'])
    expect(restored.changedFields).toEqual([])
    expect(restored.decision).toBe('retained_unselected')
    expect(removed.admissionOrigin).toBe('provider_suggested_user_repaired')
    expect(confirmed.admissionOrigin).toBe('provider_suggested_user_repaired')
    expect(observed.admissionOrigin).toBe('provider_suggested_user_repaired')
  })

  it('bounds candidate text and ignores fields outside the snapshot allowlist', () => {
    const snapshot = buildPlanningCandidateSnapshot({
      ...baseSnapshot,
      title: '题'.repeat(100),
      description: '说明'.repeat(200),
      generationContextSignature: '{"diary":"secret"}',
      rawProviderPayload: 'raw-secret',
    } as PlanningCandidateSnapshotInput & Record<string, unknown>)

    expect(snapshot.title).toHaveLength(80)
    expect(snapshot.description).toHaveLength(240)
    expect(JSON.stringify(snapshot)).not.toContain('generationContextSignature')
    expect(JSON.stringify(snapshot)).not.toContain('raw-secret')
  })

  it('normalizes invalid reference IDs to null which masks raw-level changes', () => {
    const invalidRef: PlanningCandidateSnapshotInput = {
      ...baseSnapshot,
      relatedEntryId: -1,
      subjectId: -1,
      relatedMistakeId: -1,
    }
    const clearedRef: PlanningCandidateSnapshotInput = {
      ...baseSnapshot,
      relatedEntryId: null,
      subjectId: null,
      relatedMistakeId: null,
    }

    const invalidSnapshot = buildPlanningCandidateSnapshot(invalidRef)
    const clearedSnapshot = buildPlanningCandidateSnapshot(clearedRef)

    expect(invalidSnapshot.relatedEntryId).toBeNull()
    expect(clearedSnapshot.relatedEntryId).toBeNull()
    expect(invalidSnapshot.subjectId).toBeNull()
    expect(clearedSnapshot.subjectId).toBeNull()
    expect(invalidSnapshot.relatedMistakeId).toBeNull()
    expect(clearedSnapshot.relatedMistakeId).toBeNull()

    expect(invalidSnapshot).toEqual(clearedSnapshot)

    expect(invalidRef.relatedEntryId).not.toBe(clearedRef.relatedEntryId)
    expect(invalidRef.subjectId).not.toBe(clearedRef.subjectId)
    expect(invalidRef.relatedMistakeId).not.toBe(clearedRef.relatedMistakeId)
  })
})

describe('planning confirmed action outcome mapping', () => {
  it('maps a newly created task', () => {
    expect(mapStudyTaskActionExecutionResult({
      operationId: OPERATION_ID,
      status: 'succeeded',
      task,
      replayed: false,
    }, OPERATION_ID)).toEqual({
      kind: 'created',
      operationId: OPERATION_ID,
      message: '已创建任务',
      taskId: 42,
    })
  })

  it('maps a replay without calling it newly created', () => {
    const outcome = mapStudyTaskActionExecutionResult({
      operationId: OPERATION_ID,
      status: 'succeeded',
      task,
      replayed: true,
    }, OPERATION_ID)

    expect(outcome.kind).toBe('replayed')
    expect(outcome.message).toBe('原操作此前已完成，本次未重复创建')
  })

  it('maps uncertain and operation mismatch to a bounded uncertain result', () => {
    expect(mapStudyTaskActionExecutionResult({
      operationId: OPERATION_ID,
      status: 'uncertain',
      error: 'transport detail that must not be shown',
    }, OPERATION_ID).kind).toBe('uncertain')

    const mismatch = mapStudyTaskActionExecutionResult({
      operationId: '22222222-2222-4222-8222-222222222222',
      status: 'succeeded',
      task,
      replayed: false,
    }, OPERATION_ID)
    expect(mismatch).toEqual({
      kind: 'uncertain',
      operationId: OPERATION_ID,
      message: '结果尚无法确认，需要用户手动检查',
    })
  })

  it.each([
    ['IDEMPOTENCY_CONFLICT', 'conflict', '该操作 ID 已对应另一份确认内容，本次未新建任务'],
    ['RESULT_DELETED', 'deleted', '原操作曾成功关联任务，但该任务后来已删除；本次检查没有新建任务。'],
    ['INTEGRITY_ERROR', 'integrity_error', '完整性检查未通过，本次操作已安全终止'],
    ['DATE_MISMATCH', 'date_mismatch', '确认日期已失效，本次未创建任务'],
    ['INVALID_REQUEST', 'validation_error', '确认内容未通过校验，本次未创建任务'],
  ] as const)('maps %s to %s', (code, kind, message) => {
    expect(mapStudyTaskActionExecutionResult({
      operationId: OPERATION_ID,
      status: 'failed',
      code,
      error: 'provider-or-database-detail-that-must-not-leak',
    }, OPERATION_ID)).toEqual({ kind, operationId: OPERATION_ID, message })
  })

  it('does not expose unknown or unbounded error objects', () => {
    const secret = 'secret-detail-'.repeat(1_000)
    const outcome = mapStudyTaskActionExecutionResult({
      operationId: OPERATION_ID,
      status: 'failed',
      code: 'UNKNOWN_CODE',
      error: { secret, stack: secret },
      rawProviderPayload: secret,
    }, OPERATION_ID)

    expect(outcome.kind).toBe('uncertain')
    expect(JSON.stringify(outcome)).not.toContain('secret-detail')
    expect(JSON.stringify(outcome).length).toBeLessThan(250)
  })

  it.each([
    ['succeeded missing task', {
      operationId: OPERATION_ID,
      status: 'succeeded',
      replayed: false,
    }],
    ['succeeded null task', {
      operationId: OPERATION_ID,
      status: 'succeeded',
      task: null,
      replayed: false,
    }],
    ['succeeded partial task', {
      operationId: OPERATION_ID,
      status: 'succeeded',
      task: { id: task.id, title: task.title },
      replayed: false,
    }],
    ['succeeded malformed task field', {
      operationId: OPERATION_ID,
      status: 'succeeded',
      task: { ...task, planned_date: '2026-02-30' },
      replayed: false,
    }],
    ['succeeded task with an ambiguous extra field', {
      operationId: OPERATION_ID,
      status: 'succeeded',
      task: { ...task, rawMessage: 'RAW_MALFORMED_SECRET' },
      replayed: false,
    }],
    ['succeeded missing replayed', {
      operationId: OPERATION_ID,
      status: 'succeeded',
      task,
    }],
    ['succeeded replayed wrong type', {
      operationId: OPERATION_ID,
      status: 'succeeded',
      task,
      replayed: 'false',
    }],
    ['failed missing error', {
      operationId: OPERATION_ID,
      status: 'failed',
      code: 'INTEGRITY_ERROR',
    }],
    ['failed malformed error', {
      operationId: OPERATION_ID,
      status: 'failed',
      code: 'INTEGRITY_ERROR',
      error: { message: 'RAW_MALFORMED_SECRET', stack: 'RAW_MALFORMED_SECRET' },
    }],
    ['failed unknown error code', {
      operationId: OPERATION_ID,
      status: 'failed',
      code: 'UNKNOWN_CODE',
      error: 'RAW_MALFORMED_SECRET',
    }],
    ['uncertain missing error', {
      operationId: OPERATION_ID,
      status: 'uncertain',
    }],
    ['missing operation ID', {
      status: 'failed',
      code: 'INTEGRITY_ERROR',
      error: 'RAW_MALFORMED_SECRET',
    }],
    ['malformed operation ID', {
      operationId: 'bad operation id',
      status: 'failed',
      code: 'INTEGRITY_ERROR',
      error: 'RAW_MALFORMED_SECRET',
    }],
    ['mismatched operation ID', {
      operationId: '22222222-2222-4222-8222-222222222222',
      status: 'failed',
      code: 'INTEGRITY_ERROR',
      error: 'RAW_MALFORMED_SECRET',
    }],
    ['unknown status', {
      operationId: OPERATION_ID,
      status: 'completed',
      error: 'RAW_MALFORMED_SECRET',
    }],
    ['ambiguous top-level extra field', {
      operationId: OPERATION_ID,
      status: 'uncertain',
      error: 'RAW_MALFORMED_SECRET',
      rawProviderPayload: 'RAW_MALFORMED_SECRET',
    }],
    ['null', null],
    ['array', [{ operationId: OPERATION_ID }]],
    ['primitive', 'RAW_MALFORMED_SECRET'],
  ] as const)('fails closed for %s', (_label, malformed) => {
    const outcome = mapStudyTaskActionExecutionResult(malformed, OPERATION_ID)

    expect(outcome).toEqual(FIXED_UNCERTAIN_OUTCOME)
    expect(Object.keys(outcome)).toEqual(['kind', 'operationId', 'message'])
    expect(JSON.stringify(outcome)).not.toContain('RAW_MALFORMED_SECRET')
  })

  it('fails closed when inspecting an accessor that throws', () => {
    const malformed = Object.defineProperty({}, 'operationId', {
      enumerable: true,
      get: () => { throw new Error('RAW_MALFORMED_SECRET') },
    })

    expect(mapStudyTaskActionExecutionResult(malformed, OPERATION_ID)).toEqual(FIXED_UNCERTAIN_OUTCOME)
  })

  it('relates the observed outcome to the confirmed candidate operation', () => {
    const confirmed = confirmPlanningCandidateRecord(candidate(), OPERATION_ID)
    const observed = applyPlanningCandidateOutcome(confirmed, {
      operationId: OPERATION_ID,
      status: 'succeeded',
      task,
      replayed: false,
    }, OPERATION_ID)

    expect(observed.decision).toBe('confirmed')
    expect(observed.outcome?.kind).toBe('created')
    expect(observed.outcome?.taskId).toBe(42)
  })

  it('ignores a late outcome from an older attempt without changing the current operation', () => {
    const oldOperationId = OPERATION_ID
    const currentOperationId = '22222222-2222-4222-8222-222222222222'
    const firstAttempt = confirmPlanningCandidateRecord(candidate(), oldOperationId)
    const currentAttempt = confirmPlanningCandidateRecord(firstAttempt, currentOperationId)
    const lateOldOutcome = applyPlanningCandidateOutcome(currentAttempt, {
      operationId: oldOperationId,
      status: 'succeeded',
      task,
      replayed: false,
    }, oldOperationId)

    expect(lateOldOutcome).toBe(currentAttempt)
    expect(lateOldOutcome.operationId).toBe(currentOperationId)
    expect(lateOldOutcome.outcome).toBeNull()

    const malformedCurrentOutcome = applyPlanningCandidateOutcome(currentAttempt, {
      operationId: 'RAW_SECRET_OPERATION_ID',
      status: 'succeeded',
      task: { ...task, id: 'RAW_SECRET_TASK_ID' },
      replayed: false,
    }, currentOperationId)
    expect(malformedCurrentOutcome.operationId).toBe(currentOperationId)
    expect(malformedCurrentOutcome.outcome).toEqual({
      kind: 'uncertain',
      operationId: currentOperationId,
      message: '结果尚无法确认，需要用户手动检查',
    })
    expect(JSON.stringify(malformedCurrentOutcome)).not.toContain('RAW_SECRET')
  })
})

describe('bounded session/reset behavior', () => {
  it('replaces a generation instead of retaining an archive or tombstones', () => {
    const first = createPlanningSessionExplainability({
      generationId: 'today-action-generation-1',
      contextDecisions,
      candidates: [{ clientId: 'suggestion-1', snapshot: baseSnapshot, selected: true }],
    })
    const removed = {
      ...first,
      candidates: [removePlanningCandidateRecord(first.candidates[0]!)],
    }
    const regenerated = createPlanningSessionExplainability({
      generationId: 'today-action-generation-2',
      contextDecisions: [],
      candidates: [],
    })

    expect(first.candidates[0]?.admissionOrigin).toBe('provider_validated')
    expect(removed.candidates[0]?.decision).toBe('removed')
    expect(regenerated.generationId).toBe('today-action-generation-2')
    expect(regenerated.candidates).toEqual([])
    expect(JSON.stringify(regenerated)).not.toContain('today-action-generation-1')
    expect(resetPlanningSessionExplainability()).toBeNull()
  })

  it('does not access storage or retain signatures and raw provider fields', () => {
    const getItem = vi.fn(() => { throw new Error('storage must not be read') })
    const setItem = vi.fn(() => { throw new Error('storage must not be written') })
    vi.stubGlobal('localStorage', { getItem, setItem })

    const session = createPlanningSessionExplainability({
      generationId: 'daily-review-generation-1',
      contextDecisions: [{
        ...contextDecisions[0]!,
        generationContextSignature: '{"secret":"signature"}',
        rawProviderPayload: 'provider-secret',
      } as PlanningContextDecision & Record<string, unknown>],
      candidates: [{
        clientId: 'daily-review-candidate-1',
        snapshot: {
          ...baseSnapshot,
          generationContextSignature: 'signature-secret',
          rawProviderPayload: 'provider-secret',
        } as PlanningCandidateSnapshotInput & Record<string, unknown>,
        selected: true,
      }],
    })

    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify(session)).not.toContain('generationContextSignature')
    expect(JSON.stringify(session)).not.toContain('provider-secret')
    expect(JSON.stringify(session)).not.toContain('signature-secret')
  })

  it('pre-truncates excessively long text before normalization to bound processing cost', () => {
    const longTitle = 'A'.repeat(10_000_000)
    const snapshot = buildPlanningCandidateSnapshot({
      ...baseSnapshot,
      title: longTitle,
      description: longTitle,
    })

    expect(snapshot.title.length).toBeLessThanOrEqual(80)
    expect(snapshot.description.length).toBeLessThanOrEqual(240)
  })

  it('normalizes context decision enum fields to safe defaults for unknown values', () => {
    const session = createPlanningSessionExplainability({
      generationId: 'today-action-generation-1',
      contextDecisions: [{
        ...contextDecisions[0]!,
        preparation: 'INJECTED_UNKNOWN' as never,
        disposition: 'INJECTED_UNKNOWN' as never,
        reasonCode: 'INJECTED_UNKNOWN' as never,
      }],
      candidates: [],
    })

    const decision = session.contextDecisions[0]!
    expect(decision.preparation).toBe('preparation_failed')
    expect(decision.disposition).toBe('excluded')
    expect(decision.reasonCode).toBe('preparation_failed')
    expect(JSON.stringify(session)).not.toContain('INJECTED_UNKNOWN')
  })
})
