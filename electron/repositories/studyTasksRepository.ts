import type Database from 'better-sqlite3';
import { isDateKey } from '../../src/utils/dateKey';
import type {
    NewStudyTask,
    StudyTask,
    StudyTaskSource,
    StudyTaskStatus,
    StudyTaskType,
} from '../../src/types/index';

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

export function createStudyTasksRepository(db: Database.Database) {
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

    function startStudyTaskFocus(id: number, date: string): StudyTask {
        const taskId = normalizeStudyTaskId(id);
        const plannedDate = normalizeStudyTaskDate(date);
        const task = requireStudyTask(taskId);
        if (task.planned_date !== plannedDate) {
            throw new Error('Task is not planned for this date');
        }
        if (task.status === 'done' || task.status === 'skipped') {
            throw new Error('Cannot start focus for a completed or skipped task');
        }
        if (task.status === 'doing') return task;
        return updateStudyTask(taskId, { status: 'doing' });
    }

    return {
        getStudyTasksByDate,
        createStudyTask,
        updateStudyTask,
        deleteStudyTask,
        completeStudyTask,
        skipStudyTask,
        startStudyTaskFocus,
    };
}

export type StudyTasksRepository = ReturnType<typeof createStudyTasksRepository>;
