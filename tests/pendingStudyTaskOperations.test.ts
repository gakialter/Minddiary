import { describe, expect, it } from 'vitest'
import type { IdempotentAIStudyTaskCreateRequest } from '../src/types/api'
import { CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION } from '../src/utils/aiOperationContracts'
import {
  PENDING_STUDY_TASK_OPERATION_MAX_BYTES,
  PENDING_STUDY_TASK_OPERATION_RETENTION_MS,
  PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY,
  getPendingStudyTaskCreateRequest,
  loadPendingStudyTaskOperations,
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
