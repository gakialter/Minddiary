// @vitest-environment node
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSubjectsRepository } from '../electron/repositories/subjectsRepository';
import { createSubjectChaptersRepository } from '../electron/repositories/subjectChaptersRepository';
import { createPomodoroRepository } from '../electron/repositories/pomodoroRepository';
import { createFirstSliceResolver } from '../electron/aiFirstSlice';
import type { EvidenceEnvelope } from '../src/types/api';

const periodA = { startDate: '2026-09-07', endDate: '2026-09-13' };
const periodB = { startDate: '2026-09-14', endDate: '2026-09-20' };
const identitySql = 'SELECT id, name FROM subjects WHERE id = ?';
const nameSql = 'SELECT id, name FROM subjects WHERE name COLLATE BINARY = ? ORDER BY id ASC';
const detailSql = 'SELECT title, sort_order, completed FROM subject_chapters WHERE subject_id = ? ORDER BY sort_order ASC, id ASC';
const aggregateSql = 'SELECT total_chapters, completed_chapters FROM subjects WHERE id = ?';
const focusSql = 'SELECT COALESCE(SUM(duration), 0) AS recordedMinutes, COUNT(DISTINCT date_key) AS observedDateCount FROM pomodoro_sessions WHERE subject_id = ? AND date_key BETWEEN ? AND ?';

function seed(db: Database.Database) {
    db.exec(`
        CREATE TABLE subjects (id INTEGER PRIMARY KEY, name TEXT, total_chapters INTEGER,
            completed_chapters INTEGER, color TEXT);
        CREATE TABLE subject_chapters (id INTEGER PRIMARY KEY, subject_id INTEGER, title TEXT,
            sort_order INTEGER, completed INTEGER, notes TEXT, updated_at TEXT);
        CREATE TABLE pomodoro_sessions (id INTEGER PRIMARY KEY, subject_id INTEGER, date_key TEXT,
            duration REAL, task_id INTEGER, started_at TEXT, completed_at TEXT);
        CREATE TABLE mistakes (id INTEGER PRIMARY KEY, subject_id INTEGER, notes TEXT);
        CREATE TABLE study_tasks (id INTEGER PRIMARY KEY, subject_id INTEGER, description TEXT);
        CREATE TABLE entries (id INTEGER PRIMARY KEY, content TEXT);
        INSERT INTO subjects VALUES (1, '线代', 3, 2, 'COLOR_CANARY'), (2, '英语', 99, 98, 'OTHER_COLOR'),
            (3, '数学', 0, 0, 'MATH_COLOR'), (4, 'Math', 0, 0, ''), (5, 'math', 0, 0, ''),
            (6, '同名', 0, 0, ''), (9, '同名', 0, 0, '');
        INSERT INTO subject_chapters VALUES
            (11, 1, '第1章', 0, 1, 'NOTES_CANARY', ''),
            (12, 1, '第2章', 1, 1, 'NOTES_CANARY', ''),
            (13, 1, '第3章', 2, 0, 'NOTES_CANARY', ''),
            (21, 2, 'OTHER_SUBJECT_CANARY', 0, 0, 'OTHER_NOTES', '');
        INSERT INTO mistakes VALUES (1, 1, 'MISTAKE_CANARY');
        INSERT INTO study_tasks VALUES (1, 1, 'TASK_CANARY');
        INSERT INTO entries VALUES (1, 'DIARY_CANARY');
    `);
    const insert = db.prepare('INSERT INTO pomodoro_sessions (subject_id, date_key, duration, task_id) VALUES (?, ?, ?, 1)');
    for (let day = 7; day <= 20; day++) {
        const date = `2026-09-${String(day).padStart(2, '0')}`;
        insert.run(3, date, day <= 13 ? 10 : 20);
        insert.run(2, date, 1000);
        insert.run(null, date, 2000);
    }
    insert.run(3, '2026-09-06', 4000);
    insert.run(3, '2026-09-21', 8000);
}

