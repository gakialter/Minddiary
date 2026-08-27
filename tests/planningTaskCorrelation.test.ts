// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import {
  executePrivilegedTodayActionV2CommandWithPlanningAudit,
  executeStudyTaskCommandWithPlanningAudit,
  reconcileCommittedStudyTaskStatusWithPlanningAudit,
} from '../electron/planningTaskCorrelation'
import type { CandidateIdentityClassification } from '../electron/planningHistory'
import type {
  IdempotentAIStudyTaskCreateRequest,
  IdempotentAIStudyTaskCreateResponse,
  PrivilegedTodayActionV2CreateCommand,
  TodayActionCommittedStatus,
} from '../src/types/api'

const REQUEST: IdempotentAIStudyTaskCreateRequest = {
  operationId: '11111111-1111-4111-8111-111111111111',
  operationKind: 'today_action',
  actionContractVersion: 'confirmed-study-task-action.v1',
  expectedCurrentDate: '2026-08-13',
  payload: {
    title: '复习函数极限',
    description: '今天到期。',
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
}

const CREATED: IdempotentAIStudyTaskCreateResponse = {
  ok: true,
  operationId: REQUEST.operationId,
  task: {
    id: 42,
    title: '复习函数极限',
    description: '今天到期。',
    type: 'review',
    subject_id: 1,
    related_mistake_id: 12,
    related_entry_id: null,
    related_chapter_id: null,
    planned_date: '2026-08-13',
    estimate_minutes: 25,
    status: 'todo',
    source: 'ai',
    created_at: '2026-08-13T12:00:00.000Z',
    updated_at: '2026-08-13T12:00:00.000Z',
  },
  replayed: false,
}

const OPAQUE_TODAY_REQUEST: IdempotentAIStudyTaskCreateRequest = {
  ...REQUEST,
  actionContractVersion: 'confirmed-study-task-action.v2',
  contextProjectionVersion: 'today-action.context-projection.v2',
  originalGenerationContextSignature: '1'.repeat(64),
  generationChapterSignature: '2'.repeat(64),
  latestReviewedChapterSignature: '2'.repeat(64),
  staleContextOverride: false,
  staleReviewToken: null,
}

const OPAQUE_TODAY_COMMAND: PrivilegedTodayActionV2CreateCommand = {
  planningCandidateId: 9,
  request: OPAQUE_TODAY_REQUEST as PrivilegedTodayActionV2CreateCommand['request'],
}

const CONFLICT: IdempotentAIStudyTaskCreateResponse = {
  ok: false,
  operationId: REQUEST.operationId,
  code: 'IDEMPOTENCY_CONFLICT',
  message: 'bounded',
}

const runInTransaction = <T,>(operation: () => T): T => operation()

const AUDIT_INTEGRITY_FAILURE: IdempotentAIStudyTaskCreateResponse = {
  ok: false,
  operationId: REQUEST.operationId,
  code: 'INTEGRITY_ERROR',
  message: 'The study task could not be created safely.',
}

describe('existing task command planning-audit correlation', () => {
  it('keeps the task command authoritative when audit claim fails', () => {
    const execute = vi.fn(() => CREATED)
    const recordOutcome = vi.fn()

    const result = executeStudyTaskCommandWithPlanningAudit(REQUEST, 9, {
      claim: vi.fn(() => { throw new Error('audit unavailable') }),
      execute,
      recordOutcome,
      warn: vi.fn(),
      runInTransaction,
    })

    expect(result).toBe(CREATED)
    expect(execute).toHaveBeenCalledOnce()
    expect(recordOutcome).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...CREATED, replayed: false }, 'created'],
    [{ ...CREATED, replayed: true }, 'replayed'],
    [CONFLICT, 'conflict'],
    [{ ok: false, operationId: REQUEST.operationId, code: 'RESULT_DELETED', message: 'bounded' }, 'deleted'],
    [{ ok: false, operationId: REQUEST.operationId, code: 'INTEGRITY_ERROR', message: 'bounded' }, 'integrity_error'],
    [{ ok: false, operationId: REQUEST.operationId, code: 'DATE_MISMATCH', message: 'bounded' }, 'date_mismatch'],
    [{ ok: false, operationId: REQUEST.operationId, code: 'INVALID_REQUEST', message: 'bounded' }, 'validation_error'],
  ] as const)('derives trusted %s outcome without changing the task response', (response, outcome) => {
    const recordOutcome = vi.fn(() => ({ recorded: true }))

    const result = executeStudyTaskCommandWithPlanningAudit(REQUEST, 9, {
      claim: vi.fn(() => ({ claimed: true as const })),
      execute: vi.fn(() => response as IdempotentAIStudyTaskCreateResponse),
      recordOutcome,
      warn: vi.fn(),
      runInTransaction,
    })

    expect(result).toBe(response)
    expect(recordOutcome).toHaveBeenCalledWith(9, REQUEST.operationId, outcome)
  })

  it('returns task success even when outcome audit persistence fails and never replays the command', () => {
    const execute = vi.fn(() => CREATED)

    const result = executeStudyTaskCommandWithPlanningAudit(REQUEST, 9, {
      claim: vi.fn(() => ({ claimed: true as const })),
      execute,
      recordOutcome: vi.fn(() => { throw new Error('audit write failed') }),
      warn: vi.fn(),
      runInTransaction,
    })

    expect(result).toBe(CREATED)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('does not touch Planning History when no audit reference is supplied', () => {
    const claim = vi.fn()
    const recordOutcome = vi.fn()

    expect(executeStudyTaskCommandWithPlanningAudit(REQUEST, undefined, {
      claim,
      execute: vi.fn(() => CREATED),
      recordOutcome,
      warn: vi.fn(),
      runInTransaction,
    })).toBe(CREATED)

    expect(claim).not.toHaveBeenCalled()
    expect(recordOutcome).not.toHaveBeenCalled()
  })
})

describe('Today v2 receipt-first planning-audit orchestration', () => {
  const digest = 'a'.repeat(64)

  const dependencies = (
    overrides: Partial<Parameters<
      typeof executePrivilegedTodayActionV2CommandWithPlanningAudit
    >[2]> = {},
  ): Parameters<typeof executePrivilegedTodayActionV2CommandWithPlanningAudit>[2] => ({
    preflightReceipt: vi.fn(() => null),
    classifyCandidate: vi.fn(() => ({ kind: 'EXACT_UNCONFIRMED' as const })),
    claim: vi.fn(() => ({ claimed: true as const })),
    execute: vi.fn(() => CREATED),
    recordOutcome: vi.fn(() => ({ recorded: true })),
    warn: vi.fn(),
    runInTransaction: vi.fn(runInTransaction) as unknown as Parameters<
      typeof executePrivilegedTodayActionV2CommandWithPlanningAudit
    >[2]['runInTransaction'],
    ...overrides,
  })

  it('resolves a matching receipt before claim and skips date/freshness execution', () => {
    const events: string[] = []
    const replayed = { ...CREATED, replayed: true }
    const deps = dependencies({
      preflightReceipt: vi.fn(() => {
        events.push('receipt')
        return replayed
      }),
      classifyCandidate: vi.fn(() => {
        events.push('classification')
        return { kind: 'EXACT_UNCONFIRMED' as const }
      }),
    })

    expect(executePrivilegedTodayActionV2CommandWithPlanningAudit(
      OPAQUE_TODAY_COMMAND,
      digest,
      deps,
    )).toBe(replayed)
    expect(events).toEqual(['receipt', 'classification'])
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.execute).not.toHaveBeenCalled()
    expect(deps.recordOutcome).not.toHaveBeenCalled()
  })

  it('claims only after receipt absence and commits task/receipt/outcome in Phase 2', () => {
    const events: string[] = []
    const deps = dependencies({
      preflightReceipt: vi.fn(() => { events.push('receipt'); return null }),
      classifyCandidate: vi.fn(() => { events.push('classification'); return { kind: 'EXACT_UNCONFIRMED' as const } }),
      claim: vi.fn(() => { events.push('claim'); return { claimed: true as const } }),
      execute: vi.fn(() => { events.push('execute'); return CREATED }),
      recordOutcome: vi.fn(() => { events.push('outcome'); return { recorded: true } }),
      runInTransaction: operation => { events.push('phase2'); return operation() },
    })

    expect(executePrivilegedTodayActionV2CommandWithPlanningAudit(
      OPAQUE_TODAY_COMMAND,
      digest,
      deps,
    )).toBe(CREATED)
    expect(events).toEqual([
      'receipt',
      'classification',
      'claim',
      'phase2',
      'execute',
      'outcome',
    ])
  })

  it('leaves claim-only uncertain and executes no task when Phase 1 claim fails', () => {
    const deps = dependencies({
      claim: vi.fn(() => { throw new Error('claim commit unavailable') }),
    })
    expect(() => executePrivilegedTodayActionV2CommandWithPlanningAudit(
      OPAQUE_TODAY_COMMAND,
      digest,
      deps,
    )).toThrow('claim commit unavailable')
    expect(deps.execute).not.toHaveBeenCalled()
    expect(deps.recordOutcome).not.toHaveBeenCalled()
  })

  it.each([
    'created',
    'replayed',
    'conflict',
    'deleted',
    'validation_error',
    'date_mismatch',
    'integrity_error',
  ] as const)('never re-enters Phase 1 or Phase 2 for definitive same-O1 outcome %s', outcomeKind => {
    const deps = dependencies({
      classifyCandidate: vi.fn(() => ({
        kind: 'EXACT_CONFIRMED_MATCH' as const,
        outcomeKind,
      })),
    })
    const result = executePrivilegedTodayActionV2CommandWithPlanningAudit(
      OPAQUE_TODAY_COMMAND,
      digest,
      deps,
    )
    expect(result).toMatchObject({ ok: false })
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.execute).not.toHaveBeenCalled()
    expect(deps.runInTransaction).not.toHaveBeenCalled()
  })

  it.each([null, 'uncertain'] as const)(
    'keeps an already accepted receipt-less operation status-first for %s',
    outcomeKind => {
      const deps = dependencies({
        classifyCandidate: vi.fn(() => ({
          kind: 'EXACT_CONFIRMED_MATCH' as const,
          outcomeKind,
        })),
      })
      const changedCommitmentCommand = {
        ...OPAQUE_TODAY_COMMAND,
        request: {
          ...OPAQUE_TODAY_COMMAND.request,
          generationChapterSignature: '9'.repeat(64),
          latestReviewedChapterSignature: '9'.repeat(64),
        },
      }
      expect(() => executePrivilegedTodayActionV2CommandWithPlanningAudit(
        changedCommitmentCommand,
        digest,
        deps,
      )).toThrow('status-first recovery')
      expect(deps.claim).not.toHaveBeenCalled()
      expect(deps.execute).not.toHaveBeenCalled()
      expect(deps.recordOutcome).not.toHaveBeenCalled()
      expect(deps.runInTransaction).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['ABSENT_NO_COMPETING_OPERATION', { ...CREATED, replayed: true }],
    ['EXACT_UNCONFIRMED', { ...CREATED, replayed: true }],
  ] as const)('allows historical digest-matched replay for %s with zero audit mutation', (kind, replayed) => {
    const deps = dependencies({
      preflightReceipt: vi.fn(() => replayed),
      classifyCandidate: vi.fn(() => ({ kind } as CandidateIdentityClassification)),
    })
    expect(executePrivilegedTodayActionV2CommandWithPlanningAudit(
      OPAQUE_TODAY_COMMAND,
      digest,
      deps,
    )).toBe(replayed)
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.recordOutcome).not.toHaveBeenCalled()
  })

  it('returns historical digest conflict without claiming or repairing audit', () => {
    const deps = dependencies({
      preflightReceipt: vi.fn(() => CONFLICT),
      classifyCandidate: vi.fn(() => ({ kind: 'ABSENT_NO_COMPETING_OPERATION' as const })),
    })
    expect(executePrivilegedTodayActionV2CommandWithPlanningAudit(
      OPAQUE_TODAY_COMMAND,
      digest,
      deps,
    )).toBe(CONFLICT)
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.recordOutcome).not.toHaveBeenCalled()
  })

  it.each(['EXACT_MISMATCH', 'EXACT_CORRUPT', 'ABSENT_COMPETING_OPERATION'] as const)(
    'rejects unsafe receipt identity %s without audit mutation',
    kind => {
      const deps = dependencies({
        preflightReceipt: vi.fn(() => ({ ...CREATED, replayed: true })),
        classifyCandidate: vi.fn(() => ({ kind })),
      })
      expect(executePrivilegedTodayActionV2CommandWithPlanningAudit(
        OPAQUE_TODAY_COMMAND,
        digest,
        deps,
      )).toEqual(AUDIT_INTEGRITY_FAILURE)
      expect(deps.claim).not.toHaveBeenCalled()
      expect(deps.recordOutcome).not.toHaveBeenCalled()
    },
  )

  it('durably reconciles privileged full-request digest conflict only after commit acknowledgement', () => {
    const events: string[] = []
    const deps = dependencies({
      preflightReceipt: vi.fn(() => CONFLICT),
      classifyCandidate: vi.fn(() => ({
        kind: 'EXACT_CONFIRMED_MATCH' as const,
        outcomeKind: null,
      })),
      recordOutcome: vi.fn(() => { events.push('outcome'); return { recorded: true } }),
      runInTransaction: operation => {
        events.push('transaction')
        const response = operation()
        events.push('commit')
        return response
      },
    })
    expect(executePrivilegedTodayActionV2CommandWithPlanningAudit(
      OPAQUE_TODAY_COMMAND,
      digest,
      deps,
    )).toBe(CONFLICT)
    expect(events).toEqual(['transaction', 'outcome', 'commit'])
    expect(deps.recordOutcome).toHaveBeenCalledWith(9, OPAQUE_TODAY_REQUEST.operationId, 'conflict')
  })

  it('rejects operational commit uncertainty and retains the marker contract', () => {
    const deps = dependencies({
      runInTransaction: operation => {
        operation()
        throw new Error('outer commit acknowledgement unknown')
      },
    })
    expect(() => executePrivilegedTodayActionV2CommandWithPlanningAudit(
      OPAQUE_TODAY_COMMAND,
      digest,
      deps,
    )).toThrow('outer commit acknowledgement unknown')
    expect(deps.claim).toHaveBeenCalledOnce()
    expect(deps.execute).toHaveBeenCalledOnce()
  })
})

