import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { app, safeStorage as ss } from 'electron';
import { logger } from './logger';
import { deleteManagedMistakeImage, getMistakeImageReferenceKey } from './mistakeImageStorage';
import { getLocalDateKey } from '../src/utils/dateKey';
import {
    DATABASE_BACKUP_TABLES,
    normalizeBackupDatabaseData,
    type DatabaseBackupRow,
    type NormalizedBackupDatabaseData,
} from './databaseBackupData';
import {
    assertSupportedDatabaseVersion,
    CURRENT_SCHEMA_VERSION,
    runDatabaseMigrations,
} from './databaseMigrations';
import { createDatabaseRepositories, type DatabaseRepositories } from './repositories/databaseRepositoryFactory';
import type Database from 'better-sqlite3';
import type {
    DiaryEntry, NewEntry, EntryFilters, Tag, Subject,
    PomodoroSession, PomodoroStat, StudyTask, NewStudyTask,
    Mistake, MistakeFilters,
    DiaryTemplate, TodayDashboardData, DateMood, Attachment
} from '../src/types/index';

// NOTE: fully typing better-sqlite3 query results requires generics at every
// .get/.all/.run call site. That is a separate task; the exported function
// signatures are typed, which is what matters for IPC callers.
let db: Database.Database = undefined as unknown as Database.Database;
let repositories: DatabaseRepositories = undefined as unknown as DatabaseRepositories;
let isInitialized = false;

let customDbPath: string | null = null;
const API_KEY_ENCRYPTION_UNAVAILABLE_MESSAGE = '当前系统加密能力不可用，无法安全保存 API Key';
const API_KEY_ENCRYPTION_PREFIX = 'enc:v1:';

function setCustomDbPath(p: string) {
    customDbPath = p;
}

function getDbPath() {
    if (customDbPath) return customDbPath;
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'minddiary.db');
}

function initialize() {
    let candidate: Database.Database | null = null;
    try {
        candidate = new BetterSqlite3(getDbPath());
        assertSupportedDatabaseVersion(candidate);
        candidate.pragma('journal_mode = WAL');
        candidate.pragma('foreign_keys = ON');
        runDatabaseMigrations(candidate);
        repositories = createDatabaseRepositories(candidate);
        db = candidate;
        isInitialized = true;
        candidate = null;
    } catch (error) {
        isInitialized = false;
        db = undefined as unknown as Database.Database;
        repositories = undefined as unknown as DatabaseRepositories;
        if (candidate) {
            candidate.close();
        }
        throw error;
    }
}

function getDb(): Database.Database {
    if (!isInitialized) {
        throw new Error('Database has not been initialized');
    }
    return db;
}

function getRepositories(): DatabaseRepositories {
    if (!isInitialized) {
        throw new Error('Database has not been initialized');
    }
    return repositories;
}

// ==================== Entries ====================
function createEntry({ date, title, content, mood }: NewEntry) {
    return getRepositories().entries.createEntry({ date, title, content, mood });
}

function updateEntry(id: number, { title, content, mood }: Partial<NewEntry>) {
    return getRepositories().entries.updateEntry(id, { title, content, mood });
}

function deleteEntry(id: number) {
    return getRepositories().entries.deleteEntry(id);
}

function getEntryById(id: number): DiaryEntry | undefined {
    return getRepositories().entries.getEntryById(id);
}

function getEntryByDate(date: string): DiaryEntry | undefined {
    return getRepositories().entries.getEntryByDate(date);
}

function getAllEntries(filters: EntryFilters = {}): DiaryEntry[] {
    return getRepositories().entries.getAllEntries(filters);
}

function searchEntries(query: string) {
    return getRepositories().entries.searchEntries(query);
}

function getDatesWithEntries(yearMonth: string): DateMood[] {
    return getRepositories().entries.getDatesWithEntries(yearMonth);
}

// ==================== Tags ====================
function getAllTags(): Tag[] {
    return getRepositories().tags.getAllTags();
}

function createTag(data: Partial<Tag>): Tag {
    return getRepositories().tags.createTag(data);
}

function updateTag(id: number, data: Partial<Tag>): Tag {
    return getRepositories().tags.updateTag(id, data);
}

function deleteTag(id: number) {
    return getRepositories().tags.deleteTag(id);
}

