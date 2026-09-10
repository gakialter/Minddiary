import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Mistake } from '../../src/types';
import type { DailyReviewState } from '../../src/types/dailyReview';
import { transitionDailyReview, validateDailyReviewCommand } from '../../src/utils/dailyReview';

export function createDailyReviewRepository(db: Database.Database) {
    const execute = db.transaction((input: unknown) => {
        const command = validateDailyReviewCommand(input);
        if (!db.prepare('SELECT id FROM subjects WHERE id = ?').get(command.subjectId)) throw new Error('科目不存在');
        const row = db.prepare('SELECT * FROM subject_daily_review_state WHERE subject_id = ?').get(command.subjectId) as
            (Omit<DailyReviewState, 'queue'> & { queue: string }) | undefined;
        const state = row ? { ...row, queue: JSON.parse(row.queue) } as DailyReviewState : null;
        const items = db.prepare('SELECT * FROM mistakes WHERE subject_id = ? ORDER BY id').all(command.subjectId) as Mistake[];
        const result = transitionDailyReview(state, command, items.map(item => ({ ...item, mastered: Boolean(item.mastered) })), randomUUID);
        if (result.state) {
            db.prepare(`INSERT INTO subject_daily_review_state
                (subject_id, daily_quota, queue, cursor, daily_date, daily_completed, round_id, round_started_date)
                VALUES (@subject_id, @daily_quota, @queue, @cursor, @daily_date, @daily_completed, @round_id, @round_started_date)
                ON CONFLICT(subject_id) DO UPDATE SET daily_quota=excluded.daily_quota, queue=excluded.queue,
                cursor=excluded.cursor, daily_date=excluded.daily_date, daily_completed=excluded.daily_completed,
                round_id=excluded.round_id, round_started_date=excluded.round_started_date, updated_at=CURRENT_TIMESTAMP
            `).run({ ...result.state, queue: JSON.stringify(result.state.queue) });
        }
        return result.snapshot;
    });
    return { execute: (input: unknown) => execute.immediate(input) };
}