describe('committed-status planning-audit reconciliation', () => {
  const operationId = REQUEST.operationId

  const dependencies = () => ({
    planningCandidateId: 9,
    recordOutcome: vi.fn(() => ({ recorded: true })),
    warn: vi.fn(),
    runInTransaction,
  })

  it('maps claim-only to NOT_COMMITTED without writing validation_error', () => {
    for (const outcomeKind of [null, 'uncertain'] as const) {
      const status = { status: 'NOT_COMMITTED' as const, operationId }
      const deps = dependencies()
      expect(reconcileCommittedStudyTaskStatusWithPlanningAudit(status, {
        kind: 'EXACT_CONFIRMED_MATCH',
        outcomeKind,
      }, deps)).toBe(status)
      expect(deps.recordOutcome).not.toHaveBeenCalled()
    }
  })

  it('does not let a local digest mismatch create durable conflict', () => {
    const status = { status: 'IDEMPOTENCY_CONFLICT' as const, operationId }
    const deps = dependencies()
    expect(reconcileCommittedStudyTaskStatusWithPlanningAudit(status, {
      kind: 'EXACT_CONFIRMED_MATCH',
      outcomeKind: null,
    }, deps)).toEqual({ status: 'INTEGRITY_ERROR', operationId })
    expect(deps.recordOutcome).not.toHaveBeenCalled()
  })

  it('preserves an already durable conflict for the same local digest mismatch', () => {
    const status = { status: 'IDEMPOTENCY_CONFLICT' as const, operationId }
    const deps = dependencies()
    expect(reconcileCommittedStudyTaskStatusWithPlanningAudit(status, {
      kind: 'EXACT_CONFIRMED_MATCH',
      outcomeKind: 'conflict',
    }, deps)).toBe(status)
    expect(deps.recordOutcome).not.toHaveBeenCalled()
  })

  it.each([
    [{ status: 'RECOVERED_COMMITTED', operationId, task: CREATED.task }, 'replayed'],
    [{ status: 'RESULT_DELETED', operationId }, 'deleted'],
    [{ status: 'INTEGRITY_ERROR', operationId }, 'integrity_error'],
  ] as const)('reconciles only Main-authenticated durable proof %s', (status, outcomeKind) => {
    const deps = dependencies()
    expect(reconcileCommittedStudyTaskStatusWithPlanningAudit(
      status as TodayActionCommittedStatus,
      { kind: 'EXACT_CONFIRMED_MATCH', outcomeKind: null },
      deps,
    )).toBe(status)
    expect(deps.recordOutcome).toHaveBeenCalledWith(9, operationId, outcomeKind)
  })

  it.each([
    ['EXACT_UNCONFIRMED', { status: 'RECOVERED_COMMITTED', operationId, task: CREATED.task }],
    ['EXACT_MISMATCH', { status: 'NOT_COMMITTED', operationId }],
    ['EXACT_CORRUPT', { status: 'NOT_COMMITTED', operationId }],
    ['ABSENT_COMPETING_OPERATION', { status: 'NOT_COMMITTED', operationId }],
  ] as const)('fails closed for candidate gate %s', (kind, status) => {
    const deps = dependencies()
    expect(reconcileCommittedStudyTaskStatusWithPlanningAudit(
      status as TodayActionCommittedStatus,
      { kind } as CandidateIdentityClassification,
      deps,
    )).toEqual({ status: 'INTEGRITY_ERROR', operationId })
    expect(deps.recordOutcome).not.toHaveBeenCalled()
  })

  it('allows current-marker digest fallback only when the candidate is absent without a competitor', () => {
    const status = { status: 'RECOVERED_COMMITTED' as const, operationId, task: CREATED.task }
    const deps = dependencies()
    expect(reconcileCommittedStudyTaskStatusWithPlanningAudit(status, {
      kind: 'ABSENT_NO_COMPETING_OPERATION',
    }, deps)).toBe(status)
    expect(deps.recordOutcome).not.toHaveBeenCalled()
  })

  it('keeps legacy status negative-only', () => {
    const deps = dependencies()
    expect(reconcileCommittedStudyTaskStatusWithPlanningAudit({
      status: 'RECOVERED_COMMITTED',
      operationId,
      task: CREATED.task,
    }, null, deps)).toEqual({ status: 'INTEGRITY_ERROR', operationId })
    expect(reconcileCommittedStudyTaskStatusWithPlanningAudit({
      status: 'RESULT_DELETED',
      operationId,
    }, null, deps)).toEqual({ status: 'INTEGRITY_ERROR', operationId })
    const notCommitted = { status: 'NOT_COMMITTED' as const, operationId }
    expect(reconcileCommittedStudyTaskStatusWithPlanningAudit(notCommitted, null, deps))
      .toBe(notCommitted)
    expect(deps.recordOutcome).not.toHaveBeenCalled()
  })

  it('throws READ_FAILURE and reconciliation commit failure as operational uncertainty', () => {
    const readError = new Error('candidate read unavailable')
    expect(() => reconcileCommittedStudyTaskStatusWithPlanningAudit({
      status: 'NOT_COMMITTED',
      operationId,
    }, { kind: 'READ_FAILURE', error: readError }, dependencies())).toThrow(readError)

    const deps = dependencies()
    deps.runInTransaction = operation => {
      operation()
      throw new Error('reconciliation commit unknown')
    }
    expect(() => reconcileCommittedStudyTaskStatusWithPlanningAudit({
      status: 'RESULT_DELETED',
      operationId,
    }, { kind: 'EXACT_CONFIRMED_MATCH', outcomeKind: null }, deps))
      .toThrow('reconciliation commit unknown')
  })
})
