import type Database from 'better-sqlite3';
import { createAttachmentsRepository } from './attachmentsRepository';
import { createEntriesRepository } from './entriesRepository';
import { createPomodoroRepository } from './pomodoroRepository';
import { createSettingsRepository } from './settingsRepository';
import { createSubjectsRepository } from './subjectsRepository';
import { createStudyTasksRepository } from './studyTasksRepository';
import { createTagsRepository } from './tagsRepository';
import { createTemplatesRepository } from './templatesRepository';

export function createDatabaseRepositories(db: Database.Database) {
    return {
        attachments: createAttachmentsRepository(db),
        entries: createEntriesRepository(db),
        pomodoro: createPomodoroRepository(db),
        settings: createSettingsRepository(db),
        subjects: createSubjectsRepository(db),
        studyTasks: createStudyTasksRepository(db),
        tags: createTagsRepository(db),
        templates: createTemplatesRepository(db),
    };
}

export type DatabaseRepositories = ReturnType<typeof createDatabaseRepositories>;
