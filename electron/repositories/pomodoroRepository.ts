import type Database from 'better-sqlite3';
import { getLocalDateKey, isDateKey, toLocalDateTimeString } from '../../src/utils/dateKey';
import type { PomodoroRangeEntry, PomodoroSession, PomodoroStat } from '../../src/types/index';
import type { FocusPeriodResult, Period } from '../../src/types/api';

export function createPomodoroRepository(db: Database.Database) {
    function normalizeOptionalDateTime(value: unknown): string | null {
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    function normalizeTaskIdForSession(taskId: PomodoroSession['task_id']): number | null {
        if (taskId === undefined || taskId === null) return null;
        if (!Number.isInteger(taskId) || taskId <= 0) {
            throw new Error('pomodoro task_id must be a positive integer or null');
        }

        const task = db.prepare('SELECT id FROM study_tasks WHERE id = ?').get(taskId) as { id: number } | undefined;
        if (!task) {
            throw new Error('Task not found');
        }
        return taskId;
    }

    return {
        getFirstSliceFocusComparison(subjectId: number, periodA: Period, periodB: Period) {
            function readPeriod(period: Period): FocusPeriodResult {
                if (!db.open) {
                    return { status: 'unavailable', recordedMinutes: null, observedDateCount: null };
                }
                try {
                    const row = db.prepare(`
                        SELECT COALESCE(SUM(duration), 0) AS recordedMinutes,
                               COUNT(DISTINCT date_key) AS observedDateCount
                        FROM pomodoro_sessions
                        WHERE subject_id = ? AND date_key BETWEEN ? AND ?
                    `).get(subjectId, period.startDate, period.endDate) as {
                        recordedMinutes: number; observedDateCount: number;
                    };
                    const days = (Date.parse(period.endDate) - Date.parse(period.startDate)) / 86400000 + 1;
                    if (typeof row?.recordedMinutes !== 'number' || !Number.isFinite(row.recordedMinutes)
                        || row.recordedMinutes < 0 || !Number.isSafeInteger(row.observedDateCount)
                        || row.observedDateCount < 0 || row.observedDateCount > days
                        || (row.observedDateCount === 0 && row.recordedMinutes !== 0)) {
                        throw new Error('Invalid focus aggregate');
                    }
                    return { status: row.observedDateCount === 0 ? 'empty' : 'ok', ...row };
                } catch {
                    return { status: 'failed', recordedMinutes: null, observedDateCount: null };
                }
            }
            // Both periods are fixed before reading. Failure of A never causes a retry or prevents B.
            return { periodA: readPeriod(periodA), periodB: readPeriod(periodB) };
        },

        addPomodoroSession({ subject_id, task_id, duration, date_key, started_at, completed_at }: PomodoroSession) {
            const completedAt = normalizeOptionalDateTime(completed_at) || toLocalDateTimeString();
            const startedAt = normalizeOptionalDateTime(started_at);
            const dateKey = isDateKey(date_key) ? date_key : getLocalDateKey(startedAt ? new Date(startedAt) : new Date());
            const taskId = normalizeTaskIdForSession(task_id);

            const stmt = db.prepare(
                'INSERT INTO pomodoro_sessions (subject_id, task_id, duration, date_key, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)'
            );
            const result = stmt.run(subject_id || null, taskId, duration, dateKey, startedAt, completedAt);
            return { id: result.lastInsertRowid, date_key: dateKey, started_at: startedAt, completed_at: completedAt };
        },

        getPomodoroStats(date: string): PomodoroStat[] {
            return db.prepare(`
    SELECT s.name as subject_name, s.color, SUM(p.duration) as total_minutes, COUNT(p.id) as session_count
    FROM pomodoro_sessions p
    LEFT JOIN subjects s ON p.subject_id = s.id
    WHERE p.date_key = ?
    GROUP BY p.subject_id
  `).all(date) as PomodoroStat[];
        },

        getPomodoroStatsRange(startDate: string, endDate: string): PomodoroStat[] {
            return db.prepare(`
    SELECT s.name as subject_name, s.color, SUM(p.duration) as total_minutes, COUNT(p.id) as session_count
    FROM pomodoro_sessions p
    LEFT JOIN subjects s ON p.subject_id = s.id
    WHERE p.date_key BETWEEN ? AND ?
    GROUP BY p.subject_id
    ORDER BY total_minutes DESC
  `).all(startDate, endDate) as PomodoroStat[];
        },

        getDailyStudyMinutes(date: string) {
            const row = db.prepare(
                'SELECT COALESCE(SUM(duration), 0) as total FROM pomodoro_sessions WHERE date_key = ?'
            ).get(date) as { total: number };
            return row.total;
        },

        getPomodoroRange(startDate: string, endDate: string): PomodoroRangeEntry[] {
            return db.prepare(`
        SELECT date_key as date,
               SUM(duration) as total_minutes,
               COUNT(id) as session_count
        FROM pomodoro_sessions
        WHERE date_key BETWEEN ? AND ?
        GROUP BY date_key
        ORDER BY date ASC
    `).all(startDate, endDate) as PomodoroRangeEntry[];
        },
    };
}
