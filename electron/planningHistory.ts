import type Database from 'better-sqlite3'
import type {
    PlanningCandidateAdmissionOrigin,
    PlanningCandidateDisposition,
    PlanningCandidateOutcomeKind,
    PlanningCandidatePriority,
    PlanningCandidateSnapshot,
    PlanningContextDisposition,
    PlanningContextPreparation,
    PlanningContextReasonCode,
    PlanningContextSummaryItem,
    PlanningEntryPoint,
    PlanningExecutionAttribution,
    PlanningFocusAttribution,
    PlanningGenerationResultKind,
    PlanningRunCandidateCreateInput,
    PlanningRunCandidateRecord,
    PlanningRunCreateRequest,
    PlanningRunListResult,
    PlanningRunRecord,
    PlanningRunCloseReason,
    PlanningRunTransitionRequest,
    PlanningSemanticDrift,
    PlanningSourceRelation,
} from '../src/types/planningHistory'
import type { StudyTaskStatus, StudyTaskType } from '../src/types'
import type { IdempotentAIStudyTaskCreateRequest } from '../src/types/api'
import {
    buildIdempotentAIStudyTaskRequestDigest,
    IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION,
    validateIdempotentAIStudyTaskCreateRequest,
} from './idempotentStudyTaskCreation'

export const PLANNING_HISTORY_CONTRACT_VERSION = 'planning-history.v1'
export const PLANNING_HISTORY_RETENTION_DAYS = 30
export const PLANNING_HISTORY_MAX_RUNS = 100
export const PLANNING_HISTORY_CONTEXT_MAX_UTF8_BYTES = 4096
export const PLANNING_HISTORY_EDIT_MAX_UTF8_BYTES = 4096
export const PLANNING_HISTORY_TITLE_MAX_UTF8_BYTES = 240
export const PLANNING_HISTORY_DESCRIPTION_MAX_UTF8_BYTES = 720

const RUN_CREATE_KEYS = [
    'id',
    'entryPoint',
    'planningDate',
    'targetDate',
    'generationResultKind',
    'contextSummary',
    'candidates',
] as const
const CONTEXT_KEYS = ['category', 'preparation', 'disposition', 'reasonCode'] as const
const CANDIDATE_CREATE_KEYS = [
    'ordinal',
    'admissionOrigin',
    'title',
    'description',
    'type',
    'estimateMinutes',
    'priority',
    'subjectId',
    'relatedMistakeId',
    'relatedEntryId',
    'userDisposition',
] as const
const SNAPSHOT_KEYS = [
    'title',
    'description',
    'type',
    'estimateMinutes',
    'priority',
    'subjectId',
    'relatedMistakeId',
    'relatedEntryId',
] as const
const REPAIRED_CANDIDATE_KEYS = ['ordinal', ...SNAPSHOT_KEYS, 'userDisposition'] as const
const TRANSITION_KINDS = [
    'admit_repaired_candidate',
    'commit_candidate',
    'set_selection',
    'remove_candidate',
    'close_run',
] as const
const OUTCOME_KINDS = [
    'created',
    'replayed',
    'uncertain',
    'conflict',
    'deleted',
    'integrity_error',
    'date_mismatch',
    'validation_error',
] as const
const EDIT_FIELD_MAPPINGS = [
    ['title', 'title'],
    ['description', 'description'],
    ['type', 'type'],
    ['estimateMinutes', 'estimate_minutes'],
    ['priority', 'priority'],
    ['subjectId', 'subject_id'],
    ['relatedMistakeId', 'related_mistake_id'],
    ['relatedEntryId', 'related_entry_id'],
] as const

const LOWERCASE_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const STUDY_TASK_TYPES: readonly StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']
const PRIORITIES: readonly PlanningCandidatePriority[] = ['high', 'medium', 'low']
const ADMISSION_ORIGINS: readonly PlanningCandidateAdmissionOrigin[] = [
    'provider_validated',
    'provider_suggested_user_repaired',
]
const CREATE_DISPOSITIONS: readonly Exclude<PlanningCandidateDisposition, 'confirmed'>[] = [
    'selected_unconfirmed',
    'unselected',
]

const TODAY_CONTEXT_CATEGORIES = [
    'available_minutes',
    'today_tasks',
    'due_mistakes',
    'subjects',
    'today_entry',
    'chapters',
    'focus_history',
] as const
const DAILY_CONTEXT_CATEGORIES = [
    'today_tasks',
    'candidate_date_tasks',
    'pomodoro',
    'subjects',
    'today_entry',
    'due_mistakes',
    'available_minutes',
] as const

const VALID_CONTEXT_TUPLES = new Set([
    'prepared|included|included_required',
    'prepared|included|included_available',
    'prepared_empty|included_empty|included_empty',
    'prepared_empty|included_empty|no_record',
    'prepared|partially_included|limit_applied',
    'source_unavailable|included|source_unavailable',
    'source_unavailable|excluded|source_unavailable',
    'not_integrated|excluded|not_integrated',
    'preparation_failed|excluded|preparation_failed',
])

const PREPARATIONS: readonly PlanningContextPreparation[] = [
    'prepared',
    'prepared_empty',
    'source_unavailable',
    'not_integrated',
    'preparation_failed',
]
const DISPOSITIONS: readonly PlanningContextDisposition[] = [
    'included',
    'included_empty',
    'partially_included',
    'excluded',
]
const REASON_CODES: readonly PlanningContextReasonCode[] = [
    'included_required',
    'included_available',
    'included_empty',
    'limit_applied',
    'no_record',
    'source_unavailable',
    'not_integrated',
    'preparation_failed',
]

type PlanningHistoryStoreDependencies = {
    database: Database.Database
    now?: () => Date
    onCreatedNew?: (runId: string) => void
}

type PlanningRunRow = {
    id: unknown
    contract_version: unknown
    entry_point: unknown
    planning_date: unknown
    target_date: unknown
    generation_result_kind: unknown
    context_summary_json: unknown
    created_at: unknown
    updated_at: unknown
    closed_at: unknown
    close_reason: unknown
}

type PlanningCandidateRow = {
    id: unknown
    planning_run_id: unknown
    ordinal: unknown
    admission_origin: unknown
    title: unknown
    description: unknown
    type: unknown
    estimate_minutes: unknown
    priority: unknown
    subject_id: unknown
    related_mistake_id: unknown
    related_entry_id: unknown
    edit_before_json: unknown
    user_disposition: unknown
    operation_id: unknown
    outcome_kind: unknown
    outcome_observed_at: unknown
    admitted_at: unknown
    updated_at: unknown
}

export class PlanningHistoryValidationError extends Error {}
export class PlanningHistoryConflictError extends Error {}
export class PlanningHistoryUnavailableError extends Error {}

function requirePlainObject(value: unknown, label: string): object {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new PlanningHistoryValidationError(`${label} must be a plain object`)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
        throw new PlanningHistoryValidationError(`${label} must be a plain object`)
    }
    return value
}

function assertExactOwnDataKeys(record: object, keys: readonly string[], label: string): void {
    const ownKeys = Reflect.ownKeys(record)
    if (
        ownKeys.length !== keys.length
        || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))
        || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key))
    ) {
        throw new PlanningHistoryValidationError(`${label} must contain exactly the supported fields`)
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key)
        if (!descriptor || !('value' in descriptor)) {
            throw new PlanningHistoryValidationError(`${label}.${key} must be an own data property`)
        }
    }
}

function readOwn(record: object, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (!descriptor || !('value' in descriptor)) {
        throw new PlanningHistoryValidationError(`${key} must be an own data property`)
    }
    return descriptor.value
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new PlanningHistoryValidationError(`${label} is invalid`)
    }
    return value as T
}

function normalizeText(value: unknown, label: string, maxUnits: number, maxBytes: number): string {
    if (typeof value !== 'string') {
        throw new PlanningHistoryValidationError(`${label} must be a string`)
    }
    const normalized = value
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u00AD\u2060\uFEFF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (!normalized) {
        throw new PlanningHistoryValidationError(`${label} is required`)
    }
    if (normalized.length > maxUnits) {
        throw new PlanningHistoryValidationError(`${label} must be ${maxUnits} current units or fewer`)
    }
    if (Buffer.byteLength(normalized, 'utf8') > maxBytes) {
        throw new PlanningHistoryValidationError(`${label} exceeds its UTF-8 byte limit`)
    }
    return normalized
}

function requireNullablePositiveSafeInteger(value: unknown, label: string): number | null {
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new PlanningHistoryValidationError(`${label} must be a positive safe integer or null`)
    }
    return value
}

function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
    if (month === 2) return isLeapYear(year) ? 29 : 28
    return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function requireDateKey(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new PlanningHistoryValidationError(`${label} must be a local YYYY-MM-DD date`)
    }
    const match = DATE_KEY_PATTERN.exec(value)
    if (!match) {
        throw new PlanningHistoryValidationError(`${label} must be a local YYYY-MM-DD date`)
    }
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
        throw new PlanningHistoryValidationError(`${label} must be an actual calendar date`)
    }
    return value
}

function nextDateKey(value: string): string | null {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number]
    if (day < daysInMonth(year, month)) {
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`
    }
    if (month < 12) {
        return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`
    }
    if (year < 9999) return `${String(year + 1).padStart(4, '0')}-01-01`
    return null
}

function requireUuid(value: unknown, label: string): string {
    if (typeof value !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(value)) {
        throw new PlanningHistoryValidationError(`${label} must be a lowercase UUID v4`)
    }
    return value
}

function validateContextSummary(
    value: unknown,
    entryPoint: PlanningEntryPoint,
): { items: PlanningContextSummaryItem[]; json: string } {
    if (!Array.isArray(value) || value.length > 12) {
        throw new PlanningHistoryValidationError('request.contextSummary must contain at most 12 items')
    }
    const expectedCategories = entryPoint === 'today_action'
        ? TODAY_CONTEXT_CATEGORIES
        : DAILY_CONTEXT_CATEGORIES
    if (value.length !== expectedCategories.length) {
        throw new PlanningHistoryValidationError('request.contextSummary must contain the frozen categories')
    }
    const items = value.map((candidate, index): PlanningContextSummaryItem => {
        const record = requirePlainObject(candidate, `request.contextSummary[${index}]`)
        assertExactOwnDataKeys(record, CONTEXT_KEYS, `request.contextSummary[${index}]`)
        const category = readOwn(record, 'category')
        if (typeof category !== 'string' || category !== expectedCategories[index]) {
            throw new PlanningHistoryValidationError('request.contextSummary categories must use canonical order')
        }
        const preparation = requireEnum(
            readOwn(record, 'preparation'),
            PREPARATIONS,
            `request.contextSummary[${index}].preparation`,
        )
        const disposition = requireEnum(
            readOwn(record, 'disposition'),
            DISPOSITIONS,
            `request.contextSummary[${index}].disposition`,
        )
        const reasonCode = requireEnum(
            readOwn(record, 'reasonCode'),
            REASON_CODES,
            `request.contextSummary[${index}].reasonCode`,
        )
        if (!VALID_CONTEXT_TUPLES.has(`${preparation}|${disposition}|${reasonCode}`)) {
            throw new PlanningHistoryValidationError(`request.contextSummary[${index}] has an invalid semantic tuple`)
        }
        return { category, preparation, disposition, reasonCode }
    })
    const json = JSON.stringify(items)
    if (Buffer.byteLength(json, 'utf8') > PLANNING_HISTORY_CONTEXT_MAX_UTF8_BYTES) {
        throw new PlanningHistoryValidationError('request.contextSummary exceeds its UTF-8 byte limit')
    }
    return { items, json }
}

