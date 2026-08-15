// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { executeStudyTaskCommandWithPlanningAudit } from '../electron/planningTaskCorrelation'
import type {
  IdempotentAIStudyTaskCreateRequest,
  IdempotentAIStudyTaskCreateResponse,
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

describe('existing task command planning-audit correlation', () => {
  it('keeps the task command authoritative when audit claim fails', () => {
    const execute = vi.fn(() => CREATED)
    const recordOutcome = vi.fn()

    const result = executeStudyTaskCommandWithPlanningAudit(REQUEST, 9, {
      claim: vi.fn(() => { throw new Error('audit unavailable') }),
      execute,
      recordOutcome,
      warn: vi.fn(),
    })

    expect(result).toBe(CREATED)
    expect(execute).toHaveBeenCalledOnce()
    expect(recordOutcome).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...CREATED, replayed: false }, 'created'],
    [{ ...CREATED, replayed: true }, 'replayed'],
    [{ ok: false, operationId: REQUEST.operationId, code: 'IDEMPOTENCY_CONFLICT', message: 'bounded' }, 'conflict'],
    [{ ok: false, operationId: REQUEST.operationId, code: 'RESULT_DELETED', message: 'bounded' }, 'deleted'],
    [{ ok: false, operationId: REQUEST.operationId, code: 'INTEGRITY_ERROR', message: 'bounded' }, 'integrity_error'],
    [{ ok: false, operationId: REQUEST.operationId, code: 'DATE_MISMATCH', message: 'bounded' }, 'date_mismatch'],
    [{ ok: false, operationId: REQUEST.operationId, code: 'INVALID_REQUEST', message: 'bounded' }, 'validation_error'],
  ] as const)('derives trusted %s outcome without changing the task response', (response, outcome) => {
    const recordOutcome = vi.fn()

    const result = executeStudyTaskCommandWithPlanningAudit(REQUEST, 9, {
      claim: vi.fn(() => ({ claimed: true as const })),
      execute: vi.fn(() => response as IdempotentAIStudyTaskCreateResponse),
      recordOutcome,
      warn: vi.fn(),
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
    })).toBe(CREATED)

    expect(claim).not.toHaveBeenCalled()
    expect(recordOutcome).not.toHaveBeenCalled()
  })
})
