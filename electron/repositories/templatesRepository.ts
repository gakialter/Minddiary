import type Database from 'better-sqlite3';
import type { DiaryTemplate } from '../../src/types/index';

export function createTemplatesRepository(db: Database.Database) {
    return {
        getAllTemplates(): DiaryTemplate[] {
            return db.prepare('SELECT * FROM diary_templates ORDER BY sort_order ASC, id ASC').all() as DiaryTemplate[];
        },

        createTemplate({ name, content, sort_order }: Partial<DiaryTemplate>) {
            const stmt = db.prepare(
                'INSERT INTO diary_templates (name, content, is_default, sort_order) VALUES (?, ?, 0, ?)'
            );
            const normalizedContent = content || '';
            const normalizedSortOrder = sort_order ?? 99;
            const result = stmt.run(name, normalizedContent, normalizedSortOrder);
            return {
                id: result.lastInsertRowid,
                name,
                content: normalizedContent,
                is_default: 0,
                sort_order: normalizedSortOrder,
            };
        },

        updateTemplate(id: number, { name, content, sort_order }: Partial<DiaryTemplate>) {
            const updates: string[] = [];
            const params: (string | number)[] = [];
            if (name !== undefined) { updates.push('name = ?'); params.push(name); }
            if (content !== undefined) { updates.push('content = ?'); params.push(content); }
            if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
            updates.push('updated_at = CURRENT_TIMESTAMP');
            params.push(id);
            db.prepare(`UPDATE diary_templates SET ${updates.join(', ')} WHERE id=?`).run(...params);
            return db.prepare('SELECT * FROM diary_templates WHERE id=?').get(id) as DiaryTemplate | undefined;
        },

        deleteTemplate(id: number) {
            const tpl = db.prepare('SELECT is_default FROM diary_templates WHERE id=?').get(id) as { is_default: number } | undefined;
            if (tpl && tpl.is_default) {
                return { success: false, message: '默认模板不可删除' };
            }
            db.prepare('DELETE FROM diary_templates WHERE id=?').run(id);
            return { success: true };
        },
    };
}

export type TemplatesRepository = ReturnType<typeof createTemplatesRepository>;
