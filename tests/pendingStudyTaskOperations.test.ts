import { describe, expect, it } from 'vitest'
import type { IdempotentAIStudyTaskCreateRequest } from '../src/types/api'
import {
  CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION,
  CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION,
} from '../src/utils/aiOperationContracts'
import {
  PENDING_STUDY_TASK_OPERATION_MAX_BYTES,
  PENDING_STUDY_TASK_OPERATION_RETENTION_MS,
  PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY,
  getPendingStudyTaskCreateRequest,
  getPendingTodayActionCommittedStatusRequest,
  isPendingTodayActionStudyTaskOperationV2,
  loadPendingStudyTaskOperations,
  observePendingTodayActionCommittedStatus,
  removePendingStudyTaskOperation,
  savePendingStudyTaskOperation,
  validatePendingStudyTaskOperation,
  type PendingStudyTaskOperationStorage,
} from '../src/utils/pendingStudyTaskOperations'

class MemoryStorage implements PendingStudyTaskOperationStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const NOW = Date.parse('2026-06-12T08:00:00.000Z')
const CURRENT_PLANNING_CANDIDATE_ID = 701
const CURRENT_REQUEST_DIGEST = 'd'.repeat(64)

function makeRequest(
  operationId = '11111111-1111-4111-8111-111111111111',
  overrides: Partial<IdempotentAIStudyTaskCreateRequest> = {},
): IdempotentAIStudyTaskCreateRequest {
  return {
    operationId,
    operationKind: 'today_action',
    actionContractVersion: CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION,
    expectedCurrentDate: '2026-06-12',
    payload: {
      title: '复习函数极限错题',
      description: '今天到期，先处理薄弱点。',
      type: 'review',
      subject_id: 1,
      related_mistake_id: 12,
      related_entry_id: 5,
      related_chapter_id: null,
      planned_date: '2026-06-12',
      estimate_minutes: 10,
      status: 'todo',
      source: 'ai',
    },
    ...overrides,
  }
}

function makeTodayV2Request(
  operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  overrides: Partial<IdempotentAIStudyTaskCreateRequest> = {},
): IdempotentAIStudyTaskCreateRequest {
  return {
    operationId,
    operationKind: 'today_action',
    actionContractVersion: CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION,
    expectedCurrentDate: '2026-06-12',
    contextProjectionVersion: 'today-action.context-projection.v2',
    originalGenerationContextSignature: 'a'.repeat(64),
    generationChapterSignature: 'b'.repeat(64),
    latestReviewedChapterSignature: 'c'.repeat(64),
    staleContextOverride: true,
    staleReviewToken: 'd'.repeat(64),
    payload: {
      title: '绝不能持久化的任务标题',
      description: '绝不能持久化的任务描述 RAW_SECRET_PENDING_V2',
      type: 'review',
      subject_id: 1,
      related_mistake_id: 12,
      related_entry_id: 5,
      related_chapter_id: null,
      planned_date: '2026-06-12',
      estimate_minutes: 10,
      status: 'todo',
      source: 'ai',
    },
    ...overrides,
  }
}

function makeLegacyTodayV2Marker(now = NOW) {
  return {
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    operationKind: 'today_action',
    actionContractVersion: 'confirmed-study-task-action.v2',
    expectedCurrentDate: '2026-06-12',
    plannedDate: '2026-06-12',
    createdAt: new Date(now).toISOString(),
  } as const
}

function saveCurrentTodayV2Operation(
  storage: PendingStudyTaskOperationStorage,
  now = NOW,
  request = makeTodayV2Request(),
) {
  return savePendingStudyTaskOperation(
    request,
    storage,
    now,
    CURRENT_PLANNING_CANDIDATE_ID,
    CURRENT_REQUEST_DIGEST,
  )
}

