// @vitest-environment node

import fs from 'fs'
import os from 'os'
import path from 'path'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  CURRENT_SCHEMA_VERSION,
  DATABASE_MIGRATIONS,
  getDatabaseSchemaVersion,
  runDatabaseMigrations,
  type DatabaseMigration,
} from '../electron/databaseMigrations'
import { BACKUP_FORMAT_VERSION, createAutoBackup } from '../electron/backup'

vi.mock('../electron/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

type DatabaseModule = {
  CURRENT_SCHEMA_VERSION: number
  initialize: () => void
  setCustomDbPath: (filepath: string) => void
  getDb: () => Database.Database
}

const databases: Database.Database[] = []
const tempRoots: string[] = []

function createDatabase(filename = ':memory:'): Database.Database {
  const database = new BetterSqlite3(filename)
  databases.push(database)
  return database
}

function closeDatabase(database: Database.Database): void {
  try {
    database.close()
  } catch {
    // already closed by the code under test
  }
}

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-schema-'))
  tempRoots.push(root)
  return root
}

function getUserVersion(database: Database.Database): number {
  return database.pragma('user_version', { simple: true }) as number
}

function tableExists(database: Database.Database, tableName: string): boolean {
  const row = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  return !!row
}

function indexExists(database: Database.Database, indexName: string): boolean {
  const row = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName)
  return !!row
}

function getColumnNames(database: Database.Database, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>).map(column => column.name)
}

function getTableCount(database: Database.Database, tableName: string): number {
  return (database.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number }).count
}

