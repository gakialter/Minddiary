import type Database from 'better-sqlite3';
import { getLocalDateKey } from '../../src/utils/dateKey';
import type { Mistake, MistakeFilters } from '../../src/types/index';

type StoredMistake = Omit<Mistake, 'mastered'> & { mastered: boolean | number };

function normalizeStoredMistake(row: StoredMistake): Mistake {
    return { ...row, mastered: Boolean(row.mastered) };
}

export function createMistakesRepository(db: Database.Database) {
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
        query += ' ORDER BY m.created_at DESC, m.id DESC';

        if (filters.limit) {
            query += ' LIMIT ? OFFSET ?';
            params.push(filters.limit, filters.offset || 0);
        }

        const data = (db.prepare(query).all(...params) as StoredMistake[]).map(normalizeStoredMistake);
        return { data, total, masteredTotal };
    }

    function createMistake({
        subject_id,
        question,
        answer,
        notes,
        mastered,
        ease_factor,
        review_interval,
        next_review_date,
        review_count,
        image_path,
        answer_image_path,
    }: Partial<Mistake>) {
        const stmt = db.prepare(
            `INSERT INTO mistakes (
                subject_id, question, answer, notes, mastered,
                ease_factor, review_interval, next_review_date, review_count,
                image_path, answer_image_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const result = stmt.run(
            subject_id || null,
            question || '',
            answer || '',
            notes || '',
            mastered ? 1 : 0,
            ease_factor ?? 2.5,
            review_interval ?? 1,
            next_review_date ?? null,
            review_count ?? 0,
            image_path || null,
            answer_image_path || null,
        );
        return { id: result.lastInsertRowid };
    }

    const createMistakes = db.transaction((mistakes: Partial<Mistake>[]) => (
        mistakes.map(mistake => createMistake(mistake))
    ));

    function getMistakeImageFields(id: number): { image_path: string | null; answer_image_path: string | null } {
        const row = db.prepare('SELECT image_path, answer_image_path FROM mistakes WHERE id = ?').get(id) as { image_path: string | null; answer_image_path: string | null } | undefined;
        return {
            image_path: row?.image_path ?? null,
            answer_image_path: row?.answer_image_path ?? null,
        };
    }

    function getOtherMistakeImageFields(excludingId: number): { id: number; image_path: string | null; answer_image_path: string | null }[] {
        return db.prepare(`
            SELECT id, image_path, answer_image_path
            FROM mistakes
            WHERE id <> ? AND (image_path IS NOT NULL OR answer_image_path IS NOT NULL)
        `).all(excludingId) as { id: number; image_path: string | null; answer_image_path: string | null }[];
    }

    function getAllMistakeImageFields(): { id: number; image_path: string | null; answer_image_path: string | null }[] {
        return db.prepare(`
            SELECT id, image_path, answer_image_path
            FROM mistakes
            WHERE image_path IS NOT NULL OR answer_image_path IS NOT NULL
        `).all() as { id: number; image_path: string | null; answer_image_path: string | null }[];
    }

    function updateMistake(id: number, {
        subject_id,
        question,
        answer,
        notes,
        mastered,
        ease_factor,
        review_interval,
        next_review_date,
        review_count,
        image_path,
        answer_image_path,
    }: Partial<Mistake>) {
        const updates = [];
        const params = [];
        if (subject_id !== undefined) { updates.push('subject_id = ?'); params.push(subject_id); }
        if (question !== undefined) { updates.push('question = ?'); params.push(question); }
        if (answer !== undefined) { updates.push('answer = ?'); params.push(answer); }
        if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
        if (mastered !== undefined) { updates.push('mastered = ?'); params.push(mastered ? 1 : 0); }
        if (ease_factor !== undefined) { updates.push('ease_factor = ?'); params.push(ease_factor); }
        if (review_interval !== undefined) { updates.push('review_interval = ?'); params.push(review_interval); }
        if (next_review_date !== undefined) { updates.push('next_review_date = ?'); params.push(next_review_date); }
        if (review_count !== undefined) { updates.push('review_count = ?'); params.push(review_count); }
        if (image_path !== undefined) { updates.push('image_path = ?'); params.push(image_path); }
        if (answer_image_path !== undefined) { updates.push('answer_image_path = ?'); params.push(answer_image_path); }
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);
        db.prepare(`UPDATE mistakes SET ${updates.join(', ')} WHERE id=?`).run(...params);
        return { success: true };
    }

    function deleteMistake(id: number) {
        db.prepare('DELETE FROM mistakes WHERE id=?').run(id);
        return { success: true };
    }

    function toggleMistakeMastered(id: number) {
        db.prepare('UPDATE mistakes SET mastered = 1 - mastered, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
        const row = db.prepare('SELECT mastered FROM mistakes WHERE id=?').get(id) as { mastered: number };
        return { mastered: row.mastered };
    }

    function reviewMistake(id: number, { ease_factor, review_interval, next_review_date, review_count }: Partial<Mistake>) {
        const result = db.prepare(`
        UPDATE mistakes
        SET ease_factor = ?, review_interval = ?, next_review_date = ?, review_count = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(ease_factor, review_interval, next_review_date, review_count, id);
        if (result.changes === 0) {
            throw new Error('Mistake not found');
        }
        const mistake = db.prepare(`
        SELECT m.*, s.name as subject_name, s.color as subject_color
        FROM mistakes m LEFT JOIN subjects s ON m.subject_id = s.id
        WHERE m.id = ?
    `).get(id) as StoredMistake | undefined;
        if (!mistake) {
            throw new Error('Mistake not found');
        }
        return { success: true, mistake: normalizeStoredMistake(mistake) };
    }

    function getDueForReviewCount(date: string) {
        const row = db.prepare(`
        SELECT COUNT(*) as count FROM mistakes
        WHERE mastered = 0 AND (next_review_date IS NULL OR next_review_date <= ?)
    `).get(date) as { count: number };
        return row.count;
    }

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
        const mistake = db.prepare(query).get(...selectParams) as StoredMistake | undefined;
        return mistake ? normalizeStoredMistake(mistake) : null;
    }

    return {
        getAllMistakes,
        createMistake,
        createMistakes,
        getMistakeImageFields,
        getOtherMistakeImageFields,
        getAllMistakeImageFields,
        updateMistake,
        deleteMistake,
        toggleMistakeMastered,
        reviewMistake,
        getDueForReviewCount,
        getRandomDueMistake,
    };
}

export type MistakesRepository = ReturnType<typeof createMistakesRepository>;