function setEntryTags(entryId: number, tagIds: number[]) {
    return getRepositories().tags.setEntryTags(entryId, tagIds);
}

function getEntryTags(entryId: number): Tag[] {
    return getRepositories().tags.getEntryTags(entryId);
}

function getEntryTagsBatch(entryIds: number[]): Record<number, Tag[]> {
    return getRepositories().tags.getEntryTagsBatch(entryIds);
}

// ==================== Settings ====================
function getSetting(key: string) {
    return getRepositories().settings.getSetting(key);
}

function setSetting(key: string, value: unknown) {
    return getRepositories().settings.setSetting(key, value);
}

function getAllSettings() {
    return getRepositories().settings.getAllSettings();
}

// ==================== Attachments ====================
function addAttachment(entryId: number, { filename, filepath, mimetype }: { filename: string; filepath: string; mimetype: string }) {
    return getRepositories().attachments.addAttachment(entryId, { filename, filepath, mimetype });
}

function getAttachmentsByEntry(entryId: number) {
    return getRepositories().attachments.getAttachmentsByEntry(entryId);
}

function getAttachmentsByEntries(entryIds: number[]): Record<number, Attachment[]> {
    return getRepositories().attachments.getAttachmentsByEntries(entryIds);
}

function getAttachmentById(id: number) {
    return getRepositories().attachments.getAttachmentById(id);
}

function removeAttachment(id: number) {
    return getRepositories().attachments.removeAttachment(id);
}

// ==================== Subjects ====================
function getAllSubjects(): Subject[] {
    return getRepositories().subjects.getAllSubjects();
}

function createSubject(subject: Partial<Subject>) {
    return getRepositories().subjects.createSubject(subject);
}

function updateSubject(id: number, subject: Partial<Subject>) {
    return getRepositories().subjects.updateSubject(id, subject);
}

function deleteSubject(id: number) {
    return getRepositories().subjects.deleteSubject(id);
}

// ==================== Pomodoro ====================
function addPomodoroSession({ subject_id, task_id, duration, date_key, started_at, completed_at }: PomodoroSession) {
    return getRepositories().pomodoro.addPomodoroSession({ subject_id, task_id, duration, date_key, started_at, completed_at });
}

function getPomodoroStats(date: string): PomodoroStat[] {
    return getRepositories().pomodoro.getPomodoroStats(date);
}

function getPomodoroStatsRange(startDate: string, endDate: string): PomodoroStat[] {
    return getRepositories().pomodoro.getPomodoroStatsRange(startDate, endDate);
}

function getDailyStudyMinutes(date: string) {
    return getRepositories().pomodoro.getDailyStudyMinutes(date);
}

// Dashboard: daily totals over a date range
function getPomodoroRange(startDate: string, endDate: string) {
    return getRepositories().pomodoro.getPomodoroRange(startDate, endDate);
}

function getStudyTasksByDate(date: string): StudyTask[] {
    return getRepositories().studyTasks.getStudyTasksByDate(date);
}

function createStudyTask(data: NewStudyTask): StudyTask {
    return getRepositories().studyTasks.createStudyTask(data);
}

function updateStudyTask(id: number, patch: Partial<StudyTask>): StudyTask {
    return getRepositories().studyTasks.updateStudyTask(id, patch);
}

function deleteStudyTask(id: number): boolean {
    return getRepositories().studyTasks.deleteStudyTask(id);
}

function completeStudyTask(id: number): StudyTask {
    return getRepositories().studyTasks.completeStudyTask(id);
}

function skipStudyTask(id: number): StudyTask {
    return getRepositories().studyTasks.skipStudyTask(id);
}

function startStudyTaskFocus(id: number, date: string): StudyTask {
    return getRepositories().studyTasks.startStudyTaskFocus(id, date);
}

// Dashboard: entry dates with mood for heatmap
function getEntryDatesRange(startDate: string, endDate: string) {
    return db.prepare(`
        SELECT date, mood FROM entries
        WHERE date BETWEEN ? AND ?
        ORDER BY date ASC
    `).all(startDate, endDate);
}

