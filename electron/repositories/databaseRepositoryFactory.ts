import type Database from 'better-sqlite3';
import { createSettingsRepository } from './settingsRepository';
import { createSubjectsRepository } from './subjectsRepository';
import { createTemplatesRepository } from './templatesRepository';

export function createDatabaseRepositories(db: Database.Database) {
    return {
        settings: createSettingsRepository(db),
        subjects: createSubjectsRepository(db),
        templates: createTemplatesRepository(db),
    };
}

export type DatabaseRepositories = ReturnType<typeof createDatabaseRepositories>;
