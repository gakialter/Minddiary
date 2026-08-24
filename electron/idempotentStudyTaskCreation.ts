import { createHash } from 'crypto';
import type Database from 'better-sqlite3';
import type {
    Mistake,
    NewStudyTask,
    StudyTask,
    StudyTaskSource,
    StudyTaskStatus,
    StudyTaskType,
    Subject,
} from '../src/types';
import type {
    IdempotentAIStudyTaskCreateRequest,
    IdempotentAIStudyTaskCreateResponse,
    TodayActionCommittedStatus,
    TodayActionCommittedStatusRequest,
} from '../src/types/api';
import {
    CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION,
    CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION,
    CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION,
} from '../src/utils/aiOperationContracts';
import {
    buildMistakeReviewContextSignatureString,
    prepareMistakeReviewSession,
} from '../src/utils/mistakeReviewSuggestions';
import { TODAY_ACTION_CHAPTER_CONTEXT_PROJECTION_VERSION } from '../src/utils/todayActionChapterContext';
import {
    TodayActionStaleReviewTokenStore,
    readAuthoritativeTodayActionChapterContext,
    type CanonicalTodayActionStaleAuthorizationCore,
} from './todayActionChapterContext';

export const IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION =
    CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION;

const BASE_REQUEST_KEYS = [
    'operationId',
    'operationKind',
    'actionContractVersion',
    'expectedCurrentDate',
    'payload',
] as const;
const TODAY_V2_REQUEST_KEYS = [
    'operationId',
    'operationKind',
    'actionContractVersion',
    'expectedCurrentDate',
    'contextProjectionVersion',
    'originalGenerationContextSignature',
    'generationChapterSignature',
    'latestReviewedChapterSignature',
    'staleContextOverride',
    'staleReviewToken',
    'payload',
] as const;
const MISTAKE_V2_REQUEST_KEYS = [
    'operationId',
    'operationKind',
    'actionContractVersion',
    'expectedCurrentDate',
    'contextProjectionVersion',
    'generationContextSignature',
    'generationMistakeRef',
    'payload',
] as const;
const TODAY_COMMITTED_STATUS_REQUEST_KEYS = [
    'operationId',
    'operationKind',
    'actionContractVersion',
    'expectedCurrentDate',
    'plannedDate',
] as const;
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
] as const;
const STUDY_TASK_TYPES: readonly StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom'];
const STUDY_TASK_STATUSES: readonly StudyTaskStatus[] = ['todo', 'doing', 'done', 'skipped'];
const STUDY_TASK_SOURCES: readonly StudyTaskSource[] = ['manual', 'dashboard', 'ai', 'pomodoro'];
const LOWERCASE_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MISTAKE_REF_PATTERN = /^m(?:[1-9]|1[0-2])$/;
const LEGACY_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION = 'confirmed-mistake-review-task-action.v1';
const MISTAKE_REVIEW_CONTEXT_PROJECTION_VERSION = 'mistake-review.context-projection.v1';
const STALE_MISTAKE_REVIEW_MESSAGE = '错题上下文已变化，请重新生成建议后再确认；本次未创建任务。';
const STALE_TODAY_ACTION_MESSAGE = '章节上下文已变化，请查看最新章节进度后再次确认；本次未创建任务。';
const TITLE_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 240;
const ESTIMATE_MINUTES_MIN = 5;
const ESTIMATE_MINUTES_MAX = 180;

type CanonicalAIStudyTaskPayload = Required<NewStudyTask>;

type IdempotentStudyTaskCreationDependencies = {
    database: Database.Database;
    getCurrentDateKey: () => string;
    createTask: (task: NewStudyTask) => StudyTask;
    trustedSession?: object;
    tokenStore?: TodayActionStaleReviewTokenStore;
};

type StudyTaskActionReceiptRow = {
    operation_id: unknown;
    operation_kind: unknown;
    action_contract_version: unknown;
    request_digest: unknown;
    expected_current_date: unknown;
    planned_date: unknown;
    task_id: unknown;
    created_at: unknown;
};

type StudyTaskRow = {
    id: unknown;
    title: unknown;
    description: unknown;
    type: unknown;
    subject_id: unknown;
    related_mistake_id: unknown;
    related_entry_id: unknown;
    related_chapter_id: unknown;
    planned_date: unknown;
    estimate_minutes: unknown;
    status: unknown;
    source: unknown;
    created_at: unknown;
    updated_at: unknown;
};

class RequestValidationError extends Error {}
class FreshTodayActionValidationError extends Error {}
class FreshMistakeReviewValidationError extends Error {}
class CurrentDateMismatchError extends Error {}
class PersistenceIntegrityError extends Error {}

function isObjectRecord(value: unknown): value is object {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactOwnKeys(record: object, allowedKeys: readonly string[], label: string): void {
    const ownKeys = Reflect.ownKeys(record);
    if (
        ownKeys.length !== allowedKeys.length
        || ownKeys.some(key => typeof key !== 'string' || !allowedKeys.includes(key))
        || allowedKeys.some(key => !Object.prototype.hasOwnProperty.call(record, key))
    ) {
        throw new RequestValidationError(`${label} must contain exactly the supported fields`);
    }
}

function readOwnDataProperty(record: object, key: string, label: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) {
        throw new RequestValidationError(`${label}.${key} must be an own data property`);
    }
    return descriptor.value;
}

