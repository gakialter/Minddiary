import { validateConfirmedStudyTaskOperationId } from './agentStudyTaskActions'
import type { StudyTask } from '../types'
import type { IdempotentAIStudyTaskCreateErrorCode } from '../types/api'
import { getLocalDateKey, isDateKey } from './dateKey'

export const PLANNING_SESSION_MAX_CANDIDATES = 6
export const PLANNING_CANDIDATE_TITLE_MAX_CHARS = 80
export const PLANNING_CANDIDATE_DESCRIPTION_MAX_CHARS = 240

export const PROVIDER_USAGE_DISCLAIMER = '这里显示的是本地应用是否把相应类别加入请求，无法证明模型内部是否实际使用了某项内容。'

export type ContextRequestDisposition =
  | 'included'
  | 'included_empty'
  | 'partially_included'
  | 'excluded'

export type ContextReasonCode =
  | 'included_required'
  | 'included_available'
  | 'included_empty'
  | 'limit_applied'
  | 'no_record'
  | 'source_unavailable'
  | 'not_integrated'
  | 'preparation_failed'

export type ContextPreparationState =
  | 'prepared'
  | 'prepared_empty'
  | 'source_unavailable'
  | 'not_integrated'
  | 'preparation_failed'

export interface PlanningContextDecision {
  category: string
  label: string
  preparation: ContextPreparationState
  disposition: ContextRequestDisposition
  reasonCode: ContextReasonCode
  preparedCount: number
  includedCount: number
  limit?: number
}

export const CONTEXT_PREPARATION_LABELS: Readonly<Record<ContextPreparationState, string>> = Object.freeze({
  prepared: '本地已准备',
  prepared_empty: '没有相应记录',
  source_unavailable: '来源暂不可用',
  not_integrated: '尚未接入',
  preparation_failed: '本地准备失败',
})

export const CONTEXT_DISPOSITION_LABELS: Readonly<Record<ContextRequestDisposition, string>> = Object.freeze({
  included: '已加入本次请求',
  included_empty: '以空记录加入本次请求',
  partially_included: '部分加入本次请求',
  excluded: '未加入本次请求',
})

export const CONTEXT_REASON_LABELS: Readonly<Record<ContextReasonCode, string>> = Object.freeze({
  included_required: '规划所需的基础信息',
  included_available: '本地来源可用并已加入',
  included_empty: '请求保留了该类别，但没有相应记录',
  limit_applied: '已应用本地请求数量上限',
  no_record: '本地没有相应记录',
  source_unavailable: '本地来源暂不可用',
  not_integrated: '当前版本尚未接入该来源',
  preparation_failed: '本地准备该来源时失败',
})

export type CandidateDecision =
  | 'generated'
  | 'retained_selected'
  | 'retained_unselected'
  | 'removed'
  | 'confirmed'

export type CandidateAdmissionOrigin =
  | 'provider_validated'
  | 'provider_suggested_user_repaired'

export const CANDIDATE_ADMISSION_ORIGIN_LABELS: Readonly<Record<CandidateAdmissionOrigin, string>> = Object.freeze({
  provider_validated: '模型候选：本地验证通过',
  provider_suggested_user_repaired: '模型候选：用户修复后通过本地验证',
})

export type PlanningCandidateChangedField =
  | 'title'
  | 'description'
  | 'type'
  | 'estimateMinutes'
  | 'priority'
  | 'subjectId'
  | 'relatedMistakeId'
  | 'relatedEntryId'

export interface PlanningCandidateSnapshotInput {
  title: unknown
  description: unknown
  type: unknown
  estimateMinutes: unknown
  priority: unknown
  subjectId: unknown
  relatedMistakeId: unknown
  relatedEntryId?: unknown
}

export interface PlanningCandidateSnapshot {
  title: string
  description: string
  type: string
  estimateMinutes: number
  priority: string
  subjectId: number | null
  relatedMistakeId: number | null
  relatedEntryId: number | null
}