function validateCandidate(
    value: unknown,
    index: number,
    entryPoint: PlanningEntryPoint,
    database: Database.Database,
    planningDate: string,
    validateCurrentRelations: boolean,
): PlanningRunCandidateCreateInput {
    const label = `request.candidates[${index}]`
    const record = requirePlainObject(value, label)
    assertExactOwnDataKeys(record, CANDIDATE_CREATE_KEYS, label)
    const ordinal = readOwn(record, 'ordinal')
    if (typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 0 || ordinal > 5) {
        throw new PlanningHistoryValidationError(`${label}.ordinal must be an integer from 0 to 5`)
    }
    const snapshot = validateSnapshot(
        record,
        label,
        entryPoint,
        database,
        planningDate,
        validateCurrentRelations,
    )
    return {
        ordinal,
        admissionOrigin: requireEnum(
            readOwn(record, 'admissionOrigin'),
            ADMISSION_ORIGINS,
            `${label}.admissionOrigin`,
        ),
        ...snapshot,
        userDisposition: requireEnum(
            readOwn(record, 'userDisposition'),
            CREATE_DISPOSITIONS,
            `${label}.userDisposition`,
        ),
    }
}

function validateSnapshot(
    record: object,
    label: string,
    entryPoint: PlanningEntryPoint,
    database: Database.Database,
    planningDate: string,
    validateCurrentRelations = true,
) {
    const type = requireEnum(readOwn(record, 'type'), STUDY_TASK_TYPES, `${label}.type`)
    const estimateMinutes = readOwn(record, 'estimateMinutes')
    if (
        typeof estimateMinutes !== 'number'
        || !Number.isInteger(estimateMinutes)
        || estimateMinutes < 5
        || estimateMinutes > 180
    ) {
        throw new PlanningHistoryValidationError(`${label}.estimateMinutes must be an integer from 5 to 180`)
    }
    const subjectId = requireNullablePositiveSafeInteger(readOwn(record, 'subjectId'), `${label}.subjectId`)
    const relatedMistakeId = requireNullablePositiveSafeInteger(
        readOwn(record, 'relatedMistakeId'),
        `${label}.relatedMistakeId`,
    )
    const relatedEntryId = requireNullablePositiveSafeInteger(
        readOwn(record, 'relatedEntryId'),
        `${label}.relatedEntryId`,
    )
    if (
        validateCurrentRelations
        && subjectId !== null
        && !database.prepare('SELECT 1 FROM subjects WHERE id = ?').get(subjectId)
    ) {
        throw new PlanningHistoryValidationError(`${label}.subjectId is unavailable`)
    }
    let mistakeSubjectId: number | null = null
    if (relatedMistakeId !== null && validateCurrentRelations) {
        const mistake = database.prepare(`
            SELECT subject_id, mastered, next_review_date
            FROM mistakes
            WHERE id = ?
        `).get(relatedMistakeId) as {
            subject_id: number | null
            mastered: number
            next_review_date: string | null
        } | undefined
        if (!mistake) throw new PlanningHistoryValidationError(`${label}.relatedMistakeId is unavailable`)
        if (
            mistake.mastered !== 0
            || (mistake.next_review_date !== null && mistake.next_review_date > (
                entryPoint === 'today_action' ? planningDate : nextDateKey(planningDate)!
            ))
        ) {
            throw new PlanningHistoryValidationError(`${label}.relatedMistakeId is not due for this planning target`)
        }
        mistakeSubjectId = mistake.subject_id
    }
    if (type === 'review') {
        if (relatedMistakeId === null) {
            throw new PlanningHistoryValidationError(`${label}.relatedMistakeId is required for review candidates`)
        }
        const subjectsMatch = !validateCurrentRelations
            || (entryPoint === 'daily_review'
                ? subjectId === mistakeSubjectId
                : mistakeSubjectId === null || subjectId === mistakeSubjectId)
        if (!subjectsMatch) {
            throw new PlanningHistoryValidationError(`${label} review relation is inconsistent`)
        }
    } else if (relatedMistakeId !== null) {
        throw new PlanningHistoryValidationError(`${label}.relatedMistakeId is only allowed for review candidates`)
    }
    if (entryPoint === 'daily_review' && relatedEntryId !== null) {
        throw new PlanningHistoryValidationError(`${label}.relatedEntryId must be null for Daily Review`)
    }
    if (relatedEntryId !== null && validateCurrentRelations) {
        const entry = database.prepare('SELECT date FROM entries WHERE id = ?').get(relatedEntryId) as {
            date: unknown
        } | undefined
        if (!entry || entry.date !== planningDate) {
            throw new PlanningHistoryValidationError(`${label}.relatedEntryId is unavailable for the planning date`)
        }
    }
    return {
        title: normalizeText(
            readOwn(record, 'title'),
            `${label}.title`,
            80,
            PLANNING_HISTORY_TITLE_MAX_UTF8_BYTES,
        ),
        description: normalizeText(
            readOwn(record, 'description'),
            `${label}.description`,
            240,
            PLANNING_HISTORY_DESCRIPTION_MAX_UTF8_BYTES,
        ),
        type,
        estimateMinutes,
        priority: requireEnum(readOwn(record, 'priority'), PRIORITIES, `${label}.priority`),
        subjectId,
        relatedMistakeId,
        relatedEntryId,
    }
}

function validateCreateRequest(
    value: unknown,
    database: Database.Database,
    validateCurrentRelations = true,
): PlanningRunCreateRequest & { contextJson: string } {
    const record = requirePlainObject(value, 'request')
    assertExactOwnDataKeys(record, RUN_CREATE_KEYS, 'request')
    const id = requireUuid(readOwn(record, 'id'), 'request.id')
    const entryPoint = requireEnum(
        readOwn(record, 'entryPoint'),
        ['today_action', 'daily_review'] as const,
        'request.entryPoint',
    )
    const planningDate = requireDateKey(readOwn(record, 'planningDate'), 'request.planningDate')
    const targetDate = requireDateKey(readOwn(record, 'targetDate'), 'request.targetDate')
    const expectedTargetDate = entryPoint === 'today_action' ? planningDate : nextDateKey(planningDate)
    if (targetDate !== expectedTargetDate) {
        throw new PlanningHistoryValidationError('request.targetDate does not satisfy the entry-point date invariant')
    }
    const generationResultKind = requireEnum(
        readOwn(record, 'generationResultKind'),
        ['valid_empty', 'candidate_set'] as const,
        'request.generationResultKind',
    )
    const { items: contextSummary, json: contextJson } = validateContextSummary(
        readOwn(record, 'contextSummary'),
        entryPoint,
    )
    const rawCandidates = readOwn(record, 'candidates')
    if (!Array.isArray(rawCandidates) || rawCandidates.length > 6) {
        throw new PlanningHistoryValidationError('request.candidates must contain at most 6 candidates')
    }
    if (generationResultKind === 'valid_empty' && rawCandidates.length !== 0) {
        throw new PlanningHistoryValidationError('valid_empty runs cannot contain candidates')
    }
    const candidates = rawCandidates.map((candidate, index) => (
        validateCandidate(
            candidate,
            index,
            entryPoint,
            database,
            planningDate,
            validateCurrentRelations,
        )
    ))
    if (new Set(candidates.map(candidate => candidate.ordinal)).size !== candidates.length) {
        throw new PlanningHistoryValidationError('request.candidates ordinal values must be unique')
    }
    return {
        id,
        entryPoint,
        planningDate,
        targetDate,
        generationResultKind,
        contextSummary,
        contextJson,
        candidates,
    }
}

function getTrustedTimestamp(now: () => Date): string {
    const timestamp = now()
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
        throw new PlanningHistoryUnavailableError('Planning History clock is unavailable')
    }
    return timestamp.toISOString()
}

function readRunRow(database: Database.Database, id: string): PlanningRunRow | undefined {
    return database.prepare(`
        SELECT id, contract_version, entry_point, planning_date, target_date,
               generation_result_kind, context_summary_json, created_at, updated_at,
               closed_at, close_reason
        FROM planning_runs
        WHERE id = ?
    `).get(id) as PlanningRunRow | undefined
}

function readCandidateRows(database: Database.Database, runId: string): PlanningCandidateRow[] {
    return database.prepare(`
        SELECT id, planning_run_id, ordinal, admission_origin, title, description,
               type, estimate_minutes, priority, subject_id, related_mistake_id,
               related_entry_id, edit_before_json, user_disposition, operation_id,
               outcome_kind, outcome_observed_at, admitted_at, updated_at
        FROM planning_run_candidates
        WHERE planning_run_id = ?
        ORDER BY ordinal ASC
    `).all(runId) as PlanningCandidateRow[]
}

function readCandidatesForRunIds(database: Database.Database, runIds: string[]): PlanningCandidateRow[] {
    if (runIds.length === 0) return []
    const placeholders = runIds.map(() => '?').join(',')
    return database.prepare(`
        SELECT id, planning_run_id, ordinal, admission_origin, title, description,
               type, estimate_minutes, priority, subject_id, related_mistake_id,
               related_entry_id, edit_before_json, user_disposition, operation_id,
               outcome_kind, outcome_observed_at, admitted_at, updated_at
        FROM planning_run_candidates
        WHERE planning_run_id IN (${placeholders})
        ORDER BY planning_run_id ASC, ordinal ASC
    `).all(...runIds) as PlanningCandidateRow[]
}

function requireStoredTimestamp(value: unknown, label: string): string {
    if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new PlanningHistoryUnavailableError(`${label} is unavailable`)
    }
    return value
}

function isCanonicalStoredDateKey(value: unknown): value is string {
    try {
        return requireDateKey(value, 'stored date') === value
    } catch {
        return false
    }
}

function normalizeRelationLabel(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const normalized = value
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u00AD\u2060\uFEFF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return normalized ? normalized.slice(0, 80) : null
}

// ─── C3: Batch Query Infrastructure ─────────────────────────────────────────

type BatchRelationMap = Map<number, PlanningSourceRelation>
type BatchReceiptRow = {
    operation_id: string
    operation_kind: string
    action_contract_version: string
    request_digest: string
    expected_current_date: string
    planned_date: string
    task_id: number | null
}
type BatchTaskRow = {
    id: number
    title: string
    description: string
    type: string
    subject_id: number | null
    related_mistake_id: number | null
    related_entry_id: number | null
    related_chapter_id: number | null
    planned_date: string
    estimate_minutes: number
    status: string
    source: string
}
type BatchPomodoroRow = {
    id: unknown
    task_id: unknown
    duration: unknown
}

const STUDY_TASK_STATUSES: readonly StudyTaskStatus[] = ['todo', 'doing', 'done', 'skipped']
const STUDY_TASK_SOURCES: readonly string[] = ['manual', 'dashboard', 'ai', 'pomodoro']

function batchLoadRelations(
    database: Database.Database,
    table: 'subjects' | 'mistakes' | 'entries',
    ids: Set<number>,
): BatchRelationMap {
    const map: BatchRelationMap = new Map()
    if (ids.size === 0) return map
    const idArray = Array.from(ids)
    const placeholders = idArray.map(() => '?').join(',')
    const select = table === 'subjects'
        ? `SELECT id, name AS label FROM subjects WHERE id IN (${placeholders})`
        : table === 'mistakes'
            ? `SELECT id, question AS label FROM mistakes WHERE id IN (${placeholders})`
            : `SELECT id, COALESCE(NULLIF(TRIM(title), ''), date) AS label FROM entries WHERE id IN (${placeholders})`
    const rows = database.prepare(select).all(...idArray) as { id: number; label: unknown }[]
    // Pre-populate missing IDs as available:false
    for (const id of idArray) {
        map.set(id, { available: false, id })
    }
    for (const row of rows) {
        const label = normalizeRelationLabel(row.label)
        if (label) {
            map.set(row.id, { available: true, id: row.id, label })
        }
        // If label is null, it stays as available:false from pre-population
    }
    return map
}

