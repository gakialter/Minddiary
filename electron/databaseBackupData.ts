export type DatabaseBackupValue = string | number | null;
export type DatabaseBackupRow = Record<string, DatabaseBackupValue>;

export interface NormalizedBackupDatabaseData {
    settings: DatabaseBackupRow[];
    subjects: DatabaseBackupRow[];
    tags: DatabaseBackupRow[];
    entries: DatabaseBackupRow[];
    entry_tags: DatabaseBackupRow[];
    attachments: DatabaseBackupRow[];
    pomodoro_sessions: DatabaseBackupRow[];
    mistakes: DatabaseBackupRow[];
    ai_chats: DatabaseBackupRow[];
    diary_templates: DatabaseBackupRow[];
}

export const DATABASE_BACKUP_TABLES = [
    {
        key: 'settings',
        table: 'settings',
        columns: ['key', 'value'],
    },
    {
        key: 'subjects',
        table: 'subjects',
        columns: ['id', 'name', 'total_chapters', 'completed_chapters', 'color'],
    },
    {
        key: 'tags',
        table: 'tags',
        columns: ['id', 'name', 'color', 'icon', 'variant', 'pattern'],
    },
    {
        key: 'entries',
        table: 'entries',
        columns: ['id', 'date', 'title', 'content', 'mood', 'word_count', 'created_at', 'updated_at'],
    },
    {
        key: 'entry_tags',
        table: 'entry_tags',
        columns: ['entry_id', 'tag_id'],
    },
    {
        key: 'attachments',
        table: 'attachments',
        columns: ['id', 'entry_id', 'filename', 'filepath', 'mimetype', 'created_at'],
    },
    {
        key: 'pomodoro_sessions',
        table: 'pomodoro_sessions',
        columns: ['id', 'subject_id', 'duration', 'date_key', 'started_at', 'completed_at'],
    },
    {
        key: 'mistakes',
        table: 'mistakes',
        columns: [
            'id',
            'subject_id',
            'question',
            'answer',
            'notes',
            'mastered',
            'created_at',
            'updated_at',
            'ease_factor',
            'review_interval',
            'next_review_date',
            'review_count',
            'image_path',
        ],
    },
    {
        key: 'ai_chats',
        table: 'ai_chats',
        columns: ['id', 'entry_id', 'role', 'content', 'created_at'],
    },
    {
        key: 'diary_templates',
        table: 'diary_templates',
        columns: ['id', 'name', 'content', 'is_default', 'sort_order', 'created_at', 'updated_at'],
    },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBackupValue(value: unknown, tableName: string, columnName: string): DatabaseBackupValue {
    if (value === null || typeof value === 'string' || typeof value === 'number') {
        return value;
    }
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    throw new Error(`Invalid database backup value for ${tableName}.${columnName}`);
}

function normalizeTableRows(raw: unknown, tableName: string): DatabaseBackupRow[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        throw new Error(`Invalid database backup: ${tableName} must be an array`);
    }

    return raw.map((row, index) => {
        if (!isRecord(row)) {
            throw new Error(`Invalid database backup: ${tableName}[${index}] must be an object`);
        }
        const normalized: DatabaseBackupRow = {};
        for (const [key, value] of Object.entries(row)) {
            if (value !== undefined) {
                normalized[key] = normalizeBackupValue(value, tableName, key);
            }
        }
        return normalized;
    });
}

function normalizeSettingValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

function normalizeSettings(raw: unknown): DatabaseBackupRow[] {
    if (raw === undefined) return [];
    if (Array.isArray(raw)) {
        return raw.map((row, index) => {
            if (!isRecord(row) || typeof row.key !== 'string') {
                throw new Error(`Invalid database backup: settings[${index}] must have a string key`);
            }
            return { key: row.key, value: normalizeSettingValue(row.value) };
        });
    }
    if (isRecord(raw)) {
        return Object.entries(raw).map(([key, value]) => ({ key, value: normalizeSettingValue(value) }));
    }
    throw new Error('Invalid database backup: settings must be an object or an array');
}

function normalizeMistakes(raw: unknown): DatabaseBackupRow[] {
    if (raw === undefined) return [];
    if (Array.isArray(raw)) return normalizeTableRows(raw, 'mistakes');
    if (isRecord(raw) && Array.isArray(raw.data)) {
        return normalizeTableRows(raw.data, 'mistakes');
    }
    throw new Error('Invalid database backup: mistakes must be an array');
}

function normalizePomodoroSessions(raw: Record<string, unknown>): DatabaseBackupRow[] {
    if (Array.isArray(raw.pomodoro_sessions)) {
        return normalizeTableRows(raw.pomodoro_sessions, 'pomodoro_sessions');
    }
    if (!Array.isArray(raw.pomodoro)) {
        if (raw.pomodoro !== undefined) {
            throw new Error('Invalid database backup: pomodoro must be an array');
        }
        return [];
    }
    const candidateRows = raw.pomodoro.filter(isRecord);
    if (!candidateRows.every(row => 'duration' in row)) {
        return [];
    }
    return normalizeTableRows(candidateRows, 'pomodoro_sessions');
}

export function normalizeBackupDatabaseData(raw: Record<string, unknown>): NormalizedBackupDatabaseData {
    if (!isRecord(raw)) {
        throw new Error('Invalid database backup: data must be an object');
    }

    return {
        settings: normalizeSettings(raw.settings),
        subjects: normalizeTableRows(raw.subjects, 'subjects'),
        tags: normalizeTableRows(raw.tags, 'tags'),
        entries: normalizeTableRows(raw.entries, 'entries'),
        entry_tags: normalizeTableRows(raw.entry_tags, 'entry_tags'),
        attachments: normalizeTableRows(raw.attachments, 'attachments'),
        pomodoro_sessions: normalizePomodoroSessions(raw),
        mistakes: normalizeMistakes(raw.mistakes),
        ai_chats: normalizeTableRows(raw.ai_chats, 'ai_chats'),
        diary_templates: normalizeTableRows(raw.diary_templates, 'diary_templates'),
    };
}