export type PlanningConfirmedActionOutcomeKind =
  | 'created'
  | 'replayed'
  | 'uncertain'
  | 'conflict'
  | 'deleted'
  | 'integrity_error'
  | 'date_mismatch'
  | 'validation_error'

export interface PlanningConfirmedActionOutcome {
  kind: PlanningConfirmedActionOutcomeKind
  operationId: string | null
  message: string
  taskId?: number
}

export type PlanningStudyTaskActionExecutionObservation =
  | {
      status: 'succeeded'
      operationId: string
      task: StudyTask
      replayed: boolean
      outcome: PlanningConfirmedActionOutcome
    }
  | {
      status: 'failed'
      operationId: string
      code: IdempotentAIStudyTaskCreateErrorCode
      outcome: PlanningConfirmedActionOutcome
    }
  | {
      status: 'uncertain'
      operationId: string | null
      outcome: PlanningConfirmedActionOutcome
    }

export interface PlanningCandidateRecord {
  candidateId: string
  clientId: string
  admissionOrigin: CandidateAdmissionOrigin
  initial: PlanningCandidateSnapshot
  current: PlanningCandidateSnapshot
  changedFields: PlanningCandidateChangedField[]
  decision: CandidateDecision
  selected: boolean
  operationId: string | null
  outcome: PlanningConfirmedActionOutcome | null
}

export interface PlanningSessionExplainability {
  generationId: string
  contextDecisions: PlanningContextDecision[]
  candidates: PlanningCandidateRecord[]
}

const SNAPSHOT_FIELDS_RECORD: Readonly<Record<PlanningCandidateChangedField, true>> = {
  title: true,
  description: true,
  type: true,
  estimateMinutes: true,
  priority: true,
  subjectId: true,
  relatedMistakeId: true,
  relatedEntryId: true,
}
const SNAPSHOT_FIELDS = Object.keys(SNAPSHOT_FIELDS_RECORD) as PlanningCandidateChangedField[]

const OUTCOME_MESSAGES: Readonly<Record<PlanningConfirmedActionOutcomeKind, string>> = Object.freeze({
  created: '已创建任务',
  replayed: '原操作此前已完成，本次未重复创建',
  uncertain: '结果尚无法确认，需要用户手动检查',
  conflict: '该操作 ID 已对应另一份确认内容，本次未新建任务',
  deleted: '原操作曾成功关联任务，但该任务后来已删除；本次检查没有新建任务。',
  integrity_error: '完整性检查未通过，本次操作已安全终止',
  date_mismatch: '确认日期已失效，本次未创建任务',
  validation_error: '确认内容未通过校验，本次未创建任务',
})

const STUDY_TASK_RESULT_KEYS = [
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
const SUCCEEDED_RESULT_KEYS = ['operationId', 'status', 'task', 'replayed'] as const
const FAILED_RESULT_KEYS = ['operationId', 'status', 'code', 'error'] as const
const UNCERTAIN_RESULT_KEYS = ['operationId', 'status', 'error'] as const
const STUDY_TASK_TYPES = ['review', 'focus', 'diary', 'mistake', 'custom'] as const
const STUDY_TASK_STATUSES = ['todo', 'doing', 'done', 'skipped'] as const
const STUDY_TASK_SOURCES = ['manual', 'dashboard', 'ai', 'pomodoro'] as const
const STUDY_TASK_FAILURE_CODES = [
  'INVALID_REQUEST',
  'DATE_MISMATCH',
  'IDEMPOTENCY_CONFLICT',
  'RESULT_DELETED',
  'INTEGRITY_ERROR',
] as const

const NORMALIZATION_SAFETY_FACTOR = 4

function normalizeBoundedText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return ''
  const bounded = value.length > maxChars * NORMALIZATION_SAFETY_FACTOR
    ? value.slice(0, maxChars * NORMALIZATION_SAFETY_FACTOR)
    : value
  return bounded
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u00AD\u2060\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
}

