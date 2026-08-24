import { createHash, randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import type { NewStudyTask, StudyTaskType } from '../src/types';
import type { TodayActionStaleReviewAuthorizationRequest } from '../src/types/api';
import {
    TODAY_ACTION_CHAPTER_CONTEXT_PROJECTION_VERSION,
    allocateTodayActionChapterProjection,
    buildTodayActionChapterSignatureInput,
    prepareTodayActionChapterSubject,
    type PreparedTodayActionChapterSubject,
    type TodayActionProviderChapterProjection,
} from '../src/utils/todayActionChapterContext';

export const TODAY_ACTION_CHAPTER_CONTEXT_INVALID_MESSAGE =
    'Today Action chapter context could not be verified safely.';
export const TODAY_ACTION_STALE_REVIEW_AUTHORIZATION_INVALID_MESSAGE =
    'Today Action stale-review authorization is invalid.';

const TODAY_ACTION_CONTRACT_VERSION = 'confirmed-study-task-action.v2';
const TODAY_ACTION_OPERATION_KIND = 'today_action';
const LOWERCASE_UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TASK_TYPES: readonly StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom'];
const TITLE_MAX_CODE_UNITS = 80;
const DESCRIPTION_MAX_CODE_UNITS = 240;
const ESTIMATE_MINUTES_MIN = 5;
const ESTIMATE_MINUTES_MAX = 180;

const STALE_AUTHORIZATION_CORE_KEYS = [
    'operationId',
    'operationKind',
    'actionContractVersion',
    'expectedCurrentDate',
    'contextProjectionVersion',
    'originalGenerationContextSignature',
    'generationChapterSignature',
    'latestReviewedChapterSignature',
    'staleContextOverride',
    'payload',
] as const;

const TASK_PAYLOAD_KEYS = [
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

export type CanonicalTodayActionTaskPayload = Required<NewStudyTask>;

export interface CanonicalTodayActionStaleAuthorizationCore
    extends Omit<TodayActionStaleReviewAuthorizationRequest, 'payload'> {
    payload: CanonicalTodayActionTaskPayload;
}

export interface TodayActionAuthoritativeChapterContext {
    chapterProjection: TodayActionProviderChapterProjection;
    chapterProjectionJson: string;
    currentChapterSignature: string;
}

export interface TodayActionAuthoritativeChapterContextReadOptions {
    projector?: (
        preparedSubjects: readonly PreparedTodayActionChapterSubject[],
    ) => TodayActionProviderChapterProjection;
}

type RawSubjectRow = { id: unknown };
type RawChapterRow = {
    id: unknown;
    subject_id: unknown;
    sort_order: unknown;
    title: unknown;
    completed: unknown;
};

type StoredStaleReviewAuthorization = {
    trustedSession: object;
    canonicalCoreJson: string;
};

function authorizationError(): Error {
    return new Error(TODAY_ACTION_STALE_REVIEW_AUTHORIZATION_INVALID_MESSAGE);
}

function contextError(): Error {
    return new Error(TODAY_ACTION_CHAPTER_CONTEXT_INVALID_MESSAGE);
}

function requireObject(value: unknown): object {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw authorizationError();
    }
    return value;
}

function assertExactOwnDataKeys(
    record: object,
    expectedKeys: readonly string[],
): void {
    const ownKeys = Reflect.ownKeys(record);
    if (
        ownKeys.length !== expectedKeys.length
        || ownKeys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))
        || expectedKeys.some(key => !Object.prototype.hasOwnProperty.call(record, key))
    ) {
        throw authorizationError();
    }
    for (const key of expectedKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !('value' in descriptor)) throw authorizationError();
    }
}

function readOwnDataProperty(record: object, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) throw authorizationError();
    return descriptor.value;
}

function requirePositiveSafeInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw authorizationError();
    }
    return value;
}

function requireNullablePositiveSafeInteger(value: unknown): number | null {
    return value === null ? null : requirePositiveSafeInteger(value);
}

