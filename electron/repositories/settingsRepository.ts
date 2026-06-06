import type Database from 'better-sqlite3';

export function createSettingsRepository(db: Database.Database) {
    return {
        getSetting(key: string) {
            const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: unknown } | undefined;
            return row ? row.value : null;
        },

        setSetting(key: string, value: unknown) {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
            return { success: true };
        },

        getAllSettings() {
            const rows = db.prepare('SELECT * FROM settings').all() as { key: string; value: unknown }[];
            const settings: Record<string, unknown> = {};
            for (const row of rows) {
                settings[row.key] = row.value;
            }
            return settings;
        },
    };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
