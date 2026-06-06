import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { app, safeStorage as ss } from 'electron';
import { logger } from './logger';
import { deleteManagedMistakeImage, getMistakeImageReferenceKey } from './mistakeImageStorage';
import { getLocalDateKey, isDateKey, toLocalDateTimeString } from '../src/utils/dateKey';
import {
    mergeTagPatch,
    normalizeTag,
    normalizeTagList,
} from '../src/utils/tagStyle';
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
import type Database from 'better-sqlite3';
import type {
    DiaryEntry, NewEntry, EntryFilters, Tag, Subject,
    PomodoroSession, PomodoroStat, StudyTask, NewStudyTask,
    StudyTaskSource, StudyTaskStatus, StudyTaskType,
    Mistake, MistakeFilters,
    DiaryTemplate, TodayDashboardData, DateMood, Attachment
} from '../src/types/index';

// NOTE: fully typing better-sqlite3 query results requires generics at every
// .get/.all/.run call site. That is a separate task; the exported function
// signatures are typed, which is what matters for IPC callers.
let db: Database.Database = undefined as unknown as Database.Database;
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
        db = candidate;
        isInitialized = true;
        candidate = null;
    } catch (error) {
        isInitialized = false;
        db = undefined as unknown as Database.Database;
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

// ==================== Entries ====================
function createEntry({ date, title, content, mood }: NewEntry) {
    const wordCount = (content || '').replace(/\s/g, '').length;
    const stmt = db.prepare(
        'INSERT INTO entries (date, title, content, mood, word_count) VALUES (?, ?, ?, ?, ?)'
    );
    const result = stmt.run(date, title || '', content || '', mood || null, wordCount);
    return { id: result.lastInsertRowid, date, title, content, mood, word_count: wordCount };
}

function updateEntry(id: number, { title, content, mood }: Partial<NewEntry>) {
    const wordCount = (content || '').replace(/\s/g, '').length;
    const stmt = db.prepare(
        'UPDATE entries SET title=?, content=?, mood=?, word_count=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    );
    stmt.run(title || '', content || '', mood || null, wordCount, id);
    return getEntryById(id);
}

function deleteEntry(id: number) {
    db.prepare('DELETE FROM entries WHERE id=?').run(id);
    return { success: true };
}

function getEntryById(id: number): DiaryEntry | undefined {
    return db.prepare('SELECT * FROM entries WHERE id=?').get(id) as DiaryEntry | undefined;
}

function getEntryByDate(date: string): DiaryEntry | undefined {
    return db.prepare('SELECT * FROM entries WHERE date=?').get(date) as DiaryEntry | undefined;
}

function getAllEntries(filters: EntryFilters = {}): DiaryEntry[] {
    // Phase 11.2: By default, strip heavy `content` field from list queries.
    // Pass { includeContent: true } when full text is needed (e.g. export/backup).
    const columns = filters.includeContent
        ? '*'
        : 'id, date, title, mood, word_count, created_at, updated_at';
    let query = `SELECT ${columns} FROM entries`;
    const conditions = [];
    const params = [];

    if (filters.mood) {
        conditions.push('mood = ?');
        params.push(filters.mood);
    }
    if (filters.startDate) {
        conditions.push('date >= ?');
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        conditions.push('date <= ?');
        params.push(filters.endDate);
    }
    if (filters.tagId) {
        conditions.push('id IN (SELECT entry_id FROM entry_tags WHERE tag_id = ?)');
        params.push(filters.tagId);
    }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY date DESC';

    if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
    }

    return db.prepare(query).all(...params) as DiaryEntry[];
}

function searchEntries(query: string) {
    const searchTerm = `%${query}%`;
    // Return metadata + a content snippet indicator; full content loaded via getEntryById
    return db.prepare(
        'SELECT id, date, title, mood, word_count, created_at, updated_at, SUBSTR(content, 1, 200) AS content_snippet FROM entries WHERE content LIKE ? OR title LIKE ? ORDER BY date DESC'
    ).all(searchTerm, searchTerm) as DiaryEntry[];
}

function getDatesWithEntries(yearMonth: string): DateMood[] {
    const pattern = `${yearMonth}%`;
    return db.prepare(
        'SELECT date, mood FROM entries WHERE date LIKE ?'
    ).all(pattern) as DateMood[];
}

// ==================== Tags ====================
function getAllTags(): Tag[] {
    return normalizeTagList(db.prepare('SELECT * FROM tags ORDER BY name').all() as Tag[]);
}

function normalizeEntryIds(entryIds: number[]): number[] {
    if (!Array.isArray(entryIds)) return [];
    return Array.from(new Set(entryIds.filter(entryId => Number.isInteger(entryId) && entryId > 0)));
}

function getTagById(id: number): Tag | undefined {
    const tag = db.prepare('SELECT * FROM tags WHERE id=?').get(id) as Tag | undefined;
    return tag ? normalizeTag(tag) : undefined;
}

function createTag(data: Partial<Tag>): Tag {
    const newTag = normalizeTag({
        id: 0,
        name: data.name,
        color: data.color,
        icon: data.icon,
        variant: data.variant,
        pattern: data.pattern,
    });
    if (!newTag.name) {
        throw new Error('Tag name is required');
    }
    const stmt = db.prepare('INSERT INTO tags (name, color, icon, variant, pattern) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(newTag.name, newTag.color, newTag.icon, newTag.variant, newTag.pattern);
    return { ...newTag, id: Number(result.lastInsertRowid) };
}

function updateTag(id: number, data: Partial<Tag>): Tag {
    const existingTag = getTagById(id);
    if (!existingTag) {
        throw new Error('Tag not found');
    }
    const updatedTag = mergeTagPatch(existingTag, data);
    if (!updatedTag.name) {
        throw new Error('Tag name is required');
    }
    const result = db.prepare('UPDATE tags SET name=?, color=?, icon=?, variant=?, pattern=? WHERE id=?')
        .run(updatedTag.name, updatedTag.color, updatedTag.icon, updatedTag.variant, updatedTag.pattern, id);
    if (result.changes === 0) {
        throw new Error('Tag not found');
    }
    return updatedTag;
}

function deleteTag(id: number) {
    db.prepare('DELETE FROM tags WHERE id=?').run(id);
    return { success: true };
}

function setEntryTags(entryId: number, tagIds: number[]) {
    const deleteStmt = db.prepare('DELETE FROM entry_tags WHERE entry_id=?');
    const insertStmt = db.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
    const transaction = db.transaction(() => {
        deleteStmt.run(entryId);
        for (const tagId of tagIds) {
            insertStmt.run(entryId, tagId);
        }
    });
    transaction();
    return { success: true };
}

function getEntryTags(entryId: number): Tag[] {
    return normalizeTagList(db.prepare(
        'SELECT t.* FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id = ?'
    ).all(entryId) as Tag[]);
}

function getEntryTagsBatch(entryIds: number[]): Record<number, Tag[]> {
    const validEntryIds = normalizeEntryIds(entryIds);
    if (validEntryIds.length === 0) return {};

    const result: Record<number, Tag[]> = {};
    for (const entryId of validEntryIds) {
        result[entryId] = [];
    }

    const placeholders = validEntryIds.map(() => '?').join(', ');
    const rows = db.prepare(
        `SELECT et.entry_id, t.* FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id IN (${placeholders})`
    ).all(...validEntryIds) as Array<Tag & { entry_id: number }>;

    for (const row of rows) {
        const { entry_id, ...tag } = row;
        if (result[entry_id]) {
            result[entry_id].push(normalizeTag(tag));
        }
    }
    return result;
}

// ==================== Settings ====================
function getSetting(key: string) {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: unknown } | undefined;
    return row ? row.value : null;
}

function setSetting(key: string, value: unknown) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    return { success: true };
}