function resolveRelationFromMap(
    map: BatchRelationMap,
    idValue: unknown,
): PlanningSourceRelation | null {
    if (idValue === null) return null
    if (typeof idValue !== 'number' || !Number.isSafeInteger(idValue) || idValue <= 0) {
        throw new PlanningHistoryUnavailableError('Planning source relation is unavailable')
    }
    return map.get(idValue) ?? { available: false, id: idValue }
}

function batchLoadReceipts(
    database: Database.Database,
    operationIds: Set<string>,
): Map<string, BatchReceiptRow> {
    const map = new Map<string, BatchReceiptRow>()
    if (operationIds.size === 0) return map
    const idArray = Array.from(operationIds)
    const placeholders = idArray.map(() => '?').join(',')
    const rows = database.prepare(`
        SELECT operation_id, operation_kind, action_contract_version,
               request_digest, expected_current_date, planned_date, task_id
        FROM study_task_action_receipts
        WHERE operation_id IN (${placeholders})
    `).all(...idArray) as {
        operation_id: unknown; operation_kind: unknown; action_contract_version: unknown
        request_digest: unknown; expected_current_date: unknown; planned_date: unknown
        task_id: unknown
    }[]
    for (const row of rows) {
        if (typeof row.operation_id === 'string'
            && typeof row.operation_kind === 'string'
            && typeof row.action_contract_version === 'string'
            && typeof row.request_digest === 'string'
            && typeof row.expected_current_date === 'string'
            && typeof row.planned_date === 'string'
        ) {
            const taskId = row.task_id === null ? null
                : (typeof row.task_id === 'number' && Number.isSafeInteger(row.task_id) && row.task_id > 0)
                    ? row.task_id : null
            map.set(row.operation_id, {
                operation_id: row.operation_id,
                operation_kind: row.operation_kind,
                action_contract_version: row.action_contract_version,
                request_digest: row.request_digest,
                expected_current_date: row.expected_current_date,
                planned_date: row.planned_date,
                task_id: taskId,
            })
        }
    }
    return map
}

type BatchTaskLookup =
    | { status: 'found'; task: BatchTaskRow }
    | { status: 'corrupt' }
    | { status: 'missing' }

function batchLoadTasks(
    database: Database.Database,
    taskIds: Set<number>,
): Map<number, BatchTaskLookup> {
    const map = new Map<number, BatchTaskLookup>()
    if (taskIds.size === 0) return map
    const idArray = Array.from(taskIds)
    const placeholders = idArray.map(() => '?').join(',')
    const rows = database.prepare(`
        SELECT id, title, description, type, subject_id, related_mistake_id,
               related_entry_id, related_chapter_id, planned_date, estimate_minutes,
               status, source
        FROM study_tasks
        WHERE id IN (${placeholders})
    `).all(...idArray) as Record<string, unknown>[]
    const foundIds = new Set<number>()
    for (const row of rows) {
        const id = row.id as number
        foundIds.add(id)
        const validated = validateTaskRow(row)
        if (validated) {
            map.set(id, { status: 'found', task: validated })
        } else {
            map.set(id, { status: 'corrupt' })
        }
    }
    // Mark missing IDs as missing
    for (const id of idArray) {
        if (!foundIds.has(id)) {
            map.set(id, { status: 'missing' })
        }
    }
    return map
}

function validateTaskRow(row: Record<string, unknown>): BatchTaskRow | null {
    if (
        typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0
        || typeof row.title !== 'string'
        || typeof row.description !== 'string'
        || typeof row.type !== 'string' || !STUDY_TASK_TYPES.includes(row.type as StudyTaskType)
        || !isNullablePositiveSafeInteger(row.subject_id)
        || !isNullablePositiveSafeInteger(row.related_mistake_id)
        || !isNullablePositiveSafeInteger(row.related_entry_id)
        || !isNullablePositiveSafeInteger(row.related_chapter_id)
        || !isCanonicalStoredDateKey(row.planned_date)
        || typeof row.estimate_minutes !== 'number'
        || !Number.isInteger(row.estimate_minutes)
        || row.estimate_minutes < 5 || row.estimate_minutes > 180
        || typeof row.status !== 'string'
        || !STUDY_TASK_STATUSES.includes(row.status as StudyTaskStatus)
        || typeof row.source !== 'string'
        || !STUDY_TASK_SOURCES.includes(row.source)
    ) {
        return null // fail closed — semantically invalid task
    }
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        type: row.type,
        subject_id: row.subject_id as number | null,
        related_mistake_id: row.related_mistake_id as number | null,
        related_entry_id: row.related_entry_id as number | null,
        related_chapter_id: row.related_chapter_id as number | null,
        planned_date: row.planned_date,
        estimate_minutes: row.estimate_minutes,
        status: row.status,
        source: row.source,
    }
}

function batchLoadPomodoro(
    database: Database.Database,
    taskIds: Set<number>,
): Map<number, BatchPomodoroRow[]> {
    const map = new Map<number, BatchPomodoroRow[]>()
    if (taskIds.size === 0) return map
    // Initialize all task IDs with empty arrays
    for (const id of taskIds) map.set(id, [])
    const idArray = Array.from(taskIds)
    const placeholders = idArray.map(() => '?').join(',')
    const rows = database.prepare(`
        SELECT id, task_id, duration
        FROM pomodoro_sessions
        WHERE task_id IN (${placeholders})
    `).all(...idArray) as BatchPomodoroRow[]
    for (const row of rows) {
        if (typeof row.task_id === 'number' && Number.isSafeInteger(row.task_id) && row.task_id > 0) {
            const sessions = map.get(row.task_id)
            if (sessions) sessions.push(row)
        }
    }
    return map
}

function computeFocusAttribution(
    sessions: BatchPomodoroRow[] | undefined,
    taskDeleted: boolean,
): PlanningFocusAttribution {
    if (taskDeleted) {
        return {
            state: 'unavailable',
            totalDurationMinutes: null,
            sessionCount: null,
            unavailableReason: 'task_deleted',
        }
    }
    if (!sessions) {
        return {
            state: 'not_applicable',
            totalDurationMinutes: null,
            sessionCount: null,
            unavailableReason: null,
        }
    }
    // Validate all sessions — any corruption → fail closed
    for (const session of sessions) {
        if (
            typeof session.id !== 'number' || !Number.isSafeInteger(session.id) || session.id <= 0
            || typeof session.task_id !== 'number' || !Number.isSafeInteger(session.task_id) || session.task_id <= 0
            || typeof session.duration !== 'number' || !Number.isFinite(session.duration) || session.duration <= 0
        ) {
            return {
                state: 'corrupt_data',
                totalDurationMinutes: null,
                sessionCount: null,
                unavailableReason: null,
            }
        }
    }
    // duration is already in minutes — sum directly, DO NOT divide by 60
    const totalDurationMinutes = sessions.reduce((sum, s) => sum + (s.duration as number), 0)
    return {
        state: 'available',
        totalDurationMinutes,
        sessionCount: sessions.length,
        unavailableReason: null,
    }
}

function computeSemanticDrift(
    candidateRow: PlanningCandidateRow,
    run: { targetDate: string },
    task: BatchTaskRow,
): PlanningSemanticDrift {
    const differences: PlanningSemanticDrift['differences'] = {}
    let hasDrift = false
    // Compare 9 frozen contract fields
    // 1. title
    if (candidateRow.title !== task.title) {
        differences.title = { candidateValue: candidateRow.title as string, currentValue: task.title }
        hasDrift = true
    }
    // 2. description
    if (candidateRow.description !== task.description) {
        differences.description = { candidateValue: candidateRow.description as string, currentValue: task.description }
        hasDrift = true
    }
    // 3. type
    if (candidateRow.type !== task.type) {
        differences.type = {
            candidateValue: candidateRow.type as StudyTaskType,
            currentValue: task.type as StudyTaskType,
        }
        hasDrift = true
    }
    // 4. subject_id
    if (candidateRow.subject_id !== task.subject_id) {
        differences.subjectId = {
            candidateValue: candidateRow.subject_id as number | null,
            currentValue: task.subject_id,
        }
        hasDrift = true
    }
    // 5. related_mistake_id
    if (candidateRow.related_mistake_id !== task.related_mistake_id) {
        differences.relatedMistakeId = {
            candidateValue: candidateRow.related_mistake_id as number | null,
            currentValue: task.related_mistake_id,
        }
        hasDrift = true
    }
    // 6. related_entry_id
    if (candidateRow.related_entry_id !== task.related_entry_id) {
        differences.relatedEntryId = {
            candidateValue: candidateRow.related_entry_id as number | null,
            currentValue: task.related_entry_id,
        }
        hasDrift = true
    }
    // 7. related_chapter_id (candidate expectation is always null)
    if (task.related_chapter_id !== null) {
        differences.relatedChapterId = { candidateValue: null, currentValue: task.related_chapter_id }
        hasDrift = true
    }
    // 8. planned_date (candidate expectation = run.targetDate)
    if (run.targetDate !== task.planned_date) {
        differences.plannedDate = { candidateValue: run.targetDate, currentValue: task.planned_date }
        hasDrift = true
    }
    // 9. estimate_minutes
    if (candidateRow.estimate_minutes !== task.estimate_minutes) {
        differences.estimateMinutes = {
            candidateValue: candidateRow.estimate_minutes as number,
            currentValue: task.estimate_minutes,
        }
        hasDrift = true
    }
    // NOTE: status and source are explicitly excluded per frozen contract §7.2
    return { hasDrift, differences }
}