// Dashboard: consecutive study days streak (entries or pomodoro)
function getStudyStreak() {
    const rows = db.prepare(`
        SELECT DISTINCT date FROM (
            SELECT date_key as date FROM pomodoro_sessions
            UNION
            SELECT date FROM entries
        )
        WHERE date IS NOT NULL
        ORDER BY date DESC
    `).all() as { date: string }[];

    if (rows.length === 0) return 0;

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if today or yesterday is in the list to start counting
    const firstDate = new Date(rows[0]!.date + 'T00:00:00');
    const diffFromToday = Math.round((today.getTime() - firstDate.getTime()) / 86400000);
    if (diffFromToday > 1) return 0; // Gap > 1 day, streak broken

    for (let i = 0; i < rows.length; i++) {
        const d = new Date(rows[i]!.date + 'T00:00:00');
        const expected = new Date(today);
        expected.setDate(expected.getDate() - streak - diffFromToday);
        expected.setHours(0, 0, 0, 0);

        if (d.getTime() === expected.getTime()) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

// ==================== Today Dashboard (V3.0 Batch Query) ====================
function getTodayDashboard(date: string): TodayDashboardData {
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Invalid date format. Expected YYYY-MM-DD');
    }

    const getTodayData = db.transaction(() => {
        const dateObj = new Date(date + 'T00:00:00');
        
        // 7 days ago
        const pastDate = new Date(dateObj);
        pastDate.setDate(pastDate.getDate() - 7);
        const pastDateStr = getLocalDateKey(pastDate);

        // 1. Today's diary entry
        const todayEntry = db.prepare(
            'SELECT id, title, word_count, mood FROM entries WHERE date = ?'
        ).get(date) as { id: number; title: string; word_count: number; mood: import('../src/types/index').MoodId | null } | undefined || null;

        // 2. Today's pomodoro summary
        const pomRow = db.prepare(`
            SELECT COALESCE(SUM(duration), 0) as total_minutes,
                   COUNT(id) as session_count
            FROM pomodoro_sessions
            WHERE date_key = ?
        `).get(date) as { total_minutes: number; session_count: number };

        // 3. Today's due review pool. Keep this aligned with mistakes:getDueCount.
        const riskRow = db.prepare(`
            SELECT COUNT(*) as count FROM mistakes
            WHERE mastered = 0 AND (next_review_date IS NULL OR next_review_date <= ?)
        `).get(date) as { count: number };

        // 4. Locked Knowledge Growth (EF >= 2.5 and updated in last 7 days)
        const lockedRow = db.prepare(`
            SELECT COUNT(*) as count FROM mistakes
            WHERE (ease_factor >= 2.5 OR mastered = 1) AND DATE(updated_at) >= ?
        `).get(pastDateStr) as { count: number };

        // 5. Effective Focus Conversion (today actions vs pomodoros)
        const actionsTodayRow = db.prepare(`
            SELECT
                (SELECT COUNT(*) FROM entries WHERE date = ? AND word_count > 20) +
                (SELECT COUNT(*) FROM mistakes WHERE DATE(updated_at) = ?) as action_count
        `).get(date, date) as { action_count: number };

        let conversionRate = 0;
        if (pomRow.session_count > 0) {
            // Heuristic: 1 summary or mistake equals ~1 successful pomodoro conversion. Cap at 100%
            conversionRate = Math.min(100, Math.round((actionsTodayRow.action_count / pomRow.session_count) * 100 * 1.2));
        } else if (actionsTodayRow.action_count > 0) {
            conversionRate = 100; // Did work without pomodoro
        }

        const taskRows = db.prepare(`
            SELECT id, title, status
            FROM study_tasks
            WHERE planned_date = ?
        `).all(date) as Array<{ id: number; title: string; status: StudyTask['status'] }>;
        const taskFocusRows = db.prepare(`
            SELECT p.task_id as task_id, COALESCE(SUM(p.duration), 0) as total_minutes
            FROM pomodoro_sessions p
            INNER JOIN study_tasks t ON t.id = p.task_id
            WHERE p.date_key = ? AND t.planned_date = ?
            GROUP BY p.task_id
        `).all(date, date) as Array<{ task_id: number; total_minutes: number }>;
        const focusedMinutesByTask = new Map(taskFocusRows.map(row => [row.task_id, row.total_minutes]));
        const effectiveTasks = taskRows.filter(task => task.status !== 'skipped');
        const completedTaskCount = effectiveTasks.filter(task => task.status === 'done').length;
        const focusedTaskCount = effectiveTasks.filter(task => (focusedMinutesByTask.get(task.id) ?? 0) > 0).length;
        const openWithoutFocusTasks = effectiveTasks.filter(task => task.status === 'doing' && !(focusedMinutesByTask.get(task.id) ?? 0));
        const focusedOpenTasks = effectiveTasks.filter(task => task.status !== 'done' && (focusedMinutesByTask.get(task.id) ?? 0) > 0);
        const focusedMinutes = taskFocusRows.reduce((total, row) => total + row.total_minutes, 0);
        const completionRate = effectiveTasks.length > 0
            ? Math.round((completedTaskCount / effectiveTasks.length) * 100)
            : 0;
        const focusCoverageRate = effectiveTasks.length > 0
            ? Math.round((focusedTaskCount / effectiveTasks.length) * 100)
            : 0;

        const streak = getStudyStreak();

        return {
            todayEntry: todayEntry ? {
                id: todayEntry.id,
                title: todayEntry.title,
                wordCount: todayEntry.word_count,
                mood: todayEntry.mood,
            } : null,
            pomodoroToday: {
                totalMinutes: pomRow.total_minutes,
                sessionCount: pomRow.session_count,
            },
            commanderMetrics: {
                riskPoolCount: riskRow.count,
                lockedKnowledgeGrowth: lockedRow.count,
                focusConversionRate: conversionRate
            },
            taskFocusToday: {
                effectiveTaskCount: effectiveTasks.length,
                completedTaskCount,
                completionRate,
                focusedTaskCount,
                focusCoverageRate,
                focusedMinutes,
                skippedTaskCount: taskRows.filter(task => task.status === 'skipped').length,
                openWithoutFocusCount: openWithoutFocusTasks.length,
                focusedOpenTaskCount: focusedOpenTasks.length,
                unclosedTaskTitles: [...openWithoutFocusTasks, ...focusedOpenTasks]
                    .filter((task, index, tasks) => tasks.findIndex(candidate => candidate.id === task.id) === index)
                    .slice(0, 3)
                    .map(task => task.title),
            },
            streakDays: streak
        };
    });

    return getTodayData();
}

// ==================== Mistakes ====================
function getAllMistakes(filters: MistakeFilters = {}): { data: Mistake[], total: number, masteredTotal: number } {
    return getRepositories().mistakes.getAllMistakes(filters);
}

function createMistake({ subject_id, question, answer, notes, image_path, answer_image_path }: Partial<Mistake>) {
    return getRepositories().mistakes.createMistake({ subject_id, question, answer, notes, image_path, answer_image_path });
}

type MistakeImageFields = {
    image_path: string | null;
    answer_image_path: string | null;
};

function parseMistakeImagePaths(raw: unknown): string[] {
    if (typeof raw !== 'string') return [];
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
            }
        } catch {
            return [trimmed];
        }
    }
    return [trimmed];
}