function getAllSettings() {
    const rows = db.prepare('SELECT * FROM settings').all() as { key: string; value: unknown }[];
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    return settings;
}

// ==================== Attachments ====================
function addAttachment(entryId: number, { filename, filepath, mimetype }: { filename: string; filepath: string; mimetype: string }) {
    const stmt = db.prepare(
        'INSERT INTO attachments (entry_id, filename, filepath, mimetype) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(entryId, filename, filepath, mimetype);
    return { id: result.lastInsertRowid, entry_id: entryId, filename, filepath, mimetype };
}

function getAttachmentsByEntry(entryId: number) {
    return db.prepare('SELECT * FROM attachments WHERE entry_id=?').all(entryId);
}

function getAttachmentsByEntries(entryIds: number[]): Record<number, Attachment[]> {
    const validEntryIds = normalizeEntryIds(entryIds);
    if (validEntryIds.length === 0) return {};

    const result: Record<number, Attachment[]> = {};
    for (const entryId of validEntryIds) {
        result[entryId] = [];
    }

    const placeholders = validEntryIds.map(() => '?').join(', ');
    const rows = db.prepare(
        `SELECT * FROM attachments WHERE entry_id IN (${placeholders})`
    ).all(...validEntryIds) as Attachment[];

    for (const attachment of rows) {
        const attachmentsForEntry = result[attachment.entry_id];
        if (attachmentsForEntry) {
            attachmentsForEntry.push(attachment);
        }
    }
    return result;
}

function getAttachmentById(id: number) {
    return db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
}

function removeAttachment(id: number) {
    db.prepare('DELETE FROM attachments WHERE id=?').run(id);
    return { success: true };
}

// ==================== Subjects ====================
function getAllSubjects(): Subject[] {
    return db.prepare('SELECT * FROM subjects ORDER BY name').all() as Subject[];
}

function createSubject({ name, total_chapters, color }: Subject) {
    const stmt = db.prepare(
        'INSERT INTO subjects (name, total_chapters, color) VALUES (?, ?, ?)'
    );
    const defaultColor = '#0F766E';
    const result = stmt.run(name, total_chapters || 0, color || defaultColor);
    return { id: result.lastInsertRowid, name, total_chapters: total_chapters || 0, completed_chapters: 0, color: color || defaultColor };
}

function updateSubject(id: number, { name, total_chapters, completed_chapters, color }: Subject) {
    db.prepare(
        'UPDATE subjects SET name=?, total_chapters=?, completed_chapters=?, color=? WHERE id=?'
    ).run(name, total_chapters, completed_chapters, color, id);
    return { id, name, total_chapters, completed_chapters, color };
}

function deleteSubject(id: number) {
    db.prepare('DELETE FROM subjects WHERE id=?').run(id);
    return { success: true };
}

// ==================== Pomodoro ====================
function normalizeOptionalDateTime(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function addPomodoroSession({ subject_id, duration, date_key, started_at, completed_at }: PomodoroSession) {
    const completedAt = normalizeOptionalDateTime(completed_at) || toLocalDateTimeString();
    const startedAt = normalizeOptionalDateTime(started_at);
    const dateKey = isDateKey(date_key) ? date_key : getLocalDateKey(startedAt ? new Date(startedAt) : new Date());

    const stmt = db.prepare(
        'INSERT INTO pomodoro_sessions (subject_id, duration, date_key, started_at, completed_at) VALUES (?, ?, ?, ?, ?)'
    );
    const result = stmt.run(subject_id || null, duration, dateKey, startedAt, completedAt);
    return { id: result.lastInsertRowid, date_key: dateKey, started_at: startedAt, completed_at: completedAt };
}

function getPomodoroStats(date: string): PomodoroStat[] {
    return db.prepare(`
    SELECT s.name as subject_name, s.color, SUM(p.duration) as total_minutes, COUNT(p.id) as session_count
    FROM pomodoro_sessions p
    LEFT JOIN subjects s ON p.subject_id = s.id
    WHERE p.date_key = ?
    GROUP BY p.subject_id
  `).all(date) as PomodoroStat[];
}

function getPomodoroStatsRange(startDate: string, endDate: string): PomodoroStat[] {
    return db.prepare(`
    SELECT s.name as subject_name, s.color, SUM(p.duration) as total_minutes, COUNT(p.id) as session_count
    FROM pomodoro_sessions p
    LEFT JOIN subjects s ON p.subject_id = s.id
    WHERE p.date_key BETWEEN ? AND ?
    GROUP BY p.subject_id
    ORDER BY total_minutes DESC
  `).all(startDate, endDate) as PomodoroStat[];
}

function getDailyStudyMinutes(date: string) {
    const row = db.prepare(
        'SELECT COALESCE(SUM(duration), 0) as total FROM pomodoro_sessions WHERE date_key = ?'
    ).get(date) as { total: number };
    return row.total;
}

// Dashboard: daily totals over a date range
function getPomodoroRange(startDate: string, endDate: string) {
    return db.prepare(`
        SELECT date_key as date,
               SUM(duration) as total_minutes,
               COUNT(id) as session_count
        FROM pomodoro_sessions
        WHERE date_key BETWEEN ? AND ?
        GROUP BY date_key
        ORDER BY date ASC
    `).all(startDate, endDate);
}

// ==================== Study Tasks ====================
const STUDY_TASK_TYPES: StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom'];
const STUDY_TASK_STATUSES: StudyTaskStatus[] = ['todo', 'doing', 'done', 'skipped'];
const STUDY_TASK_SOURCES: StudyTaskSource[] = ['manual', 'dashboard', 'ai', 'pomodoro'];

function normalizeStudyTaskTitle(value: unknown): string {
    const title = typeof value === 'string' ? value.trim() : '';
    if (!title) throw new Error('Task title is required');
    return title;
}

function normalizeStudyTaskDate(value: unknown): string {
    if (!isDateKey(value)) throw new Error('planned_date must be YYYY-MM-DD');
    return value;
}

function normalizeStudyTaskType(value: unknown): StudyTaskType {
    const type = (value || 'custom') as StudyTaskType;
    if (!STUDY_TASK_TYPES.includes(type)) throw new Error('Invalid task type');
    return type;
}

function normalizeStudyTaskStatus(value: unknown): StudyTaskStatus {
    const status = (value || 'todo') as StudyTaskStatus;
    if (!STUDY_TASK_STATUSES.includes(status)) throw new Error('Invalid task status');
    return status;
}

function normalizeStudyTaskSource(value: unknown): StudyTaskSource {
    const source = (value || 'manual') as StudyTaskSource;
    if (!STUDY_TASK_SOURCES.includes(source)) throw new Error('Invalid task source');
    return source;
}

function normalizeStudyTaskNullableId(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new Error('Task related ids must be positive integers');
    }
    return numeric;
}

function normalizeStudyTaskEstimate(value: unknown): number {
    if (value === undefined || value === null || value === '') return 25;
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new Error('estimate_minutes must be a positive integer');
    }
    return numeric;
}

