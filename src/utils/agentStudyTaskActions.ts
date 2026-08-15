import type { NewStudyTask, StudyTask, StudyTaskType } from '../types'
import type {
  IdempotentAIStudyTaskCreateErrorCode,
  IdempotentAIStudyTaskCreateRequest,
  IdempotentAIStudyTaskCreateResponse,
  TasksContextAPI,
} from '../types/api'
import {
  validateAIStudyTaskGenerationProvenance,
  type AIStudyTaskGenerationProvenance,
  type AIStudyTaskOperationKind,
} from './aiOperationContracts'
import { getLocalDateKey, getNextLocalDateKey, isDateKey } from './dateKey'

const STUDY_TASK_TYPES: readonly StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']
const ACTION_KEYS = [
  'kind',
  'operationId',
  'mode',
  'generation',
  'confirmationContextSignature',
  'expectedCurrentDate',
  'plannedDate',
  'draft',
] as const
const SNAPSHOT_KEYS = [
  'mode',
  'generation',
  'confirmationContextSignature',
  'expectedCurrentDate',
  'plannedDate',
] as const
const DRAFT_KEYS = [
  'title',
  'description',
  'type',
  'estimate_minutes',
  'subject_id',
  'related_mistake_id',
  'related_entry_id',
  'related_chapter_id',
] as const
const DRAFT_REQUIRED_KEYS = [
  'title',
  'description',
  'type',
  'estimate_minutes',
  'subject_id',
  'related_mistake_id',
  'related_entry_id',
] as const
const STUDY_TASK_RESPONSE_KEYS = [
  'id',
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
  'created_at',
  'updated_at',
] as const
const STUDY_TASK_STATUSES = ['todo', 'doing', 'done', 'skipped'] as const
const STUDY_TASK_SOURCES = ['manual', 'dashboard', 'ai', 'pomodoro'] as const

const TITLE_MAX_LENGTH = 80
const DESCRIPTION_MAX_LENGTH = 240
const ESTIMATE_MINUTES_MIN = 5
const ESTIMATE_MINUTES_MAX = 180
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UNCERTAIN_RESULT_MESSAGE = '任务创建结果不确定。请使用相同操作 ID 检查并恢复。'
const IDEMPOTENT_ERROR_CODES: readonly IdempotentAIStudyTaskCreateErrorCode[] = [
  'INVALID_REQUEST',
  'DATE_MISMATCH',
  'IDEMPOTENCY_CONFLICT',
  'RESULT_DELETED',
  'INTEGRITY_ERROR',
]

export type StudyTaskActionMode = AIStudyTaskOperationKind

export interface ConfirmedStudyTaskDraft {
  title: string
  description: string
  type: StudyTaskType
  estimate_minutes: number
  subject_id: number | null
  related_mistake_id: number | null
  related_entry_id: number | null
  related_chapter_id?: number | null
}

export interface StudyTaskActionConfirmationSnapshot {
  mode: StudyTaskActionMode
  generation: AIStudyTaskGenerationProvenance
  confirmationContextSignature: string
  expectedCurrentDate: string
  plannedDate: string
}

export interface ConfirmedStudyTaskAction {
  kind: 'create_study_task'
  operationId: string
  mode: StudyTaskActionMode
  generation: AIStudyTaskGenerationProvenance
  confirmationContextSignature: string
  expectedCurrentDate: string
  plannedDate: string
  draft: ConfirmedStudyTaskDraft
}

export type StudyTaskActionExecutionResult =
  | {
      operationId: string
      status: 'succeeded'
      task: StudyTask
      replayed: boolean
    }
  | {
      operationId: string
      status: 'failed'
      code: IdempotentAIStudyTaskCreateErrorCode
      error: string
    }
  | {
      operationId: string
      status: 'uncertain'
      error: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function assertExactKeys({
  record,
  allowed,
  required = allowed,
  label,
}: {
  record: Record<string, unknown>
  allowed: readonly string[]
  required?: readonly string[]
  label: string
}): void {
  const unsupported = Reflect.ownKeys(record).filter(key => (
    typeof key !== 'string' || !allowed.includes(key)
  ))
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unsupported.map(String).join(', ')}`)
  }
  const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
  if (missing.length > 0) {
    throw new Error(`${label} is missing required fields: ${missing.map(key => `${label}.${key}`).join(', ')}`)
  }
}

function normalizeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u00AD\u2060\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) throw new Error(`${label} is required`)
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`)
  return normalized
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}