function computeExecutionAttribution(
    candidateRow: PlanningCandidateRow,
    run: { entryPoint: PlanningEntryPoint; planningDate: string; targetDate: string },
    receiptMap: Map<string, BatchReceiptRow>,
    taskMap: Map<number, BatchTaskLookup>,
    pomodoroMap: Map<number, BatchPomodoroRow[]>,
): PlanningExecutionAttribution | null {
    // §10.1 Unconfirmed candidates get not_confirmed
    if (candidateRow.user_disposition !== 'confirmed') {
        return {
            kind: 'not_confirmed',
            receiptValidated: false,
            taskId: null,
            taskCurrentTitle: null,
            taskCurrentStatus: null,
            semanticDrift: null,
            focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: null },
        }
    }
    // Must have operation_id to proceed
    if (typeof candidateRow.operation_id !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(candidateRow.operation_id)) {
        return null
    }
    const operationId = candidateRow.operation_id
    const outcomeKind = candidateRow.outcome_kind as PlanningCandidateOutcomeKind | null

    // §10.9 date_mismatch + receipt absent → no_execution_expected
    if (outcomeKind === 'date_mismatch') {
        return {
            kind: 'no_execution_expected',
            receiptValidated: false,
            taskId: null,
            taskCurrentTitle: null,
            taskCurrentStatus: null,
            semanticDrift: null,
            focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: null },
        }
    }
    // §10.10 validation_error + receipt absent → no_execution_expected
    if (outcomeKind === 'validation_error') {
        return {
            kind: 'no_execution_expected',
            receiptValidated: false,
            taskId: null,
            taskCurrentTitle: null,
            taskCurrentStatus: null,
            semanticDrift: null,
            focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: null },
        }
    }
    // §10.11 integrity_error → integrity_inconsistency
    if (outcomeKind === 'integrity_error') {
        return {
            kind: 'integrity_inconsistency',
            receiptValidated: false,
            taskId: null,
            taskCurrentTitle: null,
            taskCurrentStatus: null,
            semanticDrift: null,
            focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: null },
        }
    }

    // Look up receipt
    const receipt = receiptMap.get(operationId)

    // Validate receipt by reconstructing idempotent request and recomputing digest
    let receiptValidated = false
    if (receipt) {
        try {
            const request: IdempotentAIStudyTaskCreateRequest = {
                operationId,
                operationKind: run.entryPoint,
                actionContractVersion: IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION,
                expectedCurrentDate: run.planningDate,
                payload: {
                    title: candidateRow.title as string,
                    description: candidateRow.description as string,
                    type: candidateRow.type as StudyTaskType,
                    subject_id: candidateRow.subject_id as number | null,
                    related_mistake_id: candidateRow.related_mistake_id as number | null,
                    related_entry_id: candidateRow.related_entry_id as number | null,
                    related_chapter_id: null,
                    planned_date: run.targetDate,
                    estimate_minutes: candidateRow.estimate_minutes as number,
                    status: 'todo',
                    source: 'ai',
                },
            }
            const expectedDigest = buildIdempotentAIStudyTaskRequestDigest(request)
            receiptValidated = (
                receipt.operation_kind === run.entryPoint
                && receipt.action_contract_version === IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION
                && receipt.request_digest === expectedDigest
                && receipt.expected_current_date === run.planningDate
                && receipt.planned_date === run.targetDate
            )
        } catch {
            receiptValidated = false
        }
    }

    // §10.2 created/replayed + matching receipt + valid task → verified_linked
    if (outcomeKind === 'created' || outcomeKind === 'replayed') {
        if (!receipt || !receiptValidated) {
            // §10.4 created/replayed + receipt missing → integrity_inconsistency
            return {
                kind: 'integrity_inconsistency',
                receiptValidated: false,
                taskId: null,
                taskCurrentTitle: null,
                taskCurrentStatus: null,
                semanticDrift: null,
                focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: null },
            }
        }
        // §10.3 created/replayed + receipt.task_id = null → task_deleted
        if (receipt.task_id === null) {
            return {
                kind: 'task_deleted',
                receiptValidated: true,
                taskId: null,
                taskCurrentTitle: null,
                taskCurrentStatus: null,
                semanticDrift: null,
                focus: computeFocusAttribution(undefined, true),
            }
        }
        const taskLookup = taskMap.get(receipt.task_id)
        if (!taskLookup || taskLookup.status === 'missing') {
            return {
                kind: 'task_deleted',
                receiptValidated: true,
                taskId: null,
                taskCurrentTitle: null,
                taskCurrentStatus: null,
                semanticDrift: null,
                focus: computeFocusAttribution(undefined, true),
            }
        }
        if (taskLookup.status === 'corrupt') {
            // Task row exists in study_tasks but failed validation → integrity_inconsistency
            return {
                kind: 'integrity_inconsistency',
                receiptValidated: true,
                taskId: receipt.task_id,
                taskCurrentTitle: null,
                taskCurrentStatus: null,
                semanticDrift: null,
                focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: null },
            }
        }
        const task = taskLookup.task
        const title = normalizeRelationLabel(task.title)
        return {
            kind: 'verified_linked',
            receiptValidated: true,
            taskId: receipt.task_id,
            taskCurrentTitle: title,
            taskCurrentStatus: task.status as StudyTaskStatus,
            semanticDrift: computeSemanticDrift(candidateRow, run, task),
            focus: computeFocusAttribution(pomodoroMap.get(receipt.task_id), false),
        }
    }

    // §10.5 uncertain + matching receipt + task exists → verified_linked
    // §10.6 uncertain + no receipt → unresolved
    if (outcomeKind === 'uncertain') {
        if (receipt && receiptValidated && receipt.task_id !== null) {
            const taskLookup = taskMap.get(receipt.task_id)
            if (taskLookup && taskLookup.status === 'found') {
                const task = taskLookup.task
                const title = normalizeRelationLabel(task.title)
                return {
                    kind: 'verified_linked',
                    receiptValidated: true,
                    taskId: receipt.task_id,
                    taskCurrentTitle: title,
                    taskCurrentStatus: task.status as StudyTaskStatus,
                    semanticDrift: computeSemanticDrift(candidateRow, run, task),
                    focus: computeFocusAttribution(pomodoroMap.get(receipt.task_id), false),
                }
            }
            if (taskLookup && taskLookup.status === 'missing') {
                return {
                    kind: 'task_deleted',
                    receiptValidated: true,
                    taskId: null,
                    taskCurrentTitle: null,
                    taskCurrentStatus: null,
                    semanticDrift: null,
                    focus: computeFocusAttribution(undefined, true),
                }
            }
        }
        if (receipt && receiptValidated && receipt.task_id === null) {
            return {
                kind: 'task_deleted',
                receiptValidated: true,
                taskId: null,
                taskCurrentTitle: null,
                taskCurrentStatus: null,
                semanticDrift: null,
                focus: computeFocusAttribution(undefined, true),
            }
        }
        return {
            kind: 'unresolved',
            receiptValidated: false,
            taskId: null,
            taskCurrentTitle: null,
            taskCurrentStatus: null,
            semanticDrift: null,
            focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: 'confirmation_uncertain' },
        }
    }

    // §10.7 conflict + mismatching existing receipt → known_conflict
    // §10.8 conflict + receipt missing → integrity_inconsistency
    if (outcomeKind === 'conflict') {
        if (receipt) {
            return {
                kind: 'known_conflict',
                receiptValidated: receiptValidated,
                taskId: null,
                taskCurrentTitle: null,
                taskCurrentStatus: null,
                semanticDrift: null,
                focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: null },
            }
        }
        return {
            kind: 'integrity_inconsistency',
            receiptValidated: false,
            taskId: null,
            taskCurrentTitle: null,
            taskCurrentStatus: null,
            semanticDrift: null,
            focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: null },
        }
    }

    // §10.3 deleted outcome → task_deleted
    if (outcomeKind === 'deleted') {
        return {
            kind: 'task_deleted',
            receiptValidated: receipt ? receiptValidated : false,
            taskId: null,
            taskCurrentTitle: null,
            taskCurrentStatus: null,
            semanticDrift: null,
            focus: computeFocusAttribution(undefined, true),
        }
    }

    // Fallback: outcome not yet recorded but confirmed
    if (outcomeKind === null) {
        return {
            kind: 'unresolved',
            receiptValidated: false,
            taskId: null,
            taskCurrentTitle: null,
            taskCurrentStatus: null,
            semanticDrift: null,
            focus: { state: 'not_applicable', totalDurationMinutes: null, sessionCount: null, unavailableReason: null },
        }
    }

    return null
}

// Batch projection types for read path
type BatchMaps = {
    subjectMap: BatchRelationMap
    mistakeMap: BatchRelationMap
    entryMap: BatchRelationMap
    receiptMap: Map<string, BatchReceiptRow>
    taskMap: Map<number, BatchTaskLookup>
    pomodoroMap: Map<number, BatchPomodoroRow[]>
}

function collectBatchIds(candidateRows: PlanningCandidateRow[]): {
    subjectIds: Set<number>
    mistakeIds: Set<number>
    entryIds: Set<number>
    operationIds: Set<string>
} {
    const subjectIds = new Set<number>()
    const mistakeIds = new Set<number>()
    const entryIds = new Set<number>()
    const operationIds = new Set<string>()
    for (const row of candidateRows) {
        // Current relations
        if (typeof row.subject_id === 'number' && Number.isSafeInteger(row.subject_id) && row.subject_id > 0) {
            subjectIds.add(row.subject_id)
        }
        if (typeof row.related_mistake_id === 'number' && Number.isSafeInteger(row.related_mistake_id) && row.related_mistake_id > 0) {
            mistakeIds.add(row.related_mistake_id)
        }
        if (typeof row.related_entry_id === 'number' && Number.isSafeInteger(row.related_entry_id) && row.related_entry_id > 0) {
            entryIds.add(row.related_entry_id)
        }
        // editBefore relations
        if (typeof row.edit_before_json === 'string') {
            try {
                const parsed = JSON.parse(row.edit_before_json)
                if (parsed && typeof parsed === 'object') {
                    if (typeof parsed.subject_id === 'number' && Number.isSafeInteger(parsed.subject_id) && parsed.subject_id > 0) {
                        subjectIds.add(parsed.subject_id)
                    }
                    if (typeof parsed.related_mistake_id === 'number' && Number.isSafeInteger(parsed.related_mistake_id) && parsed.related_mistake_id > 0) {
                        mistakeIds.add(parsed.related_mistake_id)
                    }
                    if (typeof parsed.related_entry_id === 'number' && Number.isSafeInteger(parsed.related_entry_id) && parsed.related_entry_id > 0) {
                        entryIds.add(parsed.related_entry_id)
                    }
                }
            } catch { /* ignore — parseEditBefore will handle bad JSON */ }
        }
        // Operation IDs for receipt lookup
        if (typeof row.operation_id === 'string' && LOWERCASE_UUID_V4_PATTERN.test(row.operation_id)) {
            operationIds.add(row.operation_id)
        }
    }
    return { subjectIds, mistakeIds, entryIds, operationIds }
}

function loadBatchMaps(
    database: Database.Database,
    candidateRows: PlanningCandidateRow[],
): BatchMaps {
    const { subjectIds, mistakeIds, entryIds, operationIds } = collectBatchIds(candidateRows)
    const subjectMap = batchLoadRelations(database, 'subjects', subjectIds)
    const mistakeMap = batchLoadRelations(database, 'mistakes', mistakeIds)
    const entryMap = batchLoadRelations(database, 'entries', entryIds)
    const receiptMap = batchLoadReceipts(database, operationIds)

    // Collect task IDs from receipts
    const taskIds = new Set<number>()
    for (const receipt of receiptMap.values()) {
        if (receipt.task_id !== null) taskIds.add(receipt.task_id)
    }
    const taskMap = batchLoadTasks(database, taskIds)

    // Collect valid task IDs for pomodoro lookup
    const validTaskIds = new Set<number>()
    for (const [id, lookup] of taskMap) {
        if (lookup.status === 'found') validTaskIds.add(id)
    }
    const pomodoroMap = batchLoadPomodoro(database, validTaskIds)

    return { subjectMap, mistakeMap, entryMap, receiptMap, taskMap, pomodoroMap }
}

