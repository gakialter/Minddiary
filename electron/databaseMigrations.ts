import type Database from 'better-sqlite3';
import {
    DEFAULT_TAG_PATTERN,
    DEFAULT_TAG_VARIANT,
    TAG_PATTERNS,
    TAG_VARIANTS,
} from '../src/utils/tagStyle';

export const CURRENT_SCHEMA_VERSION = 4;

export type DatabaseMigration = {
    version: number;
    name: string;
    up: (database: Database.Database) => void;
};

type PragmaUserVersionRow = {
    user_version: unknown;
};

export type RunDatabaseMigrationsOptions = {
    migrations?: readonly DatabaseMigration[];
    targetVersion?: number;
};

const LEGACY_TO_BRAND: Record<string, string> = {
    '#8b5cf6': '#475569',
    '#6366f1': '#0E7490',
    '#3b82f6': '#0F766E',
    '#10b981': '#2F8F6B',
    '#f59e0b': '#854D0E',
    '#ec4899': '#C65A3A',
    '#ef4444': '#C65A3A',
    '#f43f5e': '#C65A3A',
    '#06b6d4': '#0E7490',
    '#14b8a6': '#0F766E',
};

const DEFAULT_DIARY_TEMPLATES = [
    {
        name: '\u8003\u7814\u6a21\u677f',
        content: '## \u4eca\u65e5\u5b66\u4e86\u4ec0\u4e48\n-\n\n## \u8584\u5f31\u70b9 / \u7591\u95ee\n-\n\n## \u660e\u65e5\u8ba1\u5212\n-\n\n## \u611f\u609f / \u788e\u788e\u5ff5\n',
        is_default: 1,
        sort_order: 0,
    },
    {
        name: '\u7b80\u6d01\u6a21\u677f',
        content: '## \u4eca\u65e5\u603b\u7ed3\n- \u5b66\u4e86\u4ec0\u4e48\uff1f\n- \u6709\u4ec0\u4e48\u6536\u83b7\uff1f\n- \u660e\u5929\u505a\u4ec0\u4e48\uff1f\n',
        is_default: 1,
        sort_order: 1,
    },
    {
        name: '\u8be6\u7ec6\u6a21\u677f',
        content: '## \u5b66\u4e60\u5185\u5bb9\n**\u79d1\u76ee**\uff1a\n**\u7ae0\u8282**\uff1a\n**\u7528\u65f6**\uff1a\u5c0f\u65f6\n\n## \u91cd\u70b9\u8bb0\u5f55\n1.\n2.\n\n## \u9519\u9898\u5206\u6790\n-\n\n## \u5fc3\u6001\u8c03\u6574\n-\n',
        is_default: 1,
        sort_order: 2,
    },
] as const;

function quoteIdentifier(identifier: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
        throw new Error(`Invalid SQLite identifier: ${identifier}`);
    }
    return `"${identifier}"`;
}

function readUserVersionViaStatement(database: Database.Database): unknown {
    return (database.prepare('PRAGMA user_version').get() as PragmaUserVersionRow | undefined)?.user_version;
}

export function getDatabaseSchemaVersion(database: Database.Database): number {
    const rawVersion = database.pragma('user_version', { simple: true }) ?? readUserVersionViaStatement(database);
    if (!Number.isInteger(rawVersion) || (rawVersion as number) < 0) {
        throw new Error(`Invalid SQLite user_version: ${String(rawVersion)}`);
    }
    return rawVersion as number;
}

function setDatabaseSchemaVersion(database: Database.Database, version: number): void {
    if (!Number.isInteger(version) || version < 0) {
        throw new Error(`Invalid SQLite schema version: ${String(version)}`);
    }
    database.pragma(`user_version = ${version}`);
}

export function assertSupportedDatabaseVersion(
    database: Database.Database,
    supportedVersion = CURRENT_SCHEMA_VERSION,
): number {
    const databaseVersion = getDatabaseSchemaVersion(database);
    if (databaseVersion > supportedVersion) {
        throw new Error(
            `Database schema version ${databaseVersion} is newer than supported version ${supportedVersion}. Please update MindDiary before opening this database.`,
        );
    }
    return databaseVersion;
}