function normalizeShortToken(value: unknown): string {
  return normalizeBoundedText(value, 32)
}

function normalizeNullableId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function normalizeEstimateMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-10_000, Math.min(10_000, Math.round(value)))
    : 0
}

function requireBoundedIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value)
  ) {
    throw new Error(`${label} must be a bounded identifier`)
  }
  return value
}

type OwnDataSnapshot = Readonly<Record<string, unknown>>

type ValidatedStudyTaskActionResult =
  | {
      status: 'succeeded'
      operationId: string
      task: StudyTask
      replayed: boolean
    }
  | {
      status: 'failed'
      operationId: string
      code: typeof STUDY_TASK_FAILURE_CODES[number]
    }
  | {
      status: 'uncertain'
      operationId: string
    }

type SnapshotResult<T> =
  | { ok: true; value: T }
  | { ok: false }

function snapshotOwnDataProperties(value: unknown): OwnDataSnapshot | null {
  if (value === null || typeof value !== 'object') return null
  try {
    if (Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return null
      const descriptor = descriptors[key]
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null
      snapshot[key] = descriptor.value
    }
    return Object.freeze(snapshot)
  } catch {
    return null
  }
}

function hasExactSnapshotKeys(snapshot: OwnDataSnapshot, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(snapshot)
  return ownKeys.length === keys.length
    && ownKeys.every(key => typeof key === 'string' && keys.includes(key))
}

function isNullablePositiveSafeInteger(value: unknown): value is number | null {
  return value === null
    || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
}

