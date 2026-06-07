// @vitest-environment node

import fs from 'fs'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { BACKUP_FORMAT_VERSION } from '../electron/backup'
import {
  CURRENT_SCHEMA_VERSION,
  runDatabaseMigrations,
} from '../electron/databaseMigrations'
import {
  legacyDatabaseFixtures,
  type ExpectedLegacyData,
  type LegacyDatabaseFixture,
} from './fixtures/legacyDatabaseSchemas'
import {
  closeDatabase,
  createTempDatabase,
  getColumnNames,
  getForeignKeyViolations,
  getIntegrityCheck,
  getPrimaryKeyColumns,
  getTableCount,
  getUserVersion,
  indexExists,
  removeTempRoot,
  snapshotTableCounts,
  tableExists,
} from './helpers/sqliteTestUtils'

vi.mock('../electron/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const REAL_SQLITE_TEST_TIMEOUT_MS = 15_000

type EntryRow = {
  id: number
  date: string
  title: string
  content: string
  mood: string
  word_count: number
}

type TagRow = {
  id: number
  name: string
  color: string
  icon: string | null
  variant: string | null
  pattern: string | null
}

type SubjectRow = {
  id: number
  name: string
  color: string
}

type PomodoroRow = {
  id: number
  subject_id: number | null
  duration: number
  date_key: string | null
  started_at: string | null
  completed_at: string
}

type MistakeRow = {
  id: number
  subject_id: number | null
  question: string
  answer: string | null
  notes: string | null
  mastered: number
  ease_factor: number
  review_interval: number
  next_review_date: string | null
  review_count: number
  image_path: string | null
  answer_image_path: string | null
}

type DiaryTemplateRow = {
  id: number
  name: string
  content: string
  is_default: number
}

type StudyTaskRow = {
  id: number
  title: string
  planned_date: string
  status: string
  source: string
  subject_id: number | null
  related_mistake_id: number | null
  related_entry_id: number | null
}

type DatabaseModule = {
  CURRENT_SCHEMA_VERSION: number
  initialize: () => void
  setCustomDbPath: (filepath: string) => void
  getDb: () => Database.Database
  createEntry: (entry: { date: string; title: string; content: string; mood: string }) => { id: number | bigint }
  getEntryById: (id: number) => EntryRow | undefined
  getAllTags: () => TagRow[]
  createTag: (tag: { name: string; color: string; icon?: string; variant?: string; pattern?: string }) => TagRow
  setEntryTags: (entryId: number, tagIds: number[]) => { success: boolean }
  getEntryTags: (entryId: number) => TagRow[]
  addPomodoroSession: (session: {
    subject_id: number | null
    duration: number
    date_key?: string
    started_at?: string
    completed_at?: string
  }) => { id: number | bigint; date_key: string; started_at: string | null; completed_at: string }
  getDailyStudyMinutes: (date: string) => number
  getAllMistakes: (filters?: { subject_id?: number; limit?: number }) => { data: MistakeRow[]; total: number; masteredTotal: number }
  createMistake: (mistake: { subject_id: number | null; question: string; answer: string; notes: string; image_path?: string | null; answer_image_path?: string | null }) => { id: number | bigint }
  createStudyTask: (task: {
    title: string
    planned_date: string
    subject_id?: number
    related_mistake_id?: number
    related_entry_id?: number
    estimate_minutes?: number
  }) => StudyTaskRow
  getStudyTasksByDate: (date: string) => StudyTaskRow[]
  getAllTemplates: () => DiaryTemplateRow[]
}

const CURRENT_TABLES = [
  'entries',
  'tags',
  'entry_tags',
  'attachments',
  'subjects',
  'pomodoro_sessions',
  'mistakes',
  'study_tasks',
  'ai_chats',
  'settings',
  'diary_templates',
] as const

const CURRENT_INDEXES = [
  'idx_entries_date',
  'idx_entries_mood',
  'idx_entry_tags_tag_id',
  'idx_pomodoro_completed',
  'idx_pomodoro_date_key',
  'idx_mistakes_subject',
  'idx_mistakes_next_review',
  'idx_study_tasks_planned_date',
  'idx_study_tasks_status',
  'idx_study_tasks_subject_id',
] as const

const tempRoots: string[] = []
const databases: Database.Database[] = []

function trackDatabase(database: Database.Database): Database.Database {
  databases.push(database)
  return database
}

function prepareFixtureDatabase(fixture: LegacyDatabaseFixture): {
  database: Database.Database
  expected: ExpectedLegacyData
  filepath: string
  root: string
} {
  const temp = createTempDatabase(`${fixture.id}.db`)
  tempRoots.push(temp.root)
  const database = trackDatabase(temp.database)
  database.pragma('foreign_keys = ON')
  fixture.createSchema(database)
  const expected = fixture.seedData(database)
  return {
    database,
    expected,
    filepath: temp.filepath,
    root: temp.root,
  }
}

async function loadRealDatabaseModule(root: string): Promise<DatabaseModule> {
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: {
      getPath: vi.fn(() => root),
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

function closeTrackedDatabase(database: Database.Database): void {
  const index = databases.indexOf(database)
  if (index >= 0) databases.splice(index, 1)
  closeDatabase(database)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('electron')
  vi.doUnmock('../electron/mistakeImageStorage')
  for (const database of databases.splice(0)) {
    closeDatabase(database)
  }
  for (const root of tempRoots.splice(0)) {
    removeTempRoot(root)
  }
})

function expectFixtureProvenance(): void {
  const ids = legacyDatabaseFixtures.map(fixture => fixture.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const fixture of legacyDatabaseFixtures) {
    expect(fixture.sourceRef).toMatch(/^v\d+\.\d+\.\d+$/)
    expect(fixture.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(fixture.ddlSource).toContain(`git show ${fixture.sourceRef}:electron/database.ts`)
    expect(fixture.schemaDifferences.length).toBeGreaterThan(0)
    expect(Object.values(fixture.capabilities).some(Boolean)).toBe(true)
  }
}

function expectCurrentSchema(database: Database.Database): void {
  expect(getUserVersion(database)).toBe(2)
  expect(getIntegrityCheck(database)).toBe('ok')
  expect(getForeignKeyViolations(database)).toEqual([])

  for (const tableName of CURRENT_TABLES) {
    expect(tableExists(database, tableName)).toBe(true)
  }
  for (const indexName of CURRENT_INDEXES) {
    expect(indexExists(database, indexName)).toBe(true)
  }

  expect(getColumnNames(database, 'tags')).toEqual(expect.arrayContaining(['icon', 'variant', 'pattern']))
  expect(getColumnNames(database, 'pomodoro_sessions')).toEqual(expect.arrayContaining(['date_key', 'started_at']))
  expect(getColumnNames(database, 'mistakes')).toEqual(expect.arrayContaining([
    'ease_factor',
    'review_interval',
    'next_review_date',
    'review_count',
    'image_path',
    'answer_image_path',
  ]))
  expect(getColumnNames(database, 'study_tasks')).toEqual(expect.arrayContaining([
    'title',
    'description',
    'type',
    'subject_id',
    'related_mistake_id',
    'related_entry_id',
    'planned_date',
    'estimate_minutes',
    'status',
    'source',
  ]))

  expect(getPrimaryKeyColumns(database, 'entries')).toEqual(['id'])
  expect(getPrimaryKeyColumns(database, 'tags')).toEqual(['id'])
  expect(getPrimaryKeyColumns(database, 'entry_tags')).toEqual(['entry_id', 'tag_id'])
  expect(getPrimaryKeyColumns(database, 'study_tasks')).toEqual(['id'])
}

function expectLegacyDataPreserved(database: Database.Database, expected: ExpectedLegacyData): void {
  expect(database.prepare('SELECT id, date, title, content, mood, word_count FROM entries WHERE id = ?').get(expected.entry.id))
    .toEqual(expected.entry)
  expect(database.prepare('SELECT tag_id FROM entry_tags WHERE entry_id = ?').get(expected.entry.id))
    .toEqual({ tag_id: expected.tag.id })

  const tag = database.prepare('SELECT id, name, color, icon, variant, pattern FROM tags WHERE id = ?').get(expected.tag.id) as TagRow
  expect(tag).toEqual({
    id: expected.tag.id,
    name: expected.tag.name,
    color: expected.tag.expectedColor,
    icon: expected.tag.expectedIcon,
    variant: expected.tag.expectedVariant,
    pattern: expected.tag.expectedPattern,
  })

  expect(database.prepare('SELECT id, name, color FROM subjects WHERE id = ?').get(expected.subject.id))
    .toEqual({
      id: expected.subject.id,
      name: expected.subject.name,
      color: expected.subject.expectedColor,
    })

  if (expected.attachment) {
    expect(database.prepare('SELECT id, filename, filepath, mimetype FROM attachments WHERE id = ?').get(expected.attachment.id))
      .toEqual(expected.attachment)
  }

  const pomodoro = database.prepare(`
    SELECT id, subject_id, duration, date_key, started_at, completed_at
    FROM pomodoro_sessions
    WHERE id = ?
  `).get(expected.pomodoro.id) as PomodoroRow
  expect(pomodoro).toEqual({
    id: expected.pomodoro.id,
    subject_id: expected.subject.id,
    duration: expected.pomodoro.duration,
    date_key: expected.pomodoro.expectedDateKey,
    started_at: expected.pomodoro.expectedStartedAt,
    completed_at: expected.pomodoro.completed_at,
  })

  const mistake = database.prepare(`
    SELECT id, subject_id, question, answer, notes, mastered, ease_factor, review_interval, next_review_date, review_count, image_path, answer_image_path
    FROM mistakes
    WHERE id = ?
  `).get(expected.mistake.id) as MistakeRow
  expect(mistake).toEqual({
    id: expected.mistake.id,
    subject_id: expected.subject.id,
    question: expected.mistake.question,
    answer: expected.mistake.answer,
    notes: expected.mistake.notes,
    mastered: expected.mistake.mastered,
    ease_factor: expected.mistake.expectedEaseFactor,
    review_interval: expected.mistake.expectedReviewInterval,
    next_review_date: expected.mistake.expectedNextReviewDate,
    review_count: expected.mistake.expectedReviewCount,
    image_path: expected.mistake.expectedImagePath,
    answer_image_path: null,
  })

  expect(database.prepare('SELECT value FROM settings WHERE key = ?').get(expected.setting.key))
    .toEqual({ value: expected.setting.value })

  if (expected.diaryTemplate) {
    expect(database.prepare('SELECT id, name, content, is_default FROM diary_templates WHERE id = ?').get(expected.diaryTemplate.id))
      .toEqual({
        id: expected.diaryTemplate.id,
        name: expected.diaryTemplate.name,
        content: expected.diaryTemplate.content,
        is_default: 0,
      })
  } else {
    expect(getTableCount(database, 'diary_templates')).toBe(expected.expectedDefaultTemplateCount)
  }

  if (expected.studyTask) {
    expect(database.prepare(`
      SELECT id, title, planned_date, status, source, subject_id, related_mistake_id, related_entry_id
      FROM study_tasks
      WHERE id = ?
    `).get(expected.studyTask.id)).toEqual({
      id: expected.studyTask.id,
      title: expected.studyTask.title,
      planned_date: expected.studyTask.planned_date,
      status: expected.studyTask.status,
      source: expected.studyTask.source,
      subject_id: expected.subject.id,
      related_mistake_id: expected.mistake.id,
      related_entry_id: expected.entry.id,
    })
  }
}

function expectPrimaryKeyContinuity(database: Database.Database, expected: ExpectedLegacyData): void {
  const nextEntryId = database.prepare(`
    INSERT INTO entries (date, title, content, mood, word_count)
    VALUES ('2026-05-22', 'post migration entry', 'new content', 'calm', 10)
  `).run().lastInsertRowid
  expect(Number(nextEntryId)).toBeGreaterThan(expected.entry.id)

  const nextTagId = database.prepare("INSERT INTO tags (name, color, icon, variant, pattern) VALUES ('post migration tag', '#0F766E', '', 'soft', 'none')")
    .run().lastInsertRowid
  expect(Number(nextTagId)).toBeGreaterThan(expected.tag.id)

  const nextSubjectId = database.prepare("INSERT INTO subjects (name, color) VALUES ('post migration subject', '#0F766E')")
    .run().lastInsertRowid
  expect(Number(nextSubjectId)).toBeGreaterThan(expected.subject.id)

  const nextPomodoroId = database.prepare(`
    INSERT INTO pomodoro_sessions (subject_id, duration, date_key, started_at, completed_at)
    VALUES (?, 30, '2026-05-22', '2026-05-22 12:00:00', '2026-05-22 12:30:00')
  `).run(expected.subject.id).lastInsertRowid
  expect(Number(nextPomodoroId)).toBeGreaterThan(expected.pomodoro.id)

  const nextMistakeId = database.prepare(`
    INSERT INTO mistakes (subject_id, question, answer, notes, image_path)
    VALUES (?, 'post migration question', 'answer', 'notes', NULL)
  `).run(expected.subject.id).lastInsertRowid
  expect(Number(nextMistakeId)).toBeGreaterThan(expected.mistake.id)

  if (expected.studyTask) {
    const nextTaskId = database.prepare(`
      INSERT INTO study_tasks (title, subject_id, related_mistake_id, related_entry_id, planned_date)
      VALUES ('post migration task', ?, ?, ?, '2026-05-22')
    `).run(expected.subject.id, expected.mistake.id, expected.entry.id).lastInsertRowid
    expect(Number(nextTaskId)).toBeGreaterThan(expected.studyTask.id)
  }
}

function exerciseDatabaseApi(databaseModule: DatabaseModule, expected: ExpectedLegacyData): void {
  expect(databaseModule.CURRENT_SCHEMA_VERSION).toBe(CURRENT_SCHEMA_VERSION)
  expect(databaseModule.getEntryById(expected.entry.id)?.title).toBe(expected.entry.title)

  const entry = databaseModule.createEntry({
    date: '2026-05-24',
    title: 'api entry',
    content: 'api content',
    mood: 'calm',
  })
  const entryId = Number(entry.id)
  expect(databaseModule.getEntryById(entryId)?.content).toBe('api content')

  expect(databaseModule.getAllTags().some(tag => tag.id === expected.tag.id)).toBe(true)
  const tag = databaseModule.createTag({
    name: `api tag ${expected.entry.id}`,
    color: '#0F766E',
    icon: 'api',
    variant: 'outline',
    pattern: 'dots',
  })
  expect(tag.variant).toBe('outline')
  expect(databaseModule.setEntryTags(entryId, [tag.id]).success).toBe(true)
  expect(databaseModule.getEntryTags(entryId).map(row => row.id)).toEqual([tag.id])

  const pomodoro = databaseModule.addPomodoroSession({
    subject_id: expected.subject.id,
    duration: 35,
    date_key: '2026-05-24',
    started_at: '2026-05-24 12:00:00',
    completed_at: '2026-05-24 12:35:00',
  })
  expect(pomodoro.date_key).toBe('2026-05-24')
  expect(databaseModule.getDailyStudyMinutes('2026-05-24')).toBe(35)

  const mistakes = databaseModule.getAllMistakes({ subject_id: expected.subject.id })
  expect(mistakes.data.some(mistake => mistake.id === expected.mistake.id)).toBe(true)
  const mistake = databaseModule.createMistake({
    subject_id: expected.subject.id,
    question: 'api question',
    answer: 'api answer',
    notes: 'api notes',
    image_path: null,
    answer_image_path: 'mistake_images/api-answer.png',
  })
  expect(Number(mistake.id)).toBeGreaterThan(expected.mistake.id)

  const task = databaseModule.createStudyTask({
    title: 'api task',
    planned_date: '2026-05-24',
    subject_id: expected.subject.id,
    related_mistake_id: expected.mistake.id,
    related_entry_id: expected.entry.id,
    estimate_minutes: 25,
  })
  expect(task.title).toBe('api task')
  expect(databaseModule.getStudyTasksByDate('2026-05-24').some(row => row.id === task.id)).toBe(true)
  expect(databaseModule.getAllTemplates().length).toBeGreaterThanOrEqual(expected.expectedDefaultTemplateCount)
}

describe('legacy SQLite fixture provenance', () => {
  it('documents unique real Git refs in historical order', () => {
    expectFixtureProvenance()
    expect(legacyDatabaseFixtures.map(fixture => fixture.sourceRef)).toEqual([
      'v1.4.0',
      'v1.6.0',
      'v1.9.0',
      'v1.9.3',
      'v1.9.7',
    ])
    expect(legacyDatabaseFixtures.length).toBeGreaterThanOrEqual(3)
  })

  it.each(legacyDatabaseFixtures)('keeps $id capability metadata aligned with its source schema', (fixture) => {
    const { database } = prepareFixtureDatabase(fixture)

    expect(getUserVersion(database)).toBe(0)
    expect(getColumnNames(database, 'tags').includes('variant')).toBe(fixture.capabilities.tagStyles)
    expect(getColumnNames(database, 'tags').includes('pattern')).toBe(fixture.capabilities.tagStyles)
    expect(getColumnNames(database, 'pomodoro_sessions').includes('date_key')).toBe(fixture.capabilities.pomodoroDateKey)
    expect(getColumnNames(database, 'pomodoro_sessions').includes('started_at')).toBe(fixture.capabilities.pomodoroStartedAt)
    expect(getColumnNames(database, 'mistakes').includes('ease_factor')).toBe(fixture.capabilities.mistakeReviewColumns)
    expect(getColumnNames(database, 'mistakes').includes('image_path')).toBe(fixture.capabilities.mistakeImagePath)
    expect(tableExists(database, 'diary_templates')).toBe(fixture.capabilities.diaryTemplates)
    expect(tableExists(database, 'study_tasks')).toBe(fixture.capabilities.studyTasks)
  }, REAL_SQLITE_TEST_TIMEOUT_MS)
})

describe('version 1 adoption migration for real historical SQLite schemas', () => {
  it.each(legacyDatabaseFixtures)('migrates $id to the current schema and preserves data', (fixture) => {
    const { database, expected } = prepareFixtureDatabase(fixture)

    expect(getUserVersion(database)).toBe(0)
    expect(runDatabaseMigrations(database)).toBe(2)

    expectCurrentSchema(database)
    expectLegacyDataPreserved(database, expected)
    expectPrimaryKeyContinuity(database, expected)
  }, REAL_SQLITE_TEST_TIMEOUT_MS)

  it.each(legacyDatabaseFixtures)('is idempotent across a second real initialize for $id', async (fixture) => {
    const { database: seedDatabase, expected, filepath, root } = prepareFixtureDatabase(fixture)
    closeTrackedDatabase(seedDatabase)

    const databaseModule = await loadRealDatabaseModule(root)
    databaseModule.setCustomDbPath(filepath)
    databaseModule.initialize()
    const firstDatabase = trackDatabase(databaseModule.getDb())
    expectCurrentSchema(firstDatabase)
    expectLegacyDataPreserved(firstDatabase, expected)
    exerciseDatabaseApi(databaseModule, expected)

    const firstSnapshot = {
      counts: snapshotTableCounts(firstDatabase, CURRENT_TABLES),
      userVersion: getUserVersion(firstDatabase),
      templates: firstDatabase.prepare('SELECT name, is_default FROM diary_templates ORDER BY id').all(),
      entryTags: firstDatabase.prepare('SELECT entry_id, tag_id FROM entry_tags ORDER BY entry_id, tag_id').all(),
      sqliteSequence: firstDatabase.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all(),
    }
    closeTrackedDatabase(firstDatabase)

    databaseModule.initialize()
    const secondDatabase = trackDatabase(databaseModule.getDb())
    expectCurrentSchema(secondDatabase)
    expectLegacyDataPreserved(secondDatabase, expected)
    expect({
      counts: snapshotTableCounts(secondDatabase, CURRENT_TABLES),
      userVersion: getUserVersion(secondDatabase),
      templates: secondDatabase.prepare('SELECT name, is_default FROM diary_templates ORDER BY id').all(),
      entryTags: secondDatabase.prepare('SELECT entry_id, tag_id FROM entry_tags ORDER BY entry_id, tag_id').all(),
      sqliteSequence: secondDatabase.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all(),
    }).toEqual(firstSnapshot)
  }, REAL_SQLITE_TEST_TIMEOUT_MS)

  it('rejects a future-version historical database before adoption mutates it', async () => {
    const fixture = legacyDatabaseFixtures[0]
    expect(fixture).toBeDefined()
    const { database: seedDatabase, expected, filepath, root } = prepareFixtureDatabase(fixture!)
    seedDatabase.pragma('user_version = 3')
    closeTrackedDatabase(seedDatabase)

    const databaseModule = await loadRealDatabaseModule(root)
    databaseModule.setCustomDbPath(filepath)
    expect(() => databaseModule.initialize()).toThrow(/schema version 3.*supported version 2/i)
    expect(() => databaseModule.getDb()).toThrow('Database has not been initialized')

    const reopened = trackDatabase(new BetterSqlite3(filepath))
    expect(getUserVersion(reopened)).toBe(3)
    expect(tableExists(reopened, 'study_tasks')).toBe(false)
    expect(reopened.prepare('SELECT title FROM entries WHERE id = ?').get(expected.entry.id)).toEqual({ title: expected.entry.title })
    expect(fs.existsSync(`${filepath}-wal`)).toBe(false)
  }, REAL_SQLITE_TEST_TIMEOUT_MS)

  it('rolls back schema adoption when a malformed historical database fails migration', () => {
    const fixture = legacyDatabaseFixtures[0]
    expect(fixture).toBeDefined()
    const { database } = prepareFixtureDatabase(fixture!)
    database.exec('DROP TABLE tags')
    database.exec('CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)')
    database.prepare("INSERT INTO tags (id, name) VALUES (201, 'malformed tag')").run()

    expect(() => runDatabaseMigrations(database)).toThrow(/no such column: color/i)

    expect(getUserVersion(database)).toBe(0)
    expect(tableExists(database, 'study_tasks')).toBe(false)
    expect(tableExists(database, 'diary_templates')).toBe(false)
    expect(getColumnNames(database, 'tags')).not.toContain('icon')
  })

  it('keeps schema and backup format constants aligned with the current schema', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2)
    expect(BACKUP_FORMAT_VERSION).toBe(2)
  })
})