function getMistakeImageRefs(fields: MistakeImageFields): string[] {
    return [
        ...parseMistakeImagePaths(fields.image_path),
        ...parseMistakeImagePaths(fields.answer_image_path),
    ];
}

function getRemovedMistakeImageRefs(oldFields: MistakeImageFields, newFields: MistakeImageFields): string[] {
    const newKeys = new Set(
        getMistakeImageRefs(newFields)
            .map(ref => getMistakeImageReferenceKey(ref))
            .filter((key: string | null): key is string => !!key),
    );
    const removed: string[] = [];
    const seen = new Set<string>();

    for (const ref of getMistakeImageRefs(oldFields)) {
        const key = getMistakeImageReferenceKey(ref);
        if (!key) {
            removed.push(ref);
            continue;
        }
        if (!newKeys.has(key) && !seen.has(key)) {
            removed.push(ref);
            seen.add(key);
        }
    }

    return removed;
}

function isMistakeImageStillReferenced(ref: string, excludingId: number): boolean {
    const targetKey = getMistakeImageReferenceKey(ref);
    if (!targetKey) return false;
    const rows = getRepositories().mistakes.getOtherMistakeImageFields(excludingId);
    return rows.some(row => getMistakeImageRefs(row).some(candidate => (
        getMistakeImageReferenceKey(candidate) === targetKey
    )));
}