function projectCandidateBatch(
    row: PlanningCandidateRow,
    run: { entryPoint: PlanningEntryPoint; planningDate: string; targetDate: string; createdAt: string },
    maps: BatchMaps,
): PlanningRunCandidateRecord {
    if (
        typeof row.id !== 'number'
        || !Number.isSafeInteger(row.id)
        || row.id <= 0
        || typeof row.ordinal !== 'number'
        || !Number.isInteger(row.ordinal)
        || row.ordinal < 0
        || row.ordinal > 5
        || !isValidStoredText(row.title, 80, PLANNING_HISTORY_TITLE_MAX_UTF8_BYTES)
        || !isValidStoredText(row.description, 240, PLANNING_HISTORY_DESCRIPTION_MAX_UTF8_BYTES)
        || typeof row.type !== 'string'
        || !STUDY_TASK_TYPES.includes(row.type as StudyTaskType)
        || typeof row.estimate_minutes !== 'number'
        || !Number.isInteger(row.estimate_minutes)
        || row.estimate_minutes < 5
        || row.estimate_minutes > 180
        || typeof row.priority !== 'string'
        || !PRIORITIES.includes(row.priority as PlanningCandidatePriority)
        || typeof row.admission_origin !== 'string'
        || !ADMISSION_ORIGINS.includes(row.admission_origin as PlanningCandidateAdmissionOrigin)
        || typeof row.user_disposition !== 'string'
        || !['selected_unconfirmed', 'unselected', 'confirmed'].includes(row.user_disposition)
        || !isNullablePositiveSafeInteger(row.subject_id)
        || !isNullablePositiveSafeInteger(row.related_mistake_id)
        || !isNullablePositiveSafeInteger(row.related_entry_id)
        || (row.type === 'review' ? row.related_mistake_id === null : row.related_mistake_id !== null)
        || (run.entryPoint === 'daily_review' && row.related_entry_id !== null)
        || (row.user_disposition === 'confirmed'
            ? typeof row.operation_id !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(row.operation_id)
            : row.operation_id !== null)
        || (row.user_disposition !== 'confirmed'
            && (row.outcome_kind !== null || row.outcome_observed_at !== null))
        || (row.outcome_kind !== null && !OUTCOME_KINDS.includes(row.outcome_kind as PlanningCandidateOutcomeKind))
        || ((row.outcome_kind === null) !== (row.outcome_observed_at === null))
    ) {
        throw new PlanningHistoryUnavailableError('Planning candidate history is unavailable')
    }
    const admittedAt = requireStoredTimestamp(row.admitted_at, 'candidate admission timestamp')
    const updatedAt = requireStoredTimestamp(row.updated_at, 'candidate update timestamp')
    const outcomeObservedAt = row.outcome_observed_at === null
        ? null
        : requireStoredTimestamp(row.outcome_observed_at, 'candidate outcome timestamp')
    if (
        admittedAt < run.createdAt
        || updatedAt < admittedAt
        || (outcomeObservedAt !== null && outcomeObservedAt < admittedAt)
    ) {
        throw new PlanningHistoryUnavailableError('Planning candidate history is unavailable')
    }
    const finalSnapshot = snapshotFromRow(row)
    const editBefore = parseEditBefore(row.edit_before_json, finalSnapshot, run.entryPoint)
    return {
        id: row.id,
        ordinal: row.ordinal,
        admissionOrigin: row.admission_origin as PlanningCandidateAdmissionOrigin,
        title: row.title,
        description: row.description,
        type: row.type as StudyTaskType,
        estimateMinutes: row.estimate_minutes,
        priority: row.priority as PlanningCandidatePriority,
        subjectId: row.subject_id as number | null,
        relatedMistakeId: row.related_mistake_id as number | null,
        relatedEntryId: row.related_entry_id as number | null,
        editBefore,
        editBeforeSourceRelations: {
            subject: Object.prototype.hasOwnProperty.call(editBefore, 'subjectId')
                ? resolveRelationFromMap(maps.subjectMap, editBefore.subjectId)
                : null,
            mistake: Object.prototype.hasOwnProperty.call(editBefore, 'relatedMistakeId')
                ? resolveRelationFromMap(maps.mistakeMap, editBefore.relatedMistakeId)
                : null,
            entry: Object.prototype.hasOwnProperty.call(editBefore, 'relatedEntryId')
                ? resolveRelationFromMap(maps.entryMap, editBefore.relatedEntryId)
                : null,
        },
        userDisposition: row.user_disposition as PlanningCandidateDisposition,
        outcomeKind: row.outcome_kind as PlanningRunCandidateRecord['outcomeKind'],
        outcomeObservedAt,
        admittedAt,
        updatedAt,
        sourceRelations: {
            subject: resolveRelationFromMap(maps.subjectMap, row.subject_id),
            mistake: resolveRelationFromMap(maps.mistakeMap, row.related_mistake_id),
            entry: resolveRelationFromMap(maps.entryMap, row.related_entry_id),
        },
        taskRelation: resolveTaskRelationFromMaps(row, run, maps),
        executionAttribution: computeExecutionAttribution(row, run, maps.receiptMap, maps.taskMap, maps.pomodoroMap),
    }
}

function resolveTaskRelationFromMaps(
    row: PlanningCandidateRow,
    run: { entryPoint: PlanningEntryPoint; planningDate: string; targetDate: string },
    maps: BatchMaps,
) {
    if (row.operation_id === null) return null
    if (typeof row.operation_id !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(row.operation_id)) {
        return { available: false as const }
    }
    const receipt = maps.receiptMap.get(row.operation_id)
    if (!receipt) return { available: false as const }
    // Validate receipt fields match expected
    try {
        const request: IdempotentAIStudyTaskCreateRequest = {
            operationId: row.operation_id,
            operationKind: run.entryPoint,
            actionContractVersion: IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION,
            expectedCurrentDate: run.planningDate,
            payload: {
                title: row.title as string,
                description: row.description as string,
                type: row.type as StudyTaskType,
                subject_id: row.subject_id as number | null,
                related_mistake_id: row.related_mistake_id as number | null,
                related_entry_id: row.related_entry_id as number | null,
                related_chapter_id: null,
                planned_date: run.targetDate,
                estimate_minutes: row.estimate_minutes as number,
                status: 'todo',
                source: 'ai',
            },
        }
        const expectedDigest = buildIdempotentAIStudyTaskRequestDigest(request)
        if (
            receipt.operation_kind !== run.entryPoint
            || receipt.action_contract_version !== IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION
            || receipt.request_digest !== expectedDigest
            || receipt.expected_current_date !== run.planningDate
            || receipt.planned_date !== run.targetDate
            || receipt.task_id === null
        ) {
            return { available: false as const }
        }
        const taskLookup = maps.taskMap.get(receipt.task_id)
        if (!taskLookup || taskLookup.status !== 'found') return { available: false as const }
        const task = taskLookup.task
        const title = normalizeRelationLabel(task.title)
        if (!title || !STUDY_TASK_STATUSES.includes(task.status as StudyTaskStatus)) {
            return { available: false as const }
        }
        return { available: true as const, title, status: task.status }
    } catch {
        return { available: false as const }
    }
}

function projectRunFromMaps(
    row: PlanningRunRow,
    candidateRows: PlanningCandidateRow[],
    maps: BatchMaps,
): PlanningRunRecord {
    if (
        typeof row.id !== 'string'
        || !LOWERCASE_UUID_V4_PATTERN.test(row.id)
        || row.contract_version !== PLANNING_HISTORY_CONTRACT_VERSION
        || (row.entry_point !== 'today_action' && row.entry_point !== 'daily_review')
        || (row.generation_result_kind !== 'valid_empty' && row.generation_result_kind !== 'candidate_set')
        || !isCanonicalStoredDateKey(row.planning_date)
        || !isCanonicalStoredDateKey(row.target_date)
        || row.target_date !== (row.entry_point === 'today_action'
            ? row.planning_date
            : nextDateKey(row.planning_date))
        || ((row.closed_at === null) !== (row.close_reason === null))
        || (row.close_reason !== null
            && !['dialog_closed', 'regenerated', 'date_rollover', 'app_closed'].includes(String(row.close_reason)))
    ) {
        throw new PlanningHistoryUnavailableError('Planning run history is unavailable')
    }
    let contextSummary: PlanningContextSummaryItem[]
    try {
        const parsed = JSON.parse(String(row.context_summary_json))
        contextSummary = validateContextSummary(parsed, row.entry_point).items
    } catch {
        throw new PlanningHistoryUnavailableError('Planning run history is unavailable')
    }
    const entryPoint = row.entry_point
    const planningDate = row.planning_date
    const targetDate = row.target_date
    const createdAt = requireStoredTimestamp(row.created_at, 'run creation timestamp')
    const updatedAt = requireStoredTimestamp(row.updated_at, 'run update timestamp')
    const closedAt = row.closed_at === null ? null : requireStoredTimestamp(row.closed_at, 'run close timestamp')
    if (updatedAt < createdAt || (closedAt !== null && closedAt < createdAt)) {
        throw new PlanningHistoryUnavailableError('Planning run history is unavailable')
    }
    if (candidateRows.length > 6 || (row.generation_result_kind === 'valid_empty' && candidateRows.length !== 0)) {
        throw new PlanningHistoryUnavailableError('Planning run history is unavailable')
    }
    return {
        id: row.id,
        entryPoint,
        planningDate,
        targetDate,
        generationResultKind: row.generation_result_kind,
        contextSummary,
        createdAt,
        updatedAt,
        closedAt,
        closeReason: row.close_reason as PlanningRunRecord['closeReason'],
        candidates: candidateRows.map(candidate => projectCandidateBatch(
            candidate,
            { entryPoint, planningDate, targetDate, createdAt },
            maps,
        )),
    }
}

// ─── End C3 Batch Infrastructure ────────────────────────────────────────────

function resolveSourceRelation(
    database: Database.Database,
    table: 'subjects' | 'mistakes' | 'entries',
    idValue: unknown,
) {
    if (idValue === null) return null
    if (typeof idValue !== 'number' || !Number.isSafeInteger(idValue) || idValue <= 0) {
        throw new PlanningHistoryUnavailableError('Planning source relation is unavailable')
    }
    const select = table === 'subjects'
        ? 'SELECT name AS label FROM subjects WHERE id = ?'
        : table === 'mistakes'
            ? 'SELECT question AS label FROM mistakes WHERE id = ?'
            : "SELECT COALESCE(NULLIF(TRIM(title), ''), date) AS label FROM entries WHERE id = ?"
    const row = database.prepare(select).get(idValue) as { label: unknown } | undefined
    if (!row) return { available: false as const, id: idValue }
    const label = normalizeRelationLabel(row.label)
    return label
        ? { available: true as const, id: idValue, label }
        : { available: false as const, id: idValue }
}

function resolveTaskRelation(
    database: Database.Database,
    row: PlanningCandidateRow,
    run: { entryPoint: PlanningEntryPoint; planningDate: string; targetDate: string },
) {
    if (row.operation_id === null) return null
    if (typeof row.operation_id !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(row.operation_id)) {
        return { available: false as const }
    }
    let request: IdempotentAIStudyTaskCreateRequest
    try {
        request = {
            operationId: row.operation_id,
            operationKind: run.entryPoint,
            actionContractVersion: IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION,
            expectedCurrentDate: run.planningDate,
            payload: {
                title: row.title as string,
                description: row.description as string,
                type: row.type as StudyTaskType,
                subject_id: row.subject_id as number | null,
                related_mistake_id: row.related_mistake_id as number | null,
                related_entry_id: row.related_entry_id as number | null,
                related_chapter_id: null,
                planned_date: run.targetDate,
                estimate_minutes: row.estimate_minutes as number,
                status: 'todo',
                source: 'ai',
            },
        }
        const expectedDigest = buildIdempotentAIStudyTaskRequestDigest(request)
        const receipt = database.prepare(`
            SELECT operation_kind, action_contract_version, request_digest,
                   expected_current_date, planned_date, task_id
            FROM study_task_action_receipts
            WHERE operation_id = ?
        `).get(row.operation_id) as {
            operation_kind: unknown
            action_contract_version: unknown
            request_digest: unknown
            expected_current_date: unknown
            planned_date: unknown
            task_id: unknown
        } | undefined
        if (
            !receipt
            || receipt.operation_kind !== run.entryPoint
            || receipt.action_contract_version !== IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION
            || receipt.request_digest !== expectedDigest
            || receipt.expected_current_date !== run.planningDate
            || receipt.planned_date !== run.targetDate
            || typeof receipt.task_id !== 'number'
            || !Number.isSafeInteger(receipt.task_id)
            || receipt.task_id <= 0
        ) {
            return { available: false as const }
        }
        const task = database.prepare(`
            SELECT title, status
            FROM study_tasks
            WHERE id = ?
        `).get(receipt.task_id) as { title: unknown; status: unknown } | undefined
        const title = task ? normalizeRelationLabel(task.title) : null
        if (
            !task
            || !title
            || typeof task.status !== 'string'
            || !['todo', 'doing', 'done', 'skipped'].includes(task.status)
        ) {
            return { available: false as const }
        }
        return { available: true as const, title, status: task.status }
    } catch {
        return { available: false as const }
    }
}

function isValidStoredText(value: unknown, maxUnits: number, maxBytes: number): value is string {
    if (typeof value !== 'string') return false
    const normalized = value
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u00AD\u2060\uFEFF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return normalized === value
        && normalized.length > 0
        && normalized.length <= maxUnits
        && Buffer.byteLength(normalized, 'utf8') <= maxBytes
}

function isNullablePositiveSafeInteger(value: unknown): value is number | null {
    return value === null
        || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
}

