import type {
    AIMessage,
    MoodId,
    NewEntry,
    NewStudyTask,
    PomodoroSession,
    ReviewData,
    StudyTask,
    StudyTaskSource,
    StudyTaskStatus,
    StudyTaskType,
} from '../src/types';
import {
    AI_REQUEST_LIMITS,
    validateAiRequestMessages,
    validateAiSummaryInput,
} from '../src/utils/aiRequestPolicy';

export const IPC_VALIDATION_LIMITS = {
    aiMessages: AI_REQUEST_LIMITS.maxMessages,
    aiMessageContent: AI_REQUEST_LIMITS.maxMessageContent,
    aiTotalContent: AI_REQUEST_LIMITS.maxTotalContent,
    aiSummaryInput: AI_REQUEST_LIMITS.maxSummaryInput,
    entryTitle: 500,
    entryContent: 200_000,
    entryImagePath: 2_000,
    taskTitle: 200,
    taskDescription: 5_000,
    dateTime: 64,
} as const;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MOOD_IDS = ['motivated', 'happy', 'calm', 'tired', 'anxious', 'sad'] as const;
const STUDY_TASK_TYPES = ['review', 'focus', 'diary', 'mistake', 'custom'] as const;
const STUDY_TASK_STATUSES = ['todo', 'doing', 'done', 'skipped'] as const;
const STUDY_TASK_SOURCES = ['manual', 'dashboard', 'ai', 'pomodoro'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === 'string' && allowed.includes(value as T);
}

function requireString(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string`);
    }
    if (value.length > maxLength) {
        throw new Error(`${label} is too long`);
    }
    return value;
}

function validateOptionalString(record: Record<string, unknown>, key: string, label: string, maxLength: number): void {
    if (!hasOwn(record, key) || record[key] === undefined) return;
    requireString(record[key], label, maxLength);
}

function requireDateKey(value: unknown, label: string): string {
    if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) {
        throw new Error(`${label} must be YYYY-MM-DD`);
    }
    return value;
}

function validateOptionalDateKey(record: Record<string, unknown>, key: string, label: string): void {
    if (!hasOwn(record, key) || record[key] === undefined) return;
    requireDateKey(record[key], label);
}

function requirePositiveInteger(value: unknown, label: string): number {
    if (!Number.isInteger(value) || typeof value !== 'number' || value <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return value;
}

function validateOptionalNullablePositiveInteger(record: Record<string, unknown>, key: string, label: string): void {
    if (!hasOwn(record, key) || record[key] === undefined) return;
    const value = record[key];
    if (value === null) return;
    requirePositiveInteger(value, label);
}

function validateRequiredNullablePositiveInteger(record: Record<string, unknown>, key: string, label: string): void {
    if (!hasOwn(record, key)) {
        throw new Error(`${label} must be a positive integer or null`);
    }
    const value = record[key];
    if (value === null) return;
    if (!Number.isInteger(value) || typeof value !== 'number' || value <= 0) {
        throw new Error(`${label} must be a positive integer or null`);
    }
}

function validateOptionalPositiveInteger(record: Record<string, unknown>, key: string, label: string): void {
    if (!hasOwn(record, key) || record[key] === undefined) return;
    requirePositiveInteger(record[key], label);
}

function requirePositiveFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive number`);
    }
    return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
    if (!Number.isInteger(value) || typeof value !== 'number' || value < 0) {
        throw new Error(`${label} must be a non-negative integer`);
    }
    return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
    if (!isOneOf(value, allowed)) {
        throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
    }
    return value;
}

function validateOptionalEnum<T extends string>(
    record: Record<string, unknown>,
    key: string,
    allowed: readonly T[],
    label: string,
): void {
    if (!hasOwn(record, key) || record[key] === undefined) return;
    requireEnum(record[key], allowed, label);
}

function validateMood(value: unknown): MoodId | null {
    if (value === null) return null;
    return requireEnum(value, MOOD_IDS, 'entry mood');
}

function validateOptionalMood(record: Record<string, unknown>): void {
    if (!hasOwn(record, 'mood') || record.mood === undefined) return;
    validateMood(record.mood);
}

function validateOptionalPositiveIntegerArray(record: Record<string, unknown>, key: string, label: string): void {
    if (!hasOwn(record, key) || record[key] === undefined) return;
    const value = record[key];
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array`);
    }
    value.forEach((item, index) => {
        requirePositiveInteger(item, `${label}[${index}]`);
    });
}

function validateOptionalStringArray(record: Record<string, unknown>, key: string, label: string, maxLength: number): void {
    if (!hasOwn(record, key) || record[key] === undefined) return;
    const value = record[key];
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array`);
    }
    value.forEach((item, index) => {
        requireString(item, `${label}[${index}]`, maxLength);
    });
}

