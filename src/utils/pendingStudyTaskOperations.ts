import type {
  IdempotentAIStudyTaskCreateRequest,
  IdempotentAIStudyTaskOperationKind,
  TodayActionCommittedStatusRequest,
} from '../types/api'
import type { NewStudyTask, StudyTaskSource, StudyTaskStatus, StudyTaskType } from '../types'
import type { PlanningStudyTaskActionExecutionObservation } from './planningSessionExplainability'
import { getLocalDateKey, getNextLocalDateKey, isDateKey } from './dateKey'
import { validateConfirmedStudyTaskOperationId } from './agentStudyTaskActions'
import { observeStudyTaskActionExecutionResult } from './planningSessionExplainability'
import {
  CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION,
  CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION,
} from './aiOperationContracts'

export const PENDING_STUDY_TASK_OPERATIONS_STORAGE_KEY = 'minddiary.pending-study-task-operations.v1'
export const PENDING_STUDY_TASK_OPERATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const PENDING_STUDY_TASK_OPERATION_MAX_COUNT = 20
export const PENDING_STUDY_TASK_OPERATION_MAX_BYTES = 64 * 1024

const ENVELOPE_KEYS = ['version', 'operations'] as const
const V1_OPERATION_KEYS = [
  'operationId',
  'operationKind',
  'actionContractVersion',
  'expectedCurrentDate',
  'payload',
  'createdAt',
] as const
const TODAY_V2_MARKER_KEYS = [
  'operationId',
  'operationKind',
  'actionContractVersion',
  'expectedCurrentDate',
  'plannedDate',
  'createdAt',
] as const
const SHA256_PATTERN = /^[0-9a-f]{64}$/
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

export interface PendingStudyTaskOperationV1 {
  operationId: string
  operationKind: 'today_action' | 'daily_review'
  actionContractVersion: 'confirmed-study-task-action.v1'
  expectedCurrentDate: string
  payload: NewStudyTask
  createdAt: string
}

interface PendingTodayActionStudyTaskOperationV2Base {
  operationId: string
  operationKind: 'today_action'
  actionContractVersion: 'confirmed-study-task-action.v2'
  expectedCurrentDate: string
  plannedDate: string
  createdAt: string
}

export interface CurrentPendingTodayActionStudyTaskOperationV2
  extends PendingTodayActionStudyTaskOperationV2Base {
  planningCandidateId: number
  requestDigest: string
}

export interface LegacyPendingTodayActionStudyTaskOperationV2
  extends PendingTodayActionStudyTaskOperationV2Base {
  planningCandidateId?: never
  requestDigest?: never
}

export type PendingTodayActionStudyTaskOperationV2 =
  | CurrentPendingTodayActionStudyTaskOperationV2
  | LegacyPendingTodayActionStudyTaskOperationV2

export type PendingStudyTaskOperation =
  | PendingStudyTaskOperationV1
  | PendingTodayActionStudyTaskOperationV2

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

