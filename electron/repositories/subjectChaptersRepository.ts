import type Database from 'better-sqlite3';
import type {
    BulkSubjectChaptersInput,
    ConvertSubjectChaptersInput,
    CreateSubjectChapterInput,
    Subject,
    SubjectChapter,
    SubjectChapterDraft,
    SubjectChapterPatch,
} from '../../src/types/index';
import {
    normalizeChapterDrafts,
    normalizeChapterNotes,
    normalizeChapterTitle,
    normalizeCompleted,
} from '../../src/utils/subjectChapters';

type SubjectChapterRow = Omit<SubjectChapter, 'completed'> & {
    completed: number;
};

function rowToChapter(row: SubjectChapterRow): SubjectChapter {
    return {
        ...row,
        completed: row.completed === 1,
    };
}

function normalizeSubjectId(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new Error('subject_id must be a positive integer');
    }
    return value;
}

function normalizeChapterId(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new Error('chapter id must be a positive integer');
    }
    return value;
}

export function createSubjectChaptersRepository(db: Database.Database) {
    const getSubject = db.prepare('SELECT * FROM subjects WHERE id = ?');
    const getChapterById = db.prepare('SELECT * FROM subject_chapters WHERE id = ?');
    const getChapterCount = db.prepare('SELECT COUNT(*) as total FROM subject_chapters WHERE subject_id = ?');
    const getChapterStats = db.prepare(`
        SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END), 0) as completed
        FROM subject_chapters
        WHERE subject_id = ?
    `);
    const getMaxSortOrder = db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) as maxSortOrder
        FROM subject_chapters
        WHERE subject_id = ?
    `);
    const insertChapter = db.prepare(`
        INSERT INTO subject_chapters (subject_id, title, notes, completed, sort_order)
        VALUES (?, ?, ?, ?, ?)
    `);
    const updateSubjectSummary = db.prepare(`
        UPDATE subjects
        SET total_chapters = ?, completed_chapters = ?
        WHERE id = ?
    `);

    function assertSubjectExists(subjectId: number): Subject {
        const subject = getSubject.get(subjectId) as Subject | undefined;
        if (!subject) {
            throw new Error('Subject not found');
        }
        return subject;
    }

    function readChapter(id: number): SubjectChapter {
        const row = getChapterById.get(id) as SubjectChapterRow | undefined;
        if (!row) {
            throw new Error('Chapter not found');
        }
        return rowToChapter(row);
    }

    function getSubjectStats(subjectId: number): { total: number; completed: number } {
        const row = getChapterStats.get(subjectId) as { total: number; completed: number | null };
        return {
            total: Number(row.total) || 0,
            completed: Number(row.completed) || 0,
        };
    }

    function syncSubjectSummary(subjectId: number): void {
        const stats = getSubjectStats(subjectId);
        updateSubjectSummary.run(stats.total, stats.completed, subjectId);
    }

    function createChapterRows(subjectId: number, drafts: SubjectChapterDraft[], completedCount = 0): SubjectChapter[] {
        const normalized = normalizeChapterDrafts(drafts);
        const maxSortOrder = (getMaxSortOrder.get(subjectId) as { maxSortOrder: number }).maxSortOrder;
        const insertedIds: number[] = [];

        normalized.forEach((draft, index) => {
            const result = insertChapter.run(
                subjectId,
                draft.title,
                draft.notes ?? '',
                index < completedCount || draft.completed ? 1 : 0,
                maxSortOrder + index + 1,
            );
            insertedIds.push(Number(result.lastInsertRowid));
        });

        syncSubjectSummary(subjectId);
        return insertedIds.map(readChapter);
    }

    const createOneTransaction = db.transaction((input: CreateSubjectChapterInput) => {
        const subjectId = normalizeSubjectId(input.subject_id);
        assertSubjectExists(subjectId);
        const chapter = createChapterRows(subjectId, [input])[0];
        if (!chapter) {
            throw new Error('Chapter was not created');
        }
        return chapter;
    });

    const bulkCreateTransaction = db.transaction((input: BulkSubjectChaptersInput) => {
        const subjectId = normalizeSubjectId(input.subject_id);
        assertSubjectExists(subjectId);
        return createChapterRows(subjectId, input.chapters);
    });

    const convertTransaction = db.transaction((input: ConvertSubjectChaptersInput) => {
        const subjectId = normalizeSubjectId(input.subject_id);
        assertSubjectExists(subjectId);
        const existingCount = getChapterCount.get(subjectId) as { total: number };
        if (existingCount.total > 0) {
            throw new Error('Subject already has detailed chapters');
        }
        const normalized = normalizeChapterDrafts(input.chapters);
        if (!Number.isInteger(input.markCompletedCount) || input.markCompletedCount < 0) {
            throw new Error('markCompletedCount must be a non-negative integer');
        }
        if (input.markCompletedCount > normalized.length) {
            throw new Error('Cannot mark more chapters complete than were provided');
        }
        return createChapterRows(subjectId, normalized, input.markCompletedCount);
    });

    const patchTransaction = db.transaction((id: number, patch: SubjectChapterPatch) => {
        const chapterId = normalizeChapterId(id);
        const existing = readChapter(chapterId);
        const updates: string[] = [];
        const params: Array<string | number> = [];

        if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
            updates.push('title = ?');
            params.push(normalizeChapterTitle(patch.title));
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'notes')) {
            updates.push('notes = ?');
            params.push(normalizeChapterNotes(patch.notes));
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'completed')) {
            updates.push('completed = ?');
            params.push(normalizeCompleted(patch.completed) ? 1 : 0);
        }

        if (updates.length > 0) {
            updates.push('updated_at = CURRENT_TIMESTAMP');
            params.push(chapterId);
            db.prepare(`UPDATE subject_chapters SET ${updates.join(', ')} WHERE id = ?`).run(...params);
            syncSubjectSummary(existing.subject_id);
        }

        return readChapter(chapterId);
    });

    const toggleTransaction = db.transaction((id: number, completed?: boolean) => {
        const chapterId = normalizeChapterId(id);
        const existing = readChapter(chapterId);
        const nextCompleted = typeof completed === 'boolean' ? completed : !existing.completed;
        db.prepare(`
            UPDATE subject_chapters
            SET completed = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(nextCompleted ? 1 : 0, chapterId);
        syncSubjectSummary(existing.subject_id);
        return readChapter(chapterId);
    });

    const reorderTransaction = db.transaction((subjectIdValue: number, chapterIdsValue: number[]) => {
        const subjectId = normalizeSubjectId(subjectIdValue);
        assertSubjectExists(subjectId);
        if (!Array.isArray(chapterIdsValue) || chapterIdsValue.length === 0) {
            throw new Error('chapterIds must be a non-empty array');
        }
        const chapterIds = chapterIdsValue.map(normalizeChapterId);
        const existing = db.prepare('SELECT id FROM subject_chapters WHERE subject_id = ? ORDER BY sort_order, id')
            .all(subjectId) as Array<{ id: number }>;
        const existingIds = existing.map(row => row.id);
        if (existingIds.length !== chapterIds.length || new Set(chapterIds).size !== chapterIds.length) {
            throw new Error('chapterIds must include each subject chapter exactly once');
        }
        const existingSet = new Set(existingIds);
        if (!chapterIds.every(id => existingSet.has(id))) {
            throw new Error('chapterIds must include only chapters for this subject');
        }

        const updateOrder = db.prepare('UPDATE subject_chapters SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        chapterIds.forEach((chapterId, index) => updateOrder.run(index, chapterId));
        return getBySubject(subjectId);
    });

    const deleteTransaction = db.transaction((id: number) => {
        const chapterId = normalizeChapterId(id);
        const existing = readChapter(chapterId);
        const statsBeforeDelete = getSubjectStats(existing.subject_id);
        db.prepare('DELETE FROM subject_chapters WHERE id = ?').run(chapterId);
        const statsAfterDelete = getSubjectStats(existing.subject_id);
        if (statsAfterDelete.total === 0) {
            updateSubjectSummary.run(statsBeforeDelete.total, statsBeforeDelete.completed, existing.subject_id);
        } else {
            updateSubjectSummary.run(statsAfterDelete.total, statsAfterDelete.completed, existing.subject_id);
        }
        return { success: true };
    });

    const clearTransaction = db.transaction((subjectIdValue: number) => {
        const subjectId = normalizeSubjectId(subjectIdValue);
        const subject = assertSubjectExists(subjectId);
        const stats = getSubjectStats(subjectId);
        if (stats.total === 0) {
            return subject;
        }
        db.prepare('DELETE FROM subject_chapters WHERE subject_id = ?').run(subjectId);
        updateSubjectSummary.run(stats.total, stats.completed, subjectId);
        return assertSubjectExists(subjectId);
    });

    function getBySubject(subjectIdValue: number): SubjectChapter[] {
        const subjectId = normalizeSubjectId(subjectIdValue);
        return (db.prepare(`
            SELECT *
            FROM subject_chapters
            WHERE subject_id = ?
            ORDER BY sort_order ASC, id ASC
        `).all(subjectId) as SubjectChapterRow[]).map(rowToChapter);
    }

    return {
        getBySubject,
        createChapter: createOneTransaction,
        bulkCreateChapters: bulkCreateTransaction,
        convertSubjectToDetailedChapters: convertTransaction,
        patchChapter: patchTransaction,
        toggleChapterCompleted: toggleTransaction,
        reorderChapters: reorderTransaction,
        deleteChapter: deleteTransaction,
        clearDetailedChapters: clearTransaction,
    };
}

export type SubjectChaptersRepository = ReturnType<typeof createSubjectChaptersRepository>;