describe('I1 real SQLite projections and snapshot', () => {
    let db: Database.Database;
    let subjects: ReturnType<typeof createSubjectsRepository>;
    let chapters: ReturnType<typeof createSubjectChaptersRepository>;
    let focus: ReturnType<typeof createPomodoroRepository>;
    let queries: Array<{ sql: string; params: unknown[]; inTransaction: boolean }>;
    let transactions: string[];
    let failPeriod: string | undefined;
    let failDetail: boolean;
    let overrideAggregate: Record<string, unknown> | undefined;
    let afterIdentity: (() => void) | undefined;

    function observe(database: Database.Database) {
        const prepare = database.prepare.bind(database);
        vi.spyOn(database, 'prepare').mockImplementation((source: string) => {
            const statement = prepare(source);
            const sql = source.replace(/\s+/g, ' ').trim();
            return new Proxy(statement, {
                get(target, property) {
                    if (property === 'all' || property === 'get' || property === 'run') {
                        return (...params: unknown[]) => {
                            queries.push({ sql, params, inTransaction: database.inTransaction });
                            if (sql === focusSql && params[1] === failPeriod) throw new Error('Synthetic period SQL failure');
                            if (sql === detailSql && failDetail) database.exec('DROP TABLE subject_chapters');
                            const result = target[property](...params);
                            if (sql === identitySql) afterIdentity?.();
                            return sql === focusSql && overrideAggregate ? overrideAggregate : result;
                        };
                    }
                    return Reflect.get(target, property);
                },
            });
        });
    }

    beforeEach(() => {
        transactions = [];
        db = new BetterSqlite3(':memory:', { verbose: sql => transactions.push(String(sql)) });
        seed(db);
        queries = [];
        failPeriod = undefined;
        failDetail = false;
        overrideAggregate = undefined;
        afterIdentity = undefined;
        observe(db);
        subjects = createSubjectsRepository(db);
        chapters = createSubjectChaptersRepository(db);
        focus = createPomodoroRepository(db);
        transactions = [];
    });
    afterEach(() => {
        // Complete allowlist of actually EXECUTED statements; prepared CRUD statements are not reads.
        for (const { sql } of queries) {
            expect([identitySql, nameSql, detailSql, aggregateSql, focusSql]).toContain(sql);
            expect(sql).not.toMatch(/SELECT\s+\*|JOIN|LIKE|COUNT\(\*\)|MIN\(|MAX\(|GROUP BY|notes|task_id|entries|mistakes|study_tasks/i);
        }
        vi.restoreAllMocks();
        if (db.open) db.close();
    });

    function envelope(kind: 'subject_progress' | 'focus_comparison' = 'subject_progress', id = 1): EvidenceEnvelope {
        const input = kind === 'subject_progress' ? { kind, subject: { by: 'id', id } }
            : { kind, subject: { by: 'id', id }, periodA, periodB };
        const result = createFirstSliceResolver(db, () => new Date('2026-09-21T04:00:00Z'))(input);
        expect(result.kind).toBe('resolved');
        if (result.kind !== 'resolved') throw new Error('Expected evidence');
        return result.envelope;
    }

    it('resolves exact ids/names, binary case and ordered duplicates with only identity columns', () => {
        expect(subjects.resolveFirstSliceSubject({ by: 'id', id: 1 })).toEqual([{ id: 1, name: '线代' }]);
        expect(subjects.resolveFirstSliceSubject({ by: 'exact_name', name: '线代' })).toEqual([{ id: 1, name: '线代' }]);
        expect(subjects.resolveFirstSliceSubject({ by: 'exact_name', name: 'Math' })).toEqual([{ id: 4, name: 'Math' }]);
        expect(subjects.resolveFirstSliceSubject({ by: 'exact_name', name: 'MATH' })).toEqual([]);
        expect(subjects.resolveFirstSliceSubject({ by: 'exact_name', name: '同名' })).toEqual([{ id: 6, name: '同名' }, { id: 9, name: '同名' }]);
        expect(subjects.resolveFirstSliceSubject({ by: 'id', id: 999 })).toEqual([]);
        expect(subjects.resolveFirstSliceSubject({ by: 'exact_name', name: '线性代数' })).toEqual([]);
        expect(subjects.resolveFirstSliceSubject({ by: 'exact_name', name: 'Ｍath' })).toEqual([]);
        expect(queries.map(({ sql, params }) => [sql, params])).toEqual([
            [identitySql, [1]], [nameSql, ['线代']], [nameSql, ['Math']], [nameSql, ['MATH']],
            [nameSql, ['同名']], [identitySql, [999]], [nameSql, ['线性代数']], [nameSql, ['Ｍath']],
        ]);
    });

    it('F3 reads only ordered detail and computes 2/3, without aggregate or canaries', () => {
        expect(chapters.getFirstSliceProgressRows(1)).toEqual([
            { title: '第1章', sort_order: 0, completed: true },
            { title: '第2章', sort_order: 1, completed: true },
            { title: '第3章', sort_order: 2, completed: false },
        ]);
        queries = [];
        const result = envelope();
        expect(result).toMatchObject({ status: 'ok', coverage: 'detail', value: { completed: 2, total: 3, nextTitle: '第3章' } });
        expect(JSON.stringify(result)).not.toContain('CANARY');
        expect(queries).toEqual([
            { sql: identitySql, params: [1], inTransaction: true },
            { sql: detailSql, params: [1], inTransaction: true },
        ]);
        expect(transactions.filter(sql => /^(BEGIN|COMMIT)/.test(sql))).toEqual(['BEGIN DEFERRED', 'COMMIT']);
    });

    it('uses id only as stable secondary order and returns null when all completed', () => {
        db.exec("UPDATE subject_chapters SET sort_order = 0, completed = 0 WHERE subject_id = 1");
        expect(envelope()).toMatchObject({ value: { nextTitle: '第1章', completed: 0, total: 3 } });
        db.exec('UPDATE subject_chapters SET completed = 1 WHERE subject_id = 1');
        expect(envelope()).toMatchObject({ value: { nextTitle: null, completed: 3, total: 3 } });
    });

    it('uses aggregate only after successful zero details; 0/0 is empty', () => {
        db.exec('DELETE FROM subject_chapters WHERE subject_id = 1');
        expect(envelope()).toMatchObject({ status: 'ok', coverage: 'aggregate_only', value: { total: 3, completed: 2, nextTitle: null } });
        expect(queries.map(({ sql, params }) => [sql, params])).toEqual([
            [identitySql, [1]], [detailSql, [1]], [aggregateSql, [1]],
        ]);
        db.exec('UPDATE subjects SET total_chapters = 0, completed_chapters = 0 WHERE id = 1');
        expect(envelope()).toMatchObject({ status: 'empty', coverage: 'no_chapter_records', value: null });
    });

    it('does not fallback after an actual detail SQL failure', () => {
        // Invalidate the already prepared narrow statement immediately before execution.
        failDetail = true;
        expect(envelope()).toMatchObject({ status: 'failed', coverage: 'unknown', value: null });
        expect(queries.map(({ sql, params }) => [sql, params])).toEqual([[identitySql, [1]], [detailSql, [1]]]);
        expect(queries.some(query => query.sql === aggregateSql)).toBe(false);
    });

    it.each(['completed = 2', 'completed = NULL', 'sort_order = -1', 'sort_order = 1.5', "title = ''"])(
        'rejects corrupt detail (%s), without aggregate repair', assignment => {
            db.exec(`UPDATE subject_chapters SET ${assignment} WHERE id = 13`);
            expect(envelope()).toMatchObject({ status: 'failed', value: null, coverage: 'unknown' });
            expect(queries.some(query => query.sql === aggregateSql)).toBe(false);
        },
    );
    it.each(['total_chapters = -1', 'completed_chapters = 4', 'completed_chapters = 1.5',
        'completed_chapters = NULL', "total_chapters = 'bad'", 'total_chapters = 1e999'])(
        'rejects corrupt aggregate (%s)', assignment => {
            db.exec('DELETE FROM subject_chapters WHERE subject_id = 1');
            db.exec(`UPDATE subjects SET ${assignment} WHERE id = 1`);
            expect(envelope()).toMatchObject({ status: 'failed', value: null });
        },
    );

    it('F2 executes exactly the predetermined subject/date pair, inclusively, in one snapshot', () => {
        expect(envelope('focus_comparison', 3)).toMatchObject({ status: 'ok', value: {
            periodA: { status: 'ok', recordedMinutes: 70, observedDateCount: 7 },
            periodB: { status: 'ok', recordedMinutes: 140, observedDateCount: 7 },
        }, coverage: { realStudy: 'unknown', unassigned: 'excluded_not_measured' } });
        expect(queries).toEqual([
            { sql: identitySql, params: [3], inTransaction: true },
            { sql: focusSql, params: [3, periodA.startDate, periodA.endDate], inTransaction: true },
            { sql: focusSql, params: [3, periodB.startDate, periodB.endDate], inTransaction: true },
        ]);
        expect(transactions.filter(sql => /^(BEGIN|COMMIT)/.test(sql))).toEqual(['BEGIN DEFERRED', 'COMMIT']);
    });

    it('distinguishes no dates from zero-duration dates and counts distinct sparse dates', () => {
        db.exec(`DELETE FROM pomodoro_sessions WHERE subject_id = 3;
            INSERT INTO pomodoro_sessions (subject_id,date_key,duration) VALUES
                (3,'2026-09-07',0), (3,'2026-09-07',0), (3,'2026-09-13',0)`);
        expect(focus.getFirstSliceFocusComparison(3, periodA, periodB)).toEqual({
            periodA: { status: 'ok', recordedMinutes: 0, observedDateCount: 2 },
            periodB: { status: 'empty', recordedMinutes: 0, observedDateCount: 0 },
        });
    });

    it.each(['2026-09-07', '2026-09-14'])('preserves the other fixed period after SQL failure of %s', failedStart => {
        failPeriod = failedStart;
        const result = envelope('focus_comparison', 3);
        expect(result.status).toBe('partial');
        expect(result.value).toEqual(failedStart === periodA.startDate ? {
            periodA: { status: 'failed', recordedMinutes: null, observedDateCount: null },
            periodB: { status: 'ok', recordedMinutes: 140, observedDateCount: 7 },
        } : {
            periodA: { status: 'ok', recordedMinutes: 70, observedDateCount: 7 },
            periodB: { status: 'failed', recordedMinutes: null, observedDateCount: null },
        });
        expect(queries.filter(query => query.sql === focusSql).map(query => query.params)).toEqual([
            [3, periodA.startDate, periodA.endDate], [3, periodB.startDate, periodB.endDate],
        ]);
    });

    it.each([-10, Infinity])('does not coerce actual SQLite numeric aggregate %s to zero', duration => {
        db.exec('DELETE FROM pomodoro_sessions WHERE subject_id = 3');
        // Fixture writes bypass the SELECT observation seam.
        const raw = BetterSqlite3.prototype.prepare.call(db, 'INSERT INTO pomodoro_sessions(subject_id,date_key,duration) VALUES (3,?,?)') as Database.Statement;
        raw.run(periodA.startDate, duration);
        expect(focus.getFirstSliceFocusComparison(3, periodA, periodB).periodA)
            .toEqual({ status: 'failed', recordedMinutes: null, observedDateCount: null });
    });
    it.each([
        { recordedMinutes: NaN, observedDateCount: 1 }, { recordedMinutes: '70', observedDateCount: 7 },
        { recordedMinutes: null, observedDateCount: 0 }, { recordedMinutes: 0, observedDateCount: -1 },
        { recordedMinutes: 0, observedDateCount: 1.5 }, { recordedMinutes: 0, observedDateCount: 8 },
        { recordedMinutes: 1, observedDateCount: 0 },
    ])('rejects malformed driver aggregate %j after real SQLite execution', row => {
        overrideAggregate = row;
        expect(focus.getFirstSliceFocusComparison(3, periodA, periodB)).toEqual({
            periodA: { status: 'failed', recordedMinutes: null, observedDateCount: null },
            periodB: { status: 'failed', recordedMinutes: null, observedDateCount: null },
        });
        expect(queries).toHaveLength(2);
    });

    it('reports an unavailable connection without reading or manufacturing zero', () => {
        db.close();
        expect(focus.getFirstSliceFocusComparison(3, periodA, periodB)).toEqual({
            periodA: { status: 'unavailable', recordedMinutes: null, observedDateCount: null },
            periodB: { status: 'unavailable', recordedMinutes: null, observedDateCount: null },
        });
        expect(queries).toEqual([]);
    });

    it('keeps identity and both aggregates on one snapshot despite a second connection write', () => {
        const directory = mkdtempSync(join(tmpdir(), 'minddiary-i1-snapshot-'));
        const reader = new BetterSqlite3(join(directory, 'synthetic.db'));
        let writer: Database.Database | undefined;
        try {
            reader.pragma('journal_mode = WAL');
            seed(reader);
            writer = new BetterSqlite3(join(directory, 'synthetic.db'));
            observe(reader);
            afterIdentity = () => writer!.exec('UPDATE pomodoro_sessions SET duration = 999 WHERE subject_id = 3');
            const result = createFirstSliceResolver(reader)({ kind: 'focus_comparison', subject: { by: 'id', id: 3 }, periodA, periodB });
            expect(result).toMatchObject({ kind: 'resolved', envelope: { value: {
                periodA: { recordedMinutes: 70 }, periodB: { recordedMinutes: 140 },
            } } });
            expect(queries.every(query => query.inTransaction)).toBe(true);
            expect(writer.prepare('SELECT SUM(duration) AS total FROM pomodoro_sessions WHERE subject_id = 3').get())
                .toEqual({ total: 16 * 999 });
        } finally {
            writer?.close();
            reader.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
