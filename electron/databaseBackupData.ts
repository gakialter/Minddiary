import path from 'path';
import { SENSITIVE_SETTINGS_KEYS } from './settingsSecurity';

export type DatabaseBackupValue = string | number | null;
export type DatabaseBackupRow = Record<string, DatabaseBackupValue>;

const PLANNING_HISTORY_SCHEMA_VERSION = 7;
const PLANNING_HISTORY_CONTRACT_VERSION = 'planning-history.v1';
const LOWERCASE_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PLANNING_RUN_COLUMNS = [
    'id',
    'contract_version',
    'entry_point',
    'planning_date',
    'target_date',
    'generation_result_kind',
    'context_summary_json',
    'created_at',
    'updated_at',
    'closed_at',
    'close_reason',
] as const;
const PLANNING_CANDIDATE_COLUMNS = [
    'id',
    'planning_run_id',
    'ordinal',
    'admission_origin',
    'title',
    'description',
    'type',
    'estimate_minutes',
    'priority',
    'subject_id',
    'related_mistake_id',
    'related_entry_id',
    'edit_before_json',
    'user_disposition',
    'operation_id',
    'outcome_kind',
    'outcome_observed_at',
    'admitted_at',
    'updated_at',
] as const;
const EDITABLE_CANDIDATE_FIELDS = [
    'title',
    'description',
    'type',
    'estimate_minutes',
    'priority',
    'subject_id',
    'related_mistake_id',
    'related_entry_id',
] as const;
const STUDY_TASK_TYPES = ['review', 'focus', 'diary', 'mistake', 'custom'] as const;
const CANDIDATE_PRIORITIES = ['high', 'medium', 'low'] as const;
const CANDIDATE_ADMISSION_ORIGINS = ['provider_validated', 'provider_suggested_user_repaired'] as const;
const CANDIDATE_DISPOSITIONS = ['selected_unconfirmed', 'unselected', 'confirmed'] as const;
const CANDIDATE_OUTCOMES = [
    'created',
    'replayed',
    'uncertain',
    'conflict',
    'deleted',
    'integrity_error',
    'date_mismatch',
    'validation_error',
] as const;
const TODAY_CONTEXT_CATEGORIES = [
    'available_minutes',
    'today_tasks',
    'due_mistakes',
    'subjects',
    'today_entry',
    'chapters',
    'focus_history',
] as const;
const DAILY_CONTEXT_CATEGORIES = [
    'today_tasks',
    'candidate_date_tasks',
    'pomodoro',
    'subjects',
    'today_entry',
    'due_mistakes',
    'available_minutes',
] as const;
const CONTEXT_PREPARATIONS = [
    'prepared',
    'prepared_empty',
    'source_unavailable',
    'not_integrated',
    'preparation_failed',
] as const;
const CONTEXT_DISPOSITIONS = ['included', 'included_empty', 'partially_included', 'excluded'] as const;
const CONTEXT_REASON_CODES = [
    'included_required',
    'included_available',
    'included_empty',
    'limit_applied',
    'no_record',
    'source_unavailable',
    'not_integrated',
    'preparation_failed',
] as const;
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
]);

export interface NormalizedBackupDatabaseData {
    settings: DatabaseBackupRow[];
    subjects: DatabaseBackupRow[];
    subject_chapters: DatabaseBackupRow[];
    tags: DatabaseBackupRow[];
    entries: DatabaseBackupRow[];
    entry_tags: DatabaseBackupRow[];
    attachments: DatabaseBackupRow[];
    pomodoro_sessions: DatabaseBackupRow[];
    mistakes: DatabaseBackupRow[];
    study_tasks: DatabaseBackupRow[];
    study_task_action_receipts: DatabaseBackupRow[];
    planning_runs: DatabaseBackupRow[];
    planning_run_candidates: DatabaseBackupRow[];
    ai_chats: DatabaseBackupRow[];
    diary_templates: DatabaseBackupRow[];
}

