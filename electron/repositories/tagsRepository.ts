import type Database from 'better-sqlite3';
import type { Tag } from '../../src/types/index';
import {
    mergeTagPatch,
    normalizeTag,
    normalizeTagList,
} from '../../src/utils/tagStyle';

function normalizeEntryIds(entryIds: number[]): number[] {
    if (!Array.isArray(entryIds)) return [];
    return Array.from(new Set(entryIds.filter(entryId => Number.isInteger(entryId) && entryId > 0)));
}

export function createTagsRepository(db: Database.Database) {
    function getTagById(id: number): Tag | undefined {
        const tag = db.prepare('SELECT * FROM tags WHERE id=?').get(id) as Tag | undefined;
        return tag ? normalizeTag(tag) : undefined;
    }

    return {
        getAllTags(): Tag[] {
            return normalizeTagList(db.prepare('SELECT * FROM tags ORDER BY name').all() as Tag[]);
        },

        createTag(data: Partial<Tag>): Tag {
            const newTag = normalizeTag({
                id: 0,
                name: data.name,
                color: data.color,
                icon: data.icon,
                variant: data.variant,
                pattern: data.pattern,
            });
            if (!newTag.name) {
                throw new Error('Tag name is required');
            }
            const stmt = db.prepare('INSERT INTO tags (name, color, icon, variant, pattern) VALUES (?, ?, ?, ?, ?)');
            const result = stmt.run(newTag.name, newTag.color, newTag.icon, newTag.variant, newTag.pattern);
            return { ...newTag, id: Number(result.lastInsertRowid) };
        },

        updateTag(id: number, data: Partial<Tag>): Tag {
            const existingTag = getTagById(id);
            if (!existingTag) {
                throw new Error('Tag not found');
            }
            const updatedTag = mergeTagPatch(existingTag, data);
            if (!updatedTag.name) {
                throw new Error('Tag name is required');
            }
            const result = db.prepare('UPDATE tags SET name=?, color=?, icon=?, variant=?, pattern=? WHERE id=?')
                .run(updatedTag.name, updatedTag.color, updatedTag.icon, updatedTag.variant, updatedTag.pattern, id);
            if (result.changes === 0) {
                throw new Error('Tag not found');
            }
            return updatedTag;
        },

        deleteTag(id: number) {
            db.prepare('DELETE FROM tags WHERE id=?').run(id);
            return { success: true };
        },

        setEntryTags(entryId: number, tagIds: number[]) {
            const deleteStmt = db.prepare('DELETE FROM entry_tags WHERE entry_id=?');
            const insertStmt = db.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
            const transaction = db.transaction(() => {
                deleteStmt.run(entryId);
                for (const tagId of tagIds) {
                    insertStmt.run(entryId, tagId);
                }
            });
            transaction();
            return { success: true };
        },

        getEntryTags(entryId: number): Tag[] {
            return normalizeTagList(db.prepare(
                'SELECT t.* FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id = ?'
            ).all(entryId) as Tag[]);
        },

        getEntryTagsBatch(entryIds: number[]): Record<number, Tag[]> {
            const validEntryIds = normalizeEntryIds(entryIds);
            if (validEntryIds.length === 0) return {};

            const result: Record<number, Tag[]> = {};
            for (const entryId of validEntryIds) {
                result[entryId] = [];
            }

            const placeholders = validEntryIds.map(() => '?').join(', ');
            const rows = db.prepare(
                `SELECT et.entry_id, t.* FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id IN (${placeholders})`
            ).all(...validEntryIds) as Array<Tag & { entry_id: number }>;

            for (const row of rows) {
                const { entry_id, ...tag } = row;
                if (result[entry_id]) {
                    result[entry_id].push(normalizeTag(tag));
                }
            }
            return result;
        },
    };
}

export type TagsRepository = ReturnType<typeof createTagsRepository>;