describe('pendingStudyTaskOperations', () => {
  it('round-trips the exact request and keeps a same-request save idempotent', () => {
    const storage = new MemoryStorage()
    const request = makeRequest()

    const first = savePendingStudyTaskOperation(request, storage, NOW)
    const second = savePendingStudyTaskOperation(request, storage, NOW + 60_000)
    const loaded = loadPendingStudyTaskOperations(storage, NOW + 60_000)

    expect(second.createdAt).toBe(first.createdAt)
    expect(loaded).toEqual({ operations: [first], removedCount: 0, corrupted: false })
    expect(getPendingStudyTaskCreateRequest(first)).toEqual(request)
  })

  it('rejects reuse of an operation ID for different confirmed content', () => {
    const storage = new MemoryStorage()
    savePendingStudyTaskOperation(makeRequest(), storage, NOW)

    expect(() => savePendingStudyTaskOperation(makeRequest(undefined, {
      payload: { ...makeRequest().payload, title: '不同任务' },
    }), storage, NOW + 1)).toThrow('already belongs to a different request')
    expect(loadPendingStudyTaskOperations(storage, NOW + 1).operations).toHaveLength(1)
  })

  it.each([
    ['neither identity', undefined, undefined],
    ['candidate only', 701, undefined],
    ['digest only', undefined, 'd'.repeat(64)],
  ] as const)('rejects a Today v2 writer call with %s', (_label, planningCandidateId, requestDigest) => {
    const storage = new MemoryStorage()

    expect(() => savePendingStudyTaskOperation(
      makeTodayV2Request(),
      storage,
      NOW,
      planningCandidateId,
      requestDigest,
    )).toThrow(/planningCandidateId and requestDigest/)
    expect(storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
  })

  it('persists a Current Today Action v2 durable marker with the exact metadata-only shape', () => {
    const storage = new MemoryStorage()

    const saved = saveCurrentTodayV2Operation(storage)
    const serialized = storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)

    expect(isPendingTodayActionStudyTaskOperationV2(saved)).toBe(true)
    expect(saved).toEqual({
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-12',
      createdAt: new Date(NOW).toISOString(),
      planningCandidateId: CURRENT_PLANNING_CANDIDATE_ID,
      requestDigest: CURRENT_REQUEST_DIGEST,
    })
    expect(Object.keys(saved)).toEqual([
      'operationId',
      'operationKind',
      'actionContractVersion',
      'expectedCurrentDate',
      'plannedDate',
      'createdAt',
      'planningCandidateId',
      'requestDigest',
    ])
    expect(serialized).not.toBeNull()
    expect(serialized).not.toContain('payload')
    expect(serialized).not.toContain('RAW_SECRET_PENDING_V2')
    expect(serialized).not.toContain('generationChapterSignature')
    expect(serialized).not.toContain('latestReviewedChapterSignature')
    expect(serialized).not.toContain('staleReviewToken')
    expect(serialized).not.toContain('staleContextOverride')
  })

  it('persists only opaque candidate and request identities needed for fail-closed v2 recovery', () => {
    const storage = new MemoryStorage()
    const requestDigest = CURRENT_REQUEST_DIGEST

    const saved = savePendingStudyTaskOperation(
      makeTodayV2Request(),
      storage,
      NOW,
      CURRENT_PLANNING_CANDIDATE_ID,
      requestDigest,
    )

    expect(saved).toEqual({
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-12',
      planningCandidateId: CURRENT_PLANNING_CANDIDATE_ID,
      requestDigest,
      createdAt: new Date(NOW).toISOString(),
    })
    expect(getPendingTodayActionCommittedStatusRequest(saved)).toEqual({
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-12',
      planningCandidateId: CURRENT_PLANNING_CANDIDATE_ID,
      requestDigest,
    })
    const serialized = storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)!
    expect(serialized).toContain('"planningCandidateId":701')
    expect(serialized).not.toContain('payload')
    expect(serialized).not.toContain('staleReviewToken')
  })

  it('accepts exactly Current or Legacy Today v2 markers and rejects every partial or exotic shape', () => {
    const legacy = {
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-12',
      createdAt: new Date(NOW).toISOString(),
    }
    const current = {
      ...legacy,
      planningCandidateId: 701,
      requestDigest: 'd'.repeat(64),
    }

    expect(validatePendingStudyTaskOperation(legacy)).toEqual(legacy)
    expect(validatePendingStudyTaskOperation(current)).toEqual(current)
    expect(() => validatePendingStudyTaskOperation({
      ...legacy,
      planningCandidateId: 701,
    })).toThrow(/together/)
    expect(() => validatePendingStudyTaskOperation({
      ...legacy,
      requestDigest: 'd'.repeat(64),
    })).toThrow(/together/)
    expect(() => validatePendingStudyTaskOperation({ ...current, extra: true })).toThrow(/unsupported/)

    const accessor = { ...current } as Record<string, unknown>
    Object.defineProperty(accessor, 'requestDigest', {
      enumerable: true,
      get: () => 'd'.repeat(64),
    })
    expect(() => validatePendingStudyTaskOperation(accessor)).toThrow(/data property/)

    const symbolMarker = { ...current } as Record<PropertyKey, unknown>
    symbolMarker[Symbol('hidden')] = true
    expect(() => validatePendingStudyTaskOperation(symbolMarker)).toThrow(/unsupported/)

    const customPrototype = Object.assign(Object.create({ inherited: true }), current)
    expect(() => validatePendingStudyTaskOperation(customPrototype)).toThrow(/ordinary object/)
  })

  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)])(
    'rejects an invalid pending request digest: %s',
    requestDigest => {
      const storage = new MemoryStorage()
      expect(() => savePendingStudyTaskOperation(
        makeTodayV2Request(),
        storage,
        NOW,
        701,
        requestDigest,
      )).toThrow('requestDigest')
      expect(storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    },
  )

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5])(
    'rejects an invalid durable Planning candidate identity: %s',
    planningCandidateId => {
      const storage = new MemoryStorage()
      expect(() => savePendingStudyTaskOperation(
        makeTodayV2Request(),
        storage,
        NOW,
        planningCandidateId,
      )).toThrow('planningCandidateId')
      expect(storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
    },
  )

  it('never reconstructs a Today v2 create request and emits only the exact read-only status request', () => {
    const storage = new MemoryStorage()
    const legacyMarker = makeLegacyTodayV2Marker()
    storage.setItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY, JSON.stringify({
      version: 1,
      operations: [legacyMarker],
    }))
    const loaded = loadPendingStudyTaskOperations(storage, NOW)
    expect(loaded).toEqual({ operations: [legacyMarker], removedCount: 0, corrupted: false })
    const marker = loaded.operations[0]!

    expect(() => getPendingStudyTaskCreateRequest(marker)).toThrow('cannot reconstruct')
    expect(getPendingTodayActionCommittedStatusRequest(marker)).toEqual({
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operationKind: 'today_action',
      actionContractVersion: 'confirmed-study-task-action.v2',
      expectedCurrentDate: '2026-06-12',
      plannedDate: '2026-06-12',
    })
    expect(Object.keys(getPendingTodayActionCommittedStatusRequest(marker))).toEqual([
      'operationId',
      'operationKind',
      'actionContractVersion',
      'expectedCurrentDate',
      'plannedDate',
    ])
  })

  it('loads mixed legacy v1 and Today v2 records while rejecting any expanded v2 marker', () => {
    const storage = new MemoryStorage()
    const legacy = savePendingStudyTaskOperation(makeRequest(), storage, NOW)
    const marker = makeLegacyTodayV2Marker()
    const expandedMarker = { ...marker, payload: makeTodayV2Request().payload }
    storage.setItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY, JSON.stringify({
      version: 1,
      operations: [legacy, marker, expandedMarker],
    }))

    const loaded = loadPendingStudyTaskOperations(storage, NOW)

    expect(loaded.operations).toEqual([legacy, marker])
    expect(loaded.removedCount).toBe(1)
    expect(loaded.corrupted).toBe(true)
    expect(storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).not.toContain('payload\":{\"title\":\"绝不能持久化')
  })

  it('rejects a Today v2 marker whose planned date is not the expected current date', () => {
    const storage = new MemoryStorage()

    expect(() => savePendingStudyTaskOperation(makeTodayV2Request(undefined, {
      payload: { ...makeTodayV2Request().payload, planned_date: '2026-06-13' },
    }), storage, NOW, CURRENT_PLANNING_CANDIDATE_ID, CURRENT_REQUEST_DIGEST)).toThrow('date invariant')
    expect(storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
  })

  it('maps bounded Today v2 receipt statuses without turning NOT_COMMITTED into a create retry', () => {
    const storage = new MemoryStorage()
    const marker = saveCurrentTodayV2Operation(storage)
    const task = {
      id: 42,
      title: '已提交任务',
      description: '由原操作创建',
      type: 'review' as const,
      subject_id: 1,
      related_mistake_id: 12,
      related_entry_id: 5,
      related_chapter_id: null,
      planned_date: '2026-06-12',
      estimate_minutes: 10,
      status: 'todo' as const,
      source: 'ai' as const,
      created_at: '2026-06-12T08:00:00.000Z',
      updated_at: '2026-06-12T08:00:00.000Z',
    }

    const notCommitted = observePendingTodayActionCommittedStatus(marker, {
      status: 'NOT_COMMITTED',
      operationId: marker.operationId,
    })
    expect(notCommitted).toEqual({
      kind: 'not_committed',
      terminal: true,
      operationId: marker.operationId,
    })

    const recovered = observePendingTodayActionCommittedStatus(marker, {
      status: 'RECOVERED_COMMITTED',
      operationId: marker.operationId,
      task,
    })
    expect(recovered.kind).toBe('observation')
    if (recovered.kind !== 'observation') throw new Error('expected observation')
    expect(recovered.terminal).toBe(true)
    expect(recovered.observation).toMatchObject({
      status: 'succeeded',
      operationId: marker.operationId,
      replayed: true,
      task,
    })

    const terminalKinds = [
      ['IDEMPOTENCY_CONFLICT', 'conflict'],
      ['RESULT_DELETED', 'deleted'],
      ['INTEGRITY_ERROR', 'integrity_error'],
    ] as const
    for (const [status, kind] of terminalKinds) {
      const resolved = observePendingTodayActionCommittedStatus(marker, {
        status,
        operationId: marker.operationId,
      })
      expect(resolved.kind).toBe('observation')
      if (resolved.kind !== 'observation') throw new Error('expected observation')
      expect(resolved.terminal).toBe(true)
      expect(resolved.observation.outcome.kind).toBe(kind)
    }
  })

  it('keeps a Today v2 marker when the receipt status response is malformed or mismatched', () => {
    const storage = new MemoryStorage()
    const marker = saveCurrentTodayV2Operation(storage)

    for (const response of [
      { status: 'NOT_COMMITTED', operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { status: 'NOT_COMMITTED', operationId: marker.operationId, hidden: 'receipt' },
      { status: 'RECOVERED_COMMITTED', operationId: marker.operationId, task: null },
      { status: 'FABRICATED_COMMITTED', operationId: marker.operationId },
    ]) {
      const resolved = observePendingTodayActionCommittedStatus(marker, response)
      expect(resolved.kind).toBe('observation')
      if (resolved.kind !== 'observation') throw new Error('expected observation')
      expect(resolved.terminal).toBe(false)
      expect(resolved.observation.status).toBe('uncertain')
    }
  })

  it('removes only the requested operation', () => {
    const storage = new MemoryStorage()
    savePendingStudyTaskOperation(makeRequest(), storage, NOW)
    savePendingStudyTaskOperation(makeRequest('22222222-2222-4222-8222-222222222222'), storage, NOW)

    removePendingStudyTaskOperation('11111111-1111-4111-8111-111111111111', storage, NOW)

    expect(loadPendingStudyTaskOperations(storage, NOW).operations.map(item => item.operationId))
      .toEqual(['22222222-2222-4222-8222-222222222222'])
  })

  it('cleans invalid, duplicate, and expired entries without expiring on clock rollback', () => {
    const storage = new MemoryStorage()
    const current = savePendingStudyTaskOperation(makeRequest(), storage, NOW)
    const duplicate = { ...current, createdAt: new Date(NOW + 1).toISOString() }
    const expired = {
      ...current,
      operationId: '22222222-2222-4222-8222-222222222222',
      createdAt: new Date(NOW - PENDING_STUDY_TASK_OPERATION_RETENTION_MS - 1).toISOString(),
    }
    const future = {
      ...current,
      operationId: '33333333-3333-4333-8333-333333333333',
      createdAt: new Date(NOW + 60_000).toISOString(),
    }
    storage.setItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY, JSON.stringify({
      version: 1,
      operations: [current, duplicate, expired, { invalid: true }, future],
    }))

    const loaded = loadPendingStudyTaskOperations(storage, NOW)

    expect(loaded.corrupted).toBe(true)
    expect(loaded.removedCount).toBe(3)
    expect(loaded.operations.map(item => item.operationId)).toEqual([
      current.operationId,
      future.operationId,
    ])
  })

  it('drops a corrupt or oversized UTF-8 envelope fail-closed', () => {
    const storage = new MemoryStorage()
    storage.setItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY, '{not-json')
    expect(loadPendingStudyTaskOperations(storage, NOW)).toEqual({
      operations: [],
      removedCount: 1,
      corrupted: true,
    })
    expect(storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()

    storage.setItem(
      PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY,
      '中'.repeat(Math.ceil(PENDING_STUDY_TASK_OPERATION_MAX_BYTES / 3) + 1),
    )
    expect(loadPendingStudyTaskOperations(storage, NOW).operations).toEqual([])
    expect(storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
  })

  it('validates operation kind, contract version, date invariant, and exact payload shape', () => {
    const base = {
      ...makeRequest(),
      createdAt: new Date(NOW).toISOString(),
    }
    expect(() => validatePendingStudyTaskOperation({ ...base, operationKind: 'other' }))
      .toThrow('operation kind')
    expect(() => validatePendingStudyTaskOperation({ ...base, operationKind: 'mistake_review' as any }))
      .toThrow('operation kind')
    expect(() => validatePendingStudyTaskOperation({ ...base, actionContractVersion: 'forged' }))
      .toThrow('not canonical')
    expect(() => validatePendingStudyTaskOperation({
      ...base,
      operationKind: 'daily_review',
    })).toThrow('date invariant')
    expect(() => validatePendingStudyTaskOperation({
      ...base,
      payload: { ...base.payload, path: 'C:\\secret' },
    })).toThrow('unsupported fields')
    expect(() => validatePendingStudyTaskOperation(Object.create(base))).toThrow('missing required fields')
    expect(() => validatePendingStudyTaskOperation({
      ...base,
      payload: Object.create(base.payload),
    })).toThrow('missing required fields')
  })

  it('does not mutate storage when persistence itself fails', () => {
    const storage = new MemoryStorage()
    storage.setItem = () => {
      throw new Error('quota exceeded')
    }

    expect(() => savePendingStudyTaskOperation(makeRequest(), storage, NOW)).toThrow('quota exceeded')
    expect(storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)).toBeNull()
  })
})
