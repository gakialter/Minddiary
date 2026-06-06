import type Database from 'better-sqlite3';
import type { Attachment } from '../../src/types/index';

function normalizeEntryIds(entryIds: number[]): number[] {
    if (!Array.isArray(entryIds)) return [];
    return Array.from(new Set(entryIds.filter(entryId => Number.isInteger(entryId) && entryId > 0)));
}

export function createAttachmentsRepository(db: Database.Database) {
    return {
        addAttachment(entryId: number, { filename, filepath, mimetype }: { filename: string; filepath: string; mimetype: string }) {
            const stmt = db.prepare(
                'INSERT INTO attachments (entry_id, filename, filepath, mimetype) VALUES (?, ?, ?, ?)'
            );
            const result = stmt.run(entryId, filename, filepath, mimetype);
            return { id: result.lastInsertRowid, entry_id: entryId, filename, filepath, mimetype };
        },

        getAttachmentsByEntry(entryId: number) {
            return db.prepare('SELECT * FROM attachments WHERE entry_id=?').all(entryId);
        },

        getAttachmentsByEntries(entryIds: number[]): Record<number, Attachment[]> {
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
        },

        getAttachmentById(id: number) {
            return db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
        },

        removeAttachment(id: number) {
            db.prepare('DELETE FROM attachments WHERE id=?').run(id);
            return { success: true };
        },
    };
}

export type AttachmentsRepository = ReturnType<typeof createAttachmentsRepository>;
