import type {
    AIMessage,
    BulkSubjectChaptersInput,
    ConvertSubjectChaptersInput,
    CreateSubjectChapterInput,
    MoodId,
    NewEntry,
    NewStudyTask,
    PomodoroSession,
    ReviewData,
    StudyTask,
    StudyTaskQuery,
    StudyTaskSource,
    StudyTaskStatus,
    StudyTaskType,
    SubjectChapterPatch,
} from '../src/types';
import {
    AI_REQUEST_LIMITS,
    validateAiRequestMessages,
    validateAiSummaryInput,
} from '../src/utils/aiRequestPolicy';
import {
    validateMistakeId as validateSharedMistakeId,
    validateMistakeWritePayload as validateSharedMistakeWritePayload,
    validateMistakeWritePayloadBatch as validateSharedMistakeWritePayloadBatch,
    type MistakeWritePayload,
} from '../src/utils/mistakePayload';

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
    chapterTitle: 120,
    chapterNotes: 1_000,
    chapterBatch: 200,
    dateTime: 64,
} as const;

export function validateMistakeId(payload: unknown): number {
    return validateSharedMistakeId(payload);
}

export function validateMistakeWritePayload(payload: unknown): MistakeWritePayload {
    return validateSharedMistakeWritePayload(payload);
}

export function validateMistakeWritePayloadBatch(payload: unknown): MistakeWritePayload[] {
    return validateSharedMistakeWritePayloadBatch(payload);
}

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
    validateOptionalNullablePositiveInteger(record, 'related_chapter_id', 'task related_chapter_id');
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

function validateChapterDraft(record: Record<string, unknown>, label: string): void {
    const title = requireString(record.title, `${label} title`, IPC_VALIDATION_LIMITS.chapterTitle);
    if (!title.trim()) throw new Error(`${label} title is required`);
    validateOptionalString(record, 'notes', `${label} notes`, IPC_VALIDATION_LIMITS.chapterNotes);
    if (hasOwn(record, 'completed') && record.completed !== undefined && typeof record.completed !== 'boolean') {
        throw new Error(`${label} completed must be a boolean`);
    }
}