export function validateConfirmedStudyTaskOperationId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error('confirmed study task operationId must be a lowercase UUID v4')
  }
  return value
}

export function createConfirmedStudyTaskOperationId(randomUUID?: () => string): string {
  const generator = randomUUID ?? (() => {
    if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
      throw new Error('Secure operation ID generation is unavailable')
    }
    return globalThis.crypto.randomUUID()
  })
  return validateConfirmedStudyTaskOperationId(generator())
}

function requireMode(value: unknown): StudyTaskActionMode {
  if (value !== 'today_action' && value !== 'daily_review') {
    throw new Error('action mode is invalid')
  }
  return value
}

function requireValidLocalDateKey(value: unknown, label: string): string {
  if (!isDateKey(value)) throw new Error(`${label} must be a YYYY-MM-DD local date key`)
  const [year, month, day] = value.split('-').map(Number)
  const localDate = new Date(year!, month! - 1, day!, 12)
  if (Number.isNaN(localDate.getTime()) || getLocalDateKey(localDate) !== value) {
    throw new Error(`${label} must be a valid local date key`)
  }
  return value
}

function requireNullableId(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer or null`)
  }
  return value
}

function validateSnapshot(value: unknown): StudyTaskActionConfirmationSnapshot {
  const snapshot = requireRecord(value, 'confirmation snapshot')
  assertExactKeys({ record: snapshot, allowed: SNAPSHOT_KEYS, label: 'confirmation snapshot' })
  const mode = requireMode(snapshot.mode)
  const generation = validateAIStudyTaskGenerationProvenance(snapshot.generation, mode)
  const confirmationContextSignature = requireNonEmptyString(
    snapshot.confirmationContextSignature,
    'confirmation context signature',
  )
  const expectedCurrentDate = requireValidLocalDateKey(snapshot.expectedCurrentDate, 'confirmation expectedCurrentDate')
  const plannedDate = requireValidLocalDateKey(snapshot.plannedDate, 'confirmation plannedDate')
  const invariantPlannedDate = mode === 'today_action'
    ? expectedCurrentDate
    : getNextLocalDateKey(expectedCurrentDate)
  if (plannedDate !== invariantPlannedDate) {
    throw new Error(`${mode} plannedDate does not match its local-date invariant`)
  }
  return {
    mode,
    generation,
    confirmationContextSignature,
    expectedCurrentDate,
    plannedDate,
  }
}

function validateDraft(value: unknown): ConfirmedStudyTaskDraft {
  const draft = requireRecord(value, 'study task draft')
  assertExactKeys({
    record: draft,
    allowed: DRAFT_KEYS,
    required: DRAFT_REQUIRED_KEYS,
    label: 'study task draft',
  })
  const type = draft.type
  if (typeof type !== 'string' || !STUDY_TASK_TYPES.includes(type as StudyTaskType)) {
    throw new Error('study task draft type is invalid')
  }
  if (
    typeof draft.estimate_minutes !== 'number'
    || !Number.isInteger(draft.estimate_minutes)
    || draft.estimate_minutes < ESTIMATE_MINUTES_MIN
    || draft.estimate_minutes > ESTIMATE_MINUTES_MAX
  ) {
    throw new Error(
      `study task draft estimate_minutes must be an integer between ${ESTIMATE_MINUTES_MIN} and ${ESTIMATE_MINUTES_MAX}`,
    )
  }
  return {
    title: normalizeText(draft.title, 'study task draft title', TITLE_MAX_LENGTH),
    description: normalizeText(draft.description, 'study task draft description', DESCRIPTION_MAX_LENGTH),
    type: type as StudyTaskType,
    estimate_minutes: draft.estimate_minutes,
    subject_id: requireNullableId(draft.subject_id, 'study task draft subject_id'),
    related_mistake_id: requireNullableId(draft.related_mistake_id, 'study task draft related_mistake_id'),
    related_entry_id: requireNullableId(draft.related_entry_id, 'study task draft related_entry_id'),
    related_chapter_id: !Object.prototype.hasOwnProperty.call(draft, 'related_chapter_id')
      || draft.related_chapter_id === undefined
      ? null
      : requireNullableId(draft.related_chapter_id, 'study task draft related_chapter_id'),
  }
}

export function validateConfirmedStudyTaskAction(
  value: unknown,
  confirmationSnapshot: StudyTaskActionConfirmationSnapshot,
): ConfirmedStudyTaskAction {
  const action = requireRecord(value, 'confirmed study task action')
  assertExactKeys({ record: action, allowed: ACTION_KEYS, label: 'confirmed study task action' })
  if (action.kind !== 'create_study_task') throw new Error('confirmed study task action kind is invalid')
  const operationId = validateConfirmedStudyTaskOperationId(action.operationId)
  const mode = requireMode(action.mode)
  const generation = validateAIStudyTaskGenerationProvenance(action.generation, mode)
  const confirmationContextSignature = requireNonEmptyString(
    action.confirmationContextSignature,
    'confirmed study task action confirmation context signature',
  )
  const expectedCurrentDate = requireValidLocalDateKey(
    action.expectedCurrentDate,
    'confirmed study task action expectedCurrentDate',
  )
  const plannedDate = requireValidLocalDateKey(action.plannedDate, 'confirmed study task action plannedDate')
  const snapshot = validateSnapshot(confirmationSnapshot)

  if (mode !== snapshot.mode) throw new Error('confirmed study task action mode does not match confirmation snapshot')
  if (
    generation.operationKind !== snapshot.generation.operationKind
    || generation.generationContextSignature !== snapshot.generation.generationContextSignature
    || Object.keys(generation.versions).some(key => (
      generation.versions[key as keyof typeof generation.versions]
      !== snapshot.generation.versions[key as keyof typeof snapshot.generation.versions]
    ))
  ) {
    throw new Error('confirmed study task action generation provenance does not match confirmation snapshot')
  }
  if (confirmationContextSignature !== snapshot.confirmationContextSignature) {
    throw new Error('confirmed study task action confirmation context signature does not match confirmation snapshot')
  }
  if (expectedCurrentDate !== snapshot.expectedCurrentDate) {
    throw new Error('confirmed study task action expectedCurrentDate does not match confirmation snapshot')
  }
  if (plannedDate !== snapshot.plannedDate) {
    throw new Error('confirmed study task action plannedDate does not match confirmation snapshot')
  }

  return {
    kind: 'create_study_task',
    operationId,
    mode,
    generation,
    confirmationContextSignature,
    expectedCurrentDate,
    plannedDate,
    draft: validateDraft(action.draft),
  }
}

export function createConfirmedStudyTaskAction({
  operationId,
  confirmationSnapshot,
  draft,
}: {
  operationId: string
  confirmationSnapshot: StudyTaskActionConfirmationSnapshot
  draft: unknown
}): ConfirmedStudyTaskAction {
  const snapshot = validateSnapshot(confirmationSnapshot)
  return validateConfirmedStudyTaskAction({
    kind: 'create_study_task',
    operationId,
    mode: snapshot.mode,
    generation: snapshot.generation,
    confirmationContextSignature: snapshot.confirmationContextSignature,
    expectedCurrentDate: snapshot.expectedCurrentDate,
    plannedDate: snapshot.plannedDate,
    draft,
  }, snapshot)
}

export function buildConfirmedStudyTaskPayload(action: ConfirmedStudyTaskAction): NewStudyTask {
  return {
    title: action.draft.title,
    description: action.draft.description,
    type: action.draft.type,
    subject_id: action.draft.subject_id,
    related_mistake_id: action.draft.related_mistake_id,
    related_entry_id: action.draft.related_entry_id,
    related_chapter_id: action.draft.related_chapter_id ?? null,
    planned_date: action.plannedDate,
    estimate_minutes: action.draft.estimate_minutes,
    status: 'todo',
    source: 'ai',
  }
}

export function buildIdempotentAIStudyTaskCreateRequest(
  action: ConfirmedStudyTaskAction,
): IdempotentAIStudyTaskCreateRequest {
  return {
    operationId: action.operationId,
    operationKind: action.mode,
    actionContractVersion: action.generation.versions.actionContractVersion,
    expectedCurrentDate: action.expectedCurrentDate,
    payload: buildConfirmedStudyTaskPayload(action),
  }
}

function getResultOperationId(value: unknown): string {
  if (!isRecord(value) || typeof value.operationId !== 'string') return ''
  return value.operationId
}

function isExactResponseShape(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(record)
  return ownKeys.length === keys.length
    && ownKeys.every(key => typeof key === 'string' && keys.includes(key))
    && keys.every(key => Object.prototype.hasOwnProperty.call(record, key))
}

function isNullablePositiveSafeInteger(value: unknown): value is number | null {
  return value === null
    || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
}

function isValidStudyTaskResponse(value: unknown): value is StudyTask {
  if (!isRecord(value) || !isExactResponseShape(value, STUDY_TASK_RESPONSE_KEYS)) return false
  let plannedDateIsValid = false
  try {
    plannedDateIsValid = requireValidLocalDateKey(value.planned_date, 'response task planned_date')
      === value.planned_date
  } catch {
    return false
  }
  return typeof value.id === 'number'
    && Number.isSafeInteger(value.id)
    && value.id > 0
    && typeof value.title === 'string'
    && value.title.length > 0
    && typeof value.description === 'string'
    && typeof value.type === 'string'
    && STUDY_TASK_TYPES.includes(value.type as StudyTaskType)
    && isNullablePositiveSafeInteger(value.subject_id)
    && isNullablePositiveSafeInteger(value.related_mistake_id)
    && isNullablePositiveSafeInteger(value.related_entry_id)
    && isNullablePositiveSafeInteger(value.related_chapter_id)
    && plannedDateIsValid
    && typeof value.estimate_minutes === 'number'
    && Number.isSafeInteger(value.estimate_minutes)
    && value.estimate_minutes > 0
    && typeof value.status === 'string'
    && STUDY_TASK_STATUSES.includes(value.status as typeof STUDY_TASK_STATUSES[number])
    && typeof value.source === 'string'
    && STUDY_TASK_SOURCES.includes(value.source as typeof STUDY_TASK_SOURCES[number])
    && typeof value.created_at === 'string'
    && value.created_at.length > 0
    && typeof value.updated_at === 'string'
    && value.updated_at.length > 0
}

function isValidIdempotentResponse(
  value: unknown,
  expectedOperationId: string,
): value is IdempotentAIStudyTaskCreateResponse {
  if (!isRecord(value) || value.operationId !== expectedOperationId) return false
  if (value.ok === true) {
    return isExactResponseShape(value, ['ok', 'operationId', 'task', 'replayed'])
      && value.replayed !== undefined
      && typeof value.replayed === 'boolean'
      && isValidStudyTaskResponse(value.task)
  }
  return value.ok === false
    && isExactResponseShape(value, ['ok', 'operationId', 'code', 'message'])
    && typeof value.code === 'string'
    && IDEMPOTENT_ERROR_CODES.includes(value.code as IdempotentAIStudyTaskCreateErrorCode)
    && typeof value.message === 'string'
    && value.message.length > 0
    && value.message.length <= 500
}

export async function executeIdempotentAIStudyTaskCreateRequest(
  request: IdempotentAIStudyTaskCreateRequest,
  tasksAPI: Pick<TasksContextAPI, 'createIdempotentAIStudyTaskForCurrentDate'>,
  planningCandidateId?: number,
): Promise<StudyTaskActionExecutionResult> {
  try {
    const response = planningCandidateId === undefined
      ? await tasksAPI.createIdempotentAIStudyTaskForCurrentDate(request)
      : await tasksAPI.createIdempotentAIStudyTaskForCurrentDate(request, planningCandidateId)
    if (!isValidIdempotentResponse(response, request.operationId)) {
      return {
        operationId: request.operationId,
        status: 'uncertain',
        error: UNCERTAIN_RESULT_MESSAGE,
      }
    }
    if (response.ok) {
      return {
        operationId: response.operationId,
        status: 'succeeded',
        task: response.task,
        replayed: response.replayed,
      }
    }
    return {
      operationId: response.operationId,
      status: 'failed',
      code: response.code,
      error: response.message,
    }
  } catch {
    return {
      operationId: request.operationId,
      status: 'uncertain',
      error: UNCERTAIN_RESULT_MESSAGE,
    }
  }
}

export async function executeConfirmedStudyTaskAction(
  action: ConfirmedStudyTaskAction,
  confirmationSnapshot: StudyTaskActionConfirmationSnapshot,
  tasksAPI: Pick<TasksContextAPI, 'createIdempotentAIStudyTaskForCurrentDate'>,
  planningCandidateId?: number,
): Promise<StudyTaskActionExecutionResult> {
  let validatedAction: ConfirmedStudyTaskAction
  try {
    validatedAction = validateConfirmedStudyTaskAction(action, confirmationSnapshot)
  } catch (error) {
    return {
      operationId: getResultOperationId(action),
      status: 'failed',
      code: 'INVALID_REQUEST',
      error: error instanceof Error ? error.message : String(error),
    }
  }
  return executeIdempotentAIStudyTaskCreateRequest(
    buildIdempotentAIStudyTaskCreateRequest(validatedAction),
    tasksAPI,
    planningCandidateId,
  )
}