export function validateDatabaseMigrationRegistry(
    migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
    targetVersion = CURRENT_SCHEMA_VERSION,
): void {
    let previousVersion = 0;
    const seenVersions = new Set<number>();

    for (const migration of migrations) {
        if (!Number.isInteger(migration.version) || migration.version <= 0) {
            throw new Error(`Invalid database migration version: ${String(migration.version)}`);
        }
        if (migration.version <= previousVersion) {
            throw new Error('Database migrations must be registered in ascending version order');
        }
        if (seenVersions.has(migration.version)) {
            throw new Error(`Duplicate database migration version: ${migration.version}`);
        }
        seenVersions.add(migration.version);
        previousVersion = migration.version;
    }

    for (let version = 1; version <= targetVersion; version += 1) {
        if (!seenVersions.has(version)) {
            throw new Error(`Missing database migration version: ${version}`);
        }
    }
}

function hasColumn(database: Database.Database, tableName: string, columnName: string): boolean {
    const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as { name: string }[];
    return columns.some(column => column.name === columnName);
}

function ensureColumn(database: Database.Database, tableName: string, columnName: string, definition: string): void {
    if (!hasColumn(database, tableName, columnName)) {
        database.exec(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`);
    }
}

function createCurrentSchema(database: Database.Database): void {
    database.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      title TEXT,
      content TEXT NOT NULL DEFAULT '',
      mood TEXT,
      word_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
    CREATE INDEX IF NOT EXISTS idx_entries_mood ON entries(mood);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#0F766E',
      icon TEXT DEFAULT '',
      variant TEXT DEFAULT 'soft',
      pattern TEXT DEFAULT 'none'
    );

    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entry_tags_tag_id ON entry_tags(tag_id);

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      mimetype TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      total_chapters INTEGER DEFAULT 0,
      completed_chapters INTEGER DEFAULT 0,
      color TEXT DEFAULT '#0F766E'
    );

    CREATE TABLE IF NOT EXISTS subject_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_subject_chapters_subject_id ON subject_chapters(subject_id);
    CREATE INDEX IF NOT EXISTS idx_subject_chapters_subject_order ON subject_chapters(subject_id, sort_order);

    CREATE TABLE IF NOT EXISTS pomodoro_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER REFERENCES subjects(id),
      duration INTEGER NOT NULL,
      date_key TEXT,
      started_at DATETIME,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pomodoro_completed ON pomodoro_sessions(completed_at);

    CREATE TABLE IF NOT EXISTS mistakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER REFERENCES subjects(id),
      question TEXT NOT NULL,
      answer TEXT,
      notes TEXT,
      mastered INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ease_factor REAL DEFAULT 2.5,
      review_interval INTEGER DEFAULT 1,
      next_review_date TEXT,
      review_count INTEGER DEFAULT 0,
      image_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mistakes_subject ON mistakes(subject_id);

    CREATE TABLE IF NOT EXISTS study_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'custom',
      subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      related_mistake_id INTEGER REFERENCES mistakes(id) ON DELETE SET NULL,
      related_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
      planned_date TEXT NOT NULL,
      estimate_minutes INTEGER DEFAULT 25,
      status TEXT NOT NULL DEFAULT 'todo',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_study_tasks_planned_date ON study_tasks(planned_date);
    CREATE INDEX IF NOT EXISTS idx_study_tasks_status ON study_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_study_tasks_subject_id ON study_tasks(subject_id);

    CREATE TABLE IF NOT EXISTS ai_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS diary_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function migratePomodoroDateKey(database: Database.Database): void {
    ensureColumn(database, 'pomodoro_sessions', 'date_key', 'TEXT');
    ensureColumn(database, 'pomodoro_sessions', 'started_at', 'DATETIME');
    database.exec('CREATE INDEX IF NOT EXISTS idx_pomodoro_date_key ON pomodoro_sessions(date_key)');
    database.prepare(`
        UPDATE pomodoro_sessions
        SET date_key = DATE(completed_at, 'localtime')
        WHERE date_key IS NULL OR date_key = ''
    `).run();
}

function migrateTagStyleColumns(database: Database.Database): void {
    ensureColumn(database, 'tags', 'icon', "TEXT DEFAULT ''");
    ensureColumn(database, 'tags', 'variant', "TEXT DEFAULT 'soft'");
    ensureColumn(database, 'tags', 'pattern', "TEXT DEFAULT 'none'");

    database.prepare("UPDATE tags SET icon = '' WHERE icon IS NULL").run();
    database.prepare(`UPDATE tags SET variant = ? WHERE variant IS NULL OR variant NOT IN (${TAG_VARIANTS.map(() => '?').join(', ')})`)
        .run(DEFAULT_TAG_VARIANT, ...TAG_VARIANTS);
    database.prepare(`UPDATE tags SET pattern = ? WHERE pattern IS NULL OR pattern NOT IN (${TAG_PATTERNS.map(() => '?').join(', ')})`)
        .run(DEFAULT_TAG_PATTERN, ...TAG_PATTERNS);
}

function migrateMistakeReviewColumns(database: Database.Database): void {
    ensureColumn(database, 'mistakes', 'ease_factor', 'REAL DEFAULT 2.5');
    ensureColumn(database, 'mistakes', 'review_interval', 'INTEGER DEFAULT 1');
    ensureColumn(database, 'mistakes', 'next_review_date', 'TEXT');
    ensureColumn(database, 'mistakes', 'review_count', 'INTEGER DEFAULT 0');
    ensureColumn(database, 'mistakes', 'image_path', 'TEXT');
    database.exec('CREATE INDEX IF NOT EXISTS idx_mistakes_next_review ON mistakes(next_review_date)');
}

function normalizeLegacyColors(database: Database.Database): void {
    const updateTag = database.prepare('UPDATE tags SET color = ? WHERE LOWER(color) = ?');
    const updateSubject = database.prepare('UPDATE subjects SET color = ? WHERE LOWER(color) = ?');
    for (const [legacy, brand] of Object.entries(LEGACY_TO_BRAND)) {
        updateTag.run(brand, legacy);
        updateSubject.run(brand, legacy);
    }
}

function seedDefaultDiaryTemplates(database: Database.Database): void {
    const templateCount = database.prepare('SELECT COUNT(*) as count FROM diary_templates').get() as { count: number };
    if (templateCount.count !== 0) return;

    const insertTemplate = database.prepare(
        'INSERT INTO diary_templates (name, content, is_default, sort_order) VALUES (?, ?, ?, ?)',
    );
    for (const template of DEFAULT_DIARY_TEMPLATES) {
        insertTemplate.run(template.name, template.content, template.is_default, template.sort_order);
    }
}

function migrateToSchemaVersion1(database: Database.Database): void {
    createCurrentSchema(database);
    migratePomodoroDateKey(database);
    migrateTagStyleColumns(database);
    migrateMistakeReviewColumns(database);
    normalizeLegacyColors(database);
    seedDefaultDiaryTemplates(database);
}

function migrateToSchemaVersion2(database: Database.Database): void {
    ensureColumn(database, 'mistakes', 'answer_image_path', 'TEXT');
}

function migrateToSchemaVersion3(database: Database.Database): void {
    ensureColumn(database, 'pomodoro_sessions', 'task_id', 'INTEGER REFERENCES study_tasks(id) ON DELETE SET NULL');
    database.exec('CREATE INDEX IF NOT EXISTS idx_pomodoro_task_id ON pomodoro_sessions(task_id)');
}

function migrateToSchemaVersion4(database: Database.Database): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS subject_chapters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          subject_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          completed INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_subject_chapters_subject_id ON subject_chapters(subject_id);
        CREATE INDEX IF NOT EXISTS idx_subject_chapters_subject_order ON subject_chapters(subject_id, sort_order);
    `);
}

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
    {
        version: 1,
        name: 'adopt-current-schema',
        up: migrateToSchemaVersion1,
    },
    {
        version: 2,
        name: 'add-mistake-answer-images',
        up: migrateToSchemaVersion2,
    },
    {
        version: 3,
        name: 'add-pomodoro-task-attribution',
        up: migrateToSchemaVersion3,
    },
    {
        version: 4,
        name: 'add-subject-chapters',
        up: migrateToSchemaVersion4,
    },
] as const;

export function runDatabaseMigrations(
    database: Database.Database,
    options: RunDatabaseMigrationsOptions = {},
): number {
    const migrations = options.migrations ?? DATABASE_MIGRATIONS;
    const targetVersion = options.targetVersion ?? CURRENT_SCHEMA_VERSION;
    validateDatabaseMigrationRegistry(migrations, targetVersion);

    let currentVersion = assertSupportedDatabaseVersion(database, targetVersion);
    if (currentVersion === targetVersion) {
        return currentVersion;
    }

    for (const migration of migrations) {
        if (migration.version <= currentVersion || migration.version > targetVersion) {
            continue;
        }

        const migrate = database.transaction(() => {
            migration.up(database);
            setDatabaseSchemaVersion(database, migration.version);
        });
        migrate();
        currentVersion = migration.version;
    }

    return currentVersion;
}