function daysInMonth(year: number, month: number): number {
    if (month === 2) {
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function requireActualDateKey(value: unknown): string {
    if (typeof value !== 'string') throw authorizationError();
    const match = DATE_KEY_PATTERN.exec(value);
    if (!match) throw authorizationError();
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (
        year < 1
        || year > 9999
        || month < 1
        || month > 12
        || day < 1
        || day > daysInMonth(year, month)
    ) {
        throw authorizationError();
    }
    return value;
}

function normalizeBoundedText(value: unknown, maxCodeUnits: number): string {
    if (typeof value !== 'string') throw authorizationError();
    const normalized = value
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200D\u2060\uFEFF]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    if (!normalized || normalized.length > maxCodeUnits) throw authorizationError();
    return normalized;
}

function requireSignature(value: unknown): string {
    if (typeof value !== 'string' || !LOWERCASE_SHA256_PATTERN.test(value)) {
        throw authorizationError();
    }
    return value;
}

function validateCanonicalTaskPayload(
    value: unknown,
    expectedCurrentDate: string,
): CanonicalTodayActionTaskPayload {
    const payload = requireObject(value);
    assertExactOwnDataKeys(payload, TASK_PAYLOAD_KEYS);

    const type = readOwnDataProperty(payload, 'type');
    if (typeof type !== 'string' || !TASK_TYPES.includes(type as StudyTaskType)) {
        throw authorizationError();
    }
    const estimateMinutes = readOwnDataProperty(payload, 'estimate_minutes');
    if (
        typeof estimateMinutes !== 'number'
        || !Number.isSafeInteger(estimateMinutes)
        || estimateMinutes < ESTIMATE_MINUTES_MIN
        || estimateMinutes > ESTIMATE_MINUTES_MAX
    ) {
        throw authorizationError();
    }
    const plannedDate = requireActualDateKey(readOwnDataProperty(payload, 'planned_date'));
    if (
        plannedDate !== expectedCurrentDate
        || readOwnDataProperty(payload, 'related_chapter_id') !== null
        || readOwnDataProperty(payload, 'status') !== 'todo'
        || readOwnDataProperty(payload, 'source') !== 'ai'
    ) {
        throw authorizationError();
    }

    return {
        title: normalizeBoundedText(readOwnDataProperty(payload, 'title'), TITLE_MAX_CODE_UNITS),
        description: normalizeBoundedText(
            readOwnDataProperty(payload, 'description'),
            DESCRIPTION_MAX_CODE_UNITS,
        ),
        type: type as StudyTaskType,
        subject_id: requireNullablePositiveSafeInteger(readOwnDataProperty(payload, 'subject_id')),
        related_mistake_id: requireNullablePositiveSafeInteger(
            readOwnDataProperty(payload, 'related_mistake_id'),
        ),
        related_entry_id: requireNullablePositiveSafeInteger(
            readOwnDataProperty(payload, 'related_entry_id'),
        ),
        related_chapter_id: null,
        planned_date: plannedDate,
        estimate_minutes: estimateMinutes,
        status: 'todo',
        source: 'ai',
    };
}

export function validateTodayActionStaleAuthorizationCore(
    value: unknown,
): CanonicalTodayActionStaleAuthorizationCore {
    try {
        const request = requireObject(value);
        assertExactOwnDataKeys(request, STALE_AUTHORIZATION_CORE_KEYS);
        const operationId = readOwnDataProperty(request, 'operationId');
        if (typeof operationId !== 'string' || !LOWERCASE_UUID_V4_PATTERN.test(operationId)) {
            throw authorizationError();
        }
        if (
            readOwnDataProperty(request, 'operationKind') !== TODAY_ACTION_OPERATION_KIND
            || readOwnDataProperty(request, 'actionContractVersion') !== TODAY_ACTION_CONTRACT_VERSION
            || readOwnDataProperty(request, 'contextProjectionVersion')
                !== TODAY_ACTION_CHAPTER_CONTEXT_PROJECTION_VERSION
            || readOwnDataProperty(request, 'staleContextOverride') !== true
        ) {
            throw authorizationError();
        }
        const expectedCurrentDate = requireActualDateKey(
            readOwnDataProperty(request, 'expectedCurrentDate'),
        );
        return {
            operationId,
            operationKind: TODAY_ACTION_OPERATION_KIND,
            actionContractVersion: TODAY_ACTION_CONTRACT_VERSION,
            expectedCurrentDate,
            contextProjectionVersion: TODAY_ACTION_CHAPTER_CONTEXT_PROJECTION_VERSION,
            originalGenerationContextSignature: requireSignature(
                readOwnDataProperty(request, 'originalGenerationContextSignature'),
            ),
            generationChapterSignature: requireSignature(
                readOwnDataProperty(request, 'generationChapterSignature'),
            ),
            latestReviewedChapterSignature: requireSignature(
                readOwnDataProperty(request, 'latestReviewedChapterSignature'),
            ),
            staleContextOverride: true,
            payload: validateCanonicalTaskPayload(
                readOwnDataProperty(request, 'payload'),
                expectedCurrentDate,
            ),
        };
    } catch {
        throw authorizationError();
    }
}

export function serializeTodayActionStaleAuthorizationCore(value: unknown): string {
    try {
        const request = validateTodayActionStaleAuthorizationCore(value);
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
            payload: {
                title: request.payload.title,
                description: request.payload.description,
                type: request.payload.type,
                subject_id: request.payload.subject_id,
                related_mistake_id: request.payload.related_mistake_id,
                related_entry_id: request.payload.related_entry_id,
                related_chapter_id: request.payload.related_chapter_id,
                planned_date: request.payload.planned_date,
                estimate_minutes: request.payload.estimate_minutes,
                status: request.payload.status,
                source: request.payload.source,
            },
        });
    } catch {
        throw authorizationError();
    }
}