export const DATABASE_BACKUP_TABLES = [
    {
        key: 'settings',
        table: 'settings',
        columns: ['key', 'value'],
    },
    {
        key: 'subjects',
        table: 'subjects',
        columns: ['id', 'name', 'total_chapters', 'completed_chapters', 'color'],
    },
    {
        key: 'subject_chapters',
        table: 'subject_chapters',
        columns: ['id', 'subject_id', 'title', 'notes', 'completed', 'sort_order', 'created_at', 'updated_at'],
    },
    {
        key: 'tags',
        table: 'tags',
        columns: ['id', 'name', 'color', 'icon', 'variant', 'pattern'],
    },
    {
        key: 'entries',
        table: 'entries',
        columns: ['id', 'date', 'title', 'content', 'mood', 'word_count', 'created_at', 'updated_at'],
    },
    {
        key: 'entry_tags',
        table: 'entry_tags',
        columns: ['entry_id', 'tag_id'],
    },
    {
        key: 'attachments',
        table: 'attachments',
        columns: ['id', 'entry_id', 'filename', 'filepath', 'mimetype', 'created_at'],
    },
    {
        key: 'mistakes',
        table: 'mistakes',
        columns: [
            'id',
            'subject_id',
            'question',
            'answer',
            'notes',
            'mastered',
            'created_at',
            'updated_at',
            'ease_factor',
            'review_interval',
            'next_review_date',
            'review_count',
            'image_path',
            'answer_image_path',
        ],
    },
    {
        key: 'study_tasks',
        table: 'study_tasks',
        columns: [
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
        ],
    },
    {
        key: 'study_task_action_receipts',
        table: 'study_task_action_receipts',
        columns: [
            'operation_id',
            'operation_kind',
            'action_contract_version',
            'request_digest',
            'expected_current_date',
            'planned_date',
            'task_id',
            'created_at',
        ],
    },
    {
        key: 'planning_runs',
        table: 'planning_runs',
        columns: PLANNING_RUN_COLUMNS,
    },
    {
        key: 'planning_run_candidates',
        table: 'planning_run_candidates',
        columns: PLANNING_CANDIDATE_COLUMNS,
    },
    {
        key: 'pomodoro_sessions',
        table: 'pomodoro_sessions',
        columns: ['id', 'subject_id', 'task_id', 'duration', 'date_key', 'started_at', 'completed_at'],
    },
    {
        key: 'ai_chats',
        table: 'ai_chats',
        columns: ['id', 'entry_id', 'role', 'content', 'created_at'],
    },
    {
        key: 'diary_templates',
        table: 'diary_templates',
        columns: ['id', 'name', 'content', 'is_default', 'sort_order', 'created_at', 'updated_at'],
    },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requirePlainRecord(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error(`Invalid database backup: ${label} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`Invalid database backup: ${label} must be a plain object`);
    }
    return value;
}

function requireExactOwnDataKeys(
    record: Record<string, unknown>,
    keys: readonly string[],
    label: string,
): void {
    const ownKeys = Reflect.ownKeys(record);
    if (
        ownKeys.length !== keys.length
        || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))
        || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key))
    ) {
        throw new Error(`Invalid database backup: ${label} must contain exactly the supported fields`);
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !('value' in descriptor)) {
            throw new Error(`Invalid database backup: ${label}.${key} must be an own data property`);
        }
    }
}

function readOwn(record: Record<string, unknown>, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) {
        throw new Error(`Invalid database backup: ${key} must be an own data property`);
    }
    return descriptor.value;
}

function requireStringEnum(value: unknown, allowed: readonly string[], label: string): string {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new Error(`Invalid database backup: ${label} is invalid`);
    }
    return value;
}

function requireUuid(value: unknown, label: string): string {
    if (typeof value !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(value)) {
        throw new Error(`Invalid database backup: ${label} must be a lowercase UUID v4`);
    }
    return value;
}

function requireUtcTimestamp(value: unknown, label: string): string {
    if (
        typeof value !== 'string'
        || !UTC_TIMESTAMP_PATTERN.test(value)
        || !Number.isFinite(Date.parse(value))
        || new Date(value).toISOString() !== value
    ) {
        throw new Error(`Invalid database backup: ${label} must be a UTC timestamp with millisecond precision`);
    }
    return value;
}

function daysInMonth(year: number, month: number): number {
    if (month === 2) {
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function requireDateKey(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new Error(`Invalid database backup: ${label} must be a canonical local date`);
    }
    const match = DATE_KEY_PATTERN.exec(value);
    if (!match) {
        throw new Error(`Invalid database backup: ${label} must be a canonical local date`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
        throw new Error(`Invalid database backup: ${label} must be an actual calendar date`);
    }
    return value;
}

function nextDateKey(value: string): string | null {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    if (day < daysInMonth(year, month)) {
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`;
    }
    if (month < 12) return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
    if (year < 9999) return `${String(year + 1).padStart(4, '0')}-01-01`;
    return null;
}

function requireCanonicalContextJson(value: unknown, entryPoint: string, label: string): string {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 4096) {
        throw new Error(`Invalid database backup: ${label} exceeds its UTF-8 byte limit`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error(`Invalid database backup: ${label} must be valid JSON`);
    }
    const categories = entryPoint === 'today_action' ? TODAY_CONTEXT_CATEGORIES : DAILY_CONTEXT_CATEGORIES;
    if (!Array.isArray(parsed) || parsed.length !== categories.length || parsed.length > 12) {
        throw new Error(`Invalid database backup: ${label} must contain the frozen context categories`);
    }
    const canonical = parsed.map((item, index) => {
        const itemLabel = `${label}[${index}]`;
        const record = requirePlainRecord(item, itemLabel);
        requireExactOwnDataKeys(record, ['category', 'preparation', 'disposition', 'reasonCode'], itemLabel);
        const category = readOwn(record, 'category');
        if (category !== categories[index]) {
            throw new Error(`Invalid database backup: ${label} categories must use canonical order`);
        }
        const preparation = requireStringEnum(readOwn(record, 'preparation'), CONTEXT_PREPARATIONS, `${itemLabel}.preparation`);
        const disposition = requireStringEnum(readOwn(record, 'disposition'), CONTEXT_DISPOSITIONS, `${itemLabel}.disposition`);
        const reasonCode = requireStringEnum(readOwn(record, 'reasonCode'), CONTEXT_REASON_CODES, `${itemLabel}.reasonCode`);
        if (!VALID_CONTEXT_TUPLES.has(`${preparation}|${disposition}|${reasonCode}`)) {
            throw new Error(`Invalid database backup: ${itemLabel} has an invalid semantic tuple`);
        }
        return { category, preparation, disposition, reasonCode };
    });
    if (JSON.stringify(canonical) !== value) {
        throw new Error(`Invalid database backup: ${label} must use canonical JSON`);
    }
    return value;
}

function normalizePlanningRuns(raw: unknown): DatabaseBackupRow[] {
    if (!Array.isArray(raw)) {
        throw new Error('Invalid database backup: planning_runs must be an array');
    }
    const seenIds = new Set<string>();
    return raw.map((value, index) => {
        const label = `planning_runs[${index}]`;
        const row = requirePlainRecord(value, label);
        requireExactOwnDataKeys(row, PLANNING_RUN_COLUMNS, label);
        const id = requireUuid(readOwn(row, 'id'), `${label}.id`);
        if (seenIds.has(id)) throw new Error('Invalid database backup: duplicate planning run id');
        seenIds.add(id);
        const contractVersion = requireStringEnum(
            readOwn(row, 'contract_version'),
            [PLANNING_HISTORY_CONTRACT_VERSION],
            `${label}.contract_version`,
        );
        const entryPoint = requireStringEnum(
            readOwn(row, 'entry_point'),
            ['today_action', 'daily_review'],
            `${label}.entry_point`,
        );
        const planningDate = requireDateKey(readOwn(row, 'planning_date'), `${label}.planning_date`);
        const targetDate = requireDateKey(readOwn(row, 'target_date'), `${label}.target_date`);
        const expectedTargetDate = entryPoint === 'today_action' ? planningDate : nextDateKey(planningDate);
        if (targetDate !== expectedTargetDate) {
            throw new Error(`Invalid database backup: ${label}.target_date violates the entry-point date invariant`);
        }
        const generationResultKind = requireStringEnum(
            readOwn(row, 'generation_result_kind'),
            ['valid_empty', 'candidate_set'],
            `${label}.generation_result_kind`,
        );
        const contextSummaryJson = requireCanonicalContextJson(
            readOwn(row, 'context_summary_json'),
            entryPoint,
            `${label}.context_summary_json`,
        );
        const createdAt = requireUtcTimestamp(readOwn(row, 'created_at'), `${label}.created_at`);
        const updatedAt = requireUtcTimestamp(readOwn(row, 'updated_at'), `${label}.updated_at`);
        if (updatedAt < createdAt) {
            throw new Error(`Invalid database backup: ${label}.updated_at cannot precede created_at`);
        }
        const rawClosedAt = readOwn(row, 'closed_at');
        const rawCloseReason = readOwn(row, 'close_reason');
        let closedAt: string | null = null;
        let closeReason: string | null = null;
        if (rawClosedAt !== null || rawCloseReason !== null) {
            if (rawClosedAt === null || rawCloseReason === null) {
                throw new Error(`Invalid database backup: ${label} close timestamp and reason must be paired`);
            }
            closedAt = requireUtcTimestamp(rawClosedAt, `${label}.closed_at`);
            closeReason = requireStringEnum(
                rawCloseReason,
                ['dialog_closed', 'regenerated', 'date_rollover', 'app_closed'],
                `${label}.close_reason`,
            );
            if (closedAt < createdAt) {
                throw new Error(`Invalid database backup: ${label}.closed_at cannot precede created_at`);
            }
        }
        return {
            id,
            contract_version: contractVersion,
            entry_point: entryPoint,
            planning_date: planningDate,
            target_date: targetDate,
            generation_result_kind: generationResultKind,
            context_summary_json: contextSummaryJson,
            created_at: createdAt,
            updated_at: updatedAt,
            closed_at: closedAt,
            close_reason: closeReason,
        };
    });
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid database backup: ${label} must be a positive safe integer`);
    }
    return value;
}

function requireNullablePositiveSafeInteger(value: unknown, label: string): number | null {
    return value === null ? null : requirePositiveSafeInteger(value, label);
}

function requireBoundedNormalizedText(
    value: unknown,
    label: string,
    maxUnits: number,
    maxBytes: number,
): string {
    if (typeof value !== 'string') {
        throw new Error(`Invalid database backup: ${label} must be a string`);
    }
    const normalized = value
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u00AD\u2060\uFEFF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized || normalized !== value) {
        throw new Error(`Invalid database backup: ${label} must be non-empty normalized text`);
    }
    if (value.length > maxUnits || Buffer.byteLength(value, 'utf8') > maxBytes) {
        throw new Error(`Invalid database backup: ${label} exceeds its length or UTF-8 byte limit`);
    }
    return value;
}

function requireEstimateMinutes(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 5 || value > 180) {
        throw new Error(`Invalid database backup: ${label} must be an integer from 5 to 180`);
    }
    return value;
}

function candidateFieldValue(row: DatabaseBackupRow, key: string): DatabaseBackupValue {
    return row[key] ?? null;
}

function normalizeEditBeforeJson(
    value: unknown,
    entryPoint: string,
    finalRow: DatabaseBackupRow,
    label: string,
): string {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 4096) {
        throw new Error(`Invalid database backup: ${label} exceeds its UTF-8 byte limit`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error(`Invalid database backup: ${label} must be valid JSON`);
    }
    const record = requirePlainRecord(parsed, label);
    const allowedFields = entryPoint === 'today_action'
        ? EDITABLE_CANDIDATE_FIELDS
        : EDITABLE_CANDIDATE_FIELDS.slice(0, -1);
    const ownKeys = Reflect.ownKeys(record);
    if (
        ownKeys.length > allowedFields.length
        || ownKeys.some(key => typeof key !== 'string' || !allowedFields.includes(key as typeof allowedFields[number]))
    ) {
        throw new Error(`Invalid database backup: ${label} must contain only supported edit fields`);
    }
    for (const key of ownKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !('value' in descriptor)) {
            throw new Error(`Invalid database backup: ${label}.${String(key)} must be an own data property`);
        }
    }

    const canonical: DatabaseBackupRow = {};
    for (const key of allowedFields) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
        const rawField = readOwn(record, key);
        let field: DatabaseBackupValue;
        switch (key) {
            case 'title':
                field = requireBoundedNormalizedText(rawField, `${label}.title`, 80, 240);
                break;
            case 'description':
                field = requireBoundedNormalizedText(rawField, `${label}.description`, 240, 720);
                break;
            case 'type':
                field = requireStringEnum(rawField, STUDY_TASK_TYPES, `${label}.type`);
                break;
            case 'estimate_minutes':
                field = requireEstimateMinutes(rawField, `${label}.estimate_minutes`);
                break;
            case 'priority':
                field = requireStringEnum(rawField, CANDIDATE_PRIORITIES, `${label}.priority`);
                break;
            default:
                field = requireNullablePositiveSafeInteger(rawField, `${label}.${key}`);
                break;
        }
        if (field === candidateFieldValue(finalRow, key)) {
            throw new Error(`Invalid database backup: ${label}.${key} does not describe a net edit`);
        }
        canonical[key] = field;
    }
    const reconstructedType = canonical.type !== undefined ? String(canonical.type) : String(finalRow.type);
    const reconstructedMistakeId = canonical.related_mistake_id !== undefined
        ? canonical.related_mistake_id
        : candidateFieldValue(finalRow, 'related_mistake_id');
    const reconstructedEntryId = canonical.related_entry_id !== undefined
        ? canonical.related_entry_id
        : candidateFieldValue(finalRow, 'related_entry_id');
    if ((reconstructedType === 'review') !== (reconstructedMistakeId !== null)) {
        throw new Error(`Invalid database backup: ${label} reconstructed before snapshot has inconsistent review relation`);
    }
    if (entryPoint === 'daily_review' && reconstructedEntryId !== null) {
        throw new Error(`Invalid database backup: ${label} reconstructed before snapshot has an entry relation in Daily Review`);
    }
    if (JSON.stringify(canonical) !== value) {
        throw new Error(`Invalid database backup: ${label} must use canonical JSON`);
    }
    return value;
}

function normalizePlanningCandidates(raw: unknown, planningRuns: DatabaseBackupRow[]): DatabaseBackupRow[] {
    if (!Array.isArray(raw)) {
        throw new Error('Invalid database backup: planning_run_candidates must be an array');
    }
    const runsById = new Map(planningRuns.map(row => [String(row.id), row]));
    const ids = new Set<number>();
    const ordinals = new Set<string>();
    const operations = new Set<string>();
    const countByRun = new Map<string, number>();

    const candidates = raw.map((value, index) => {
        const label = `planning_run_candidates[${index}]`;
        const source = requirePlainRecord(value, label);
        requireExactOwnDataKeys(source, PLANNING_CANDIDATE_COLUMNS, label);
        const id = requirePositiveSafeInteger(readOwn(source, 'id'), `${label}.id`);
        if (ids.has(id)) throw new Error('Invalid database backup: duplicate planning candidate id');
        ids.add(id);
        const planningRunId = requireUuid(readOwn(source, 'planning_run_id'), `${label}.planning_run_id`);
        const run = runsById.get(planningRunId);
        if (!run) throw new Error(`Invalid database backup: ${label} is an orphan planning candidate`);
        const ordinalValue = readOwn(source, 'ordinal');
        if (typeof ordinalValue !== 'number' || !Number.isInteger(ordinalValue) || ordinalValue < 0 || ordinalValue > 5) {
            throw new Error(`Invalid database backup: ${label}.ordinal must be an integer from 0 to 5`);
        }
        const ordinalKey = `${planningRunId}|${ordinalValue}`;
        if (ordinals.has(ordinalKey)) {
            throw new Error('Invalid database backup: duplicate planning candidate ordinal within a run');
        }
        ordinals.add(ordinalKey);
        const runCount = (countByRun.get(planningRunId) ?? 0) + 1;
        if (runCount > 6) throw new Error('Invalid database backup: a planning run has more than 6 candidates');
        countByRun.set(planningRunId, runCount);

        const type = requireStringEnum(readOwn(source, 'type'), STUDY_TASK_TYPES, `${label}.type`);
        const subjectId = requireNullablePositiveSafeInteger(readOwn(source, 'subject_id'), `${label}.subject_id`);
        const relatedMistakeId = requireNullablePositiveSafeInteger(
            readOwn(source, 'related_mistake_id'),
            `${label}.related_mistake_id`,
        );
        const relatedEntryId = requireNullablePositiveSafeInteger(
            readOwn(source, 'related_entry_id'),
            `${label}.related_entry_id`,
        );
        if ((type === 'review') !== (relatedMistakeId !== null)) {
            throw new Error(`Invalid database backup: ${label} review relation is inconsistent`);
        }
        if (run.entry_point === 'daily_review' && relatedEntryId !== null) {
            throw new Error(`Invalid database backup: ${label}.related_entry_id is not allowed for Daily Review`);
        }

        const row: DatabaseBackupRow = {
            id,
            planning_run_id: planningRunId,
            ordinal: ordinalValue,
            admission_origin: requireStringEnum(
                readOwn(source, 'admission_origin'),
                CANDIDATE_ADMISSION_ORIGINS,
                `${label}.admission_origin`,
            ),
            title: requireBoundedNormalizedText(readOwn(source, 'title'), `${label}.title`, 80, 240),
            description: requireBoundedNormalizedText(
                readOwn(source, 'description'),
                `${label}.description`,
                240,
                720,
            ),
            type,
            estimate_minutes: requireEstimateMinutes(readOwn(source, 'estimate_minutes'), `${label}.estimate_minutes`),
            priority: requireStringEnum(readOwn(source, 'priority'), CANDIDATE_PRIORITIES, `${label}.priority`),
            subject_id: subjectId,
            related_mistake_id: relatedMistakeId,
            related_entry_id: relatedEntryId,
        };
        row.edit_before_json = normalizeEditBeforeJson(
            readOwn(source, 'edit_before_json'),
            String(run.entry_point),
            row,
            `${label}.edit_before_json`,
        );
        const disposition = requireStringEnum(
            readOwn(source, 'user_disposition'),
            CANDIDATE_DISPOSITIONS,
            `${label}.user_disposition`,
        );
        const rawOperationId = readOwn(source, 'operation_id');
        const rawOutcomeKind = readOwn(source, 'outcome_kind');
        const rawOutcomeObservedAt = readOwn(source, 'outcome_observed_at');
        let operationId: string | null = null;
        let outcomeKind: string | null = null;
        let outcomeObservedAt: string | null = null;
        if (disposition !== 'confirmed') {
            if (rawOperationId !== null || rawOutcomeKind !== null || rawOutcomeObservedAt !== null) {
                throw new Error(`Invalid database backup: ${label} disposition state is invalid`);
            }
        } else {
            operationId = requireUuid(rawOperationId, `${label}.operation_id`);
            if (operations.has(operationId)) {
                throw new Error('Invalid database backup: duplicate planning candidate operation id');
            }
            operations.add(operationId);
            if (rawOutcomeKind === null || rawOutcomeObservedAt === null) {
                if (rawOutcomeKind !== null || rawOutcomeObservedAt !== null) {
                    throw new Error(`Invalid database backup: ${label} outcome kind and timestamp must be paired`);
                }
            } else {
                outcomeKind = requireStringEnum(rawOutcomeKind, CANDIDATE_OUTCOMES, `${label}.outcome_kind`);
                outcomeObservedAt = requireUtcTimestamp(rawOutcomeObservedAt, `${label}.outcome_observed_at`);
            }
        }
        const admittedAt = requireUtcTimestamp(readOwn(source, 'admitted_at'), `${label}.admitted_at`);
        const updatedAt = requireUtcTimestamp(readOwn(source, 'updated_at'), `${label}.updated_at`);
        if (admittedAt < String(run.created_at) || updatedAt < admittedAt) {
            throw new Error(`Invalid database backup: ${label} timestamp ownership is invalid`);
        }
        if (run.closed_at !== null && admittedAt > String(run.closed_at)) {
            throw new Error(`Invalid database backup: ${label} cannot be admitted after its run closed`);
        }
        if (outcomeObservedAt !== null && outcomeObservedAt < admittedAt) {
            throw new Error(`Invalid database backup: ${label}.outcome_observed_at cannot precede admitted_at`);
        }
        return {
            ...row,
            user_disposition: disposition,
            operation_id: operationId,
            outcome_kind: outcomeKind,
            outcome_observed_at: outcomeObservedAt,
            admitted_at: admittedAt,
            updated_at: updatedAt,
        };
    });

    for (const run of planningRuns) {
        if (run.generation_result_kind === 'valid_empty' && (countByRun.get(String(run.id)) ?? 0) > 0) {
            throw new Error('Invalid database backup: a valid_empty planning run cannot own candidates');
        }
    }
    return candidates;
}

function normalizeBackupValue(value: unknown, tableName: string, columnName: string): DatabaseBackupValue {
    if (value === null || typeof value === 'string' || typeof value === 'number') {
        return value;
    }
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    throw new Error(`Invalid database backup value for ${tableName}.${columnName}`);
}

export function validateAttachmentFilepath(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
        throw new Error('Invalid attachment filepath: expected a non-empty relative path');
    }

    const normalizedSeparators = value.replace(/\\/g, '/');
    const hasParentTraversal = normalizedSeparators.split('/').includes('..');
    const hasWindowsDrivePrefix = /^[A-Za-z]:/.test(value);
    if (
        path.posix.isAbsolute(normalizedSeparators)
        || path.win32.isAbsolute(value)
        || hasWindowsDrivePrefix
        || hasParentTraversal
    ) {
        throw new Error('Invalid attachment filepath: path must stay within the attachments directory');
    }

    return value;
}

function normalizeTableRows(raw: unknown, tableName: string): DatabaseBackupRow[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        throw new Error(`Invalid database backup: ${tableName} must be an array`);
    }

    return raw.map((row, index) => {
        if (!isRecord(row)) {
            throw new Error(`Invalid database backup: ${tableName}[${index}] must be an object`);
        }
        const normalized: DatabaseBackupRow = {};
        for (const [key, value] of Object.entries(row)) {
            if (value !== undefined) {
                normalized[key] = normalizeBackupValue(value, tableName, key);
            }
        }
        return normalized;
    });
}

function normalizeAttachments(raw: unknown): DatabaseBackupRow[] {
    return normalizeTableRows(raw, 'attachments').map(row => ({
        ...row,
        filepath: validateAttachmentFilepath(row.filepath),
    }));
}

function normalizeSettingValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

function isSensitiveSettingKey(key: string): boolean {
    return SENSITIVE_SETTINGS_KEYS.includes(key);
}

function normalizeSettings(raw: unknown): DatabaseBackupRow[] {
    if (raw === undefined) return [];
    if (Array.isArray(raw)) {
        return raw.flatMap((row, index) => {
            if (!isRecord(row) || typeof row.key !== 'string') {
                throw new Error(`Invalid database backup: settings[${index}] must have a string key`);
            }
            if (isSensitiveSettingKey(row.key)) return [];
            return [{ key: row.key, value: normalizeSettingValue(row.value) }];
        });
    }
    if (isRecord(raw)) {
        return Object.entries(raw)
            .filter(([key]) => !isSensitiveSettingKey(key))
            .map(([key, value]) => ({ key, value: normalizeSettingValue(value) }));
    }
    throw new Error('Invalid database backup: settings must be an object or an array');
}

function normalizeMistakes(raw: unknown): DatabaseBackupRow[] {
    if (raw === undefined) return [];
    if (Array.isArray(raw)) return normalizeTableRows(raw, 'mistakes');
    if (isRecord(raw) && Array.isArray(raw.data)) {
        return normalizeTableRows(raw.data, 'mistakes');
    }
    throw new Error('Invalid database backup: mistakes must be an array');
}

function normalizePomodoroSessions(raw: Record<string, unknown>): DatabaseBackupRow[] {
    if (Array.isArray(raw.pomodoro_sessions)) {
        return normalizeTableRows(raw.pomodoro_sessions, 'pomodoro_sessions');
    }
    if (!Array.isArray(raw.pomodoro)) {
        if (raw.pomodoro !== undefined) {
            throw new Error('Invalid database backup: pomodoro must be an array');
        }
        return [];
    }
    const candidateRows = raw.pomodoro.filter(isRecord);
    if (!candidateRows.every(row => 'duration' in row)) {
        return [];
    }
    return normalizeTableRows(candidateRows, 'pomodoro_sessions');
}

export function normalizeBackupDatabaseData(
    raw: Record<string, unknown>,
    manifestSchemaVersion = 6,
): NormalizedBackupDatabaseData {
    if (!isRecord(raw)) {
        throw new Error('Invalid database backup: data must be an object');
    }

    if (
        !Number.isInteger(manifestSchemaVersion)
        || manifestSchemaVersion < 1
        || manifestSchemaVersion > PLANNING_HISTORY_SCHEMA_VERSION
    ) {
        throw new Error(`Invalid database backup schema version: ${String(manifestSchemaVersion)}`);
    }
    if (
        manifestSchemaVersion >= PLANNING_HISTORY_SCHEMA_VERSION
        && (raw.planning_runs === undefined || raw.planning_run_candidates === undefined)
    ) {
        const missing = raw.planning_runs === undefined ? 'planning_runs' : 'planning_run_candidates';
        throw new Error(`Invalid schema 7 database backup: ${missing} is required`);
    }

    const planningRuns = manifestSchemaVersion >= PLANNING_HISTORY_SCHEMA_VERSION
        ? normalizePlanningRuns(raw.planning_runs)
        : [];
    const planningCandidates = manifestSchemaVersion >= PLANNING_HISTORY_SCHEMA_VERSION
        ? normalizePlanningCandidates(raw.planning_run_candidates, planningRuns)
        : [];

    return {
        settings: normalizeSettings(raw.settings),
        subjects: normalizeTableRows(raw.subjects, 'subjects'),
        subject_chapters: normalizeTableRows(raw.subject_chapters, 'subject_chapters'),
        tags: normalizeTableRows(raw.tags, 'tags'),
        entries: normalizeTableRows(raw.entries, 'entries'),
        entry_tags: normalizeTableRows(raw.entry_tags, 'entry_tags'),
        attachments: normalizeAttachments(raw.attachments),
        pomodoro_sessions: normalizePomodoroSessions(raw),
        mistakes: normalizeMistakes(raw.mistakes),
        study_tasks: normalizeTableRows(raw.study_tasks, 'study_tasks'),
        study_task_action_receipts: normalizeTableRows(
            raw.study_task_action_receipts,
            'study_task_action_receipts',
        ),
        planning_runs: planningRuns,
        planning_run_candidates: planningCandidates,
        ai_chats: normalizeTableRows(raw.ai_chats, 'ai_chats'),
        diary_templates: normalizeTableRows(raw.diary_templates, 'diary_templates'),
    };
}