async function cleanupRemovedMistakeImages(mistakeId: number, oldFields: MistakeImageFields, newFields: MistakeImageFields): Promise<void> {
    for (const ref of getRemovedMistakeImageRefs(oldFields, newFields)) {
        const key = getMistakeImageReferenceKey(ref);
        if (!key) {
            logger.warn('[database] Skipped unmanaged mistake image cleanup', ref);
            continue;
        }
        if (isMistakeImageStillReferenced(ref, mistakeId)) {
            continue;
        }
        try {
            await deleteManagedMistakeImage(ref);
        } catch (error) {
            logger.warn(
                '[database] Failed to delete removed mistake image',
                error instanceof Error ? error.message : String(error),
            );
        }
    }
}

async function updateMistake(id: number, { subject_id, question, answer, notes, mastered, image_path, answer_image_path }: Partial<Mistake>) {
    const hasImagePatch = image_path !== undefined || answer_image_path !== undefined;
    const previousImageFields = hasImagePatch
        ? getRepositories().mistakes.getMistakeImageFields(id)
        : null;
    const nextImageFields = previousImageFields
        ? {
            image_path: image_path !== undefined ? image_path ?? null : previousImageFields.image_path,
            answer_image_path: answer_image_path !== undefined ? answer_image_path ?? null : previousImageFields.answer_image_path,
        }
        : null;
    const result = getRepositories().mistakes.updateMistake(id, { subject_id, question, answer, notes, mastered, image_path, answer_image_path });
    if (previousImageFields && nextImageFields) {
        await cleanupRemovedMistakeImages(id, previousImageFields, nextImageFields);
    }
    return result;
}

async function deleteMistake(id: number) {
    try {
        const imageFields = getRepositories().mistakes.getMistakeImageFields(id);
        await cleanupRemovedMistakeImages(id, imageFields, { image_path: null, answer_image_path: null });
    } catch(e) { logger.error('Failed to cleanup mistake image', e); }

    return getRepositories().mistakes.deleteMistake(id);
}

function toggleMistakeMastered(id: number) {
    return getRepositories().mistakes.toggleMistakeMastered(id);
}

/**
 * Update a mistake's spaced-repetition fields after a review.
 * @param {number} id - Mistake ID
 * @param {{ease_factor: number, review_interval: number, next_review_date: string, review_count: number}} data
 */
function reviewMistake(id: number, { ease_factor, review_interval, next_review_date, review_count }: Partial<Mistake>) {
    return getRepositories().mistakes.reviewMistake(id, { ease_factor, review_interval, next_review_date, review_count });
}

/**
 * Count mistakes due for review on or before the given date.
 */
function getDueForReviewCount(date: string) {
    return getRepositories().mistakes.getDueForReviewCount(date);
}

/**
 * Get a random unmastered mistake, optionally filtered by subject.
 */
function getRandomDueMistake(date: string, subjectId?: number) {
    return getRepositories().mistakes.getRandomDueMistake(date, subjectId);
}

// ==================== Templates ====================
function getAllTemplates(): DiaryTemplate[] {
    return getRepositories().templates.getAllTemplates();
}

function createTemplate({ name, content, sort_order }: Partial<DiaryTemplate>) {
    return getRepositories().templates.createTemplate({ name, content, sort_order });
}

function updateTemplate(id: number, { name, content, sort_order }: Partial<DiaryTemplate>) {
    return getRepositories().templates.updateTemplate(id, { name, content, sort_order });
}

function deleteTemplate(id: number) {
    return getRepositories().templates.deleteTemplate(id);
}

// ── AI Key (safeStorage-aware) ──────────────────────────────────────────────

function encryptAiApiKeyForStorage(key: string): string {
    const encrypted = ss.encryptString(key);
    return `${API_KEY_ENCRYPTION_PREFIX}${encrypted.toString('base64')}`;
}

function decryptAiApiKeyFromStorage(raw: string): string {
    const payload = raw.startsWith(API_KEY_ENCRYPTION_PREFIX)
        ? raw.slice(API_KEY_ENCRYPTION_PREFIX.length)
        : raw;
    return ss.decryptString(Buffer.from(payload, 'base64'));
}

