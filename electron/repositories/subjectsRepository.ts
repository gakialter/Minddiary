import type Database from 'better-sqlite3';
import type { Subject } from '../../src/types/index';

const DEFAULT_SUBJECT_COLOR = '#0F766E';

export function createSubjectsRepository(db: Database.Database) {
    const unlinkMistakesFromSubject = db.prepare('UPDATE mistakes SET subject_id = NULL WHERE subject_id = ?');
    const unlinkPomodoroSessionsFromSubject = db.prepare('UPDATE pomodoro_sessions SET subject_id = NULL WHERE subject_id = ?');
    const unlinkStudyTasksFromSubject = db.prepare('UPDATE study_tasks SET subject_id = NULL WHERE subject_id = ?');
    const deleteSubjectById = db.prepare('DELETE FROM subjects WHERE id=?');
    const deleteSubjectWithRelatedHistory = db.transaction((id: number) => {
        unlinkMistakesFromSubject.run(id);
        unlinkPomodoroSessionsFromSubject.run(id);
        unlinkStudyTasksFromSubject.run(id);
        deleteSubjectById.run(id);
    });

    return {
        getAllSubjects(): Subject[] {
            return db.prepare('SELECT * FROM subjects ORDER BY name').all() as Subject[];
        },

        createSubject({ name, total_chapters, color }: Partial<Subject>) {
            const stmt = db.prepare(
                'INSERT INTO subjects (name, total_chapters, color) VALUES (?, ?, ?)'
            );
            const normalizedTotalChapters = total_chapters || 0;
            const normalizedColor = color || DEFAULT_SUBJECT_COLOR;
            const result = stmt.run(name, normalizedTotalChapters, normalizedColor);
            return {
                id: result.lastInsertRowid,
                name,
                total_chapters: normalizedTotalChapters,
                completed_chapters: 0,
                color: normalizedColor,
            };
        },

        updateSubject(id: number, { name, total_chapters, completed_chapters, color }: Partial<Subject>) {
            db.prepare(
                'UPDATE subjects SET name=?, total_chapters=?, completed_chapters=?, color=? WHERE id=?'
            ).run(name, total_chapters, completed_chapters, color, id);
            return { id, name, total_chapters, completed_chapters, color };
        },

        deleteSubject(id: number) {
            deleteSubjectWithRelatedHistory(id);
            return { success: true };
        },
    };
}
