import type Database from 'better-sqlite3';
import { createAttachmentsRepository } from './attachmentsRepository';
import { createEntriesRepository } from './entriesRepository';
import { createSettingsRepository } from './settingsRepository';
import { createSubjectsRepository } from './subjectsRepository';
import { createTagsRepository } from './tagsRepository';
import { createTemplatesRepository } from './templatesRepository';

export function createDatabaseRepositories(db: Database.Database) {
    return {
        attachments: createAttachmentsRepository(db),
        entries: createEntriesRepository(db),
        settings: createSettingsRepository(db),
        subjects: createSubjectsRepository(db),
        tags: createTagsRepository(db),
        templates: createTemplatesRepository(db),
    };
}

export type DatabaseRepositories = ReturnType<typeof createDatabaseRepositories>;
