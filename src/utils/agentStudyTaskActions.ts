import type { NewStudyTask, StudyTask, StudyTaskType } from '../types'
import type { TasksContextAPI } from '../types/api'
import {
  validateAIStudyTaskGenerationProvenance,
  type AIStudyTaskGenerationProvenance,
  type AIStudyTaskOperationKind,
} from './aiOperationContracts'
import { getLocalDateKey, getNextLocalDateKey, isDateKey } from './dateKey'

const STUDY_TASK_TYPES: readonly StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']
const ACTION_KEYS = [
  'kind',
  'actionId',
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

const TITLE_MAX_LENGTH = 80
const DESCRIPTION_MAX_LENGTH = 240
const ESTIMATE_MINUTES_MIN = 5
const ESTIMATE_MINUTES_MAX = 180

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
  actionId: string
  mode: StudyTaskActionMode
  generation: AIStudyTaskGenerationProvenance
  confirmationContextSignature: string
  expectedCurrentDate: string
  plannedDate: string
  draft: ConfirmedStudyTaskDraft
}

export type StudyTaskActionExecutionResult =
  | {
      actionId: string
      status: 'succeeded'
      task: StudyTask
    }
  | {
      actionId: string
      status: 'failed'
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
  const actionId = requireNonEmptyString(action.actionId, 'confirmed study task action actionId')
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
    actionId,
    mode,
    generation,
    confirmationContextSignature,
    expectedCurrentDate,
    plannedDate,
    draft: validateDraft(action.draft),
  }
}

export function createConfirmedStudyTaskAction({
  actionId,
  confirmationSnapshot,
  draft,
}: {
  actionId: string
  confirmationSnapshot: StudyTaskActionConfirmationSnapshot
  draft: unknown
}): ConfirmedStudyTaskAction {
  const snapshot = validateSnapshot(confirmationSnapshot)
  return validateConfirmedStudyTaskAction({
    kind: 'create_study_task',
    actionId,
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

export async function executeConfirmedStudyTaskAction(
  action: ConfirmedStudyTaskAction,
  confirmationSnapshot: StudyTaskActionConfirmationSnapshot,
  tasksAPI: Pick<TasksContextAPI, 'createForCurrentDate'>,
): Promise<StudyTaskActionExecutionResult> {
  try {
    const validatedAction = validateConfirmedStudyTaskAction(action, confirmationSnapshot)
    const task = await tasksAPI.createForCurrentDate(
      buildConfirmedStudyTaskPayload(validatedAction),
      validatedAction.expectedCurrentDate,
    )
    return { actionId: validatedAction.actionId, status: 'succeeded', task }
  } catch (error) {
    return {
      actionId: action.actionId,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