function requireRawRecord(value: unknown): object {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw contextError();
    return value;
}

function readRawDataProperty(record: object, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) throw contextError();
    return descriptor.value;
}

function requireRawPositiveSafeInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw contextError();
    }
    return value;
}

function requireRawNonNegativeSafeInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw contextError();
    }
    return value;
}

function projectRawChapterRow(value: unknown, owningSubjectId: number): {
    id: number;
    subject_id: number;
    sort_order: number;
    title: string;
    completed: boolean;
} {
    const row = requireRawRecord(value);
    const id = requireRawPositiveSafeInteger(readRawDataProperty(row, 'id'));
    const subjectId = requireRawPositiveSafeInteger(readRawDataProperty(row, 'subject_id'));
    if (subjectId !== owningSubjectId) throw contextError();
    const sortOrder = requireRawNonNegativeSafeInteger(readRawDataProperty(row, 'sort_order'));
    const title = readRawDataProperty(row, 'title');
    if (typeof title !== 'string') throw contextError();
    const completed = readRawDataProperty(row, 'completed');
    if (completed !== 0 && completed !== 1) throw contextError();
    return {
        id,
        subject_id: subjectId,
        sort_order: sortOrder,
        title,
        completed: completed === 1,
    };
}

export function readAuthoritativeTodayActionChapterContext(
    database: Database.Database,
    options: TodayActionAuthoritativeChapterContextReadOptions = {},
): TodayActionAuthoritativeChapterContext {
    try {
        const readInTransaction = database.transaction(() => {
            const subjectRows = database.prepare(`
                SELECT id
                FROM subjects
                ORDER BY id ASC
            `).all() as RawSubjectRow[];
            if (!Array.isArray(subjectRows)) throw contextError();

            const subjectIds = subjectRows.map(candidate => {
                const row = requireRawRecord(candidate);
                return requireRawPositiveSafeInteger(readRawDataProperty(row, 'id'));
            }).sort((left, right) => left - right);

            const readChapterRows = database.prepare(`
                SELECT id, subject_id, sort_order, title, completed
                FROM subject_chapters
                WHERE subject_id = ?
                ORDER BY sort_order ASC, id ASC
            `);
            const preparedSubjects = subjectIds.map(subjectId => {
                const chapterRows = readChapterRows.all(subjectId) as RawChapterRow[];
                if (!Array.isArray(chapterRows)) throw contextError();
                return prepareTodayActionChapterSubject(
                    subjectId,
                    chapterRows.map(row => projectRawChapterRow(row, subjectId)),
                );
            });
            const projector = options.projector ?? allocateTodayActionChapterProjection;
            const chapterProjection = projector(preparedSubjects);
            const signatureInput = buildTodayActionChapterSignatureInput(chapterProjection);
            const signaturePrefix = `${TODAY_ACTION_CHAPTER_CONTEXT_PROJECTION_VERSION}\u0000`;
            if (!signatureInput.startsWith(signaturePrefix)) throw contextError();
            const chapterProjectionJson = signatureInput.slice(signaturePrefix.length);
            const currentChapterSignature = createHash('sha256')
                .update(signatureInput, 'utf8')
                .digest('hex');
            if (!LOWERCASE_SHA256_PATTERN.test(currentChapterSignature)) throw contextError();
            return {
                chapterProjection,
                chapterProjectionJson,
                currentChapterSignature,
            };
        });
        return readInTransaction();
    } catch {
        throw contextError();
    }
}