function projectCandidate(
    database: Database.Database,
    row: PlanningCandidateRow,
    run: { entryPoint: PlanningEntryPoint; planningDate: string; targetDate: string; createdAt: string },
): PlanningRunCandidateRecord {
    if (
        typeof row.id !== 'number'
        || !Number.isSafeInteger(row.id)
        || row.id <= 0
        || typeof row.ordinal !== 'number'
        || !Number.isInteger(row.ordinal)
        || row.ordinal < 0
        || row.ordinal > 5
        || !isValidStoredText(row.title, 80, PLANNING_HISTORY_TITLE_MAX_UTF8_BYTES)
        || !isValidStoredText(row.description, 240, PLANNING_HISTORY_DESCRIPTION_MAX_UTF8_BYTES)
        || typeof row.type !== 'string'
        || !STUDY_TASK_TYPES.includes(row.type as StudyTaskType)
        || typeof row.estimate_minutes !== 'number'
        || !Number.isInteger(row.estimate_minutes)
        || row.estimate_minutes < 5
        || row.estimate_minutes > 180
        || typeof row.priority !== 'string'
        || !PRIORITIES.includes(row.priority as PlanningCandidatePriority)
        || typeof row.admission_origin !== 'string'
        || !ADMISSION_ORIGINS.includes(row.admission_origin as PlanningCandidateAdmissionOrigin)
        || typeof row.user_disposition !== 'string'
        || !['selected_unconfirmed', 'unselected', 'confirmed'].includes(row.user_disposition)
        || !isNullablePositiveSafeInteger(row.subject_id)
        || !isNullablePositiveSafeInteger(row.related_mistake_id)
        || !isNullablePositiveSafeInteger(row.related_entry_id)
        || (row.type === 'review' ? row.related_mistake_id === null : row.related_mistake_id !== null)
        || (run.entryPoint === 'daily_review' && row.related_entry_id !== null)
        || (row.user_disposition === 'confirmed'
            ? typeof row.operation_id !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(row.operation_id)
            : row.operation_id !== null)
        || (row.user_disposition !== 'confirmed'
            && (row.outcome_kind !== null || row.outcome_observed_at !== null))
        || (row.outcome_kind !== null && !OUTCOME_KINDS.includes(row.outcome_kind as PlanningCandidateOutcomeKind))
        || ((row.outcome_kind === null) !== (row.outcome_observed_at === null))
    ) {
        throw new PlanningHistoryUnavailableError('Planning candidate history is unavailable')
    }
    const admittedAt = requireStoredTimestamp(row.admitted_at, 'candidate admission timestamp')
    const updatedAt = requireStoredTimestamp(row.updated_at, 'candidate update timestamp')
    const outcomeObservedAt = row.outcome_observed_at === null
        ? null
        : requireStoredTimestamp(row.outcome_observed_at, 'candidate outcome timestamp')
    if (
        admittedAt < run.createdAt
        || updatedAt < admittedAt
        || (outcomeObservedAt !== null && outcomeObservedAt < admittedAt)
    ) {
        throw new PlanningHistoryUnavailableError('Planning candidate history is unavailable')
    }
    const finalSnapshot = snapshotFromRow(row)
    const editBefore = parseEditBefore(row.edit_before_json, finalSnapshot, run.entryPoint)
    return {
        id: row.id,
        ordinal: row.ordinal,
        admissionOrigin: row.admission_origin as PlanningCandidateAdmissionOrigin,
        title: row.title,
        description: row.description,
        type: row.type as StudyTaskType,
        estimateMinutes: row.estimate_minutes,
        priority: row.priority as PlanningCandidatePriority,
        subjectId: row.subject_id as number | null,
        relatedMistakeId: row.related_mistake_id as number | null,
        relatedEntryId: row.related_entry_id as number | null,
        editBefore,
        editBeforeSourceRelations: {
            subject: Object.prototype.hasOwnProperty.call(editBefore, 'subjectId')
                ? resolveSourceRelation(database, 'subjects', editBefore.subjectId)
                : null,
            mistake: Object.prototype.hasOwnProperty.call(editBefore, 'relatedMistakeId')
                ? resolveSourceRelation(database, 'mistakes', editBefore.relatedMistakeId)
                : null,
            entry: Object.prototype.hasOwnProperty.call(editBefore, 'relatedEntryId')
                ? resolveSourceRelation(database, 'entries', editBefore.relatedEntryId)
                : null,
        },
        userDisposition: row.user_disposition as PlanningCandidateDisposition,
        outcomeKind: row.outcome_kind as PlanningRunCandidateRecord['outcomeKind'],
        outcomeObservedAt,
        admittedAt,
        updatedAt,
        sourceRelations: {
            subject: resolveSourceRelation(database, 'subjects', row.subject_id),
            mistake: resolveSourceRelation(database, 'mistakes', row.related_mistake_id),
            entry: resolveSourceRelation(database, 'entries', row.related_entry_id),
        },
        taskRelation: resolveTaskRelation(database, row, run),
        executionAttribution: null,
    }
}

function projectRun(database: Database.Database, row: PlanningRunRow): PlanningRunRecord {
    if (
        typeof row.id !== 'string'
        || !LOWERCASE_UUID_V4_PATTERN.test(row.id)
        || row.contract_version !== PLANNING_HISTORY_CONTRACT_VERSION
        || (row.entry_point !== 'today_action' && row.entry_point !== 'daily_review')
        || (row.generation_result_kind !== 'valid_empty' && row.generation_result_kind !== 'candidate_set')
        || !isCanonicalStoredDateKey(row.planning_date)
        || !isCanonicalStoredDateKey(row.target_date)
        || row.target_date !== (row.entry_point === 'today_action'
            ? row.planning_date
            : nextDateKey(row.planning_date))
        || ((row.closed_at === null) !== (row.close_reason === null))
        || (row.close_reason !== null
            && !['dialog_closed', 'regenerated', 'date_rollover', 'app_closed'].includes(String(row.close_reason)))
    ) {
        throw new PlanningHistoryUnavailableError('Planning run history is unavailable')
    }
    let contextSummary: PlanningContextSummaryItem[]
    try {
        const parsed = JSON.parse(String(row.context_summary_json))
        contextSummary = validateContextSummary(parsed, row.entry_point).items
    } catch {
        throw new PlanningHistoryUnavailableError('Planning run history is unavailable')
    }
    const entryPoint = row.entry_point
    const planningDate = row.planning_date
    const targetDate = row.target_date
    const createdAt = requireStoredTimestamp(row.created_at, 'run creation timestamp')
    const updatedAt = requireStoredTimestamp(row.updated_at, 'run update timestamp')
    const closedAt = row.closed_at === null ? null : requireStoredTimestamp(row.closed_at, 'run close timestamp')
    if (updatedAt < createdAt || (closedAt !== null && closedAt < createdAt)) {
        throw new PlanningHistoryUnavailableError('Planning run history is unavailable')
    }
    const candidates = readCandidateRows(database, row.id)
    if (candidates.length > 6 || (row.generation_result_kind === 'valid_empty' && candidates.length !== 0)) {
        throw new PlanningHistoryUnavailableError('Planning run history is unavailable')
    }
    return {
        id: row.id,
        entryPoint,
        planningDate,
        targetDate,
        generationResultKind: row.generation_result_kind,
        contextSummary,
        createdAt,
        updatedAt,
        closedAt,
        closeReason: row.close_reason as PlanningRunRecord['closeReason'],
        candidates: candidates.map(candidate => projectCandidate(
            database,
            candidate,
            { entryPoint, planningDate, targetDate, createdAt },
        )),
    }
}

function immutableMetadataMatches(
    row: PlanningRunRow,
    request: PlanningRunCreateRequest & { contextJson: string },
): boolean {
    // Candidate rows are mutable/removable audit children. The stable create identity is
    // therefore limited to immutable planning_runs metadata; a replay never rewrites children.
    return row.contract_version === PLANNING_HISTORY_CONTRACT_VERSION
        && row.entry_point === request.entryPoint
        && row.planning_date === request.planningDate
        && row.target_date === request.targetDate
        && row.generation_result_kind === request.generationResultKind
        && row.context_summary_json === request.contextJson
}

function insertCandidate(
    database: Database.Database,
    runId: string,
    candidate: PlanningRunCandidateCreateInput,
    timestamp: string,
): void {
    database.prepare(`
        INSERT INTO planning_run_candidates (
          planning_run_id, ordinal, admission_origin, title, description, type,
          estimate_minutes, priority, subject_id, related_mistake_id,
          related_entry_id, edit_before_json, user_disposition, admitted_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)
    `).run(
        runId,
        candidate.ordinal,
        candidate.admissionOrigin,
        candidate.title,
        candidate.description,
        candidate.type,
        candidate.estimateMinutes,
        candidate.priority,
        candidate.subjectId,
        candidate.relatedMistakeId,
        candidate.relatedEntryId,
        candidate.userDisposition,
        timestamp,
        timestamp,
    )
}

function requireOrdinal(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) {
        throw new PlanningHistoryValidationError(`${label} must be an integer from 0 to 5`)
    }
    return value
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new PlanningHistoryValidationError(`${label} must be a positive safe integer`)
    }
    return value
}

function readCandidateForRunOrdinal(
    database: Database.Database,
    runId: string,
    ordinal: number,
): PlanningCandidateRow | undefined {
    return database.prepare(`
        SELECT id, planning_run_id, ordinal, admission_origin, title, description,
               type, estimate_minutes, priority, subject_id, related_mistake_id,
               related_entry_id, edit_before_json, user_disposition, operation_id,
               outcome_kind, outcome_observed_at, admitted_at, updated_at
        FROM planning_run_candidates
        WHERE planning_run_id = ? AND ordinal = ?
    `).get(runId, ordinal) as PlanningCandidateRow | undefined
}

function readCandidateById(
    database: Database.Database,
    candidateId: number,
): (PlanningCandidateRow & {
    entry_point: unknown
    planning_date: unknown
    target_date: unknown
    closed_at: unknown
}) | undefined {
    return database.prepare(`
        SELECT c.id, c.planning_run_id, c.ordinal, c.admission_origin, c.title,
               c.description, c.type, c.estimate_minutes, c.priority, c.subject_id,
               c.related_mistake_id, c.related_entry_id, c.edit_before_json,
               c.user_disposition, c.operation_id, c.outcome_kind,
               c.outcome_observed_at, c.admitted_at, c.updated_at,
               r.entry_point, r.planning_date, r.target_date, r.closed_at
        FROM planning_run_candidates c
        JOIN planning_runs r ON r.id = c.planning_run_id
        WHERE c.id = ?
    `).get(candidateId) as (PlanningCandidateRow & {
        entry_point: unknown
        planning_date: unknown
        target_date: unknown
        closed_at: unknown
    }) | undefined
}

function snapshotFromRow(row: PlanningCandidateRow): PlanningCandidateSnapshot {
    return {
        title: row.title as string,
        description: row.description as string,
        type: row.type as StudyTaskType,
        estimateMinutes: row.estimate_minutes as number,
        priority: row.priority as PlanningCandidatePriority,
        subjectId: row.subject_id as number | null,
        relatedMistakeId: row.related_mistake_id as number | null,
        relatedEntryId: row.related_entry_id as number | null,
    }
}

