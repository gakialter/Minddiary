import type Database from 'better-sqlite3';
import { calculateWordCount } from '../../src/utils/helpers';
import type { DateMood, DiaryEntry, EntryFilters, NewEntry } from '../../src/types/index';

export function createEntriesRepository(db: Database.Database) {
    function getEntryById(id: number): DiaryEntry | undefined {
        return db.prepare('SELECT * FROM entries WHERE id=?').get(id) as DiaryEntry | undefined;
    }

    return {
        createEntry({ date, title, content, mood }: NewEntry) {
            const wordCount = calculateWordCount(content);
            const stmt = db.prepare(
                'INSERT INTO entries (date, title, content, mood, word_count) VALUES (?, ?, ?, ?, ?)'
            );
            const result = stmt.run(date, title || '', content || '', mood || null, wordCount);
            return { id: result.lastInsertRowid, date, title, content, mood, word_count: wordCount };
        },

        updateEntry(id: number, { title, content, mood }: Partial<NewEntry>) {
            const existing = getEntryById(id);
            if (!existing) return undefined;
            const nextTitle = title !== undefined ? title : existing.title;
            const nextContent = content !== undefined ? content : existing.content;
            const nextMood = mood !== undefined ? mood : existing.mood;
            const wordCount = content !== undefined && content !== existing.content
                ? calculateWordCount(content)
                : existing.word_count;
            const stmt = db.prepare(
                'UPDATE entries SET title=?, content=?, mood=?, word_count=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
            );
            stmt.run(nextTitle || '', nextContent || '', nextMood || null, wordCount, id);
            return getEntryById(id);
        },

        deleteEntry(id: number) {
            db.prepare('DELETE FROM entries WHERE id=?').run(id);
            return { success: true };
        },

        getEntryById,

        getEntryByDate(date: string): DiaryEntry | undefined {
            return db.prepare('SELECT * FROM entries WHERE date=?').get(date) as DiaryEntry | undefined;
        },

        getAllEntries(filters: EntryFilters = {}): DiaryEntry[] {
            // Default list queries strip heavy content; callers opt into full text when needed.
            const columns = filters.includeContent
                ? '*'
                : 'id, date, title, mood, word_count, created_at, updated_at';
            let query = `SELECT ${columns} FROM entries`;
            const conditions: string[] = [];
            const params: (string | number)[] = [];

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
        },

        searchEntries(query: string) {
            const searchTerm = `%${query}%`;
            // Return metadata plus a snippet; full content is loaded through getEntryById.
            return db.prepare(
                'SELECT id, date, title, mood, word_count, created_at, updated_at, SUBSTR(content, 1, 200) AS content_snippet FROM entries WHERE content LIKE ? OR title LIKE ? ORDER BY date DESC'
            ).all(searchTerm, searchTerm) as DiaryEntry[];
        },

        getDatesWithEntries(yearMonth: string): DateMood[] {
            const pattern = `${yearMonth}%`;
            return db.prepare(
                'SELECT date, mood FROM entries WHERE date LIKE ?'
            ).all(pattern) as DateMood[];
        },
    };
}