function isTrustedSession(value: unknown): value is object {
    return value !== null && typeof value === 'object';
}

function defaultRandomToken(): string {
    return randomBytes(32).toString('hex');
}

export class TodayActionStaleReviewTokenStore {
    private readonly authorizations = new Map<string, StoredStaleReviewAuthorization>();

    constructor(private readonly generateToken: () => string = defaultRandomToken) {}

    issue(trustedSession: object, core: unknown): string {
        try {
            if (!isTrustedSession(trustedSession)) throw authorizationError();
            const canonicalCoreJson = serializeTodayActionStaleAuthorizationCore(core);
            const token = this.generateToken();
            if (
                !LOWERCASE_SHA256_PATTERN.test(token)
                || this.authorizations.has(token)
            ) {
                throw authorizationError();
            }
            this.authorizations.set(token, { trustedSession, canonicalCoreJson });
            return token;
        } catch {
            throw authorizationError();
        }
    }

    check(token: unknown, trustedSession: object, core: unknown): boolean {
        try {
            if (
                typeof token !== 'string'
                || !LOWERCASE_SHA256_PATTERN.test(token)
                || !isTrustedSession(trustedSession)
            ) {
                return false;
            }
            const stored = this.authorizations.get(token);
            return Boolean(
                stored
                && stored.trustedSession === trustedSession
                && stored.canonicalCoreJson === serializeTodayActionStaleAuthorizationCore(core),
            );
        } catch {
            return false;
        }
    }

    invalidate(token: unknown, trustedSession: object, core: unknown): boolean {
        if (!this.check(token, trustedSession, core)) return false;
        return this.authorizations.delete(token as string);
    }

    consume(token: unknown, trustedSession: object, core: unknown): boolean {
        if (!this.check(token, trustedSession, core)) return false;
        return this.authorizations.delete(token as string);
    }
}

export function authorizeTodayActionStaleReview(
    value: unknown,
    dependencies: {
        database: Database.Database;
        getCurrentDateKey: () => string;
        trustedSession: object;
        tokenStore: TodayActionStaleReviewTokenStore;
    },
): { staleReviewToken: string } {
    try {
        const core = validateTodayActionStaleAuthorizationCore(value);
        if (!isTrustedSession(dependencies.trustedSession)) throw authorizationError();

        const currentDate = requireActualDateKey(dependencies.getCurrentDateKey());
        if (currentDate !== core.expectedCurrentDate) throw authorizationError();

        const currentContext = readAuthoritativeTodayActionChapterContext(dependencies.database);
        if (
            currentContext.currentChapterSignature !== core.latestReviewedChapterSignature
            || core.latestReviewedChapterSignature === core.generationChapterSignature
        ) {
            throw authorizationError();
        }

        return {
            staleReviewToken: dependencies.tokenStore.issue(dependencies.trustedSession, core),
        };
    } catch {
        throw authorizationError();
    }
}