function seedLegacyUnversionedDatabase(database: Database.Database): void {
  database.exec(`
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      title TEXT,
      content TEXT NOT NULL DEFAULT '',
      mood TEXT,
      word_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#0F766E'
    );
    CREATE TABLE subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      total_chapters INTEGER DEFAULT 0,
      completed_chapters INTEGER DEFAULT 0,
      color TEXT DEFAULT '#0F766E'
    );
    CREATE TABLE pomodoro_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER REFERENCES subjects(id),
      duration INTEGER NOT NULL,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE mistakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER REFERENCES subjects(id),
      question TEXT NOT NULL,
      answer TEXT,
      notes TEXT,
      mastered INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE diary_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  database.prepare("INSERT INTO entries (date, title, content, mood, word_count) VALUES ('2026-05-20', 'legacy', 'kept', 'good', 4)").run()
  database.prepare("INSERT INTO tags (name, color) VALUES ('legacy tag', '#8b5cf6')").run()
  database.prepare("INSERT INTO subjects (name, color) VALUES ('legacy subject', '#3b82f6')").run()
  database.prepare("INSERT INTO pomodoro_sessions (subject_id, duration, completed_at) VALUES (1, 25, '2026-05-20 10:00:00')").run()
  database.prepare("INSERT INTO mistakes (subject_id, question, answer, notes) VALUES (1, '2 + 2', '4', 'kept')").run()
  database.prepare("INSERT INTO diary_templates (name, content, is_default, sort_order) VALUES ('custom', 'user template', 0, 9)").run()
}

async function loadRealDatabaseModule(): Promise<DatabaseModule> {
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: {
      getPath: vi.fn(() => makeTempRoot()),
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => false),
      encryptString: vi.fn((value: string) => Buffer.from(value)),
      decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
    },
  }))
  vi.doMock('../electron/mistakeImageStorage', () => ({
    deleteManagedMistakeImage: vi.fn(async () => undefined),
    getMistakeImageReferenceKey: vi.fn(() => null),
  }))
  const imported = await import('../electron/database') as unknown as DatabaseModule | { default: DatabaseModule }
  return 'default' in imported ? imported.default : imported
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('electron')
  vi.doUnmock('../electron/mistakeImageStorage')
  for (const database of databases.splice(0)) {
    closeDatabase(database)
  }
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('database migration registry', () => {
  it('defines schema version 1 with a complete ordered registry', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
    expect(DATABASE_MIGRATIONS.map(migration => migration.version)).toEqual([1])
    expect(new Set(DATABASE_MIGRATIONS.map(migration => migration.version)).size).toBe(DATABASE_MIGRATIONS.length)
    expect(DATABASE_MIGRATIONS[DATABASE_MIGRATIONS.length - 1]?.version).toBe(CURRENT_SCHEMA_VERSION)
  })
})

describe('SQLite schema migrations', () => {
  it('migrates a new database from user_version 0 to schema version 1', () => {
    const database = createDatabase()

    expect(getUserVersion(database)).toBe(0)
    expect(runDatabaseMigrations(database)).toBe(1)

    expect(getUserVersion(database)).toBe(1)
    expect(getDatabaseSchemaVersion(database)).toBe(1)
    for (const tableName of ['entries', 'tags', 'pomodoro_sessions', 'mistakes', 'study_tasks', 'diary_templates']) {
      expect(tableExists(database, tableName)).toBe(true)
    }
    for (const indexName of ['idx_entries_date', 'idx_pomodoro_date_key', 'idx_mistakes_next_review', 'idx_study_tasks_planned_date']) {
      expect(indexExists(database, indexName)).toBe(true)
    }
    expect(getTableCount(database, 'diary_templates')).toBe(3)
  })

  it('adopts a representative unversioned legacy database without losing user data', () => {
    const database = createDatabase()
    seedLegacyUnversionedDatabase(database)

    expect(getUserVersion(database)).toBe(0)
    runDatabaseMigrations(database)

    expect(getUserVersion(database)).toBe(1)
    expect(database.prepare('SELECT title, content FROM entries WHERE id = 1').get()).toEqual({ title: 'legacy', content: 'kept' })
    expect(getColumnNames(database, 'tags')).toEqual(expect.arrayContaining(['icon', 'variant', 'pattern']))
    expect(getColumnNames(database, 'pomodoro_sessions')).toEqual(expect.arrayContaining(['date_key', 'started_at']))
    expect(database.prepare('SELECT date_key FROM pomodoro_sessions WHERE id = 1').get()).toEqual({ date_key: '2026-05-20' })
    expect(getColumnNames(database, 'mistakes')).toEqual(expect.arrayContaining([
      'ease_factor',
      'review_interval',
      'next_review_date',
      'review_count',
      'image_path',
    ]))
    expect(tableExists(database, 'study_tasks')).toBe(true)
    expect(indexExists(database, 'idx_mistakes_next_review')).toBe(true)
    expect(indexExists(database, 'idx_study_tasks_subject_id')).toBe(true)
    expect(database.prepare('SELECT color FROM tags WHERE id = 1').get()).toEqual({ color: '#475569' })
    expect(database.prepare('SELECT color FROM subjects WHERE id = 1').get()).toEqual({ color: '#0F766E' })
    expect(getTableCount(database, 'diary_templates')).toBe(1)
  })

  it('treats schema version 1 as a no-op', () => {
    const database = createDatabase()
    let calls = 0
    const migrations: DatabaseMigration[] = [{
      version: 1,
      name: 'must-not-run',
      up: () => {
        calls += 1
        throw new Error('migration should not run')
      },
    }]
    database.pragma('user_version = 1')
    database.exec('CREATE TABLE preserved (value TEXT)')
    database.prepare("INSERT INTO preserved (value) VALUES ('kept')").run()

    expect(runDatabaseMigrations(database, { migrations, targetVersion: 1 })).toBe(1)

    expect(calls).toBe(0)
    expect(getUserVersion(database)).toBe(1)
    expect(database.prepare('SELECT value FROM preserved').get()).toEqual({ value: 'kept' })
  })

  it('is idempotent after a successful version 0 adoption', () => {
    const database = createDatabase()

    runDatabaseMigrations(database)
    runDatabaseMigrations(database)

    expect(getUserVersion(database)).toBe(1)
    expect(getTableCount(database, 'diary_templates')).toBe(3)
  })

  it('rejects databases from newer schema versions without mutation', () => {
    const database = createDatabase()
    database.pragma('user_version = 2')

    expect(() => runDatabaseMigrations(database)).toThrow(/schema version 2.*supported version 1/i)

    expect(getUserVersion(database)).toBe(2)
    expect(tableExists(database, 'entries')).toBe(false)
  })

  it('rolls back migration schema and data changes when a migration fails', () => {
    const database = createDatabase()
    let secondMigrationCalls = 0
    const migrations: DatabaseMigration[] = [
      {
        version: 1,
        name: 'failing-migration',
        up: (db) => {
          db.exec('CREATE TABLE rollback_probe (value TEXT)')
          db.prepare("INSERT INTO rollback_probe (value) VALUES ('temporary')").run()
          throw new Error('boom')
        },
      },
      {
        version: 2,
        name: 'should-not-run',
        up: () => {
          secondMigrationCalls += 1
        },
      },
    ]

    expect(() => runDatabaseMigrations(database, { migrations, targetVersion: 2 })).toThrow('boom')

    expect(tableExists(database, 'rollback_probe')).toBe(false)
    expect(getUserVersion(database)).toBe(0)
    expect(secondMigrationCalls).toBe(0)
  })
})

describe('database initialize schema version handling', () => {
  it('initializes a temporary database with WAL, foreign keys, and user_version 1', async () => {
    const root = makeTempRoot()
    const dbPath = path.join(root, 'minddiary.db')
    const databaseModule = await loadRealDatabaseModule()

    databaseModule.setCustomDbPath(dbPath)
    databaseModule.initialize()
    const database = databaseModule.getDb()
    databases.push(database)

    expect(databaseModule.CURRENT_SCHEMA_VERSION).toBe(1)
    expect(getUserVersion(database)).toBe(1)
    expect(String(database.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal')
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('rejects a future-version database before exposing an initialized connection', async () => {
    const root = makeTempRoot()
    const dbPath = path.join(root, 'minddiary.db')
    const seed = createDatabase(dbPath)
    seed.pragma('user_version = 2')
    closeDatabase(seed)
    databases.splice(databases.indexOf(seed), 1)
    const databaseModule = await loadRealDatabaseModule()

    databaseModule.setCustomDbPath(dbPath)
    expect(() => databaseModule.initialize()).toThrow(/schema version 2.*supported version 1/i)
    expect(() => databaseModule.getDb()).toThrow('Database has not been initialized')

    const reopened = createDatabase(dbPath)
    expect(getUserVersion(reopened)).toBe(2)
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false)
  })
})

describe('backup schema version consistency', () => {
  it('keeps backup manifests aligned with the current schema version and backup format', async () => {
    const root = makeTempRoot()
    const backupFile = await createAutoBackup({
      backupPath: path.join(root, 'backups'),
      userDataPath: path.join(root, 'userData'),
      appVersion: '1.9.8',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      now: new Date('2026-06-06T00:00:00.000Z'),
      keep: 7,
      logger: { warn: vi.fn(), error: vi.fn() },
      data: { settings: [] },
    })

    const zipText = fs.readFileSync(backupFile, 'utf8')
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
    expect(BACKUP_FORMAT_VERSION).toBe(2)
    expect(zipText).toContain('"schemaVersion": 1')
    expect(zipText).toContain(`"backupFormatVersion": ${BACKUP_FORMAT_VERSION}`)
  })
})