function requireOrdinaryDataRecord(value: unknown, label: string): Record<string, unknown> {
  const record = requireRecord(value, label)
  let prototype: object | null
  let descriptors: PropertyDescriptorMap
  try {
    prototype = Object.getPrototypeOf(record)
    descriptors = Object.getOwnPropertyDescriptors(record)
  } catch {
    throw new Error(`${label} must be an ordinary object`)
  }
  if (prototype !== Object.prototype) throw new Error(`${label} must be an ordinary object`)
  for (const descriptor of Object.values(descriptors)) {
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new Error(`${label} field must be an own data property`)
    }
  }
  return record
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireOperationKind(
  value: unknown,
): Exclude<IdempotentAIStudyTaskOperationKind, 'mistake_review'> {
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
  let operation = requireRecord(value, 'pending study task operation')
  const operationKindDescriptor = Object.getOwnPropertyDescriptor(operation, 'operationKind')
  const contractVersionDescriptor = Object.getOwnPropertyDescriptor(operation, 'actionContractVersion')
  const isTodayV2 = operationKindDescriptor !== undefined
    && Object.prototype.hasOwnProperty.call(operationKindDescriptor, 'value')
    && operationKindDescriptor.value === 'today_action'
    && contractVersionDescriptor !== undefined
    && Object.prototype.hasOwnProperty.call(contractVersionDescriptor, 'value')
    && contractVersionDescriptor.value === CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION
  if (isTodayV2) {
    operation = requireOrdinaryDataRecord(value, 'pending study task operation')
  }
  const hasPlanningCandidateId = isTodayV2
    && Object.prototype.hasOwnProperty.call(operation, 'planningCandidateId')
  const hasRequestDigest = isTodayV2
    && Object.prototype.hasOwnProperty.call(operation, 'requestDigest')
  if (isTodayV2 && hasPlanningCandidateId !== hasRequestDigest) {
    throw new Error('pending planningCandidateId and requestDigest must be supplied together')
  }
  assertExactKeys(
    operation,
    isTodayV2
      ? hasPlanningCandidateId
        ? [...TODAY_V2_MARKER_KEYS, 'planningCandidateId', 'requestDigest']
        : TODAY_V2_MARKER_KEYS
      : V1_OPERATION_KEYS,
    'pending study task operation',
  )
  const operationKind = requireOperationKind(operation.operationKind)
  const expectedCurrentDate = requireDateKey(operation.expectedCurrentDate, 'pending expectedCurrentDate')
  const operationId = validateConfirmedStudyTaskOperationId(operation.operationId)
  const createdAt = requireString(operation.createdAt, 'pending createdAt', 64)
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('pending createdAt is invalid')

  if (isTodayV2) {
    const plannedDate = requireDateKey(operation.plannedDate, 'pending plannedDate')
    if (plannedDate !== expectedCurrentDate) {
      throw new Error('pending task date invariant is invalid')
    }
    const baseMarker = {
      operationId,
      operationKind: 'today_action',
      actionContractVersion: CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION,
      expectedCurrentDate,
      plannedDate,
      createdAt,
    } as const
    if (!hasPlanningCandidateId || !hasRequestDigest) return baseMarker
    return {
      ...baseMarker,
      planningCandidateId: requirePositiveSafeInteger(
        operation.planningCandidateId,
        'pending planningCandidateId',
      ),
      requestDigest: requireSha256(operation.requestDigest, 'pending requestDigest'),
    }
  }

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
  return {
    operationId,
    operationKind,
    actionContractVersion: actionContractVersion as 'confirmed-study-task-action.v1',
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
  if (isPendingTodayActionStudyTaskOperationV2(operation)) {
    throw new Error('Today Action v2 pending marker cannot reconstruct a create request')
  }
  return {
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    actionContractVersion: operation.actionContractVersion,
    expectedCurrentDate: operation.expectedCurrentDate,
    payload: operation.payload,
  }
}

export function isPendingTodayActionStudyTaskOperationV2(
  operation: PendingStudyTaskOperation,
): operation is PendingTodayActionStudyTaskOperationV2 {
  return operation.operationKind === 'today_action'
    && operation.actionContractVersion === CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION
}

export function getPendingTodayActionCommittedStatusRequest(
  operation: PendingStudyTaskOperation,
): TodayActionCommittedStatusRequest {
  if (!isPendingTodayActionStudyTaskOperationV2(operation)) {
    throw new Error('Only a Today Action v2 pending marker can build a committed status request')
  }
  const baseRequest = {
    operationId: operation.operationId,
    operationKind: 'today_action',
    actionContractVersion: CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION,
    expectedCurrentDate: operation.expectedCurrentDate,
    plannedDate: operation.plannedDate,
  } as const
  if (operation.planningCandidateId === undefined) return baseRequest
  return {
    ...baseRequest,
    planningCandidateId: operation.planningCandidateId,
    requestDigest: operation.requestDigest,
  }
}

export type PendingTodayActionCommittedStatusResolution =
  | {
      kind: 'observation'
      terminal: boolean
      observation: PlanningStudyTaskActionExecutionObservation
    }
  | {
      kind: 'not_committed'
      terminal: true
      operationId: string
    }

function snapshotPlainOwnDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return null
      const descriptor = descriptors[key]
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return null
      }
      snapshot[key] = descriptor.value
    }
    return Object.freeze(snapshot)
  } catch {
    return null
  }
}

function hasExactSnapshotKeys(
  snapshot: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const ownKeys = Reflect.ownKeys(snapshot)
  return ownKeys.length === keys.length
    && ownKeys.every(key => typeof key === 'string' && keys.includes(key))
}

function uncertainTodayActionStatusResolution(
  operationId: string,
): PendingTodayActionCommittedStatusResolution {
  return {
    kind: 'observation',
    terminal: false,
    observation: observeStudyTaskActionExecutionResult({
      operationId,
      status: 'uncertain',
      error: 'Committed operation status could not be verified',
    }, operationId),
  }
}

