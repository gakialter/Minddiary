import type {
  IdempotentAIStudyTaskCreateRequest,
  IdempotentAIStudyTaskOperationKind,
} from '../types/api'
import type { NewStudyTask, StudyTaskSource, StudyTaskStatus, StudyTaskType } from '../types'
import { getLocalDateKey, getNextLocalDateKey, isDateKey } from './dateKey'
import { validateConfirmedStudyTaskOperationId } from './agentStudyTaskActions'
import { CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION } from './aiOperationContracts'

export const PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY = 'minddiary.pending-study-task-operations.v1'
export const PENDING_STUDY_TASK_OPERATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const PENDING_STUDY_TASK_OPERATION_MAX_COUNT = 20
export const PENDING_STUDY_TASK_OPERATION_MAX_BYTES = 64 * 1024

const ENVELOPE_KEYS = ['version', 'operations'] as const
const OPERATION_KEYS = [
  'operationId',
  'operationKind',
  'actionContractVersion',
  'expectedCurrentDate',
  'payload',
  'createdAt',
] as const
const PAYLOAD_KEYS = [
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
] as const
const TASK_TYPES: readonly StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']
const TASK_STATUS: StudyTaskStatus = 'todo'
const TASK_SOURCE: StudyTaskSource = 'ai'

export interface PendingStudyTaskOperation extends IdempotentAIStudyTaskCreateRequest {
  createdAt: string
}

export interface PendingStudyTaskOperationLoadResult {
  operations: PendingStudyTaskOperation[]
  removedCount: number
  corrupted: boolean
}

export interface PendingStudyTaskOperationStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const ownKeys = Reflect.ownKeys(record)
  const unsupported = ownKeys.filter(key => typeof key !== 'string' || !keys.includes(key))
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported fields`)
  }
  const missing = keys.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
  if (missing.length > 0) throw new Error(`${label} is missing required fields`)
}

function requireString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireDateKey(value: unknown, label: string): string {
  if (!isDateKey(value)) throw new Error(`${label} is invalid`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!, 12)
  if (Number.isNaN(date.getTime()) || getLocalDateKey(date) !== value) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireNullableId(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireOperationKind(value: unknown): IdempotentAIStudyTaskOperationKind {
  if (value !== 'today_action' && value !== 'daily_review') {
    throw new Error('pending operation kind is invalid')
  }
  return value
}

function validatePayload(value: unknown): NewStudyTask {
  const payload = requireRecord(value, 'pending task payload')
  assertExactKeys(payload, PAYLOAD_KEYS, 'pending task payload')
  const type = payload.type
  if (typeof type !== 'string' || !TASK_TYPES.includes(type as StudyTaskType)) {
    throw new Error('pending task type is invalid')
  }
  if (
    typeof payload.estimate_minutes !== 'number'
    || !Number.isInteger(payload.estimate_minutes)
    || payload.estimate_minutes < 5
    || payload.estimate_minutes > 180
  ) {
    throw new Error('pending task estimate is invalid')
  }
  if (payload.status !== TASK_STATUS || payload.source !== TASK_SOURCE) {
    throw new Error('pending task ownership fields are invalid')
  }
  return {
    title: requireString(payload.title, 'pending task title', 80),
    description: requireString(payload.description, 'pending task description', 240),
    type: type as StudyTaskType,
    subject_id: requireNullableId(payload.subject_id, 'pending task subject_id'),
    related_mistake_id: requireNullableId(payload.related_mistake_id, 'pending task related_mistake_id'),
    related_entry_id: requireNullableId(payload.related_entry_id, 'pending task related_entry_id'),
    related_chapter_id: requireNullableId(payload.related_chapter_id, 'pending task related_chapter_id'),
    planned_date: requireDateKey(payload.planned_date, 'pending task planned_date'),
    estimate_minutes: payload.estimate_minutes,
    status: TASK_STATUS,
    source: TASK_SOURCE,
  }
}

export function validatePendingStudyTaskOperation(value: unknown): PendingStudyTaskOperation {
  const operation = requireRecord(value, 'pending study task operation')
  assertExactKeys(operation, OPERATION_KEYS, 'pending study task operation')
  const operationKind = requireOperationKind(operation.operationKind)
  const expectedCurrentDate = requireDateKey(operation.expectedCurrentDate, 'pending expectedCurrentDate')
  const payload = validatePayload(operation.payload)
  const expectedPlannedDate = operationKind === 'today_action'
    ? expectedCurrentDate
    : getNextLocalDateKey(expectedCurrentDate)
  if (payload.planned_date !== expectedPlannedDate) {
    throw new Error('pending task date invariant is invalid')
  }
  const actionContractVersion = requireString(
    operation.actionContractVersion,
    'pending action contract version',
    80,
  )
  if (actionContractVersion !== CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION) {
    throw new Error('pending action contract version is not canonical')
  }
  const createdAt = requireString(operation.createdAt, 'pending createdAt', 64)
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('pending createdAt is invalid')
  return {
    operationId: validateConfirmedStudyTaskOperationId(operation.operationId),
    operationKind,
    actionContractVersion,
    expectedCurrentDate,
    payload,
    createdAt,
  }
}

function getDefaultStorage(): PendingStudyTaskOperationStorage {
  if (!globalThis.localStorage) throw new Error('Local recovery storage is unavailable')
  return globalThis.localStorage
}

function persistOperations(
  operations: PendingStudyTaskOperation[],
  storage: PendingStudyTaskOperationStorage,
): void {
  if (operations.length === 0) {
    storage.removeItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
    return
  }
  const serialized = JSON.stringify({ version: 1, operations })
  if (new TextEncoder().encode(serialized).byteLength > PENDING_STUDY_TASK_OPERATION_MAX_BYTES) {
    throw new Error('Pending recovery storage limit exceeded')
  }
  storage.setItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY, serialized)
}

export function getPendingStudyTaskCreateRequest(
  operation: PendingStudyTaskOperation,
): IdempotentAIStudyTaskCreateRequest {
  return {
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    actionContractVersion: operation.actionContractVersion,
    expectedCurrentDate: operation.expectedCurrentDate,
    payload: operation.payload,
  }
}

export function loadPendingStudyTaskOperations(
  storage: PendingStudyTaskOperationStorage = getDefaultStorage(),
  now = Date.now(),
): PendingStudyTaskOperationLoadResult {
  const serialized = storage.getItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
  if (serialized === null) return { operations: [], removedCount: 0, corrupted: false }
  if (new TextEncoder().encode(serialized).byteLength > PENDING_STUDY_TASK_OPERATION_MAX_BYTES) {
    storage.removeItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
    return { operations: [], removedCount: 1, corrupted: true }
  }

  let raw: unknown
  try {
    raw = JSON.parse(serialized)
    const envelope = requireRecord(raw, 'pending operation envelope')
    assertExactKeys(envelope, ENVELOPE_KEYS, 'pending operation envelope')
    if (envelope.version !== 1 || !Array.isArray(envelope.operations)) {
      throw new Error('pending operation envelope is invalid')
    }
    if (envelope.operations.length > PENDING_STUDY_TASK_OPERATION_MAX_COUNT) {
      throw new Error('pending operation queue is too large')
    }

    let removedCount = 0
    const seenIds = new Set<string>()
    const operations = envelope.operations.flatMap(candidate => {
      try {
        const operation = validatePendingStudyTaskOperation(candidate)
        const createdAt = Date.parse(operation.createdAt)
        const expired = now >= createdAt && now - createdAt > PENDING_STUDY_TASK_OPERATION_RETENTION_MS
        if (expired || seenIds.has(operation.operationId)) {
          removedCount += 1
          return []
        }
        seenIds.add(operation.operationId)
        return [operation]
      } catch {
        removedCount += 1
        return []
      }
    })
    if (removedCount > 0) persistOperations(operations, storage)
    return { operations, removedCount, corrupted: removedCount > 0 }
  } catch {
    storage.removeItem(PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY)
    return { operations: [], removedCount: 1, corrupted: true }
  }
}

export function savePendingStudyTaskOperation(
  request: IdempotentAIStudyTaskCreateRequest,
  storage: PendingStudyTaskOperationStorage = getDefaultStorage(),
  now = Date.now(),
): PendingStudyTaskOperation {
  const operation = validatePendingStudyTaskOperation({
    ...request,
    createdAt: new Date(now).toISOString(),
  })
  const loaded = loadPendingStudyTaskOperations(storage, now)
  const existing = loaded.operations.find(item => item.operationId === operation.operationId)
  if (
    existing
    && JSON.stringify(getPendingStudyTaskCreateRequest(existing))
      !== JSON.stringify(getPendingStudyTaskCreateRequest(operation))
  ) {
    throw new Error('Pending operation ID already belongs to a different request')
  }
  const operations = existing
    ? loaded.operations
    : [...loaded.operations, operation]
  if (operations.length > PENDING_STUDY_TASK_OPERATION_MAX_COUNT) {
    throw new Error('Pending recovery queue is full')
  }
  persistOperations(operations, storage)
  return existing ?? operation
}

export function removePendingStudyTaskOperation(
  operationId: string,
  storage: PendingStudyTaskOperationStorage = getDefaultStorage(),
  now = Date.now(),
): void {
  const validatedId = validateConfirmedStudyTaskOperationId(operationId)
  const loaded = loadPendingStudyTaskOperations(storage, now)
  persistOperations(loaded.operations.filter(operation => operation.operationId !== validatedId), storage)
}