function normalizeStudyTaskId(id: number): number {
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Task id must be a positive integer');
    }
    return id;
}

function getStudyTaskById(id: number): StudyTask | null {
    return db.prepare(`
        SELECT t.*
        FROM study_tasks t
        WHERE t.id = ?
    `).get(normalizeStudyTaskId(id)) as StudyTask | null;
}

function requireStudyTask(id: number): StudyTask {
    const task = getStudyTaskById(id);
    if (!task) throw new Error('Task not found');
    return task;
}

function getStudyTasksByDate(date: string): StudyTask[] {
    const plannedDate = normalizeStudyTaskDate(date);
    return db.prepare(`
        SELECT t.*
        FROM study_tasks t
        WHERE t.planned_date = ?
        ORDER BY
          CASE t.status
            WHEN 'doing' THEN 0
            WHEN 'todo' THEN 1
            WHEN 'skipped' THEN 2
            WHEN 'done' THEN 3
            ELSE 4
          END,
          t.created_at ASC,
          t.id ASC
    `).all(plannedDate) as StudyTask[];
}

function createStudyTask(data: NewStudyTask): StudyTask {
    const title = normalizeStudyTaskTitle(data.title);
    const description = typeof data.description === 'string' ? data.description : '';
    const type = normalizeStudyTaskType(data.type);
    const subjectId = normalizeStudyTaskNullableId(data.subject_id);
    const relatedMistakeId = normalizeStudyTaskNullableId(data.related_mistake_id);
    const relatedEntryId = normalizeStudyTaskNullableId(data.related_entry_id);
    const plannedDate = normalizeStudyTaskDate(data.planned_date);
    const estimateMinutes = normalizeStudyTaskEstimate(data.estimate_minutes);
    const status = normalizeStudyTaskStatus(data.status);
    const source = normalizeStudyTaskSource(data.source);

    const result = db.prepare(`
        INSERT INTO study_tasks (
          title,
          description,
          type,
          subject_id,
          related_mistake_id,
          related_entry_id,
          planned_date,
          estimate_minutes,
          status,
          source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        title,
        description,
        type,
        subjectId,
        relatedMistakeId,
        relatedEntryId,
        plannedDate,
        estimateMinutes,
        status,
        source,
    );

    return requireStudyTask(Number(result.lastInsertRowid));
}

function updateStudyTask(id: number, patch: Partial<StudyTask>): StudyTask {
    const taskId = normalizeStudyTaskId(id);
    const fields: Array<{ column: string; value: string | number | null }> = [];

    if (patch.title !== undefined) fields.push({ column: 'title', value: normalizeStudyTaskTitle(patch.title) });
    if (patch.description !== undefined) fields.push({ column: 'description', value: String(patch.description ?? '') });
    if (patch.type !== undefined) fields.push({ column: 'type', value: normalizeStudyTaskType(patch.type) });
    if (patch.subject_id !== undefined) fields.push({ column: 'subject_id', value: normalizeStudyTaskNullableId(patch.subject_id) });
    if (patch.related_mistake_id !== undefined) fields.push({ column: 'related_mistake_id', value: normalizeStudyTaskNullableId(patch.related_mistake_id) });
    if (patch.related_entry_id !== undefined) fields.push({ column: 'related_entry_id', value: normalizeStudyTaskNullableId(patch.related_entry_id) });
    if (patch.planned_date !== undefined) fields.push({ column: 'planned_date', value: normalizeStudyTaskDate(patch.planned_date) });
    if (patch.estimate_minutes !== undefined) fields.push({ column: 'estimate_minutes', value: normalizeStudyTaskEstimate(patch.estimate_minutes) });
    if (patch.status !== undefined) fields.push({ column: 'status', value: normalizeStudyTaskStatus(patch.status) });
    if (patch.source !== undefined) fields.push({ column: 'source', value: normalizeStudyTaskSource(patch.source) });

    if (fields.length === 0) return requireStudyTask(taskId);

    const setClause = fields.map(field => `${field.column} = ?`).join(', ');
    const result = db.prepare(`
        UPDATE study_tasks SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(...fields.map(field => field.value), taskId);
    if (result.changes === 0) throw new Error('Task not found');
    return requireStudyTask(taskId);
}

function deleteStudyTask(id: number): boolean {
    const taskId = normalizeStudyTaskId(id);
    const result = db.prepare('DELETE FROM study_tasks WHERE id = ?').run(taskId);
    return result.changes > 0;
}

function completeStudyTask(id: number): StudyTask {
    return updateStudyTask(id, { status: 'done' });
}

function skipStudyTask(id: number): StudyTask {
    return updateStudyTask(id, { status: 'skipped' });
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
            streakDays: streak
        };
    });

    return getTodayData();
}