function getAiApiKey(): string | null {
    const raw = getSetting('aiApiKey');
    if (!raw || typeof raw !== 'string' || raw.length === 0) return null;
    if (!ss.isEncryptionAvailable()) {
        logger.warn('[db] safeStorage unavailable - ignoring persisted API key');
        return null;
    }

    if (raw.startsWith(API_KEY_ENCRYPTION_PREFIX)) {
        try {
            return decryptAiApiKeyFromStorage(raw);
        } catch {
            logger.warn('[db] Failed to decrypt stored API key');
            return null;
        }
    }

    try {
        const decrypted = decryptAiApiKeyFromStorage(raw);
        setSetting('aiApiKey', encryptAiApiKeyForStorage(decrypted));
        logger.info('[db] Migrated legacy encrypted API key format');
        return decrypted;
    } catch {
        setSetting('aiApiKey', encryptAiApiKeyForStorage(raw));
        logger.info('[db] Migrated legacy plaintext API key to encrypted storage');
        return raw;
    }
}

function setAiApiKey(key: string): void {
    if (key === '') {
        setSetting('aiApiKey', '');
        return;
    }
    if (!ss.isEncryptionAvailable()) {
        logger.warn('[db] safeStorage unavailable - refusing to persist API key');
        throw new Error(API_KEY_ENCRYPTION_UNAVAILABLE_MESSAGE);
    }
    setSetting('aiApiKey', encryptAiApiKeyForStorage(key));
}

function exportBackupData(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const definition of DATABASE_BACKUP_TABLES) {
        const columns = definition.columns.join(', ');
        snapshot[definition.key] = db.prepare(`SELECT ${columns} FROM ${definition.table}`).all() as DatabaseBackupRow[];
    }
    return snapshot;
}

function getNormalizedBackupRows(
    data: NormalizedBackupDatabaseData,
    key: typeof DATABASE_BACKUP_TABLES[number]['key'],
): DatabaseBackupRow[] {
    return data[key];
}

function insertBackupRows(table: string, allowedColumns: readonly string[], rows: DatabaseBackupRow[]): void {
    for (const row of rows) {
        const columns = allowedColumns.filter(column => Object.prototype.hasOwnProperty.call(row, column));
        if (columns.length === 0) continue;
        const placeholders = columns.map(() => '?').join(', ');
        const statement = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
        statement.run(...columns.map(column => row[column]));
    }
}

function restoreBackupData(data: Record<string, unknown>): void {
    const normalized = normalizeBackupDatabaseData(data);
    const transaction = db.transaction(() => {
        for (const definition of [...DATABASE_BACKUP_TABLES].reverse()) {
            db.prepare(`DELETE FROM ${definition.table}`).run();
        }
        for (const definition of DATABASE_BACKUP_TABLES) {
            insertBackupRows(definition.table, definition.columns, getNormalizedBackupRows(normalized, definition.key));
        }
        const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
        if (foreignKeyViolations.length > 0) {
            throw new Error(`Backup restore failed foreign_key_check with ${foreignKeyViolations.length} violation(s)`);
        }
    });
    transaction();
}

module.exports = {
    CURRENT_SCHEMA_VERSION,
    initialize,
    createEntry, updateEntry, deleteEntry, getEntryById, getEntryByDate,
    getAllEntries, searchEntries, getDatesWithEntries,
    getAllTags, createTag, updateTag, deleteTag, setEntryTags, getEntryTags, getEntryTagsBatch,
    getSetting, setSetting, getAllSettings,
    addAttachment, getAttachmentsByEntry, getAttachmentsByEntries, getAttachmentById, removeAttachment,
    getAllSubjects, createSubject, updateSubject, deleteSubject,
    addPomodoroSession, getPomodoroStats, getPomodoroStatsRange, getDailyStudyMinutes,
    getStudyTasksByDate, createStudyTask, updateStudyTask, deleteStudyTask, completeStudyTask, skipStudyTask, startStudyTaskFocus,
    getPomodoroRange, getEntryDatesRange, getStudyStreak, getTodayDashboard,
    getAllMistakes, createMistake, updateMistake, deleteMistake, toggleMistakeMastered,
    reviewMistake, getDueForReviewCount, getRandomDueMistake,
    getAllTemplates, createTemplate, updateTemplate, deleteTemplate,
    setCustomDbPath, getDb,
    getAiApiKey, setAiApiKey,
    exportBackupData, restoreBackupData,
};