export function observePendingTodayActionCommittedStatus(
  operation: PendingStudyTaskOperation,
  response: unknown,
): PendingTodayActionCommittedStatusResolution {
  if (!isPendingTodayActionStudyTaskOperationV2(operation)) {
    throw new Error('Only a Today Action v2 pending marker can observe committed status')
  }
  const operationId = operation.operationId
  const snapshot = snapshotPlainOwnDataRecord(response)
  if (
    snapshot === null
    || snapshot.operationId !== operationId
    || typeof snapshot.status !== 'string'
  ) return uncertainTodayActionStatusResolution(operationId)

  if (snapshot.status === 'NOT_COMMITTED') {
    if (!hasExactSnapshotKeys(snapshot, ['status', 'operationId'])) {
      return uncertainTodayActionStatusResolution(operationId)
    }
    return {
      kind: 'not_committed',
      terminal: true,
      operationId,
    }
  }

  if (snapshot.status === 'RECOVERED_COMMITTED') {
    if (!hasExactSnapshotKeys(snapshot, ['status', 'operationId', 'task'])) {
      return uncertainTodayActionStatusResolution(operationId)
    }
    const observation = observeStudyTaskActionExecutionResult({
      operationId,
      status: 'succeeded',
      task: snapshot.task,
      replayed: true,
    }, operationId)
    if (
      observation.status !== 'succeeded'
      || observation.task.related_chapter_id !== null
    ) return uncertainTodayActionStatusResolution(operationId)
    return { kind: 'observation', terminal: true, observation }
  }

  const failureCode = snapshot.status === 'IDEMPOTENCY_CONFLICT'
    ? 'IDEMPOTENCY_CONFLICT'
    : snapshot.status === 'RESULT_DELETED'
      ? 'RESULT_DELETED'
      : snapshot.status === 'INTEGRITY_ERROR'
        ? 'INTEGRITY_ERROR'
        : null
  if (
    failureCode === null
    || !hasExactSnapshotKeys(snapshot, ['status', 'operationId'])
  ) return uncertainTodayActionStatusResolution(operationId)

  const observation = observeStudyTaskActionExecutionResult({
    operationId,
    status: 'failed',
    code: failureCode,
    error: 'Committed operation status reached a terminal state',
  }, operationId)
  return observation.status === 'uncertain'
    ? uncertainTodayActionStatusResolution(operationId)
    : { kind: 'observation', terminal: true, observation }
}

function getPendingStudyTaskOperationIdentity(operation: PendingStudyTaskOperation): string {
  return JSON.stringify(isPendingTodayActionStudyTaskOperationV2(operation)
    ? getPendingTodayActionCommittedStatusRequest(operation)
    : getPendingStudyTaskCreateRequest(operation))
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
  planningCandidateIdValue?: unknown,
  requestDigestValue?: unknown,
): PendingStudyTaskOperation {
  const createdAt = new Date(now).toISOString()
  const isTodayV2 = request.operationKind === 'today_action'
    && request.actionContractVersion === CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION
  if (planningCandidateIdValue !== undefined && !isTodayV2) {
    throw new Error('pending planningCandidateId is only supported for Today Action v2')
  }
  if (requestDigestValue !== undefined && !isTodayV2) {
    throw new Error('pending requestDigest is only supported for Today Action v2')
  }
  const planningCandidateId = planningCandidateIdValue === undefined
    ? undefined
    : requirePositiveSafeInteger(planningCandidateIdValue, 'pending planningCandidateId')
  const requestDigest = requestDigestValue === undefined
    ? undefined
    : requireSha256(requestDigestValue, 'pending requestDigest')
  if (isTodayV2 && (planningCandidateId === undefined || requestDigest === undefined)) {
    throw new Error('pending planningCandidateId and requestDigest are required for Today Action v2')
  }
  const operation = isTodayV2
    ? (() => {
        const expectedCurrentDate = requireDateKey(
          request.expectedCurrentDate,
          'pending expectedCurrentDate',
        )
        const payload = validatePayload(request.payload)
        if (payload.planned_date !== expectedCurrentDate) {
          throw new Error('pending task date invariant is invalid')
        }
        return validatePendingStudyTaskOperation({
          operationId: request.operationId,
          operationKind: 'today_action',
          actionContractVersion: CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION,
          expectedCurrentDate,
          plannedDate: payload.planned_date,
          ...(planningCandidateId === undefined ? {} : { planningCandidateId }),
          ...(requestDigest === undefined ? {} : { requestDigest }),
          createdAt,
        })
      })()
    : validatePendingStudyTaskOperation({
        ...request,
        createdAt,
      })
  const loaded = loadPendingStudyTaskOperations(storage, now)
  const existing = loaded.operations.find(item => item.operationId === operation.operationId)
  if (
    existing
    && getPendingStudyTaskOperationIdentity(existing) !== getPendingStudyTaskOperationIdentity(operation)
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