// ==================== Mistakes ====================
function getAllMistakes(filters: MistakeFilters = {}): { data: Mistake[], total: number, masteredTotal: number } {
    const baseQuery = ' FROM mistakes m LEFT JOIN subjects s ON m.subject_id = s.id';
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.subject_id) {
        conditions.push('m.subject_id = ?');
        params.push(filters.subject_id);
    }
    if (filters.due) {
        conditions.push('m.mastered = 0');
        conditions.push('(m.next_review_date IS NULL OR m.next_review_date <= ?)');
        params.push(filters.dueDate || getLocalDateKey());
    } else if (filters.mastered !== undefined) {
        conditions.push('m.mastered = ?');
        params.push(filters.mastered ? 1 : 0);
    }
    if (filters.search) {
        conditions.push('(m.question LIKE ? OR m.answer LIKE ? OR m.notes LIKE ?)');
        const term = `%${filters.search}%`;
        params.push(term, term, term);
    }

    let whereClause = '';
    if (conditions.length > 0) {
        whereClause = ' WHERE ' + conditions.join(' AND ');
    }

    const countRow = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN m.mastered = 1 THEN 1 ELSE 0 END) as mastered_total' + baseQuery + whereClause).get(...params) as { total: number, mastered_total: number | null };
    const total = countRow.total || 0;
    const masteredTotal = countRow.mastered_total || 0;

    let query = 'SELECT m.*, s.name as subject_name, s.color as subject_color' + baseQuery + whereClause;
    query += ' ORDER BY m.created_at DESC';
    
    if (filters.limit) {
        query += ' LIMIT ? OFFSET ?';
        params.push(filters.limit, filters.offset || 0);
    }

    const data = db.prepare(query).all(...params) as Mistake[];
    return { data, total, masteredTotal };
}