function requireObjectRecord(value: unknown, label: string): object {
    if (!isObjectRecord(value)) {
        throw new RequestValidationError(`${label} must be an object`);
    }
    return value;
}

function normalizeBoundedText(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== 'string') {
        throw new RequestValidationError(`${label} must be a string`);
    }
    const normalized = value
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u00AD\u2060\uFEFF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) {
        throw new RequestValidationError(`${label} is required`);
    }
    if (normalized.length > maxLength) {
        throw new RequestValidationError(`${label} must be ${maxLength} characters or fewer`);
    }
    return normalized;
}

function requireNullablePositiveId(value: unknown, label: string): number | null {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new RequestValidationError(`${label} must be a positive safe integer or null`);
    }
    return value;
}

function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number): number {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function requireActualDateKey(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new RequestValidationError(`${label} must be a YYYY-MM-DD date`);
    }
    const match = DATE_KEY_PATTERN.exec(value);
    if (!match) {
        throw new RequestValidationError(`${label} must be a YYYY-MM-DD date`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (
        year < 1
        || year > 9999
        || month < 1
        || month > 12
        || day < 1
        || day > getDaysInMonth(year, month)
    ) {
        throw new RequestValidationError(`${label} must be an actual calendar date`);
    }
    return value;
}

function getNextDateKey(dateKey: string): string | null {
    const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
    if (day < getDaysInMonth(year, month)) {
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`;
    }
    if (month < 12) {
        return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
    }
    if (year < 9999) {
        return `${String(year + 1).padStart(4, '0')}-01-01`;
    }
    return null;
}

function validatePayload(value: unknown): CanonicalAIStudyTaskPayload {
    const payload = requireObjectRecord(value, 'request.payload');
    assertExactOwnKeys(payload, PAYLOAD_KEYS, 'request.payload');

    const type = readOwnDataProperty(payload, 'type', 'request.payload');
    if (typeof type !== 'string' || !STUDY_TASK_TYPES.includes(type as StudyTaskType)) {
        throw new RequestValidationError('request.payload.type is invalid');
    }

    const estimateMinutes = readOwnDataProperty(payload, 'estimate_minutes', 'request.payload');
    if (
        typeof estimateMinutes !== 'number'
        || !Number.isInteger(estimateMinutes)
        || estimateMinutes < ESTIMATE_MINUTES_MIN
        || estimateMinutes > ESTIMATE_MINUTES_MAX
    ) {
        throw new RequestValidationError(
            `request.payload.estimate_minutes must be an integer between ${ESTIMATE_MINUTES_MIN} and ${ESTIMATE_MINUTES_MAX}`,
        );
    }

    const status = readOwnDataProperty(payload, 'status', 'request.payload');
    if (status !== 'todo') {
        throw new RequestValidationError('request.payload.status must be todo');
    }
    const source = readOwnDataProperty(payload, 'source', 'request.payload');
    if (source !== 'ai') {
        throw new RequestValidationError('request.payload.source must be ai');
    }

    return {
        title: normalizeBoundedText(
            readOwnDataProperty(payload, 'title', 'request.payload'),
            'request.payload.title',
            TITLE_MAX_LENGTH,
        ),
        description: normalizeBoundedText(
            readOwnDataProperty(payload, 'description', 'request.payload'),
            'request.payload.description',
            DESCRIPTION_MAX_LENGTH,
        ),
        type: type as StudyTaskType,
        subject_id: requireNullablePositiveId(
            readOwnDataProperty(payload, 'subject_id', 'request.payload'),
            'request.payload.subject_id',
        ),
        related_mistake_id: requireNullablePositiveId(
            readOwnDataProperty(payload, 'related_mistake_id', 'request.payload'),
            'request.payload.related_mistake_id',
        ),
        related_entry_id: requireNullablePositiveId(
            readOwnDataProperty(payload, 'related_entry_id', 'request.payload'),
            'request.payload.related_entry_id',
        ),
        related_chapter_id: requireNullablePositiveId(
            readOwnDataProperty(payload, 'related_chapter_id', 'request.payload'),
            'request.payload.related_chapter_id',
        ),
        planned_date: requireActualDateKey(
            readOwnDataProperty(payload, 'planned_date', 'request.payload'),
            'request.payload.planned_date',
        ),
        estimate_minutes: estimateMinutes,
        status: 'todo',
        source: 'ai',
    };
}

export function validateIdempotentAIStudyTaskCreateRequest(
    value: unknown,
): IdempotentAIStudyTaskCreateRequest {
    const request = requireObjectRecord(value, 'request');
    const operationKind = readOwnDataProperty(request, 'operationKind', 'request');
    if (
        operationKind !== 'today_action'
        && operationKind !== 'daily_review'
        && operationKind !== 'mistake_review'
    ) {
        throw new RequestValidationError('request.operationKind is invalid');
    }

    const actionContractVersion = readOwnDataProperty(request, 'actionContractVersion', 'request');
    const isTodayV2 = operationKind === 'today_action'
        && actionContractVersion === CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION;
    const isMistakeV2 = operationKind === 'mistake_review'
        && actionContractVersion === CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION;
    assertExactOwnKeys(
        request,
        isTodayV2
            ? TODAY_V2_REQUEST_KEYS
            : isMistakeV2
                ? MISTAKE_V2_REQUEST_KEYS
                : BASE_REQUEST_KEYS,
        'request',
    );

    const operationId = readOwnDataProperty(request, 'operationId', 'request');
    if (typeof operationId !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(operationId)) {
        throw new RequestValidationError('request.operationId must be a lowercase UUID v4');
    }

    if (operationKind === 'today_action') {
        if (
            actionContractVersion !== IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION
            && actionContractVersion !== CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION
        ) {
            throw new RequestValidationError('request.actionContractVersion is unsupported');
        }
    } else if (operationKind === 'daily_review') {
        if (actionContractVersion !== IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION) {
            throw new RequestValidationError('request.actionContractVersion is unsupported');
        }
    } else if (operationKind === 'mistake_review') {
        if (
            actionContractVersion !== CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION
            && actionContractVersion !== LEGACY_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION
        ) {
            throw new RequestValidationError('request.actionContractVersion is unsupported');
        }
    } else {
        throw new RequestValidationError('request.actionContractVersion is unsupported');
    }

    const expectedCurrentDate = requireActualDateKey(
        readOwnDataProperty(request, 'expectedCurrentDate', 'request'),
        'request.expectedCurrentDate',
    );
    const payload = validatePayload(readOwnDataProperty(request, 'payload', 'request'));
    const invariantPlannedDate = (operationKind === 'today_action' || operationKind === 'mistake_review')
        ? expectedCurrentDate
        : getNextDateKey(expectedCurrentDate);
    if (payload.planned_date !== invariantPlannedDate) {
        throw new RequestValidationError(
            `request.payload.planned_date does not satisfy the ${operationKind} date invariant`,
        );
    }
    if (operationKind === 'today_action' && payload.related_chapter_id !== null) {
        throw new RequestValidationError('request.payload.related_chapter_id must be null for today_action');
    }

    const base: IdempotentAIStudyTaskCreateRequest = {
        operationId,
        operationKind,
        actionContractVersion,
        expectedCurrentDate,
        payload,
    };
    if (isTodayV2) {
        const contextProjectionVersion = readOwnDataProperty(request, 'contextProjectionVersion', 'request');
        if (contextProjectionVersion !== TODAY_ACTION_CHAPTER_CONTEXT_PROJECTION_VERSION) {
            throw new RequestValidationError('request.contextProjectionVersion is unsupported');
        }
        const originalGenerationContextSignature = readOwnDataProperty(
            request,
            'originalGenerationContextSignature',
            'request',
        );
        const generationChapterSignature = readOwnDataProperty(
            request,
            'generationChapterSignature',
            'request',
        );
        const latestReviewedChapterSignature = readOwnDataProperty(
            request,
            'latestReviewedChapterSignature',
            'request',
        );
        for (const [label, signature] of [
            ['originalGenerationContextSignature', originalGenerationContextSignature],
            ['generationChapterSignature', generationChapterSignature],
            ['latestReviewedChapterSignature', latestReviewedChapterSignature],
        ] as const) {
            if (typeof signature !== 'string' || !SHA256_PATTERN.test(signature)) {
                throw new RequestValidationError(`request.${label} must be a lowercase SHA-256 digest`);
            }
        }
        const staleContextOverride = readOwnDataProperty(request, 'staleContextOverride', 'request');
        const staleReviewToken = readOwnDataProperty(request, 'staleReviewToken', 'request');
        if (staleContextOverride === false) {
            if (
                staleReviewToken !== null
                || latestReviewedChapterSignature !== generationChapterSignature
            ) {
                throw new RequestValidationError('request stale-review state is invalid');
            }
        } else if (staleContextOverride === true) {
            if (typeof staleReviewToken !== 'string' || !SHA256_PATTERN.test(staleReviewToken)) {
                throw new RequestValidationError('request.staleReviewToken must be a lowercase 64-hex token');
            }
        } else {
            throw new RequestValidationError('request.staleContextOverride must be a boolean');
        }
        return {
            operationId,
            operationKind,
            actionContractVersion,
            expectedCurrentDate,
            contextProjectionVersion,
            originalGenerationContextSignature: originalGenerationContextSignature as string,
            generationChapterSignature: generationChapterSignature as string,
            latestReviewedChapterSignature: latestReviewedChapterSignature as string,
            staleContextOverride,
            staleReviewToken,
            payload,
        };
    }
    if (isMistakeV2) {
        const contextProjectionVersion = readOwnDataProperty(request, 'contextProjectionVersion', 'request');
        if (contextProjectionVersion !== MISTAKE_REVIEW_CONTEXT_PROJECTION_VERSION) {
            throw new RequestValidationError('request.contextProjectionVersion is unsupported');
        }
        const generationContextSignature = readOwnDataProperty(request, 'generationContextSignature', 'request');
        if (typeof generationContextSignature !== 'string' || !SHA256_PATTERN.test(generationContextSignature)) {
            throw new RequestValidationError('request.generationContextSignature must be a lowercase SHA-256 digest');
        }
        const generationMistakeRef = readOwnDataProperty(request, 'generationMistakeRef', 'request');
        if (typeof generationMistakeRef !== 'string' || !MISTAKE_REF_PATTERN.test(generationMistakeRef)) {
            throw new RequestValidationError('request.generationMistakeRef must be m1 through m12');
        }
        return {
            ...base,
            contextProjectionVersion,
            generationContextSignature,
            generationMistakeRef,
        };
    }
    return base;
}

function buildCanonicalDigestJson(request: IdempotentAIStudyTaskCreateRequest): string {
    const payload = request.payload as CanonicalAIStudyTaskPayload;
    const canonicalPayload = {
        title: payload.title,
        description: payload.description,
        type: payload.type,
        subject_id: payload.subject_id,
        related_mistake_id: payload.related_mistake_id,
        related_entry_id: payload.related_entry_id,
        related_chapter_id: payload.related_chapter_id,
        planned_date: payload.planned_date,
        estimate_minutes: payload.estimate_minutes,
        status: payload.status,
        source: payload.source,
    };
    if (
        request.operationKind === 'today_action'
        && request.actionContractVersion === CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION
    ) {
        return JSON.stringify({
            operationId: request.operationId,
            operationKind: request.operationKind,
            actionContractVersion: request.actionContractVersion,
            expectedCurrentDate: request.expectedCurrentDate,
            contextProjectionVersion: request.contextProjectionVersion,
            originalGenerationContextSignature: request.originalGenerationContextSignature,
            generationChapterSignature: request.generationChapterSignature,
            latestReviewedChapterSignature: request.latestReviewedChapterSignature,
            staleContextOverride: request.staleContextOverride,
            staleReviewToken: request.staleReviewToken,
            payload: canonicalPayload,
        });
    }
    if (
        request.operationKind === 'mistake_review'
        && request.actionContractVersion === CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION
    ) {
        return JSON.stringify({
            operationId: request.operationId,
            operationKind: request.operationKind,
            actionContractVersion: request.actionContractVersion,
            expectedCurrentDate: request.expectedCurrentDate,
            contextProjectionVersion: request.contextProjectionVersion,
            generationContextSignature: request.generationContextSignature,
            generationMistakeRef: request.generationMistakeRef,
            payload: canonicalPayload,
        });
    }
    return JSON.stringify({
        operationKind: request.operationKind,
        actionContractVersion: request.actionContractVersion,
        expectedCurrentDate: request.expectedCurrentDate,
        plannedDate: payload.planned_date,
        payload: canonicalPayload,
    });
}

export function buildIdempotentAIStudyTaskRequestDigest(
    request: IdempotentAIStudyTaskCreateRequest,
): string {
    const canonicalRequest = validateIdempotentAIStudyTaskCreateRequest(request);
    return createHash('sha256')
        .update(buildCanonicalDigestJson(canonicalRequest), 'utf8')
        .digest('hex');
}

function readReceipt(
    database: Database.Database,
    operationId: string,
): StudyTaskActionReceiptRow | undefined {
    return database.prepare(`
        SELECT
          operation_id,
          operation_kind,
          action_contract_version,
          request_digest,
          expected_current_date,
          planned_date,
          task_id,
          created_at
        FROM study_task_action_receipts
        WHERE operation_id = ?
    `).get(operationId) as StudyTaskActionReceiptRow | undefined;
}

function readTask(database: Database.Database, taskId: number): StudyTaskRow | undefined {
    return database.prepare(`
        SELECT
          id,
          title,
          description,
          type,
          subject_id,
          related_mistake_id,
          related_entry_id,
          related_chapter_id,
          planned_date,
          estimate_minutes,
          status,
          source,
          created_at,
          updated_at
        FROM study_tasks
        WHERE id = ?
    `).get(taskId) as StudyTaskRow | undefined;
}

function isNullablePositiveDatabaseId(value: unknown): value is number | null {
    return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}

function isActualDateKey(value: unknown): value is string {
    try {
        requireActualDateKey(value, 'stored date');
        return true;
    } catch {
        return false;
    }
}

function isValidReceiptRow(receipt: StudyTaskActionReceiptRow): boolean {
    if (
        typeof receipt.operation_id !== 'string'
        || !LOWERCASE_UUID_V4_PATTERN.test(receipt.operation_id)
        || (
            receipt.operation_kind !== 'today_action'
            && receipt.operation_kind !== 'daily_review'
            && receipt.operation_kind !== 'mistake_review'
        )
        || typeof receipt.action_contract_version !== 'string'
        || typeof receipt.request_digest !== 'string'
        || !SHA256_PATTERN.test(receipt.request_digest)
        || !isActualDateKey(receipt.expected_current_date)
        || !isActualDateKey(receipt.planned_date)
        || !isNullablePositiveDatabaseId(receipt.task_id)
        || typeof receipt.created_at !== 'string'
        || receipt.created_at.trim().length === 0
    ) {
        return false;
    }

    if (receipt.operation_kind === 'today_action') {
        if (
            receipt.action_contract_version !== IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION
            && receipt.action_contract_version !== CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION
        ) {
            return false;
        }
    } else if (receipt.operation_kind === 'daily_review') {
        if (receipt.action_contract_version !== IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION) {
            return false;
        }
    } else if (receipt.operation_kind === 'mistake_review') {
        if (
            receipt.action_contract_version !== CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION
            && receipt.action_contract_version !== LEGACY_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION
        ) {
            return false;
        }
    } else {
        return false;
    }

    const invariantPlannedDate = (
        receipt.operation_kind === 'today_action'
        || receipt.operation_kind === 'mistake_review'
    )
        ? receipt.expected_current_date
        : getNextDateKey(receipt.expected_current_date);
    return receipt.planned_date === invariantPlannedDate;
}

function projectPersistedStudyTask(row: StudyTaskRow): StudyTask | null {
    if (
        typeof row.id !== 'number'
        || !Number.isSafeInteger(row.id)
        || row.id <= 0
        || typeof row.title !== 'string'
        || typeof row.description !== 'string'
        || typeof row.type !== 'string'
        || !STUDY_TASK_TYPES.includes(row.type as StudyTaskType)
        || !isNullablePositiveDatabaseId(row.subject_id)
        || !isNullablePositiveDatabaseId(row.related_mistake_id)
        || !isNullablePositiveDatabaseId(row.related_entry_id)
        || !isNullablePositiveDatabaseId(row.related_chapter_id)
        || typeof row.planned_date !== 'string'
        || typeof row.estimate_minutes !== 'number'
        || !Number.isInteger(row.estimate_minutes)
        || typeof row.status !== 'string'
        || !STUDY_TASK_STATUSES.includes(row.status as StudyTaskStatus)
        || typeof row.source !== 'string'
        || !STUDY_TASK_SOURCES.includes(row.source as StudyTaskSource)
        || typeof row.created_at !== 'string'
        || typeof row.updated_at !== 'string'
    ) {
        return null;
    }
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        type: row.type as StudyTaskType,
        subject_id: row.subject_id,
        related_mistake_id: row.related_mistake_id,
        related_entry_id: row.related_entry_id,
        related_chapter_id: row.related_chapter_id,
        planned_date: row.planned_date,
        estimate_minutes: row.estimate_minutes,
        status: row.status as StudyTaskStatus,
        source: row.source as StudyTaskSource,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

function persistedTaskMatchesPayload(
    task: StudyTask,
    payload: CanonicalAIStudyTaskPayload,
): boolean {
    return (
        task.title === payload.title
        && task.description === payload.description
        && task.type === payload.type
        && task.subject_id === payload.subject_id
        && task.related_mistake_id === payload.related_mistake_id
        && task.related_entry_id === payload.related_entry_id
        && task.related_chapter_id === payload.related_chapter_id
        && task.planned_date === payload.planned_date
        && task.estimate_minutes === payload.estimate_minutes
        && task.status === payload.status
        && task.source === payload.source
    );
}

function errorResponse(
    operationId: string,
    code: Extract<IdempotentAIStudyTaskCreateResponse, { ok: false }>['code'],
    message: string,
): IdempotentAIStudyTaskCreateResponse {
    return { ok: false, operationId, code, message };
}

function resolveExistingReceipt(
    receipt: StudyTaskActionReceiptRow,
    request: IdempotentAIStudyTaskCreateRequest,
    requestDigest: string,
    database: Database.Database,
): IdempotentAIStudyTaskCreateResponse {
    if (!isValidReceiptRow(receipt)) {
        return errorResponse(
            request.operationId,
            'INTEGRITY_ERROR',
            'The saved operation receipt is invalid.',
        );
    }
    const matchesRequest = (
        receipt.operation_id === request.operationId
        && receipt.operation_kind === request.operationKind
        && receipt.action_contract_version === request.actionContractVersion
        && receipt.request_digest === requestDigest
        && receipt.expected_current_date === request.expectedCurrentDate
        && receipt.planned_date === request.payload.planned_date
    );
    if (!matchesRequest) {
        return errorResponse(
            request.operationId,
            'IDEMPOTENCY_CONFLICT',
            'This operation ID was already used for a different study task request.',
        );
    }
    if (receipt.task_id === null) {
        return errorResponse(
            request.operationId,
            'RESULT_DELETED',
            'The study task previously created for this operation has been deleted.',
        );
    }
    if (
        typeof receipt.task_id !== 'number'
        || !Number.isSafeInteger(receipt.task_id)
        || receipt.task_id <= 0
    ) {
        return errorResponse(
            request.operationId,
            'INTEGRITY_ERROR',
            'The saved operation receipt is inconsistent with local study task data.',
        );
    }

    const row = readTask(database, receipt.task_id);
    if (!row) {
        return errorResponse(
            request.operationId,
            'INTEGRITY_ERROR',
            'The saved operation receipt points to a missing study task.',
        );
    }
    const task = projectPersistedStudyTask(row);
    if (!task) {
        return errorResponse(
            request.operationId,
            'INTEGRITY_ERROR',
            'The saved study task result is invalid.',
        );
    }
    if (request.operationKind === 'today_action' && task.related_chapter_id !== null) {
        return errorResponse(
            request.operationId,
            'INTEGRITY_ERROR',
            'The saved Today Action result has an invalid chapter relation.',
        );
    }
    return {
        ok: true,
        operationId: request.operationId,
        task,
        replayed: true,
    };
}

function assertCurrentDate(
    expectedCurrentDate: string,
    getCurrentDateKey: () => string,
): void {
    const currentDate = getCurrentDateKey();
    try {
        requireActualDateKey(currentDate, 'current local date');
    } catch {
        throw new PersistenceIntegrityError('The current local date is invalid');
    }
    if (currentDate !== expectedCurrentDate) {
        throw new CurrentDateMismatchError('The confirmed date no longer matches the current local date');
    }
}

function isReceiptOperationIdConstraint(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const code = Reflect.get(error, 'code');
    const message = Reflect.get(error, 'message');
    return (
        typeof code === 'string'
        && code.startsWith('SQLITE_CONSTRAINT')
        && typeof message === 'string'
        && message.includes('study_task_action_receipts.operation_id')
    );
}

function extractOperationId(value: unknown): string {
    if (!isObjectRecord(value)) return '';
    const descriptor = Object.getOwnPropertyDescriptor(value, 'operationId');
    return descriptor
        && 'value' in descriptor
        && typeof descriptor.value === 'string'
        && LOWERCASE_UUID_V4_PATTERN.test(descriptor.value)
        ? descriptor.value
        : '';
}

type AuthorizedTodayActionToken = {
    token: string;
    trustedSession: object;
    tokenStore: TodayActionStaleReviewTokenStore;
    core: CanonicalTodayActionStaleAuthorizationCore;
};

function isTodayActionV2Request(request: IdempotentAIStudyTaskCreateRequest): boolean {
    return request.operationKind === 'today_action'
        && request.actionContractVersion === CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION;
}

function buildTodayActionAuthorizationCore(
    request: IdempotentAIStudyTaskCreateRequest,
): CanonicalTodayActionStaleAuthorizationCore {
    return {
        operationId: request.operationId,
        operationKind: 'today_action',
        actionContractVersion: CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION,
        expectedCurrentDate: request.expectedCurrentDate,
        contextProjectionVersion: TODAY_ACTION_CHAPTER_CONTEXT_PROJECTION_VERSION,
        originalGenerationContextSignature: request.originalGenerationContextSignature as string,
        generationChapterSignature: request.generationChapterSignature as string,
        latestReviewedChapterSignature: request.latestReviewedChapterSignature as string,
        staleContextOverride: true,
        payload: request.payload as CanonicalAIStudyTaskPayload,
    };
}

function validateFreshTodayActionChapterContext(
    request: IdempotentAIStudyTaskCreateRequest,
    dependencies: IdempotentStudyTaskCreationDependencies,
): AuthorizedTodayActionToken | null {
    if (!isTodayActionV2Request(request)) {
        throw new FreshTodayActionValidationError(STALE_TODAY_ACTION_MESSAGE);
    }

    let authorizedToken: AuthorizedTodayActionToken | null = null;
    if (request.staleContextOverride === true) {
        const trustedSession = dependencies.trustedSession;
        const tokenStore = dependencies.tokenStore;
        const token = request.staleReviewToken;
        const core = buildTodayActionAuthorizationCore(request);
        if (
            trustedSession === null
            || typeof trustedSession !== 'object'
            || !tokenStore
            || typeof token !== 'string'
            || !tokenStore.check(token, trustedSession, core)
        ) {
            throw new FreshTodayActionValidationError(STALE_TODAY_ACTION_MESSAGE);
        }
        authorizedToken = { token, trustedSession, tokenStore, core };
    }

    let currentChapterSignature: string;
    try {
        currentChapterSignature = readAuthoritativeTodayActionChapterContext(
            dependencies.database,
        ).currentChapterSignature;
    } catch {
        throw new FreshTodayActionValidationError(STALE_TODAY_ACTION_MESSAGE);
    }

    const expectedChapterSignature = request.staleContextOverride === true
        ? request.latestReviewedChapterSignature
        : request.generationChapterSignature;
    if (currentChapterSignature !== expectedChapterSignature) {
        if (authorizedToken) {
            authorizedToken.tokenStore.invalidate(
                authorizedToken.token,
                authorizedToken.trustedSession,
                authorizedToken.core,
            );
        }
        throw new FreshTodayActionValidationError(STALE_TODAY_ACTION_MESSAGE);
    }
    return authorizedToken;
}

function validateFreshMistakeReviewDomain(
    request: IdempotentAIStudyTaskCreateRequest,
    database: Database.Database,
): void {
    const payload = request.payload as CanonicalAIStudyTaskPayload;
    const expectedCurrentDate = request.expectedCurrentDate;
    if (
        request.actionContractVersion !== CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION
        || request.contextProjectionVersion !== MISTAKE_REVIEW_CONTEXT_PROJECTION_VERSION
        || typeof request.generationContextSignature !== 'string'
        || !SHA256_PATTERN.test(request.generationContextSignature)
        || typeof request.generationMistakeRef !== 'string'
        || !MISTAKE_REF_PATTERN.test(request.generationMistakeRef)
        || payload.type !== 'review'
        || payload.related_mistake_id === null
        || payload.related_mistake_id <= 0
        || payload.subject_id === null
        || payload.subject_id <= 0
        || payload.related_entry_id !== null
        || payload.related_chapter_id !== null
        || payload.planned_date !== expectedCurrentDate
        || payload.status !== 'todo'
        || payload.source !== 'ai'
    ) {
        throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
    }

    type MistakeDomainRow = {
        id: number;
        subject_id: number | null;
        question: string;
        answer: string | null;
        notes: string | null;
        mastered: number;
        ease_factor: number;
        review_interval: number;
        next_review_date: string | null;
        review_count: number;
        created_at: string;
        updated_at: string | undefined;
    };
    const mistakeRows = database.prepare(`
        SELECT id, subject_id, question, answer, notes, mastered, ease_factor,
               review_interval, next_review_date, review_count, created_at, updated_at
        FROM mistakes
    `).all() as MistakeDomainRow[];
    const subjectRows = database.prepare(`
        SELECT id, name, color
        FROM subjects
    `).all() as Subject[];
    const activeReviewTaskRows = database.prepare(`
        SELECT id, type, planned_date, status, related_mistake_id
        FROM study_tasks
        WHERE type = 'review'
          AND planned_date = ?
          AND status IN ('todo', 'doing')
    `).all(expectedCurrentDate) as Array<Pick<
        StudyTask,
        'id' | 'type' | 'planned_date' | 'status' | 'related_mistake_id'
    >>;

    const mistakes = mistakeRows.map(row => ({
        ...row,
        answer: row.answer ?? '',
        notes: row.notes ?? '',
        mastered: row.mastered !== 0,
    })) as Mistake[];
    const session = prepareMistakeReviewSession({
        mistakes,
        subjects: subjectRows,
        activeReviewTasks: activeReviewTaskRows as StudyTask[],
        currentDate: expectedCurrentDate,
    });
    const currentSignature = createHash('sha256')
        .update(buildMistakeReviewContextSignatureString(session.projection), 'utf8')
        .digest('hex');
    if (currentSignature !== request.generationContextSignature) {
        throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
    }
    const aliasedMistake = session.aliasMap.get(request.generationMistakeRef);
    if (!aliasedMistake || aliasedMistake.id !== payload.related_mistake_id) {
        throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
    }

    const mistakeRow = mistakeRows.find(row => row.id === payload.related_mistake_id);

    if (!mistakeRow) {
        throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
    }

    if (mistakeRow.mastered !== 0) {
        throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
    }

    if (mistakeRow.next_review_date !== null && mistakeRow.next_review_date > expectedCurrentDate) {
        throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
    }

    if (mistakeRow.subject_id === null || mistakeRow.subject_id !== payload.subject_id) {
        throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
    }

    const subjectRow = subjectRows.find(subject => subject.id === payload.subject_id);

    if (!subjectRow) {
        throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
    }

    const collisionRow = activeReviewTaskRows.find(task => (
        task.related_mistake_id === payload.related_mistake_id
    ));

    if (collisionRow) {
        throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
    }
}

export function createIdempotentAIStudyTaskForCurrentDate(
    value: unknown,
    dependencies: IdempotentStudyTaskCreationDependencies,
): IdempotentAIStudyTaskCreateResponse {
    let request: IdempotentAIStudyTaskCreateRequest;
    let requestDigest: string;
    try {
        request = validateIdempotentAIStudyTaskCreateRequest(value);
        requestDigest = buildIdempotentAIStudyTaskRequestDigest(request);
    } catch (error) {
        return errorResponse(
            extractOperationId(value),
            'INVALID_REQUEST',
            error instanceof RequestValidationError
                ? error.message
                : 'The study task creation request is invalid.',
        );
    }

    try {
        let authorizedTodayActionToken: AuthorizedTodayActionToken | null = null;
        const existingReceipt = readReceipt(dependencies.database, request.operationId);
        if (existingReceipt) {
            return resolveExistingReceipt(existingReceipt, request, requestDigest, dependencies.database);
        }

        const createInTransaction = dependencies.database.transaction(
            (): IdempotentAIStudyTaskCreateResponse => {
                const racedReceipt = readReceipt(dependencies.database, request.operationId);
                if (racedReceipt) {
                    return resolveExistingReceipt(racedReceipt, request, requestDigest, dependencies.database);
                }

                if (
                    request.operationKind === 'mistake_review'
                    && request.actionContractVersion === LEGACY_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION
                ) {
                    throw new FreshMistakeReviewValidationError(STALE_MISTAKE_REVIEW_MESSAGE);
                }
                if (
                    request.operationKind === 'today_action'
                    && request.actionContractVersion === IDEMPOTENT_STUDY_TASK_ACTION_CONTRACT_VERSION
                ) {
                    throw new FreshTodayActionValidationError(STALE_TODAY_ACTION_MESSAGE);
                }

                assertCurrentDate(request.expectedCurrentDate, dependencies.getCurrentDateKey);

                if (request.operationKind === 'today_action') {
                    authorizedTodayActionToken = validateFreshTodayActionChapterContext(
                        request,
                        dependencies,
                    );
                }
                if (request.operationKind === 'mistake_review') {
                    validateFreshMistakeReviewDomain(
                        request,
                        dependencies.database,
                    );
                }

                if (request.operationKind === 'today_action' && request.payload.related_chapter_id !== null) {
                    throw new FreshTodayActionValidationError(STALE_TODAY_ACTION_MESSAGE);
                }
                const createdTask = dependencies.createTask(request.payload);
                if (
                    !createdTask
                    || typeof createdTask.id !== 'number'
                    || !Number.isSafeInteger(createdTask.id)
                    || createdTask.id <= 0
                ) {
                    throw new PersistenceIntegrityError('Task creation returned an invalid identifier');
                }
                const persistedRow = readTask(dependencies.database, createdTask.id);
                const persistedTask = persistedRow ? projectPersistedStudyTask(persistedRow) : null;
                if (!persistedTask) {
                    throw new PersistenceIntegrityError('Task creation did not persist a valid study task');
                }
                if (!persistedTaskMatchesPayload(persistedTask, request.payload as CanonicalAIStudyTaskPayload)) {
                    throw new PersistenceIntegrityError('Task creation persisted data that differs from the confirmed request');
                }

                dependencies.database.prepare(`
                    INSERT INTO study_task_action_receipts (
                      operation_id,
                      operation_kind,
                      action_contract_version,
                      request_digest,
                      expected_current_date,
                      planned_date,
                      task_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(
                    request.operationId,
                    request.operationKind,
                    request.actionContractVersion,
                    requestDigest,
                    request.expectedCurrentDate,
                    request.payload.planned_date,
                    persistedTask.id,
                );
                assertCurrentDate(request.expectedCurrentDate, dependencies.getCurrentDateKey);
                const persistedReceipt = readReceipt(dependencies.database, request.operationId);
                if (!persistedReceipt) {
                    throw new PersistenceIntegrityError('Operation receipt was not persisted');
                }
                const verifiedReceipt = resolveExistingReceipt(
                    persistedReceipt,
                    request,
                    requestDigest,
                    dependencies.database,
                );
                if (!verifiedReceipt.ok || verifiedReceipt.task.id !== persistedTask.id) {
                    throw new PersistenceIntegrityError('Operation receipt did not preserve the confirmed result');
                }

                return {
                    ok: true,
                    operationId: request.operationId,
                    task: persistedTask,
                    replayed: false,
                };
            },
        );

        const result = createInTransaction();
        if (result.ok && !result.replayed && authorizedTodayActionToken) {
            const authorization = authorizedTodayActionToken as AuthorizedTodayActionToken;
            authorization.tokenStore.consume(
                authorization.token,
                authorization.trustedSession,
                authorization.core,
            );
        }
        return result;
    } catch (error) {
        if (
            error instanceof FreshTodayActionValidationError
            || error instanceof FreshMistakeReviewValidationError
        ) {
            return errorResponse(
                request.operationId,
                'INVALID_REQUEST',
                error.message,
            );
        }
        if (error instanceof CurrentDateMismatchError) {
            return errorResponse(
                request.operationId,
                'DATE_MISMATCH',
                'The confirmed date no longer matches the current local date.',
            );
        }
        if (isReceiptOperationIdConstraint(error)) {
            try {
                const racedReceipt = readReceipt(dependencies.database, request.operationId);
                if (racedReceipt) {
                    return resolveExistingReceipt(racedReceipt, request, requestDigest, dependencies.database);
                }
            } catch {
            }
        }
        return errorResponse(
            request.operationId,
            'INTEGRITY_ERROR',
            'The study task could not be created safely.',
        );
    }
}

export function validateTodayActionCommittedStatusRequest(
    value: unknown,
): TodayActionCommittedStatusRequest {
    const request = requireObjectRecord(value, 'request');
    assertExactOwnKeys(request, TODAY_COMMITTED_STATUS_REQUEST_KEYS, 'request');
    const operationId = readOwnDataProperty(request, 'operationId', 'request');
    if (typeof operationId !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(operationId)) {
        throw new RequestValidationError('request.operationId must be a lowercase UUID v4');
    }
    if (readOwnDataProperty(request, 'operationKind', 'request') !== 'today_action') {
        throw new RequestValidationError('request.operationKind must be today_action');
    }
    if (
        readOwnDataProperty(request, 'actionContractVersion', 'request')
        !== CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION
    ) {
        throw new RequestValidationError('request.actionContractVersion is unsupported');
    }
    const expectedCurrentDate = requireActualDateKey(
        readOwnDataProperty(request, 'expectedCurrentDate', 'request'),
        'request.expectedCurrentDate',
    );
    const plannedDate = requireActualDateKey(
        readOwnDataProperty(request, 'plannedDate', 'request'),
        'request.plannedDate',
    );
    if (plannedDate !== expectedCurrentDate) {
        throw new RequestValidationError('request.plannedDate must equal request.expectedCurrentDate');
    }
    return {
        operationId,
        operationKind: 'today_action',
        actionContractVersion: CONFIRMED_TODAY_ACTION_STUDY_TASK_ACTION_CONTRACT_VERSION,
        expectedCurrentDate,
        plannedDate,
    };
}

export function getCommittedAIStudyTaskOperationStatus(
    value: unknown,
    dependencies: { database: Database.Database },
): TodayActionCommittedStatus {
    const request = validateTodayActionCommittedStatusRequest(value);
    const integrityError = (): TodayActionCommittedStatus => ({
        status: 'INTEGRITY_ERROR',
        operationId: request.operationId,
    });
    try {
        const receipt = readReceipt(dependencies.database, request.operationId);
        if (!receipt) {
            return { status: 'NOT_COMMITTED', operationId: request.operationId };
        }
        if (!isValidReceiptRow(receipt)) return integrityError();
        if (
            receipt.operation_id !== request.operationId
            || receipt.operation_kind !== request.operationKind
            || receipt.action_contract_version !== request.actionContractVersion
            || receipt.expected_current_date !== request.expectedCurrentDate
            || receipt.planned_date !== request.plannedDate
        ) {
            return { status: 'IDEMPOTENCY_CONFLICT', operationId: request.operationId };
        }
        if (receipt.task_id === null) {
            return { status: 'RESULT_DELETED', operationId: request.operationId };
        }
        if (
            typeof receipt.task_id !== 'number'
            || !Number.isSafeInteger(receipt.task_id)
            || receipt.task_id <= 0
        ) {
            return integrityError();
        }
        const row = readTask(dependencies.database, receipt.task_id);
        if (!row) return integrityError();
        const task = projectPersistedStudyTask(row);
        if (
            !task
            || task.planned_date !== request.plannedDate
            || task.related_chapter_id !== null
            || task.source !== 'ai'
        ) {
            return integrityError();
        }
        return {
            status: 'RECOVERED_COMMITTED',
            operationId: request.operationId,
            task,
        };
    } catch {
        return integrityError();
    }
}