function isValidLocalDateKey(value: unknown): value is string {
  if (!isDateKey(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const localDate = new Date(year!, month! - 1, day!, 12)
  return !Number.isNaN(localDate.getTime()) && getLocalDateKey(localDate) === value
}

function isSafeExecutionError(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 500
}

function snapshotStudyTask(value: unknown): StudyTask | null {
  const task = snapshotOwnDataProperties(value)
  if (task === null || !hasExactSnapshotKeys(task, STUDY_TASK_RESULT_KEYS)) return null
  if (
    typeof task.id !== 'number'
    || !Number.isSafeInteger(task.id)
    || task.id <= 0
    || typeof task.title !== 'string'
    || task.title.length === 0
    || typeof task.description !== 'string'
    || typeof task.type !== 'string'
    || !STUDY_TASK_TYPES.includes(task.type as typeof STUDY_TASK_TYPES[number])
    || !isNullablePositiveSafeInteger(task.subject_id)
    || !isNullablePositiveSafeInteger(task.related_mistake_id)
    || !isNullablePositiveSafeInteger(task.related_entry_id)
    || !isNullablePositiveSafeInteger(task.related_chapter_id)
    || !isValidLocalDateKey(task.planned_date)
    || typeof task.estimate_minutes !== 'number'
    || !Number.isSafeInteger(task.estimate_minutes)
    || task.estimate_minutes <= 0
    || typeof task.status !== 'string'
    || !STUDY_TASK_STATUSES.includes(task.status as typeof STUDY_TASK_STATUSES[number])
    || typeof task.source !== 'string'
    || !STUDY_TASK_SOURCES.includes(task.source as typeof STUDY_TASK_SOURCES[number])
    || typeof task.created_at !== 'string'
    || task.created_at.length === 0
    || typeof task.updated_at !== 'string'
    || task.updated_at.length === 0
  ) return null
  return Object.freeze({
    id: task.id,
    title: task.title,
    description: task.description,
    type: task.type,
    subject_id: task.subject_id,
    related_mistake_id: task.related_mistake_id,
    related_entry_id: task.related_entry_id,
    related_chapter_id: task.related_chapter_id,
    planned_date: task.planned_date,
    estimate_minutes: task.estimate_minutes,
    status: task.status,
    source: task.source,
    created_at: task.created_at,
    updated_at: task.updated_at,
  }) as StudyTask
}

function snapshotStudyTaskActionExecutionResult(
  input: unknown,
  expectedOperationId: string,
): SnapshotResult<ValidatedStudyTaskActionResult> {
  const result = snapshotOwnDataProperties(input)
  if (result === null || result.operationId !== expectedOperationId) return { ok: false }

  if (result.status === 'succeeded') {
    if (
      !hasExactSnapshotKeys(result, SUCCEEDED_RESULT_KEYS)
      || typeof result.replayed !== 'boolean'
    ) return { ok: false }
    const task = snapshotStudyTask(result.task)
    if (task === null) return { ok: false }
    return {
      ok: true,
      value: {
        status: 'succeeded',
        operationId: expectedOperationId,
        task,
        replayed: result.replayed,
      },
    }
  }

  if (result.status === 'failed') {
    if (
      !hasExactSnapshotKeys(result, FAILED_RESULT_KEYS)
      || typeof result.code !== 'string'
      || !STUDY_TASK_FAILURE_CODES.includes(result.code as typeof STUDY_TASK_FAILURE_CODES[number])
      || !isSafeExecutionError(result.error)
    ) return { ok: false }
    return {
      ok: true,
      value: {
        status: 'failed',
        operationId: expectedOperationId,
        code: result.code as typeof STUDY_TASK_FAILURE_CODES[number],
      },
    }
  }

  if (
    result.status === 'uncertain'
    && hasExactSnapshotKeys(result, UNCERTAIN_RESULT_KEYS)
    && isSafeExecutionError(result.error)
  ) {
    return {
      ok: true,
      value: { status: 'uncertain', operationId: expectedOperationId },
    }
  }
  return { ok: false }
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

const VALID_PREPARATIONS = Object.keys(CONTEXT_PREPARATION_LABELS) as ContextPreparationState[]
const VALID_DISPOSITIONS = Object.keys(CONTEXT_DISPOSITION_LABELS) as ContextRequestDisposition[]
const VALID_REASON_CODES = Object.keys(CONTEXT_REASON_LABELS) as ContextReasonCode[]

function cloneContextDecision(decision: PlanningContextDecision): PlanningContextDecision {
  const preparedCount = normalizeCount(decision.preparedCount)
  const includedCount = Math.min(preparedCount, normalizeCount(decision.includedCount))
  const limit = normalizeCount(decision.limit)
  const preparation = VALID_PREPARATIONS.includes(decision.preparation)
    ? decision.preparation
    : 'preparation_failed'
  const disposition = VALID_DISPOSITIONS.includes(decision.disposition)
    ? decision.disposition
    : 'excluded'
  const reasonCode = VALID_REASON_CODES.includes(decision.reasonCode)
    ? decision.reasonCode
    : 'preparation_failed'
  return {
    category: normalizeBoundedText(decision.category, 48),
    label: normalizeBoundedText(decision.label, 48),
    preparation,
    disposition,
    reasonCode,
    preparedCount,
    includedCount,
    ...(limit > 0 ? { limit } : {}),
  }
}

export function buildPlanningCandidateSnapshot(
  input: PlanningCandidateSnapshotInput,
): PlanningCandidateSnapshot {
  return {
    title: normalizeBoundedText(input.title, PLANNING_CANDIDATE_TITLE_MAX_CHARS),
    description: normalizeBoundedText(input.description, PLANNING_CANDIDATE_DESCRIPTION_MAX_CHARS),
    type: normalizeShortToken(input.type),
    estimateMinutes: normalizeEstimateMinutes(input.estimateMinutes),
    priority: normalizeShortToken(input.priority),
    subjectId: normalizeNullableId(input.subjectId),
    relatedMistakeId: normalizeNullableId(input.relatedMistakeId),
    relatedEntryId: normalizeNullableId(input.relatedEntryId),
  }
}

export function qualifyPlanningCandidateId(generationId: string, clientId: string): string {
  return `${requireBoundedIdentifier(generationId, 'generationId')}:${requireBoundedIdentifier(clientId, 'clientId')}`
}

export function getPlanningCandidateChangedFields(
  initial: PlanningCandidateSnapshot,
  current: PlanningCandidateSnapshot,
): PlanningCandidateChangedField[] {
  return SNAPSHOT_FIELDS.filter(field => initial[field] !== current[field])
}

export function createPlanningCandidateRecord({
  generationId,
  clientId,
  snapshot,
  selected,
  admissionOrigin = 'provider_validated',
}: {
  generationId: string
  clientId: string
  snapshot: PlanningCandidateSnapshotInput
  selected: boolean
  admissionOrigin?: CandidateAdmissionOrigin
}): PlanningCandidateRecord {
  const boundedClientId = requireBoundedIdentifier(clientId, 'clientId')
  const initial = buildPlanningCandidateSnapshot(snapshot)
  return {
    candidateId: qualifyPlanningCandidateId(generationId, boundedClientId),
    clientId: boundedClientId,
    admissionOrigin,
    initial,
    current: initial,
    changedFields: [],
    decision: 'generated',
    selected,
    operationId: null,
    outcome: null,
  }
}

export function updatePlanningCandidateRecord(
  record: PlanningCandidateRecord,
  snapshot: PlanningCandidateSnapshotInput,
  selected: boolean,
): PlanningCandidateRecord {
  if (record.decision === 'removed') return record
  const current = buildPlanningCandidateSnapshot(snapshot)
  const changedFields = getPlanningCandidateChangedFields(record.initial, current)
  if (record.decision === 'confirmed') {
    return { ...record, current, changedFields, selected }
  }
  if (
    record.decision === 'generated'
    && record.selected === selected
    && changedFields.length === 0
  ) return record
  return {
    ...record,
    current,
    changedFields,
    decision: selected ? 'retained_selected' : 'retained_unselected',
    selected,
  }
}

export function removePlanningCandidateRecord(record: PlanningCandidateRecord): PlanningCandidateRecord {
  return {
    ...record,
    decision: 'removed',
    selected: false,
  }
}

export function confirmPlanningCandidateRecord(
  record: PlanningCandidateRecord,
  operationId: string,
): PlanningCandidateRecord {
  return {
    ...record,
    decision: 'confirmed',
    selected: false,
    operationId: validateConfirmedStudyTaskOperationId(operationId),
    outcome: null,
  }
}

export function mapStudyTaskActionExecutionResult(
  result: unknown,
  expectedOperationId: string,
): PlanningConfirmedActionOutcome {
  return observeStudyTaskActionExecutionResult(result, expectedOperationId).outcome
}

export function observeStudyTaskActionExecutionResult(
  result: unknown,
  expectedOperationId: string,
): PlanningStudyTaskActionExecutionObservation {
  let expected: string | null = null
  try {
    expected = validateConfirmedStudyTaskOperationId(expectedOperationId)
  } catch {
  }
  const uncertain = (): PlanningStudyTaskActionExecutionObservation => {
    const outcome: PlanningConfirmedActionOutcome = Object.freeze({
      kind: 'uncertain',
      operationId: expected,
      message: OUTCOME_MESSAGES.uncertain,
    })
    return Object.freeze({ status: 'uncertain', operationId: expected, outcome })
  }
  if (expected === null) return uncertain()

  const snapshot = snapshotStudyTaskActionExecutionResult(result, expected)
  if (!snapshot.ok || snapshot.value.status === 'uncertain') return uncertain()
  if (snapshot.value.status === 'succeeded') {
    const kind: PlanningConfirmedActionOutcomeKind = snapshot.value.replayed ? 'replayed' : 'created'
    const outcome: PlanningConfirmedActionOutcome = Object.freeze({
      kind,
      operationId: snapshot.value.operationId,
      message: OUTCOME_MESSAGES[kind],
      taskId: snapshot.value.task.id,
    })
    return Object.freeze({
      status: 'succeeded',
      operationId: snapshot.value.operationId,
      task: snapshot.value.task,
      replayed: snapshot.value.replayed,
      outcome,
    })
  }

  const kind = snapshot.value.code === 'IDEMPOTENCY_CONFLICT'
    ? 'conflict'
    : snapshot.value.code === 'RESULT_DELETED'
      ? 'deleted'
      : snapshot.value.code === 'INTEGRITY_ERROR'
        ? 'integrity_error'
        : snapshot.value.code === 'DATE_MISMATCH'
          ? 'date_mismatch'
          : 'validation_error'
  const outcome: PlanningConfirmedActionOutcome = Object.freeze({
    kind,
    operationId: snapshot.value.operationId,
    message: OUTCOME_MESSAGES[kind],
  })
  return Object.freeze({
    status: 'failed',
    operationId: snapshot.value.operationId,
    code: snapshot.value.code,
    outcome,
  })
}

export function applyPlanningCandidateObservedOutcome(
  record: PlanningCandidateRecord,
  observation: PlanningStudyTaskActionExecutionObservation,
  attemptOperationId: string,
): PlanningCandidateRecord {
  if (
    record.operationId === null
    || record.operationId !== attemptOperationId
    || observation.operationId !== attemptOperationId
  ) return record
  return {
    ...record,
    decision: 'confirmed',
    selected: false,
    operationId: observation.outcome.operationId,
    outcome: observation.outcome,
  }
}

export function applyPlanningCandidateOutcome(
  record: PlanningCandidateRecord,
  result: unknown,
  attemptOperationId: string,
): PlanningCandidateRecord {
  if (record.operationId === null || record.operationId !== attemptOperationId) return record
  return applyPlanningCandidateObservedOutcome(
    record,
    observeStudyTaskActionExecutionResult(result, attemptOperationId),
    attemptOperationId,
  )
}

export function createPlanningSessionExplainability({
  generationId,
  contextDecisions,
  candidates,
}: {
  generationId: string
  contextDecisions: readonly PlanningContextDecision[]
  candidates: readonly {
    clientId: string
    snapshot: PlanningCandidateSnapshotInput
    selected: boolean
  }[]
}): PlanningSessionExplainability {
  const boundedGenerationId = requireBoundedIdentifier(generationId, 'generationId')
  return {
    generationId: boundedGenerationId,
    contextDecisions: contextDecisions.slice(0, 12).map(cloneContextDecision),
    candidates: candidates.slice(0, PLANNING_SESSION_MAX_CANDIDATES).map(candidate => (
      createPlanningCandidateRecord({
        generationId: boundedGenerationId,
        admissionOrigin: 'provider_validated',
        ...candidate,
      })
    )),
  }
}

export function updatePlanningSessionCandidate(
  session: PlanningSessionExplainability,
  clientId: string,
  update: (record: PlanningCandidateRecord) => PlanningCandidateRecord,
): PlanningSessionExplainability {
  return {
    ...session,
    candidates: session.candidates.map(candidate => (
      candidate.clientId === clientId ? update(candidate) : candidate
    )),
  }
}

export function addPlanningSessionCandidate(
  session: PlanningSessionExplainability,
  candidate: {
    clientId: string
    snapshot: PlanningCandidateSnapshotInput
    selected: boolean
  },
): PlanningSessionExplainability {
  if (
    session.candidates.length >= PLANNING_SESSION_MAX_CANDIDATES
    || session.candidates.some(record => record.clientId === candidate.clientId)
  ) return session
  return {
    ...session,
    candidates: [
      ...session.candidates,
      createPlanningCandidateRecord({
        generationId: session.generationId,
        admissionOrigin: 'provider_suggested_user_repaired',
        ...candidate,
      }),
    ],
  }
}

export function resetPlanningSessionExplainability(): null {
  return null
}
