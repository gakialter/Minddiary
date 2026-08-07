import { describe, expect, it } from 'vitest'
import type { StudyTask } from '../src/types'
import {
  PLANNING_CANDIDATE_DESCRIPTION_MAX_CHARS,
  PLANNING_CANDIDATE_TITLE_MAX_CHARS,
  PLANNING_SESSION_MAX_CANDIDATES,
  addPlanningSessionCandidate,
  applyPlanningCandidateOutcome,
  confirmPlanningCandidateRecord,
  createPlanningSessionExplainability,
  mapStudyTaskActionExecutionResult,
  qualifyPlanningCandidateId,
  removePlanningCandidateRecord,
  resetPlanningSessionExplainability,
  updatePlanningCandidateRecord,
  updatePlanningSessionCandidate,
  type CandidateAdmissionOrigin,
  type PlanningCandidateRecord,
  type PlanningCandidateSnapshotInput,
  type PlanningContextDecision,
  type PlanningSessionExplainability,
} from '../src/utils/planningSessionExplainability'

function uuidV4(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`
}

const GENERATION_ONE = uuidV4(1)
const GENERATION_TWO = uuidV4(2)
const GENERATION_THREE = uuidV4(3)
const CLIENT_ONE = uuidV4(11)
const CLIENT_TWO = uuidV4(12)
const CLIENT_THREE = uuidV4(13)
const CLIENT_MISSING = uuidV4(14)
const OPERATION_CREATED = uuidV4(101)
const OPERATION_REPLAYED = uuidV4(102)
const OPERATION_FAILED = uuidV4(103)
const OPERATION_UNCERTAIN = uuidV4(104)
const OPERATION_RETRY = uuidV4(105)
const OPERATION_CURRENT = uuidV4(106)

const LOWERCASE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const BASE_SNAPSHOT: PlanningCandidateSnapshotInput = {
  title: '复习函数极限',
  description: '今天到期，适合先处理。',
  type: 'review',
  estimateMinutes: 25,
  priority: 'high',
  subjectId: 1,
  relatedMistakeId: 12,
  relatedEntryId: null,
}

const BASE_CONTEXT: PlanningContextDecision = {
  category: 'due_mistakes',
  label: '今日到期错题',
  preparation: 'prepared',
  disposition: 'partially_included',
  reasonCode: 'limit_applied',
  preparedCount: 15,
  includedCount: 12,
  limit: 12,
}

const BASE_STUDY_TASK: StudyTask = {
  id: 42,
  title: '复习函数极限',
  description: '今天到期，适合先处理。',
  type: 'review',
  subject_id: 1,
  related_mistake_id: 12,
  related_entry_id: null,
  related_chapter_id: null,
  planned_date: '2026-08-02',
  estimate_minutes: 25,
  status: 'todo',
  source: 'ai',
  created_at: '2026-08-02T01:02:03.000Z',
  updated_at: '2026-08-02T01:02:03.000Z',
}

function studyTask(overrides: Partial<StudyTask> = {}): StudyTask {
  return { ...BASE_STUDY_TASK, ...overrides }
}

function snapshot(
  overrides: Partial<PlanningCandidateSnapshotInput> = {},
): PlanningCandidateSnapshotInput {
  return { ...BASE_SNAPSHOT, ...overrides }
}

function succeededResult(
  operationId: string,
  options: { replayed?: boolean; task?: StudyTask } = {},
): unknown {
  return {
    operationId,
    status: 'succeeded',
    task: options.task ?? studyTask(),
    replayed: options.replayed ?? false,
  }
}

interface CandidateSeed {
  clientId: string
  snapshot: PlanningCandidateSnapshotInput
  selected: boolean
}

type MachineState = PlanningSessionExplainability | null

type MachineEvent =
  | {
      type: 'replace'
      generationId: string
      contextDecisions: readonly PlanningContextDecision[]
      candidates: readonly CandidateSeed[]
    }
  | { type: 'reset' }
  | { type: 'add'; generationId: string; candidate: CandidateSeed }
  | {
      type: 'update'
      generationId: string
      clientId: string
      snapshot: PlanningCandidateSnapshotInput
      selected: boolean
    }
  | { type: 'remove'; generationId: string; clientId: string }
  | { type: 'confirm'; generationId: string; clientId: string; operationId: string }
  | {
      type: 'observe'
      generationId: string
      clientId: string
      operationId: string
      result: unknown
    }

/**
 * The product integration owns routing. This reducer models that boundary by
 * applying an observation only to the exact generation, candidate, and attempt.
 */
function transition(state: MachineState, event: MachineEvent): MachineState {
  if (event.type === 'replace') {
    return createPlanningSessionExplainability({
      generationId: event.generationId,
      contextDecisions: event.contextDecisions,
      candidates: event.candidates,
    })
  }
  if (event.type === 'reset') return resetPlanningSessionExplainability()
  if (state === null || state.generationId !== event.generationId) return state

  if (event.type === 'add') return addPlanningSessionCandidate(state, event.candidate)

  const current = state.candidates.find(candidate => candidate.clientId === event.clientId)
  if (current === undefined) return state

  switch (event.type) {
    case 'update':
      return updatePlanningSessionCandidate(state, event.clientId, record => (
        updatePlanningCandidateRecord(record, event.snapshot, event.selected)
      ))
    case 'remove':
      return updatePlanningSessionCandidate(state, event.clientId, removePlanningCandidateRecord)
    case 'confirm':
      return updatePlanningSessionCandidate(state, event.clientId, record => (
        confirmPlanningCandidateRecord(record, event.operationId)
      ))
    case 'observe':
      if (current.operationId !== event.operationId) return state
      return updatePlanningSessionCandidate(state, event.clientId, record => (
        applyPlanningCandidateOutcome(record, event.result, event.operationId)
      ))
  }
}

function sessionOf(state: MachineState): PlanningSessionExplainability {
  expect(state).not.toBeNull()
  return state!
}

function candidateOf(state: MachineState, clientId: string): PlanningCandidateRecord {
  const candidate = sessionOf(state).candidates.find(item => item.clientId === clientId)
  expect(candidate).toBeDefined()
  return candidate!
}

function startWithProviderCandidates(candidates: readonly CandidateSeed[]): PlanningSessionExplainability {
  return sessionOf(transition(null, {
    type: 'replace',
    generationId: GENERATION_ONE,
    contextDecisions: [BASE_CONTEXT],
    candidates,
  }))
}

describe('planning explainability state machine', () => {
  it('runs the normal provider-valid lifecycle through a created observation', () => {
    let state: MachineState = startWithProviderCandidates([{
      clientId: CLIENT_ONE,
      snapshot: BASE_SNAPSHOT,
      selected: true,
    }])
    const admitted = candidateOf(state, CLIENT_ONE)

    expect(admitted.admissionOrigin).toBe('provider_validated')
    expect(admitted.decision).toBe('generated')
    expect(admitted.initial).toEqual(admitted.current)

    state = transition(state, {
      type: 'update',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      snapshot: snapshot({ title: '复习导数错题', estimateMinutes: 35 }),
      selected: true,
    })
    state = transition(state, {
      type: 'confirm',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      operationId: OPERATION_CREATED,
    })
    state = transition(state, {
      type: 'observe',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      operationId: OPERATION_CREATED,
      result: succeededResult(OPERATION_CREATED, {
        task: studyTask({ id: 101, title: '复习导数错题', estimate_minutes: 35 }),
      }),
    })

    const observed = candidateOf(state, CLIENT_ONE)
    expect(observed).toMatchObject({
      admissionOrigin: 'provider_validated',
      decision: 'confirmed',
      selected: false,
      operationId: OPERATION_CREATED,
      changedFields: ['title', 'estimateMinutes'],
      outcome: {
        kind: 'created',
        operationId: OPERATION_CREATED,
        taskId: 101,
      },
    })
    expect(observed.initial).toEqual(admitted.initial)
    expect(observed.current.title).toBe('复习导数错题')
  })

  it('follows edit, unselect, select, restore, and remove transitions deterministically', () => {
    let state: MachineState = startWithProviderCandidates([{
      clientId: CLIENT_ONE,
      snapshot: BASE_SNAPSHOT,
      selected: true,
    }])
    const editedSnapshot = snapshot({ title: '复习导数错题', estimateMinutes: 30 })
    const steps = [
      {
        label: 'edit',
        event: {
          type: 'update',
          generationId: GENERATION_ONE,
          clientId: CLIENT_ONE,
          snapshot: editedSnapshot,
          selected: true,
        },
        decision: 'retained_selected',
        selected: true,
        changedFields: ['title', 'estimateMinutes'],
      },
      {
        label: 'unselect',
        event: {
          type: 'update',
          generationId: GENERATION_ONE,
          clientId: CLIENT_ONE,
          snapshot: editedSnapshot,
          selected: false,
        },
        decision: 'retained_unselected',
        selected: false,
        changedFields: ['title', 'estimateMinutes'],
      },
      {
        label: 'select',
        event: {
          type: 'update',
          generationId: GENERATION_ONE,
          clientId: CLIENT_ONE,
          snapshot: editedSnapshot,
          selected: true,
        },
        decision: 'retained_selected',
        selected: true,
        changedFields: ['title', 'estimateMinutes'],
      },
      {
        label: 'restore',
        event: {
          type: 'update',
          generationId: GENERATION_ONE,
          clientId: CLIENT_ONE,
          snapshot: BASE_SNAPSHOT,
          selected: true,
        },
        decision: 'retained_selected',
        selected: true,
        changedFields: [],
      },
      {
        label: 'remove',
        event: {
          type: 'remove',
          generationId: GENERATION_ONE,
          clientId: CLIENT_ONE,
        },
        decision: 'removed',
        selected: false,
        changedFields: [],
      },
    ] as const

    for (const step of steps) {
      state = transition(state, step.event)
      const current = candidateOf(state, CLIENT_ONE)
      expect(current.decision, step.label).toBe(step.decision)
      expect(current.selected, step.label).toBe(step.selected)
      expect(current.changedFields, step.label).toEqual(step.changedFields)
    }

    const removed = candidateOf(state, CLIENT_ONE)
    state = transition(state, {
      type: 'update',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      snapshot: snapshot({ title: '移除后不应复活' }),
      selected: true,
    })
    expect(candidateOf(state, CLIENT_ONE)).toBe(removed)
  })

  it('runs a repaired-origin lifecycle and treats duplicate admission as idempotent', () => {
    let state: MachineState = sessionOf(transition(null, {
      type: 'replace',
      generationId: GENERATION_ONE,
      contextDecisions: [],
      candidates: [],
    }))
    state = transition(state, {
      type: 'add',
      generationId: GENERATION_ONE,
      candidate: {
        clientId: CLIENT_ONE,
        snapshot: BASE_SNAPSHOT,
        selected: false,
      },
    })
    state = transition(state, {
      type: 'update',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      snapshot: snapshot({ description: '用户修复后的有效说明' }),
      selected: true,
    })
    state = transition(state, {
      type: 'confirm',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      operationId: OPERATION_REPLAYED,
    })
    state = transition(state, {
      type: 'observe',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      operationId: OPERATION_REPLAYED,
      result: succeededResult(OPERATION_REPLAYED, { replayed: true }),
    })

    const beforeDuplicate = sessionOf(state)
    const recordBeforeDuplicate = candidateOf(state, CLIENT_ONE)
    expect(recordBeforeDuplicate).toMatchObject({
      admissionOrigin: 'provider_suggested_user_repaired',
      decision: 'confirmed',
      operationId: OPERATION_REPLAYED,
      outcome: { kind: 'replayed', operationId: OPERATION_REPLAYED, taskId: 42 },
    })

    state = transition(state, {
      type: 'add',
      generationId: GENERATION_ONE,
      candidate: {
        clientId: CLIENT_ONE,
        snapshot: snapshot({
          title: '重复添加不得覆盖初始快照',
          description: '重复添加不得覆盖结果关系',
        }),
        selected: true,
      },
    })

    expect(state).toBe(beforeDuplicate)
    expect(candidateOf(state, CLIENT_ONE)).toBe(recordBeforeDuplicate)
    expect(candidateOf(state, CLIENT_ONE)).toMatchObject({
      initial: admittedInitialSnapshot(),
      admissionOrigin: 'provider_suggested_user_repaired',
      operationId: OPERATION_REPLAYED,
      outcome: { kind: 'replayed', operationId: OPERATION_REPLAYED, taskId: 42 },
    })
  })

  it.each([
    {
      label: 'created',
      operationId: OPERATION_CREATED,
      result: succeededResult(OPERATION_CREATED, { task: studyTask({ id: 201 }) }),
      expected: { kind: 'created', taskId: 201 },
    },
    {
      label: 'replayed',
      operationId: OPERATION_REPLAYED,
      result: succeededResult(OPERATION_REPLAYED, {
        replayed: true,
        task: studyTask({ id: 202 }),
      }),
      expected: { kind: 'replayed', taskId: 202 },
    },
    {
      label: 'failed',
      operationId: OPERATION_FAILED,
      result: {
        operationId: OPERATION_FAILED,
        status: 'failed',
        code: 'INVALID_REQUEST',
        error: 'bounded validation detail',
      },
      expected: { kind: 'validation_error', taskId: undefined },
    },
    {
      label: 'uncertain',
      operationId: OPERATION_UNCERTAIN,
      result: {
        operationId: OPERATION_UNCERTAIN,
        status: 'uncertain',
        error: 'bounded transport detail',
      },
      expected: { kind: 'uncertain', taskId: undefined },
    },
  ])('records a confirmed $label outcome without exposing execution details', ({
    operationId,
    result,
    expected,
  }) => {
    const source = candidateOf(startWithProviderCandidates([{
      clientId: CLIENT_ONE,
      snapshot: BASE_SNAPSHOT,
      selected: true,
    }]), CLIENT_ONE)
    const confirmed = confirmPlanningCandidateRecord(source, operationId)
    const observed = applyPlanningCandidateOutcome(confirmed, result, operationId)

    expect(observed.decision).toBe('confirmed')
    expect(observed.selected).toBe(false)
    expect(observed.operationId).toBe(operationId)
    expect(observed.outcome?.kind).toBe(expected.kind)
    expect(observed.outcome?.taskId).toBe(expected.taskId)
    expect(observed.initial).toBe(source.initial)
    expect(JSON.stringify(observed.outcome)).not.toContain('bounded validation detail')
    expect(JSON.stringify(observed.outcome)).not.toContain('bounded transport detail')
  })

  it('models a mixed partial batch, a new retry operation, and same-operation recovery', () => {
    let state: MachineState = startWithProviderCandidates([
      { clientId: CLIENT_ONE, snapshot: snapshot({ title: '候选一' }), selected: true },
      { clientId: CLIENT_TWO, snapshot: snapshot({ title: '候选二' }), selected: true },
      { clientId: CLIENT_THREE, snapshot: snapshot({ title: '候选三' }), selected: true },
    ])
    const attempts = [
      { clientId: CLIENT_ONE, operationId: OPERATION_CREATED },
      { clientId: CLIENT_TWO, operationId: OPERATION_FAILED },
      { clientId: CLIENT_THREE, operationId: OPERATION_UNCERTAIN },
    ] as const
    for (const attempt of attempts) {
      state = transition(state, {
        type: 'confirm',
        generationId: GENERATION_ONE,
        ...attempt,
      })
    }

    const observations = [
      {
        clientId: CLIENT_ONE,
        operationId: OPERATION_CREATED,
        result: succeededResult(OPERATION_CREATED, { task: studyTask({ id: 301, title: '候选一' }) }),
      },
      {
        clientId: CLIENT_TWO,
        operationId: OPERATION_FAILED,
        result: {
          operationId: OPERATION_FAILED,
          status: 'failed',
          code: 'INVALID_REQUEST',
          error: 'retryable validation detail',
        },
      },
      {
        clientId: CLIENT_THREE,
        operationId: OPERATION_UNCERTAIN,
        result: {
          operationId: OPERATION_UNCERTAIN,
          status: 'uncertain',
          error: 'request completion was not observable',
        },
      },
    ] as const
    for (const observation of observations) {
      state = transition(state, {
        type: 'observe',
        generationId: GENERATION_ONE,
        ...observation,
      })
    }

    expect(attempts.map(attempt => candidateOf(state, attempt.clientId).outcome?.kind)).toEqual([
      'created',
      'validation_error',
      'uncertain',
    ])

    const failedAttempt = candidateOf(state, CLIENT_TWO)
    const retryAttempt = confirmPlanningCandidateRecord(failedAttempt, OPERATION_RETRY)
    const completedRetry = applyPlanningCandidateOutcome(
      retryAttempt,
      succeededResult(OPERATION_RETRY, { task: studyTask({ id: 302, title: '候选二' }) }),
      OPERATION_RETRY,
    )

    expect(failedAttempt.operationId).toBe(OPERATION_FAILED)
    expect(failedAttempt.outcome?.kind).toBe('validation_error')
    expect(candidateOf(state, CLIENT_TWO)).toBe(failedAttempt)
    expect(retryAttempt.operationId).toBe(OPERATION_RETRY)
    expect(retryAttempt.outcome).toBeNull()
    expect(completedRetry.operationId).toBe(OPERATION_RETRY)
    expect(completedRetry.outcome).toMatchObject({ kind: 'created', taskId: 302 })

    const uncertainAttempt = candidateOf(state, CLIENT_THREE)
    const recoveredObservation = applyPlanningCandidateOutcome(
      uncertainAttempt,
      succeededResult(OPERATION_UNCERTAIN, {
        replayed: true,
        task: studyTask({ id: 303, title: '候选三' }),
      }),
      OPERATION_UNCERTAIN,
    )

    expect(uncertainAttempt.operationId).toBe(OPERATION_UNCERTAIN)
    expect(uncertainAttempt.outcome?.kind).toBe('uncertain')
    expect(recoveredObservation.operationId).toBe(OPERATION_UNCERTAIN)
    expect(recoveredObservation.outcome).toMatchObject({ kind: 'replayed', taskId: 303 })
  })

  it.each([
    { label: 'regeneration', resetFirst: false, generationId: GENERATION_TWO },
    { label: 'date rollover', resetFirst: true, generationId: GENERATION_THREE },
  ])('$label replaces the bounded session instead of retaining history', ({
    resetFirst,
    generationId,
  }) => {
    let state: MachineState = startWithProviderCandidates([{
      clientId: CLIENT_ONE,
      snapshot: BASE_SNAPSHOT,
      selected: true,
    }])
    state = transition(state, {
      type: 'confirm',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      operationId: OPERATION_CREATED,
    })
    state = transition(state, {
      type: 'observe',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      operationId: OPERATION_CREATED,
      result: succeededResult(OPERATION_CREATED),
    })

    if (resetFirst) {
      state = transition(state, { type: 'reset' })
      expect(state).toBeNull()
    }
    state = transition(state, {
      type: 'replace',
      generationId,
      contextDecisions: [],
      candidates: [{
        clientId: CLIENT_TWO,
        snapshot: snapshot({ title: '新日期或新一轮候选' }),
        selected: false,
      }],
    })

    const replacement = sessionOf(state)
    expect(replacement.generationId).toBe(generationId)
    expect(replacement.candidates).toHaveLength(1)
    expect(replacement.candidates[0]).toMatchObject({
      clientId: CLIENT_TWO,
      decision: 'generated',
      operationId: null,
      outcome: null,
    })
    expect(JSON.stringify(replacement)).not.toContain(GENERATION_ONE)
    expect(JSON.stringify(replacement)).not.toContain(OPERATION_CREATED)
    expect(replacement).not.toHaveProperty('history')
  })

  it('ignores late observations from an old generation or operation and fails closed on mismatch', () => {
    let oldState: MachineState = startWithProviderCandidates([{
      clientId: CLIENT_ONE,
      snapshot: BASE_SNAPSHOT,
      selected: true,
    }])
    oldState = transition(oldState, {
      type: 'confirm',
      generationId: GENERATION_ONE,
      clientId: CLIENT_ONE,
      operationId: OPERATION_CREATED,
    })
    const lateResult = succeededResult(OPERATION_CREATED, {
      task: studyTask({ id: 401, title: '旧一轮迟到结果' }),
    })

    let state: MachineState = transition(oldState, {
      type: 'replace',
      generationId: GENERATION_TWO,
      contextDecisions: [],
      candidates: [{ clientId: CLIENT_ONE, snapshot: snapshot({ title: '当前候选' }), selected: true }],
    })
    state = transition(state, {
      type: 'confirm',
      generationId: GENERATION_TWO,
      clientId: CLIENT_ONE,
      operationId: OPERATION_CURRENT,
    })

    const mismatches = [
      {
        label: 'old generation and operation',
        generationId: GENERATION_ONE,
        clientId: CLIENT_ONE,
        operationId: OPERATION_CREATED,
      },
      {
        label: 'old operation in current generation',
        generationId: GENERATION_TWO,
        clientId: CLIENT_ONE,
        operationId: OPERATION_CREATED,
      },
      {
        label: 'unknown client in current generation',
        generationId: GENERATION_TWO,
        clientId: CLIENT_MISSING,
        operationId: OPERATION_CURRENT,
      },
    ] as const

    for (const mismatch of mismatches) {
      const before = state
      state = transition(state, { type: 'observe', result: lateResult, ...mismatch })
      expect(state, mismatch.label).toBe(before)
    }

    const mappedMismatch = mapStudyTaskActionExecutionResult(lateResult, OPERATION_CURRENT)
    expect(mappedMismatch).toEqual({
      kind: 'uncertain',
      operationId: OPERATION_CURRENT,
      message: '结果尚无法确认，需要用户手动检查',
    })
    const currentRecord = candidateOf(state, CLIENT_ONE)
    const ignoredOldAttempt = applyPlanningCandidateOutcome(
      currentRecord,
      lateResult,
      OPERATION_CREATED,
    )
    expect(ignoredOldAttempt).toBe(currentRecord)

    const derivedButNotRouted = applyPlanningCandidateOutcome(
      currentRecord,
      lateResult,
      OPERATION_CURRENT,
    )
    expect(derivedButNotRouted.operationId).toBe(OPERATION_CURRENT)
    expect(derivedButNotRouted.outcome).toEqual(mappedMismatch)
    expect(candidateOf(state, CLIENT_ONE).outcome).toBeNull()
  })

  it('qualifies the same client uniquely across generations using lowercase UUID v4 inputs', () => {
    const first = createPlanningSessionExplainability({
      generationId: GENERATION_ONE,
      contextDecisions: [],
      candidates: [{ clientId: CLIENT_ONE, snapshot: BASE_SNAPSHOT, selected: true }],
    })
    const second = createPlanningSessionExplainability({
      generationId: GENERATION_TWO,
      contextDecisions: [],
      candidates: [{ clientId: CLIENT_ONE, snapshot: BASE_SNAPSHOT, selected: true }],
    })
    const ids = [
      GENERATION_ONE,
      GENERATION_TWO,
      CLIENT_ONE,
      CLIENT_TWO,
      CLIENT_THREE,
      OPERATION_CREATED,
      OPERATION_REPLAYED,
      OPERATION_FAILED,
      OPERATION_UNCERTAIN,
      OPERATION_RETRY,
      OPERATION_CURRENT,
    ]

    expect(ids.every(id => LOWERCASE_UUID_V4.test(id))).toBe(true)
    expect(first.candidates[0]?.candidateId).toBe(qualifyPlanningCandidateId(GENERATION_ONE, CLIENT_ONE))
    expect(second.candidates[0]?.candidateId).toBe(qualifyPlanningCandidateId(GENERATION_TWO, CLIENT_ONE))
    expect(first.candidates[0]?.candidateId).not.toBe(second.candidates[0]?.candidateId)
  })

  it('bounds candidate and context snapshots and retains no signatures, raw payloads, or history', () => {
    const secret = 'raw-secret-that-must-not-survive'
    const contexts: Array<PlanningContextDecision & Record<string, unknown>> = Array.from(
      { length: 15 },
      (_, index) => ({
        category: `category-${index}-${'c'.repeat(60)}`,
        label: `上下文-${index}-${'标'.repeat(60)}`,
        preparation: 'prepared',
        disposition: 'partially_included',
        reasonCode: 'limit_applied',
        preparedCount: index + 1,
        includedCount: 99,
        limit: 12,
        generationContextSignature: `${secret}-signature-${index}`,
        rawProviderPayload: `${secret}-provider-${index}`,
        history: [{ secret }],
      }),
    )
    const candidates: CandidateSeed[] = Array.from(
      { length: PLANNING_SESSION_MAX_CANDIDATES + 2 },
      (_, index) => ({
        clientId: uuidV4(500 + index),
        snapshot: {
          ...BASE_SNAPSHOT,
          title: '题'.repeat(PLANNING_CANDIDATE_TITLE_MAX_CHARS + 30),
          description: '说'.repeat(PLANNING_CANDIDATE_DESCRIPTION_MAX_CHARS + 30),
          type: 'type-token'.repeat(10),
          estimateMinutes: 99_999,
          priority: 'priority-token'.repeat(10),
          generationContextSignature: `${secret}-candidate-signature-${index}`,
          rawProviderPayload: `${secret}-candidate-provider-${index}`,
          history: [{ secret }],
        } as PlanningCandidateSnapshotInput & Record<string, unknown>,
        selected: true,
      }),
    )

    const state = createPlanningSessionExplainability({
      generationId: GENERATION_ONE,
      contextDecisions: contexts,
      candidates,
    })

    expect(state.contextDecisions).toHaveLength(12)
    expect(state.candidates).toHaveLength(PLANNING_SESSION_MAX_CANDIDATES)
    expect(new Set(state.candidates.map(candidate => candidate.candidateId)).size).toBe(
      PLANNING_SESSION_MAX_CANDIDATES,
    )
    for (const context of state.contextDecisions) {
      expect(context.category.length).toBeLessThanOrEqual(48)
      expect(context.label.length).toBeLessThanOrEqual(48)
      expect(context.includedCount).toBeLessThanOrEqual(context.preparedCount)
    }
    for (const candidate of state.candidates) {
      expect(candidate.initial).toBe(candidate.current)
      expect(candidate.current.title).toHaveLength(PLANNING_CANDIDATE_TITLE_MAX_CHARS)
      expect(candidate.current.description).toHaveLength(PLANNING_CANDIDATE_DESCRIPTION_MAX_CHARS)
      expect(candidate.current.type).toHaveLength(32)
      expect(candidate.current.priority).toHaveLength(32)
      expect(candidate.current.estimateMinutes).toBe(10_000)
    }

    contexts[0]!.label = '输入在创建后被修改'
    candidates[0]!.snapshot.title = '输入在创建后被修改'
    expect(state.contextDecisions[0]?.label).not.toBe('输入在创建后被修改')
    expect(state.candidates[0]?.initial.title).not.toBe('输入在创建后被修改')

    const serialized = JSON.stringify(state)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('generationContextSignature')
    expect(serialized).not.toContain('rawProviderPayload')
    expect(serialized).not.toContain('history')
    expect(state).not.toHaveProperty('history')

    const afterOverCapacityAdd = addPlanningSessionCandidate(state, {
      clientId: uuidV4(999),
      snapshot: BASE_SNAPSHOT,
      selected: true,
    })
    expect(afterOverCapacityAdd).toBe(state)
  })

  it.each([
    {
      label: 'provider-valid',
      expectedOrigin: 'provider_validated' as const,
      operationId: OPERATION_CREATED,
      create: () => candidateOf(startWithProviderCandidates([{
        clientId: CLIENT_ONE,
        snapshot: BASE_SNAPSHOT,
        selected: true,
      }]), CLIENT_ONE),
    },
    {
      label: 'user-repaired',
      expectedOrigin: 'provider_suggested_user_repaired' as const,
      operationId: OPERATION_REPLAYED,
      create: () => {
        const empty = createPlanningSessionExplainability({
          generationId: GENERATION_ONE,
          contextDecisions: [],
          candidates: [],
        })
        return addPlanningSessionCandidate(empty, {
          clientId: CLIENT_ONE,
          snapshot: BASE_SNAPSHOT,
          selected: true,
        }).candidates[0]!
      },
    },
  ])('keeps $label initial and origin immutable while bounding current state', ({
    expectedOrigin,
    operationId,
    create,
  }: {
    expectedOrigin: CandidateAdmissionOrigin
    operationId: string
    create: () => PlanningCandidateRecord
  }) => {
    const source = create()
    const initialReference = source.initial
    const initialValue = { ...source.initial }
    const edited = updatePlanningCandidateRecord(source, {
      ...BASE_SNAPSHOT,
      title: '题'.repeat(200),
      description: '说'.repeat(400),
      type: 'type-token'.repeat(10),
      estimateMinutes: 99_999,
      priority: 'priority-token'.repeat(10),
      subjectId: -1,
      relatedMistakeId: Number.MAX_SAFE_INTEGER + 1,
      relatedEntryId: 9,
    }, true)
    const removed = removePlanningCandidateRecord(edited)
    const confirmed = confirmPlanningCandidateRecord(edited, operationId)
    const observed = applyPlanningCandidateOutcome(
      confirmed,
      succeededResult(operationId, { task: studyTask({ id: 501 }) }),
      operationId,
    )

    expect(edited.initial).toBe(initialReference)
    expect(edited.initial).toEqual(initialValue)
    expect(source.initial).toEqual(initialValue)
    expect(edited.current.title).toHaveLength(PLANNING_CANDIDATE_TITLE_MAX_CHARS)
    expect(edited.current.description).toHaveLength(PLANNING_CANDIDATE_DESCRIPTION_MAX_CHARS)
    expect(edited.current.type).toHaveLength(32)
    expect(edited.current.priority).toHaveLength(32)
    expect(edited.current.estimateMinutes).toBe(10_000)
    expect(edited.current.subjectId).toBeNull()
    expect(edited.current.relatedMistakeId).toBeNull()
    expect(edited.current.relatedEntryId).toBe(9)
    for (const record of [source, edited, removed, confirmed, observed]) {
      expect(record.admissionOrigin).toBe(expectedOrigin)
      expect(record.initial).toBe(initialReference)
      expect(record.initial).toEqual(initialValue)
    }
  })
})

function admittedInitialSnapshot() {
  return {
    title: '复习函数极限',
    description: '今天到期,适合先处理。',
    type: 'review',
    estimateMinutes: 25,
    priority: 'high',
    subjectId: 1,
    relatedMistakeId: 12,
    relatedEntryId: null,
  }
}
