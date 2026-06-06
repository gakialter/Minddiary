import type Database from 'better-sqlite3';
import { getLocalDateKey, isDateKey, toLocalDateTimeString } from '../../src/utils/dateKey';
import type { PomodoroRangeEntry, PomodoroSession, PomodoroStat } from '../../src/types/index';

export function createPomodoroRepository(db: Database.Database) {
    function normalizeOptionalDateTime(value: unknown): string | null {
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    return {
        addPomodoroSession({ subject_id, duration, date_key, started_at, completed_at }: PomodoroSession) {
            const completedAt = normalizeOptionalDateTime(completed_at) || toLocalDateTimeString();
            const startedAt = normalizeOptionalDateTime(started_at);
            const dateKey = isDateKey(date_key) ? date_key : getLocalDateKey(startedAt ? new Date(startedAt) : new Date());

            const stmt = db.prepare(
                'INSERT INTO pomodoro_sessions (subject_id, duration, date_key, started_at, completed_at) VALUES (?, ?, ?, ?, ?)'
            );
            const result = stmt.run(subject_id || null, duration, dateKey, startedAt, completedAt);
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

export type PomodoroRepository = ReturnType<typeof createPomodoroRepository>;