function parseEditBefore(
    value: unknown,
    finalSnapshot: PlanningCandidateSnapshot,
    entryPoint: PlanningEntryPoint,
): Partial<PlanningCandidateSnapshot> {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > PLANNING_HISTORY_EDIT_MAX_UTF8_BYTES) {
        throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
    }
    const record = requirePlainObject(parsed, 'stored edit history')
    const allowedKeys: readonly string[] = EDIT_FIELD_MAPPINGS.map(([, storedKey]) => storedKey)
    const ownKeys = Reflect.ownKeys(record)
    if (ownKeys.some(key => typeof key !== 'string' || !allowedKeys.includes(key))) {
        throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
    }
    const result: Partial<PlanningCandidateSnapshot> = {}
    const canonical: Record<string, unknown> = {}
    for (const [field, storedKey] of EDIT_FIELD_MAPPINGS) {
        if (!Object.prototype.hasOwnProperty.call(record, storedKey)) continue
        const descriptor = Object.getOwnPropertyDescriptor(record, storedKey)
        if (!descriptor || !('value' in descriptor)) {
            throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
        }
        const candidateValue = descriptor.value
        let normalizedValue: unknown
        if (field === 'title') {
            normalizedValue = normalizeText(candidateValue, 'stored edit title', 80, PLANNING_HISTORY_TITLE_MAX_UTF8_BYTES)
        } else if (field === 'description') {
            normalizedValue = normalizeText(
                candidateValue,
                'stored edit description',
                240,
                PLANNING_HISTORY_DESCRIPTION_MAX_UTF8_BYTES,
            )
        } else if (field === 'type') {
            normalizedValue = requireEnum(candidateValue, STUDY_TASK_TYPES, 'stored edit type')
        } else if (field === 'estimateMinutes') {
            if (
                typeof candidateValue !== 'number'
                || !Number.isInteger(candidateValue)
                || candidateValue < 5
                || candidateValue > 180
            ) {
                throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
            }
            normalizedValue = candidateValue
        } else if (field === 'priority') {
            normalizedValue = requireEnum(candidateValue, PRIORITIES, 'stored edit priority')
        } else {
            normalizedValue = requireNullablePositiveSafeInteger(candidateValue, `stored edit ${storedKey}`)
        }
        if (entryPoint === 'daily_review' && field === 'relatedEntryId') {
            throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
        }
        if (normalizedValue === finalSnapshot[field]) {
            throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
        }
        ;(result as Record<string, unknown>)[field] = normalizedValue
        canonical[storedKey] = normalizedValue
    }
    if (JSON.stringify(canonical) !== value) {
        throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
    }
    const reconstructedType = result.type !== undefined ? result.type : finalSnapshot.type
    const reconstructedMistakeId = result.relatedMistakeId !== undefined
        ? result.relatedMistakeId
        : finalSnapshot.relatedMistakeId
    const reconstructedEntryId = result.relatedEntryId !== undefined
        ? result.relatedEntryId
        : finalSnapshot.relatedEntryId
    if ((reconstructedType === 'review') !== (reconstructedMistakeId !== null)) {
        throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
    }
    if (entryPoint === 'daily_review' && reconstructedEntryId !== null) {
        throw new PlanningHistoryUnavailableError('Planning candidate edit history is unavailable')
    }
    return result
}

function serializeEditBefore(value: Partial<PlanningCandidateSnapshot>): string {
    const canonical: Record<string, unknown> = {}
    for (const [field, storedKey] of EDIT_FIELD_MAPPINGS) {
        if (Object.prototype.hasOwnProperty.call(value, field)) {
            canonical[storedKey] = value[field]
        }
    }
    const json = JSON.stringify(canonical)
    if (Buffer.byteLength(json, 'utf8') > PLANNING_HISTORY_EDIT_MAX_UTF8_BYTES) {
        throw new PlanningHistoryValidationError('candidate edit history exceeds its UTF-8 byte limit')
    }
    return json
}

function updateRunTimestamp(database: Database.Database, runId: string, timestamp: string): void {
    database.prepare('UPDATE planning_runs SET updated_at = ? WHERE id = ?').run(timestamp, runId)
}

