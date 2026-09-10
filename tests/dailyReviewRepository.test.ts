// @vitest-environment node
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../electron/databaseMigrations'
import { createDailyReviewRepository } from '../electron/repositories/dailyReviewRepository'
import { createSubjectsRepository } from '../electron/repositories/subjectsRepository'
import { DATABASE_BACKUP_TABLES, normalizeBackupDatabaseData } from '../electron/databaseBackupData'
import type { DailyReviewSnapshot } from '../src/types/dailyReview'

describe('daily review SQLite domain', () => {
    let db: BetterSqlite3.Database
    let repository: ReturnType<typeof createDailyReviewRepository>
    const date = '2026-09-10'
    const tomorrow = '2026-09-11'
    const read = (day = date, subjectId = 1) => repository.execute({ kind: 'get', subjectId, date: day })
    const configure = (quota = 2, day = date, subjectId = 1) => repository.execute({ kind: 'configure', subjectId, quota, date: day })
    const start = (previousRoundId: string | null = null, day = date) => repository.execute({ kind: 'start', subjectId: 1, date: day, previousRoundId })
    const complete = (snapshot: DailyReviewSnapshot, day = snapshot.date) => repository.execute({ kind: 'complete', subjectId: snapshot.subjectId, date: day, roundId: snapshot.roundId, mistakeId: snapshot.currentItem!.id })
    const storedQueue = () => JSON.parse((db.prepare('SELECT queue FROM subject_daily_review_state WHERE subject_id=1').get() as { queue: string }).queue) as number[]
    const sm2 = () => db.prepare('SELECT id, mastered, ease_factor, review_interval, next_review_date, review_count FROM mistakes ORDER BY id').all()

    beforeEach(() => {
        db = new BetterSqlite3(':memory:')
        db.pragma('foreign_keys = ON')
        runDatabaseMigrations(db)
        db.exec(`INSERT INTO subjects (id, name) VALUES (1, '数学'), (2, '英语');
            INSERT INTO mistakes (id, subject_id, question, mastered, ease_factor, review_interval, next_review_date, review_count)
            VALUES (1,1,'一',1,2.1,60,'2027-01-01',9),(2,1,'二',0,1.3,6,'2026-09-01',2),
            (3,1,'三',0,2.5,1,NULL,0),(4,1,'四',1,2.7,90,'2027-02-02',20),(5,2,'英语',0,2.5,1,NULL,0);`)
        repository = createDailyReviewRepository(db)
    })
    afterEach(() => { db.close(); vi.restoreAllMocks() })

    it('configures independently per subject and freezes a shuffled, unique pool including mastered items', () => {
        expect(read().status).toBe('unconfigured')
        expect(configure()).toMatchObject({ quota: 2, subjectTotal: 4, estimatedDays: 2, status: 'ready' })
        configure(7, date, 2)
        const random = vi.spyOn(Math, 'random').mockReturnValue(0)
        start()
        expect(storedQueue()).toEqual([2, 3, 4, 1])
        expect(new Set(storedQueue()).size).toBe(4)
        expect(read(date, 2)).toMatchObject({ quota: 7, roundTotal: 0, status: 'ready' })
        read(); read(tomorrow)
        expect(random).toHaveBeenCalledTimes(3)
    })

    it('stops at quota, rejects duplicate completion, reloads same-day counts and continues across days without any SM-2 writes', () => {
        const before = sm2()
        configure()
        const first = start()
        const second = complete(first)
        expect(complete(first)).toEqual(second)
        const done = complete(second)
        expect(done).toMatchObject({ dailyCompleted: 2, roundCompleted: 2, status: 'daily_done', currentItem: null })
        expect(complete(second)).toEqual(done)
        repository = createDailyReviewRepository(db)
        expect(read()).toEqual(done)
        const nextDay = read(tomorrow)
        expect(nextDay).toMatchObject({ dailyCompleted: 0, roundCompleted: 2, roundId: first.roundId, status: 'active' })
        expect(complete(nextDay, date)).toEqual(nextDay)
        const last = complete(nextDay)
        expect(complete(last)).toMatchObject({ status: 'round_done', roundCompleted: 4, roundTotal: 4, currentItem: null })
        expect(sm2()).toEqual(before)
    })

    it('rolls over on completion without silently counting a previously displayed answer', () => {
        configure()
        const first = start()
        const rollover = complete(first, tomorrow)
        expect(rollover).toMatchObject({ date: tomorrow, dailyCompleted: 0, roundCompleted: 0 })
        expect(complete(rollover).dailyCompleted).toBe(1)
    })

    it('changes quotas without changing the queue, cursor or daily count', () => {
        configure()
        const second = complete(start())
        const queue = storedQueue()
        expect(configure(1)).toMatchObject({ status: 'daily_done', dailyCompleted: 1, roundCompleted: 1, roundId: second.roundId })
        expect(configure(10)).toMatchObject({ status: 'active', dailyCompleted: 1, roundCompleted: 1 })
        expect(storedQueue()).toEqual(queue)
    })

    it('defers new mistakes, skips deleted/current/future and moved items without counting invalid items', () => {
        configure(20)
        const first = start()
        const queue = storedQueue()
        db.exec("INSERT INTO mistakes (id, subject_id, question) VALUES (6,1,'新增')")
        db.prepare('DELETE FROM mistakes WHERE id=?').run(queue[0])
        db.prepare('DELETE FROM mistakes WHERE id=?').run(queue[2])
        db.prepare('UPDATE mistakes SET subject_id=2 WHERE id=?').run(queue[3])
        const next = complete(first)
        expect(next.currentItem?.id).toBe(queue[1])
        expect(next.dailyCompleted).toBe(0)
        expect(storedQueue()).toEqual(queue)
        const done = complete(next)
        expect(done).toMatchObject({ status: 'round_done', roundCompleted: 4, dailyCompleted: 1, currentItem: null })
        expect(read()).toEqual(done)
        expect(start(null)).toEqual(done)
        const nextRound = start(done.roundId)
        expect(nextRound.roundId).not.toBe(done.roundId)
        expect(storedQueue().sort()).toEqual([queue[1], 6].sort())
        expect(start(done.roundId)).toEqual(nextRound)
        expect(complete(first)).toEqual(nextRound)
    })

    it('requires explicit next round and preserves daily quota across rounds', () => {
        configure(5)
        let snapshot = start()
        for (let index = 0; index < 4; index++) snapshot = complete(snapshot)
        expect(snapshot).toMatchObject({ status: 'round_done', dailyCompleted: 4, roundCompleted: 4 })
        const next = start(snapshot.roundId)
        expect(next).toMatchObject({ dailyCompleted: 4, roundCompleted: 0 })
        expect(complete(next)).toMatchObject({ status: 'daily_done', dailyCompleted: 5, roundCompleted: 1 })
    })

    it('upgrades a v7 database without altering existing mistakes and clears state through the subject lifecycle', () => {
        const before = sm2()
        db.exec('DROP TABLE subject_daily_review_state; PRAGMA user_version=7')
        expect(runDatabaseMigrations(db)).toBe(8)
        expect(sm2()).toEqual(before)
        configure(); start()
        createSubjectsRepository(db).deleteSubject(1)
        expect(db.prepare('SELECT * FROM subject_daily_review_state').all()).toEqual([])
        expect(() => read()).toThrow('科目不存在')
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    })

    it('validates IPC input before writes and safely handles an empty pool', () => {
        for (const command of [null, { kind: 'get', subjectId: -1, date }, { kind: 'get', subjectId: 1, date: '2026-02-30' },
            { kind: 'configure', subjectId: 1, date, quota: 0 }, { kind: 'configure', subjectId: 1, date, quota: 1.5 },
            { kind: 'complete', subjectId: 1, date, roundId: 'bad', mistakeId: 1 }, { kind: 'unknown', subjectId: 1, date }]) {
            expect(() => repository.execute(command)).toThrow()
        }
        expect(read().status).toBe('unconfigured')
        db.exec('DELETE FROM mistakes')
        configure()
        expect(start()).toMatchObject({ roundId: null, subjectTotal: 0, status: 'ready' })
    })

    it('round-trips frozen state through the backup inventory, validates queues and accepts old backups', () => {
        configure()
        const snapshot = complete(start())
        const raw = Object.fromEntries(DATABASE_BACKUP_TABLES.map(table => [table.key, db.prepare(`SELECT * FROM ${table.table}`).all()]))
        const normalized = normalizeBackupDatabaseData(raw, 8)
        db.exec('DELETE FROM subject_daily_review_state')
        const definition = DATABASE_BACKUP_TABLES.find(table => table.key === 'subject_daily_review_state')!
        for (const row of normalized.subject_daily_review_state) {
            db.prepare(`INSERT INTO ${definition.table} (${definition.columns.join(',')}) VALUES (${definition.columns.map(() => '?').join(',')})`).run(...definition.columns.map(column => row[column]))
        }
        repository = createDailyReviewRepository(db)
        expect(read()).toEqual(snapshot)
        expect(normalizeBackupDatabaseData({}, 6).subject_daily_review_state).toEqual([])
        expect(() => normalizeBackupDatabaseData({ planning_runs: [], planning_run_candidates: [] }, 8)).toThrow(/required/)
        for (const changes of [{ queue: '[1,1]' }, { queue: '["1"]' }, { queue: '{}' }, { cursor: 100 }, { subject_id: 99 }, { daily_quota: 0 }]) {
            expect(() => normalizeBackupDatabaseData({ ...raw, subject_daily_review_state: [{ ...normalized.subject_daily_review_state[0], ...changes }] }, 8)).toThrow()
        }
    })
})