function createMistake({ subject_id, question, answer, notes, image_path }: Partial<Mistake>) {
    const stmt = db.prepare(
        'INSERT INTO mistakes (subject_id, question, answer, notes, image_path) VALUES (?, ?, ?, ?, ?)'
    );
    const result = stmt.run(subject_id || null, question || '', answer || '', notes || '', image_path || null);
    return { id: result.lastInsertRowid };
}

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

function getRemovedMistakeImageRefs(oldValue: unknown, newValue: unknown): string[] {
    const newKeys = new Set(
        parseMistakeImagePaths(newValue)
            .map(ref => getMistakeImageReferenceKey(ref))
            .filter((key: string | null): key is string => !!key),
    );
    const removed: string[] = [];
    const seen = new Set<string>();

    for (const ref of parseMistakeImagePaths(oldValue)) {
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
    const rows = db.prepare('SELECT id, image_path FROM mistakes WHERE id <> ? AND image_path IS NOT NULL').all(excludingId) as { id: number; image_path: string | null }[];
    return rows.some(row => parseMistakeImagePaths(row.image_path).some(candidate => (
        getMistakeImageReferenceKey(candidate) === targetKey
    )));
}

async function cleanupRemovedMistakeImages(mistakeId: number, oldValue: unknown, newValue: unknown): Promise<void> {
    for (const ref of getRemovedMistakeImageRefs(oldValue, newValue)) {
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

async function updateMistake(id: number, { subject_id, question, answer, notes, mastered, image_path }: Partial<Mistake>) {
    const previous = image_path !== undefined
        ? db.prepare('SELECT image_path FROM mistakes WHERE id = ?').get(id) as { image_path: string | null } | undefined
        : undefined;
    const previousImagePath = previous?.image_path ?? null;
    const updates = [];
    const params = [];
    if (subject_id !== undefined) { updates.push('subject_id = ?'); params.push(subject_id); }
    if (question !== undefined) { updates.push('question = ?'); params.push(question); }
    if (answer !== undefined) { updates.push('answer = ?'); params.push(answer); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (mastered !== undefined) { updates.push('mastered = ?'); params.push(mastered ? 1 : 0); }
    if (image_path !== undefined) { updates.push('image_path = ?'); params.push(image_path); }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE mistakes SET ${updates.join(', ')} WHERE id=?`).run(...params);
    if (image_path !== undefined) {
        await cleanupRemovedMistakeImages(id, previousImagePath, image_path ?? null);
    }
    return { success: true };
}

async function deleteMistake(id: number) {
    try {
        const mistake = db.prepare('SELECT image_path FROM mistakes WHERE id = ?').get(id) as { image_path: string | null } | undefined;
        if (mistake && mistake.image_path) {
            await cleanupRemovedMistakeImages(id, mistake.image_path, null);
        }
    } catch(e) { logger.error('Failed to cleanup mistake image', e); }

    db.prepare('DELETE FROM mistakes WHERE id=?').run(id);
    return { success: true };
}

function toggleMistakeMastered(id: number) {
    db.prepare('UPDATE mistakes SET mastered = 1 - mastered, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
    const row = db.prepare('SELECT mastered FROM mistakes WHERE id=?').get(id) as { mastered: number };
    return { mastered: row.mastered };
}

/**
 * Update a mistake's spaced-repetition fields after a review.
 * @param {number} id - Mistake ID
 * @param {{ease_factor: number, review_interval: number, next_review_date: string, review_count: number}} data
 */
function reviewMistake(id: number, { ease_factor, review_interval, next_review_date, review_count }: Partial<Mistake>) {
    db.prepare(`
        UPDATE mistakes
        SET ease_factor = ?, review_interval = ?, next_review_date = ?, review_count = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(ease_factor, review_interval, next_review_date, review_count, id);
    return { success: true };
}

/**
 * Count mistakes due for review on or before the given date.
 */
function getDueForReviewCount(date: string) {
    const row = db.prepare(`
        SELECT COUNT(*) as count FROM mistakes
        WHERE mastered = 0 AND (next_review_date IS NULL OR next_review_date <= ?)
    `).get(date) as { count: number };
    return row.count;
}

/**
 * Get a random unmastered mistake, optionally filtered by subject.
 */
function getRandomDueMistake(date: string, subjectId?: number) {
    // Phase P3: Replaced ORDER BY RANDOM() LIMIT 1 with a count + offset
    // approach. SQLite's RANDOM() scans and sorts the entire result set;
    // the offset pattern only scans up to the selected row.
    let countQuery = `
        SELECT COUNT(*) as cnt FROM mistakes m
        WHERE m.mastered = 0 AND (m.next_review_date IS NULL OR m.next_review_date <= ?)
    `;
    const params: (string | number)[] = [date];
    if (subjectId) {
        countQuery += ' AND m.subject_id = ?';
        params.push(subjectId);
    }
    const countRow = db.prepare(countQuery).get(...params) as { cnt: number };
    if (countRow.cnt === 0) return null;

    const offset = Math.floor(Math.random() * countRow.cnt);

    let query = `
        SELECT m.*, s.name as subject_name, s.color as subject_color
        FROM mistakes m LEFT JOIN subjects s ON m.subject_id = s.id
        WHERE m.mastered = 0 AND (m.next_review_date IS NULL OR m.next_review_date <= ?)
    `;
    const selectParams: (string | number)[] = [date];
    if (subjectId) {
        query += ' AND m.subject_id = ?';
        selectParams.push(subjectId);
    }
    query += ' LIMIT 1 OFFSET ?';
    selectParams.push(offset);
    return db.prepare(query).get(...selectParams) || null;
}

// ==================== Templates ====================
function getAllTemplates(): DiaryTemplate[] {
    return db.prepare('SELECT * FROM diary_templates ORDER BY sort_order ASC, id ASC').all() as DiaryTemplate[];
}

function createTemplate({ name, content, sort_order }: Partial<DiaryTemplate>) {
    const stmt = db.prepare(
        'INSERT INTO diary_templates (name, content, is_default, sort_order) VALUES (?, ?, 0, ?)'
    );
    const result = stmt.run(name, content || '', sort_order ?? 99);
    return { id: result.lastInsertRowid, name, content: content || '', is_default: 0, sort_order: sort_order ?? 99 };
}

function updateTemplate(id: number, { name, content, sort_order }: Partial<DiaryTemplate>) {
    const updates: string[] = [];
    const params: (string | number)[] = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (content !== undefined) { updates.push('content = ?'); params.push(content); }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE diary_templates SET ${updates.join(', ')} WHERE id=?`).run(...params);
    return db.prepare('SELECT * FROM diary_templates WHERE id=?').get(id) as DiaryTemplate | undefined;
}

function deleteTemplate(id: number) {
    // Prevent deleting default templates
    const tpl = db.prepare('SELECT is_default FROM diary_templates WHERE id=?').get(id) as { is_default: number } | undefined;
    if (tpl && tpl.is_default) {
        return { success: false, message: '默认模板不可删除' };
    }
    db.prepare('DELETE FROM diary_templates WHERE id=?').run(id);
    return { success: true };
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
    getStudyTasksByDate, createStudyTask, updateStudyTask, deleteStudyTask, completeStudyTask, skipStudyTask,
    getPomodoroRange, getEntryDatesRange, getStudyStreak, getTodayDashboard,
    getAllMistakes, createMistake, updateMistake, deleteMistake, toggleMistakeMastered,
    reviewMistake, getDueForReviewCount, getRandomDueMistake,
    getAllTemplates, createTemplate, updateTemplate, deleteTemplate,
    setCustomDbPath, getDb,
    getAiApiKey, setAiApiKey,
    exportBackupData, restoreBackupData,
};