function applyRetention(database: Database.Database, timestamp: string): void {
    const cutoff = new Date(Date.parse(timestamp) - PLANNING_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
    database.prepare('DELETE FROM planning_runs WHERE created_at < ?').run(cutoff)
    database.prepare(`
        DELETE FROM planning_runs
        WHERE id IN (
          SELECT id
          FROM planning_runs
          ORDER BY created_at DESC, id DESC
          LIMIT -1 OFFSET ?
        )
    `).run(PLANNING_HISTORY_MAX_RUNS)
}

function validateTransition(
    value: unknown,
    database: Database.Database,
): PlanningRunTransitionRequest & { candidate?: PlanningRunCandidateCreateInput | PlanningCandidateSnapshot } {
    const record = requirePlainObject(value, 'transition')
    const kind = requireEnum(readOwn(record, 'kind'), TRANSITION_KINDS, 'transition.kind')
    if (kind === 'admit_repaired_candidate') {
        assertExactOwnDataKeys(record, ['kind', 'runId', 'candidate'], 'transition')
        const runId = requireUuid(readOwn(record, 'runId'), 'transition.runId')
        const run = readRunRow(database, runId)
        if (!run) throw new PlanningHistoryUnavailableError('Planning run is unavailable')
        const candidateRecord = requirePlainObject(readOwn(record, 'candidate'), 'transition.candidate')
        assertExactOwnDataKeys(candidateRecord, REPAIRED_CANDIDATE_KEYS, 'transition.candidate')
        const ordinal = requireOrdinal(readOwn(candidateRecord, 'ordinal'), 'transition.candidate.ordinal')
        const snapshot = validateSnapshot(
            candidateRecord,
            'transition.candidate',
            run.entry_point as PlanningEntryPoint,
            database,
            run.planning_date as string,
        )
        return {
            kind,
            runId,
            candidate: {
                ordinal,
                admissionOrigin: 'provider_suggested_user_repaired',
                ...snapshot,
                userDisposition: requireEnum(
                    readOwn(candidateRecord, 'userDisposition'),
                    CREATE_DISPOSITIONS,
                    'transition.candidate.userDisposition',
                ),
            },
        }
    }
    if (kind === 'commit_candidate') {
        assertExactOwnDataKeys(record, ['kind', 'runId', 'ordinal', 'candidate'], 'transition')
        const runId = requireUuid(readOwn(record, 'runId'), 'transition.runId')
        const run = readRunRow(database, runId)
        if (!run) throw new PlanningHistoryUnavailableError('Planning run is unavailable')
        const candidateRecord = requirePlainObject(readOwn(record, 'candidate'), 'transition.candidate')
        assertExactOwnDataKeys(candidateRecord, SNAPSHOT_KEYS, 'transition.candidate')
        return {
            kind,
            runId,
            ordinal: requireOrdinal(readOwn(record, 'ordinal'), 'transition.ordinal'),
            candidate: validateSnapshot(
                candidateRecord,
                'transition.candidate',
                run.entry_point as PlanningEntryPoint,
                database,
                run.planning_date as string,
            ),
        }
    }
    if (kind === 'set_selection') {
        assertExactOwnDataKeys(record, ['kind', 'runId', 'ordinal', 'selected'], 'transition')
        const selected = readOwn(record, 'selected')
        if (typeof selected !== 'boolean') {
            throw new PlanningHistoryValidationError('transition.selected must be a boolean')
        }
        return {
            kind,
            runId: requireUuid(readOwn(record, 'runId'), 'transition.runId'),
            ordinal: requireOrdinal(readOwn(record, 'ordinal'), 'transition.ordinal'),
            selected,
        }
    }
    if (kind === 'remove_candidate') {
        assertExactOwnDataKeys(record, ['kind', 'runId', 'ordinal'], 'transition')
        return {
            kind,
            runId: requireUuid(readOwn(record, 'runId'), 'transition.runId'),
            ordinal: requireOrdinal(readOwn(record, 'ordinal'), 'transition.ordinal'),
        }
    }
    assertExactOwnDataKeys(record, ['kind', 'runId', 'reason'], 'transition')
    return {
        kind,
        runId: requireUuid(readOwn(record, 'runId'), 'transition.runId'),
        reason: requireEnum(
            readOwn(record, 'reason'),
            ['dialog_closed', 'regenerated', 'date_rollover'] as const,
            'transition.reason',
        ),
    }
}

export function createPlanningHistoryStore(dependencies: PlanningHistoryStoreDependencies) {
    const database = dependencies.database
    const now = dependencies.now ?? (() => new Date())

    function get(idValue: unknown): PlanningRunRecord | null {
        const id = requireUuid(idValue, 'run id')
        const row = readRunRow(database, id)
        if (!row) return null
        const candidateRows = readCandidateRows(database, id)
        const maps = loadBatchMaps(database, candidateRows)
        return projectRunFromMaps(row, candidateRows, maps)
    }

    function create(value: unknown): PlanningRunRecord {
        const replayRequest = validateCreateRequest(value, database, false)
        const existing = readRunRow(database, replayRequest.id)
        if (existing) {
            if (!immutableMetadataMatches(existing, replayRequest)) {
                throw new PlanningHistoryConflictError('Planning run create conflict')
            }
            return projectRun(database, existing)
        }
        const request = validateCreateRequest(value, database)
        const timestamp = getTrustedTimestamp(now)
        let createdNew = false
        const transaction = database.transaction(() => {
            const raced = readRunRow(database, request.id)
            if (raced) {
                if (!immutableMetadataMatches(raced, request)) {
                    throw new PlanningHistoryConflictError('Planning run create conflict')
                }
                return projectRun(database, raced)
            }
            database.prepare(`
                INSERT INTO planning_runs (
                  id, contract_version, entry_point, planning_date, target_date,
                  generation_result_kind, context_summary_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                request.id,
                PLANNING_HISTORY_CONTRACT_VERSION,
                request.entryPoint,
                request.planningDate,
                request.targetDate,
                request.generationResultKind,
                request.contextJson,
                timestamp,
                timestamp,
            )
            createdNew = true
            for (const candidate of request.candidates) {
                insertCandidate(database, request.id, candidate, timestamp)
            }
            applyRetention(database, timestamp)
            const inserted = readRunRow(database, request.id)
            if (!inserted) throw new PlanningHistoryUnavailableError('Planning run was not persisted')
            return projectRun(database, inserted)
        })
        const run = transaction()
        if (createdNew) dependencies.onCreatedNew?.(run.id)
        return run
    }

    function transition(value: unknown): PlanningRunRecord {
        const request = validateTransition(value, database)
        const timestamp = getTrustedTimestamp(now)
        const transaction = database.transaction(() => {
            const run = readRunRow(database, request.runId)
            if (!run) throw new PlanningHistoryUnavailableError('Planning run is unavailable')
            if (request.kind === 'close_run') {
                if (run.closed_at !== null || run.close_reason !== null) {
                    return projectRun(database, run)
                }
                database.prepare(`
                    UPDATE planning_runs
                    SET closed_at = ?, close_reason = ?, updated_at = ?
                    WHERE id = ? AND closed_at IS NULL AND close_reason IS NULL
                `).run(timestamp, request.reason, timestamp, request.runId)
                const closed = readRunRow(database, request.runId)
                if (!closed) throw new PlanningHistoryUnavailableError('Planning run is unavailable')
                return projectRun(database, closed)
            }
            if (run.closed_at !== null || run.close_reason !== null) {
                throw new PlanningHistoryConflictError('Planning run is closed and immutable')
            }
            if (request.kind === 'admit_repaired_candidate') {
                if (run.generation_result_kind !== 'candidate_set') {
                    throw new PlanningHistoryConflictError('A valid-empty run cannot admit a candidate')
                }
                const count = (database.prepare(`
                    SELECT COUNT(*) AS count
                    FROM planning_run_candidates
                    WHERE planning_run_id = ?
                `).get(request.runId) as { count: number }).count
                if (count >= 6) {
                    throw new PlanningHistoryConflictError('Planning run already retains 6 candidates')
                }
                if (readCandidateForRunOrdinal(database, request.runId, request.candidate.ordinal)) {
                    throw new PlanningHistoryConflictError('Planning candidate ordinal already exists')
                }
                insertCandidate(
                    database,
                    request.runId,
                    request.candidate as PlanningRunCandidateCreateInput,
                    timestamp,
                )
                updateRunTimestamp(database, request.runId, timestamp)
            } else {
                const candidate = readCandidateForRunOrdinal(database, request.runId, request.ordinal)
                if (!candidate) throw new PlanningHistoryUnavailableError('Planning candidate is unavailable')
                if (candidate.user_disposition === 'confirmed') {
                    throw new PlanningHistoryConflictError('Confirmed planning candidates are immutable')
                }
                if (request.kind === 'commit_candidate') {
                    const current = snapshotFromRow(candidate)
                    const before = parseEditBefore(
                        candidate.edit_before_json,
                        current,
                        run.entry_point as PlanningEntryPoint,
                    )
                    const next = request.candidate as PlanningCandidateSnapshot
                    const updatedBefore: Partial<PlanningCandidateSnapshot> = { ...before }
                    for (const [field] of EDIT_FIELD_MAPPINGS) {
                        const hasBefore = Object.prototype.hasOwnProperty.call(before, field)
                        const baseline = hasBefore ? before[field] : current[field]
                        if (next[field] === baseline) {
                            delete updatedBefore[field]
                        } else if (!hasBefore && next[field] !== current[field]) {
                            ;(updatedBefore as Record<string, unknown>)[field] = current[field]
                        }
                    }
                    const editJson = serializeEditBefore(updatedBefore)
                    database.prepare(`
                        UPDATE planning_run_candidates
                        SET title = ?, description = ?, type = ?, estimate_minutes = ?,
                            priority = ?, subject_id = ?, related_mistake_id = ?,
                            related_entry_id = ?, edit_before_json = ?, updated_at = ?
                        WHERE planning_run_id = ? AND ordinal = ?
                    `).run(
                        next.title,
                        next.description,
                        next.type,
                        next.estimateMinutes,
                        next.priority,
                        next.subjectId,
                        next.relatedMistakeId,
                        next.relatedEntryId,
                        editJson,
                        timestamp,
                        request.runId,
                        request.ordinal,
                    )
                } else if (request.kind === 'set_selection') {
                    database.prepare(`
                        UPDATE planning_run_candidates
                        SET user_disposition = ?, updated_at = ?
                        WHERE planning_run_id = ? AND ordinal = ?
                    `).run(
                        request.selected ? 'selected_unconfirmed' : 'unselected',
                        timestamp,
                        request.runId,
                        request.ordinal,
                    )
                } else {
                    database.prepare(`
                        DELETE FROM planning_run_candidates
                        WHERE planning_run_id = ? AND ordinal = ?
                    `).run(request.runId, request.ordinal)
                }
                updateRunTimestamp(database, request.runId, timestamp)
            }
            const updated = readRunRow(database, request.runId)
            if (!updated) throw new PlanningHistoryUnavailableError('Planning run is unavailable')
            return projectRun(database, updated)
        })
        return transaction()
    }

    function claimConfirmation(candidateIdValue: unknown, requestValue: unknown): { claimed: true } {
        const candidateId = requirePositiveSafeInteger(candidateIdValue, 'planningCandidateId')
        let request: IdempotentAIStudyTaskCreateRequest
        try {
            request = validateIdempotentAIStudyTaskCreateRequest(requestValue)
        } catch {
            throw new PlanningHistoryValidationError('Task request is unavailable for planning correlation')
        }
        const timestamp = getTrustedTimestamp(now)
        const transaction = database.transaction(() => {
            const candidate = readCandidateById(database, candidateId)
            if (!candidate) throw new PlanningHistoryUnavailableError('Planning candidate is unavailable')
            if (
                candidate.entry_point !== request.operationKind
                || candidate.planning_date !== request.expectedCurrentDate
                || candidate.target_date !== request.payload.planned_date
            ) {
                throw new PlanningHistoryConflictError('Task request dates do not match the planning candidate')
            }
            const payload = request.payload
            if (
                candidate.title !== payload.title
                || candidate.description !== payload.description
                || candidate.type !== payload.type
                || candidate.estimate_minutes !== payload.estimate_minutes
                || candidate.subject_id !== payload.subject_id
                || candidate.related_mistake_id !== payload.related_mistake_id
                || candidate.related_entry_id !== payload.related_entry_id
                || payload.related_chapter_id !== null
                || payload.status !== 'todo'
                || payload.source !== 'ai'
            ) {
                throw new PlanningHistoryConflictError('Task request payload does not match the planning candidate')
            }
            if (candidate.user_disposition === 'confirmed') {
                if (candidate.operation_id !== request.operationId) {
                    throw new PlanningHistoryConflictError('Planning candidate is bound to a different operation')
                }
                if (candidate.outcome_kind !== null && candidate.outcome_kind !== 'uncertain') {
                    throw new PlanningHistoryConflictError('Planning candidate already has a definitive outcome')
                }
                return { claimed: true } as const
            }
            if (candidate.user_disposition !== 'selected_unconfirmed' || candidate.operation_id !== null) {
                throw new PlanningHistoryConflictError('Planning candidate is not selected for confirmation')
            }
            if (candidate.closed_at !== null) {
                throw new PlanningHistoryConflictError('Planning run is closed')
            }
            database.prepare(`
                UPDATE planning_run_candidates
                SET user_disposition = 'confirmed', operation_id = ?, updated_at = ?
                WHERE id = ?
                  AND user_disposition = 'selected_unconfirmed'
                  AND operation_id IS NULL
            `).run(request.operationId, timestamp, candidateId)
            updateRunTimestamp(database, candidate.planning_run_id as string, timestamp)
            return { claimed: true } as const
        })
        return transaction()
    }

    function recordOutcome(
        candidateIdValue: unknown,
        operationIdValue: unknown,
        outcomeValue: unknown,
    ): { recorded: boolean } {
        const candidateId = requirePositiveSafeInteger(candidateIdValue, 'planningCandidateId')
        const operationId = requireUuid(operationIdValue, 'operationId')
        const outcomeKind = requireEnum(outcomeValue, OUTCOME_KINDS, 'outcomeKind')
        const timestamp = getTrustedTimestamp(now)
        const transaction = database.transaction(() => {
            const candidate = readCandidateById(database, candidateId)
            if (!candidate) return { recorded: false }
            if (candidate.user_disposition !== 'confirmed' || candidate.operation_id !== operationId) {
                throw new PlanningHistoryConflictError('Planning candidate operation does not match')
            }
            const existing = candidate.outcome_kind
            if (existing !== null && existing !== 'uncertain' && existing !== outcomeKind) {
                throw new PlanningHistoryConflictError('Planning candidate outcome is definitive and immutable')
            }
            if (existing === outcomeKind || (existing !== null && existing !== 'uncertain')) {
                return { recorded: true }
            }
            database.prepare(`
                UPDATE planning_run_candidates
                SET outcome_kind = ?, outcome_observed_at = ?, updated_at = ?
                WHERE id = ? AND operation_id = ?
            `).run(outcomeKind, timestamp, timestamp, candidateId, operationId)
            return { recorded: true }
        })
        return transaction()
    }

    function removeRun(idValue: unknown): { deleted: boolean } {
        const id = requireUuid(idValue, 'run id')
        const result = database.prepare('DELETE FROM planning_runs WHERE id = ?').run(id)
        return { deleted: result.changes === 1 }
    }

    function clear(): { deletedCount: number } {
        const transaction = database.transaction(() => {
            const result = database.prepare('DELETE FROM planning_runs').run()
            return { deletedCount: result.changes }
        })
        return transaction()
    }

    function listRecent(optionsValue: unknown = {}): PlanningRunListResult {
        const options = requirePlainObject(optionsValue, 'list options')
        const ownKeys = Reflect.ownKeys(options)
        if (ownKeys.some(key => typeof key !== 'string' || !['limit', 'cursor'].includes(key))) {
            throw new PlanningHistoryValidationError('list options contain unsupported fields')
        }
        for (const key of ownKeys) {
            const descriptor = Object.getOwnPropertyDescriptor(options, key)
            if (!descriptor || !('value' in descriptor)) {
                throw new PlanningHistoryValidationError(`list options.${String(key)} must be an own data property`)
            }
        }
        const rawLimit = Object.prototype.hasOwnProperty.call(options, 'limit') ? readOwn(options, 'limit') : 20
        if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
            throw new PlanningHistoryValidationError('list options.limit must be an integer from 1 to 50')
        }
        let cursor: { beforeCreatedAt: string; beforeId: string } | null = null
        if (Object.prototype.hasOwnProperty.call(options, 'cursor')) {
            const cursorRecord = requirePlainObject(readOwn(options, 'cursor'), 'list options.cursor')
            assertExactOwnDataKeys(cursorRecord, ['beforeCreatedAt', 'beforeId'], 'list options.cursor')
            const beforeCreatedAt = readOwn(cursorRecord, 'beforeCreatedAt')
            if (
                typeof beforeCreatedAt !== 'string'
                || !UTC_TIMESTAMP_PATTERN.test(beforeCreatedAt)
                || !Number.isFinite(Date.parse(beforeCreatedAt))
            ) {
                throw new PlanningHistoryValidationError('list cursor timestamp is invalid')
            }
            cursor = {
                beforeCreatedAt,
                beforeId: requireUuid(readOwn(cursorRecord, 'beforeId'), 'list cursor id'),
            }
        }
        const rows = (cursor
            ? database.prepare(`
                SELECT id, contract_version, entry_point, planning_date, target_date,
                       generation_result_kind, context_summary_json, created_at, updated_at,
                       closed_at, close_reason
                FROM planning_runs
                WHERE created_at < ? OR (created_at = ? AND id < ?)
                ORDER BY created_at DESC, id DESC
                LIMIT ?
            `).all(cursor.beforeCreatedAt, cursor.beforeCreatedAt, cursor.beforeId, rawLimit)
            : database.prepare(`
                SELECT id, contract_version, entry_point, planning_date, target_date,
                       generation_result_kind, context_summary_json, created_at, updated_at,
                       closed_at, close_reason
                FROM planning_runs
                ORDER BY created_at DESC, id DESC
                LIMIT ?
            `).all(rawLimit)) as PlanningRunRow[]

        if (rows.length === 0) {
            return {
                items: [],
                nextCursor: null,
            }
        }

        const runIds = rows.map(r => r.id as string)
        const allCandidateRows = readCandidatesForRunIds(database, runIds)
        const maps = loadBatchMaps(database, allCandidateRows)

        const candidatesByRunId = new Map<string, PlanningCandidateRow[]>()
        for (const runId of runIds) {
            candidatesByRunId.set(runId, [])
        }
        for (const candidate of allCandidateRows) {
            const list = candidatesByRunId.get(candidate.planning_run_id as string)
            if (list) {
                list.push(candidate)
            }
        }

        const items = rows.map(row => projectRunFromMaps(
            row,
            candidatesByRunId.get(row.id as string) ?? [],
            maps,
        ))
        const last = items.length > 0 ? items[items.length - 1] : undefined
        return {
            items,
            nextCursor: items.length === rawLimit && last
                ? { beforeCreatedAt: last.createdAt, beforeId: last.id }
                : null,
        }
    }

    function closeRuns(runIdsValue: Iterable<unknown>, reasonValue: unknown): number {
        const reason = requireEnum(
            reasonValue,
            ['app_closed'] as const,
            'close reason',
        )
        if (
            runIdsValue === null
            || typeof runIdsValue !== 'object'
            || !(Symbol.iterator in runIdsValue)
        ) {
            throw new PlanningHistoryValidationError('run ids must be iterable')
        }
        const runIds = Array.from(runIdsValue, id => requireUuid(id, 'run id'))
        if (runIds.length === 0) return 0
        const timestamp = getTrustedTimestamp(now)
        const close = database.prepare(`
            UPDATE planning_runs
            SET closed_at = ?, close_reason = ?, updated_at = ?
            WHERE id = ? AND closed_at IS NULL AND close_reason IS NULL
        `)
        return database.transaction(() => runIds.reduce(
            (total, runId) => total + close.run(timestamp, reason, timestamp, runId).changes,
            0,
        ))()
    }

    return {
        create,
        transition,
        listRecent,
        get,
        delete: removeRun,
        clear,
        claimConfirmation,
        recordOutcome,
        closeRuns,
    }
}