function validateChapterDraftArray(value: unknown, label: string): void {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array`);
    }
    if (value.length === 0) {
        throw new Error(`${label} must contain at least one chapter`);
    }
    if (value.length > IPC_VALIDATION_LIMITS.chapterBatch) {
        throw new Error(`${label} cannot contain more than ${IPC_VALIDATION_LIMITS.chapterBatch} chapters`);
    }
    value.forEach((item, index) => validateChapterDraft(requireRecord(item, `${label}[${index}]`), `${label}[${index}]`));
}

export function validatePositiveIdPayload(value: unknown, label: string): number {
    return requirePositiveInteger(value, label);
}

export function validateDateKeyPayload(value: unknown, label: string): string {
    return requireDateKey(value, label);
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

export function validateStudyTaskQueryPayload(payload: unknown): StudyTaskQuery {
    const record = requireRecord(payload, 'tasks:find payload');
    const allowed = new Set([
        'planned_date',
        'type',
        'status',
        'related_mistake_id',
        'related_entry_id',
        'related_chapter_id',
    ]);
    Object.keys(record).forEach(key => {
        if (!allowed.has(key)) {
            throw new Error(`tasks:find payload contains unsupported field: ${key}`);
        }
    });
    validateOptionalDateKey(record, 'planned_date', 'task planned_date');
    validateOptionalEnum<StudyTaskType>(record, 'type', STUDY_TASK_TYPES, 'task type');
    if (hasOwn(record, 'status') && record.status !== undefined) {
        if (Array.isArray(record.status)) {
            record.status.forEach((status, index) => {
                requireEnum(status, STUDY_TASK_STATUSES, `task status[${index}]`);
            });
        } else {
            requireEnum(record.status, STUDY_TASK_STATUSES, 'task status');
        }
    }
    validateOptionalNullablePositiveInteger(record, 'related_mistake_id', 'task related_mistake_id');
    validateOptionalNullablePositiveInteger(record, 'related_entry_id', 'task related_entry_id');
    validateOptionalNullablePositiveInteger(record, 'related_chapter_id', 'task related_chapter_id');
    return payload as StudyTaskQuery;
}

export function validatePomodoroSessionPayload(payload: unknown): PomodoroSession {
    const record = requireRecord(payload, 'pomodoro:addSession payload');
    validateRequiredNullablePositiveInteger(record, 'subject_id', 'pomodoro subject_id');
    validateOptionalNullablePositiveInteger(record, 'task_id', 'pomodoro task_id');
    requirePositiveFiniteNumber(record.duration, 'pomodoro duration');
    validateOptionalDateKey(record, 'date_key', 'pomodoro date_key');
    validateOptionalString(record, 'started_at', 'pomodoro started_at', IPC_VALIDATION_LIMITS.dateTime);
    validateOptionalString(record, 'completed_at', 'pomodoro completed_at', IPC_VALIDATION_LIMITS.dateTime);
    return payload as PomodoroSession;
}

export function validateCreateSubjectChapterPayload(payload: unknown): CreateSubjectChapterInput {
    const record = requireRecord(payload, 'subjectChapters:create payload');
    requirePositiveInteger(record.subject_id, 'chapter subject_id');
    validateChapterDraft(record, 'chapter');
    return payload as CreateSubjectChapterInput;
}

export function validateBulkSubjectChaptersPayload(payload: unknown): BulkSubjectChaptersInput {
    const record = requireRecord(payload, 'subjectChapters:bulkCreate payload');
    requirePositiveInteger(record.subject_id, 'chapter subject_id');
    validateChapterDraftArray(record.chapters, 'chapters');
    return payload as BulkSubjectChaptersInput;
}

export function validateConvertSubjectChaptersPayload(payload: unknown): ConvertSubjectChaptersInput {
    const record = requireRecord(payload, 'subjectChapters:convertFromSummary payload');
    requirePositiveInteger(record.subject_id, 'chapter subject_id');
    validateChapterDraftArray(record.chapters, 'chapters');
    requireNonNegativeInteger(record.markCompletedCount, 'markCompletedCount');
    return payload as ConvertSubjectChaptersInput;
}

export function validateSubjectChapterPatchPayload(payload: unknown): SubjectChapterPatch {
    const record = requireRecord(payload, 'subjectChapters:patch payload');
    const allowed = new Set(['title', 'notes', 'completed']);
    Object.keys(record).forEach(key => {
        if (!allowed.has(key)) {
            throw new Error(`subjectChapters:patch payload contains unsupported field: ${key}`);
        }
    });
    if (hasOwn(record, 'title')) {
        const title = requireString(record.title, 'chapter title', IPC_VALIDATION_LIMITS.chapterTitle);
        if (!title.trim()) throw new Error('chapter title is required');
    }
    validateOptionalString(record, 'notes', 'chapter notes', IPC_VALIDATION_LIMITS.chapterNotes);
    if (hasOwn(record, 'completed') && record.completed !== undefined && typeof record.completed !== 'boolean') {
        throw new Error('chapter completed must be a boolean');
    }
    return payload as SubjectChapterPatch;
}

export function validateSubjectChapterCompletedPayload(payload: unknown): boolean | undefined {
    if (payload === undefined) return undefined;
    if (typeof payload !== 'boolean') {
        throw new Error('chapter completed must be a boolean');
    }
    return payload;
}

export function validateSubjectChapterReorderPayload(payload: unknown): number[] {
    if (!Array.isArray(payload)) {
        throw new Error('chapterIds must be an array');
    }
    if (payload.length === 0) {
        throw new Error('chapterIds must be a non-empty array');
    }
    const chapterIds = payload.map((value, index) => requirePositiveInteger(value, `chapterIds[${index}]`));
    if (new Set(chapterIds).size !== chapterIds.length) {
        throw new Error('chapterIds must not contain duplicate ids');
    }
    return chapterIds;
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

// First Slice validates data descriptors before reading any renderer property.
function firstSliceObject(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Invalid First Slice payload');
    const keys = Reflect.ownKeys(value);
    if (!required.every(key => keys.includes(key)) || keys.some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return typeof key !== 'string' || ![...required, ...optional].includes(key)
            || !descriptor || !('value' in descriptor) || !descriptor.enumerable;
    })) throw new Error('Invalid First Slice payload');
    return value as Record<string, unknown>;
}
function firstSliceText(value: unknown, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid First Slice text');
    return value;
}
function firstSliceDate(value: unknown): string {
    const text = firstSliceText(value, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith('0000')
        || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) throw new Error('Invalid First Slice date');
    return text;
}
export function validateFirstSliceEvidence(value: unknown): import('../src/types/api').EvidenceRequest {
    const input = firstSliceObject(value, ['kind', 'subject'], ['periodA', 'periodB']);
    const subject = firstSliceObject(input.subject, ['by'], ['id', 'name']);
    if (subject.by === 'id') {
        firstSliceObject(subject, ['by', 'id']);
        if (typeof subject.id !== 'number' || !Number.isSafeInteger(subject.id) || subject.id <= 0) throw new Error('Invalid subject');
    } else if (subject.by === 'exact_name') {
        firstSliceObject(subject, ['by', 'name']);
        firstSliceText(subject.name, 500);
    } else throw new Error('Invalid subject');
    if (input.kind === 'subject_progress') firstSliceObject(input, ['kind', 'subject']);
    else if (input.kind === 'focus_comparison') {
        firstSliceObject(input, ['kind', 'subject', 'periodA', 'periodB']);
        const a = firstSliceObject(input.periodA, ['startDate', 'endDate']);
        const b = firstSliceObject(input.periodB, ['startDate', 'endDate']);
        const aStart = firstSliceDate(a.startDate), aEnd = firstSliceDate(a.endDate);
        const bStart = firstSliceDate(b.startDate), bEnd = firstSliceDate(b.endDate);
        if (aStart > aEnd || bStart > bEnd || !(aEnd < bStart || bEnd < aStart)) throw new Error('Invalid periods');
    } else throw new Error('Invalid evidence kind');
    return structuredClone(input) as import('../src/types/api').EvidenceRequest;
}
export function validateFirstSliceIntent(value: unknown): import('../src/types/api').FirstSliceRestrictionIntent {
    const input = firstSliceObject(value, ['lifetime', 'target', 'purpose', 'object', 'destination']);
    const target = firstSliceObject(input.target, ['category', 'operation']);
    if (!(target.category === 'diary' && (target.operation === 'use' || target.operation === 'disclose'))
        && !(target.category === 'all-outbound' && target.operation === 'disclose')) throw new Error('Invalid restriction target');
    const pairs: Record<string, string> = { request: 'this_question', session: 'this_conversation', durable_preference: 'aipanel_default' };
    if (typeof input.lifetime !== 'string' || !Object.prototype.hasOwnProperty.call(pairs, input.lifetime) || pairs[input.lifetime] !== input.purpose
        || input.object !== 'category' || !(input.destination === 'all' || input.destination === 'current_provider')) throw new Error('Invalid restriction scope');
    return structuredClone(input) as import('../src/types/api').FirstSliceRestrictionIntent;
}
export const firstSliceValidators = {
    openSession(value: unknown): Record<string, never> {
        firstSliceObject(value, []);
        return {};
    },
    closeSession(value: unknown): import('../src/types/api').FirstSliceSessionInput {
        const input = firstSliceObject(value, ['session']);
        return { session: firstSliceText(input.session, 200) };
    },
    regenerate(value: unknown): import('../src/types/api').FirstSliceRequestInput {
        const input = firstSliceObject(value, ['session', 'requestHandle']);
        return { session: firstSliceText(input.session, 200), requestHandle: firstSliceText(input.requestHandle, 200) };
    },
    cancel(value: unknown): import('../src/types/api').FirstSliceSessionInput | import('../src/types/api').FirstSliceRequestInput {
        const input = firstSliceObject(value, ['session'], ['requestHandle']);
        return Object.prototype.hasOwnProperty.call(input, 'requestHandle') ? this.regenerate(input) : this.closeSession(input);
    },
    resolveEvidence(value: unknown): import('../src/types/api').FirstSliceResolveInput {
        const input = firstSliceObject(value, ['session', 'request'], ['userInput', 'requestHandle']);
        const session = firstSliceText(input.session, 200);
        const request = validateFirstSliceEvidence(input.request);
        if (Object.prototype.hasOwnProperty.call(input, 'requestHandle')) {
            firstSliceObject(input, ['session', 'request', 'requestHandle']);
            return { session, request, requestHandle: firstSliceText(input.requestHandle, 200) };
        }
        firstSliceObject(input, ['session', 'request', 'userInput']);
        return { session, request, userInput: firstSliceText(input.userInput, 30_000) };
    },
    send(value: unknown): import('../src/types/api').FirstSliceSendInput {
        const input = firstSliceObject(value, ['session', 'kind', 'userInput'], ['requestHandle', 'share', 'acceptLimited', 'imageDataUrls', 'textAttachments']);
        const session = firstSliceText(input.session, 200), userInput = firstSliceText(input.userInput, 30_000);
        if (input.kind === 'chat') {
            firstSliceObject(input, ['session', 'kind', 'userInput'], ['imageDataUrls', 'textAttachments']);
            let textAttachments: import('../src/types/api').FirstSliceTextAttachment[] | undefined;
            if (Object.prototype.hasOwnProperty.call(input, 'textAttachments')) {
                const texts = input.textAttachments;
                if (!Array.isArray(texts) || texts.length < 1 || texts.length > 5
                    || Reflect.ownKeys(texts).length !== texts.length + 1) throw new Error('Invalid text attachments');
                let totalChars = 0;
                textAttachments = Array.from({ length: texts.length }, (_, index) => {
                    const descriptor = Object.getOwnPropertyDescriptor(texts, String(index));
                    if (!descriptor || !('value' in descriptor)) throw new Error('Invalid text attachment');
                    const attachment = firstSliceObject(descriptor.value, ['kind', 'name', 'text']);
                    if (attachment.kind !== 'pdf' && attachment.kind !== 'text-file') throw new Error('Invalid text attachment kind');
                    const name = firstSliceText(attachment.name, 255);
                    if (/[/\\:\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') throw new Error('Invalid attachment filename');
                    const text = firstSliceText(attachment.text, 20_000);
                    totalChars += text.length;
                    if (totalChars > 20_000) throw new Error('Text attachments exceed send budget');
                    return { kind: attachment.kind, name, text };
                });
            }
            const result = { session, kind: 'chat' as const, userInput, ...(textAttachments ? { textAttachments } : {}) };
            if (!Object.prototype.hasOwnProperty.call(input, 'imageDataUrls')) return result;
            const images = input.imageDataUrls;
            if (!Array.isArray(images) || images.length < 1 || images.length > 3
                || Reflect.ownKeys(images).length !== images.length + 1) throw new Error('Invalid images');
            if (images.length + (textAttachments?.length ?? 0) > 5) throw new Error('Too many attachments');
            const imageDataUrls = Array.from({ length: images.length }, (_, index) => {
                const descriptor = Object.getOwnPropertyDescriptor(images, String(index));
                if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') throw new Error('Invalid image');
                return descriptor.value as string;
            });
            // Reuse MIME, byte/count limits and final-user-only request policy.
            validateAiRequestMessages([{ role: 'system', content: 'Image input validation' }, { role: 'user', content: [
                { type: 'text', text: userInput }, ...imageDataUrls.map(url => ({ type: 'image_url' as const, image_url: { url } })),
            ] }]);
            return { ...result, imageDataUrls };
        }
        firstSliceObject(input, ['session', 'kind', 'userInput', 'requestHandle', 'share', 'acceptLimited']);
        if (input.kind !== 'focus_explanation' || typeof input.share !== 'boolean' || typeof input.acceptLimited !== 'boolean') throw new Error('Invalid disclosure decision');
        return { session, kind: 'focus_explanation', userInput, requestHandle: firstSliceText(input.requestHandle, 200), share: input.share, acceptLimited: input.acceptLimited };
    },
    restrict(value: unknown): import('../src/types/api').FirstSliceRestrictInput {
        const input = firstSliceObject(value, ['session', 'userInput', 'intent']);
        return { session: firstSliceText(input.session, 200), userInput: firstSliceText(input.userInput, 30_000), intent: validateFirstSliceIntent(input.intent) };
    },
};