function validateTaskFields(record: Record<string, unknown>, requireCreateFields: boolean): void {
    if (requireCreateFields || hasOwn(record, 'title')) {
        const title = requireString(record.title, 'task title', IPC_VALIDATION_LIMITS.taskTitle);
        if (!title.trim()) throw new Error('task title is required');
    }
    if (requireCreateFields || hasOwn(record, 'planned_date')) {
        requireDateKey(record.planned_date, 'task planned_date');
    }
    validateOptionalString(record, 'description', 'task description', IPC_VALIDATION_LIMITS.taskDescription);
    validateOptionalEnum<StudyTaskType>(record, 'type', STUDY_TASK_TYPES, 'task type');
    validateOptionalEnum<StudyTaskStatus>(record, 'status', STUDY_TASK_STATUSES, 'task status');
    validateOptionalEnum<StudyTaskSource>(record, 'source', STUDY_TASK_SOURCES, 'task source');
    validateOptionalNullablePositiveInteger(record, 'subject_id', 'task subject_id');
    validateOptionalNullablePositiveInteger(record, 'related_mistake_id', 'task related_mistake_id');
    validateOptionalNullablePositiveInteger(record, 'related_entry_id', 'task related_entry_id');
    validateOptionalPositiveInteger(record, 'estimate_minutes', 'task estimate_minutes');
}

function validateEntryFields(record: Record<string, unknown>, requireCreateFields: boolean): void {
    if (requireCreateFields || hasOwn(record, 'date')) {
        requireDateKey(record.date, 'entry date');
    }
    if (requireCreateFields || hasOwn(record, 'title')) {
        requireString(record.title, 'entry title', IPC_VALIDATION_LIMITS.entryTitle);
    }
    if (requireCreateFields || hasOwn(record, 'content')) {
        requireString(record.content, 'entry content', IPC_VALIDATION_LIMITS.entryContent);
    }
    if (requireCreateFields || hasOwn(record, 'mood')) {
        validateMood(record.mood);
    }
    validateOptionalPositiveIntegerArray(record, 'tags', 'entry tags');
    validateOptionalStringArray(record, 'images', 'entry images', IPC_VALIDATION_LIMITS.entryImagePath);
}

export function validatePositiveIdPayload(value: unknown, label: string): number {
    return requirePositiveInteger(value, label);
}

export function validateAiMessagesPayload(payload: unknown): AIMessage[] {
    return validateAiRequestMessages(payload);
}

export function validateAiSummaryPayload(payload: unknown): string {
    return validateAiSummaryInput(payload);
}

export function validateStudyTaskCreatePayload(payload: unknown): NewStudyTask {
    const record = requireRecord(payload, 'tasks:create payload');
    validateTaskFields(record, true);
    return payload as NewStudyTask;
}

export function validateStudyTaskUpdatePayload(payload: unknown): Partial<StudyTask> {
    const record = requireRecord(payload, 'tasks:update payload');
    validateTaskFields(record, false);
    return payload as Partial<StudyTask>;
}

export function validatePomodoroSessionPayload(payload: unknown): PomodoroSession {
    const record = requireRecord(payload, 'pomodoro:addSession payload');
    validateRequiredNullablePositiveInteger(record, 'subject_id', 'pomodoro subject_id');
    requirePositiveFiniteNumber(record.duration, 'pomodoro duration');
    validateOptionalDateKey(record, 'date_key', 'pomodoro date_key');
    validateOptionalString(record, 'started_at', 'pomodoro started_at', IPC_VALIDATION_LIMITS.dateTime);
    validateOptionalString(record, 'completed_at', 'pomodoro completed_at', IPC_VALIDATION_LIMITS.dateTime);
    return payload as PomodoroSession;
}

export function validateMistakeReviewPayload(idPayload: unknown, dataPayload: unknown): { id: number; data: ReviewData } {
    const id = requirePositiveInteger(idPayload, 'mistake id');
    const record = requireRecord(dataPayload, 'mistakes:review payload');
    if (hasOwn(record, 'quality')) {
        throw new Error('mistakes:review payload must contain review data, not raw quality');
    }
    requirePositiveFiniteNumber(record.ease_factor, 'mistake ease_factor');
    requirePositiveInteger(record.review_interval, 'mistake review_interval');
    requireDateKey(record.next_review_date, 'mistake next_review_date');
    requireNonNegativeInteger(record.review_count, 'mistake review_count');
    return { id, data: dataPayload as ReviewData };
}

export function validateEntryCreatePayload(payload: unknown): NewEntry {
    const record = requireRecord(payload, 'entries:create payload');
    validateEntryFields(record, true);
    return payload as NewEntry;
}

export function validateEntryUpdatePayload(payload: unknown): Partial<NewEntry> {
    const record = requireRecord(payload, 'entries:update payload');
    validateEntryFields(record, false);
    return payload as Partial<NewEntry>;
}
