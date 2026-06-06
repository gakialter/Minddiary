// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseRepositories } from '../electron/repositories/databaseRepositoryFactory'
import { getLocalDateKey, toLocalDateTimeString } from '../src/utils/dateKey'
import type Database from 'better-sqlite3'

describe('database repositories', () => {
  let database: Database.Database
  let repositories: ReturnType<typeof createDatabaseRepositories>

  beforeEach(() => {
    database = new BetterSqlite3(':memory:')
    database.pragma('foreign_keys = ON')
    database.exec(`
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        title TEXT,
        content TEXT,
        mood TEXT,
        word_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#0F766E',
        icon TEXT DEFAULT '',
        variant TEXT DEFAULT 'soft',
        pattern TEXT DEFAULT 'none'
      );

      CREATE TABLE entry_tags (
        entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (entry_id, tag_id)
      );

      CREATE TABLE attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER REFERENCES entries(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        mimetype TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT
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
        date_key TEXT,
        started_at DATETIME,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_pomodoro_completed ON pomodoro_sessions(completed_at);
      CREATE INDEX idx_pomodoro_date_key ON pomodoro_sessions(date_key);

      CREATE TABLE mistakes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER REFERENCES subjects(id),
        question TEXT NOT NULL,
        answer TEXT,
        category TEXT DEFAULT '',
        mastered INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE study_tasks (
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
      CREATE INDEX idx_study_tasks_planned_date ON study_tasks(planned_date);
      CREATE INDEX idx_study_tasks_status ON study_tasks(status);
      CREATE INDEX idx_study_tasks_subject_id ON study_tasks(subject_id);

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
    repositories = createDatabaseRepositories(database)
  })

  afterEach(() => {
    vi.useRealTimers()
    database.close()
  })

  it('normalizes, validates, updates, orders, and deletes tags', () => {
    database.prepare(
      'INSERT INTO tags (name, color, icon, variant, pattern) VALUES (?, ?, ?, ?, ?)'
    ).run('zeta', 'not-a-color', null, 'invalid', 'invalid')
    database.prepare(
      'INSERT INTO tags (name, color, icon, variant, pattern) VALUES (?, ?, ?, ?, ?)'
    ).run('alpha', '#0E7490', 'abcde', 'solid', 'dots')

    expect(repositories.tags.getAllTags()).toEqual([
      {
        id: 2,
        name: 'alpha',
        color: '#0E7490',
        icon: 'abcd',
        variant: 'solid',
        pattern: 'dots',
      },
      {
        id: 1,
        name: 'zeta',
        color: '#0F766E',
        icon: '',
        variant: 'soft',
        pattern: 'none',
      },
    ])

    const created = repositories.tags.createTag({
      name: '  beta  ',
      color: ' bad ',
      icon: ' 12345 ',
      variant: 'ghost',
      pattern: 'leaf',
    })
    expect(created).toEqual({
      id: 3,
      name: 'beta',
      color: '#0F766E',
      icon: '1234',
      variant: 'ghost',
      pattern: 'leaf',
    })
    expect(database.prepare('SELECT name, color, icon, variant, pattern FROM tags WHERE id=?').get(created.id)).toEqual({
      name: 'beta',
      color: '#0F766E',
      icon: '1234',
      variant: 'ghost',
      pattern: 'leaf',
    })

    expect(repositories.tags.updateTag(3, { color: '#475569', pattern: 'grid' })).toEqual({
      id: 3,
      name: 'beta',
      color: '#475569',
      icon: '1234',
      variant: 'ghost',
      pattern: 'grid',
    })
    expect(() => repositories.tags.createTag({ name: '   ' })).toThrow('Tag name is required')
    expect(() => repositories.tags.updateTag(404, { name: 'missing' })).toThrow('Tag not found')
    expect(() => repositories.tags.updateTag(3, { name: '   ' })).toThrow('Tag name is required')

    expect(repositories.tags.deleteTag(404)).toEqual({ success: true })
    expect(repositories.tags.deleteTag(1)).toEqual({ success: true })
    expect(repositories.tags.getAllTags().map(tag => tag.name)).toEqual(['alpha', 'beta'])
  })

  it('replaces, clears, reads, and batches entry tags', () => {
    const entry = repositories.entries.createEntry({
      date: '2026-06-06',
      title: 'Tagged',
      content: 'entry',
      mood: 'happy',
    })
    const secondEntry = repositories.entries.createEntry({
      date: '2026-06-07',
      title: 'Second',
      content: 'entry',
      mood: 'calm',
    })
    const alpha = repositories.tags.createTag({ name: 'alpha', color: '#0E7490', icon: 'a', variant: 'solid', pattern: 'dots' })
    const beta = repositories.tags.createTag({ name: 'beta', color: '#475569', icon: 'b', variant: 'outline', pattern: 'grid' })

    expect(repositories.tags.setEntryTags(Number(entry.id), [alpha.id, beta.id])).toEqual({ success: true })
    expect(repositories.tags.getEntryTags(Number(entry.id))).toEqual(expect.arrayContaining([
      alpha,
      beta,
    ]))

    expect(repositories.tags.setEntryTags(Number(entry.id), [beta.id])).toEqual({ success: true })
    expect(repositories.tags.getEntryTags(Number(entry.id))).toEqual([beta])
    expect(repositories.tags.setEntryTags(Number(secondEntry.id), [alpha.id])).toEqual({ success: true })

    expect(repositories.tags.getEntryTagsBatch([
      Number(entry.id),
      Number(entry.id),
      0,
      Number(secondEntry.id),
      Number.NaN,
      999,
    ])).toEqual({
      [Number(entry.id)]: [beta],
      [Number(secondEntry.id)]: [alpha],
      999: [],
    })

    expect(repositories.tags.setEntryTags(Number(entry.id), [])).toEqual({ success: true })
    expect(repositories.tags.getEntryTags(Number(entry.id))).toEqual([])
  })

  it('rolls back entry tag replacement when duplicate tag ids violate the primary key', () => {
    const entry = repositories.entries.createEntry({
      date: '2026-06-06',
      title: 'Tagged',
      content: 'entry',
      mood: 'happy',
    })
    const alpha = repositories.tags.createTag({ name: 'alpha' })
    const beta = repositories.tags.createTag({ name: 'beta' })
    repositories.tags.setEntryTags(Number(entry.id), [alpha.id])

    expect(() => repositories.tags.setEntryTags(Number(entry.id), [beta.id, beta.id])).toThrow()

    expect(repositories.tags.getEntryTags(Number(entry.id))).toEqual([alpha])
    expect(database.prepare(
      'SELECT tag_id FROM entry_tags WHERE entry_id=? ORDER BY tag_id'
    ).all(entry.id)).toEqual([{ tag_id: alpha.id }])
  })

  it('rolls back entry tag replacement when foreign keys reject a tag id', () => {
    const entry = repositories.entries.createEntry({
      date: '2026-06-06',
      title: 'Tagged',
      content: 'entry',
      mood: 'happy',
    })
    const alpha = repositories.tags.createTag({ name: 'alpha' })
    repositories.tags.setEntryTags(Number(entry.id), [alpha.id])

    expect(() => repositories.tags.setEntryTags(Number(entry.id), [999])).toThrow()

    expect(repositories.tags.getEntryTags(Number(entry.id))).toEqual([alpha])
    expect(database.prepare(
      'SELECT tag_id FROM entry_tags WHERE entry_id=? ORDER BY tag_id'
    ).all(entry.id)).toEqual([{ tag_id: alpha.id }])
  })

  it('creates, updates, reads, lists, searches, and deletes entries', () => {
    const first = repositories.entries.createEntry({
      date: '2026-06-06',
      title: 'First',
      content: 'hello world',
      mood: 'happy',
    })
    const second = repositories.entries.createEntry({
      date: '2026-06-07',
      title: 'Second',
      content: 'quiet focus',
      mood: 'calm',
    })
    const tag = repositories.tags.createTag({ name: 'focus' })
    database.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').run(first.id, tag.id)

    expect(first).toEqual({
      id: 1,
      date: '2026-06-06',
      title: 'First',
      content: 'hello world',
      mood: 'happy',
      word_count: 10,
    })
    expect(repositories.entries.getEntryById(Number(first.id))).toEqual(expect.objectContaining({
      id: 1,
      date: '2026-06-06',
      title: 'First',
      content: 'hello world',
      mood: 'happy',
      word_count: 10,
    }))
    expect(repositories.entries.getEntryByDate('2026-06-07')).toEqual(expect.objectContaining({
      id: second.id,
      title: 'Second',
    }))

    const defaultList = repositories.entries.getAllEntries()
    expect(defaultList.map(entry => entry.date)).toEqual(['2026-06-07', '2026-06-06'])
    expect(defaultList[0]).not.toHaveProperty('content')

    expect(repositories.entries.getAllEntries({
      mood: 'happy',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      tagId: tag.id,
      limit: 1,
    })).toEqual([expect.objectContaining({ id: first.id, title: 'First' })])
    expect(repositories.entries.getAllEntries({ includeContent: true, limit: 1 })[0]).toHaveProperty('content')
    expect(repositories.entries.searchEntries('focus')).toEqual([expect.objectContaining({
      id: second.id,
      content_snippet: 'quiet focus',
    })])
    expect(repositories.entries.getDatesWithEntries('2026-06')).toEqual([
      { date: '2026-06-06', mood: 'happy' },
      { date: '2026-06-07', mood: 'calm' },
    ])

    expect(repositories.entries.updateEntry(Number(first.id), {
      title: 'Updated',
      content: 'two words',
      mood: null,
    })).toEqual(expect.objectContaining({
      id: first.id,
      title: 'Updated',
      content: 'two words',
      mood: null,
      word_count: 8,
    }))
    expect(repositories.entries.deleteEntry(Number(second.id))).toEqual({ success: true })
    expect(repositories.entries.getEntryById(Number(second.id))).toBeUndefined()
  })

  it('creates, reads, batches, and removes attachments', () => {
    const firstEntry = repositories.entries.createEntry({
      date: '2026-06-06',
      title: 'First',
      content: 'hello',
      mood: 'happy',
    })
    const secondEntry = repositories.entries.createEntry({
      date: '2026-06-07',
      title: 'Second',
      content: 'world',
      mood: 'calm',
    })

    const firstAttachment = repositories.attachments.addAttachment(Number(firstEntry.id), {
      filename: 'first.png',
      filepath: 'attachments/first.png',
      mimetype: 'image/png',
    })
    const secondAttachment = repositories.attachments.addAttachment(Number(secondEntry.id), {
      filename: 'second.jpg',
      filepath: 'attachments/second.jpg',
      mimetype: 'image/jpeg',
    })

    expect(firstAttachment).toEqual({
      id: 1,
      entry_id: firstEntry.id,
      filename: 'first.png',
      filepath: 'attachments/first.png',
      mimetype: 'image/png',
    })
    expect(repositories.attachments.getAttachmentsByEntry(Number(firstEntry.id))).toEqual([
      expect.objectContaining(firstAttachment),
    ])
    expect(repositories.attachments.getAttachmentById(Number(secondAttachment.id))).toEqual(expect.objectContaining(secondAttachment))
    expect(repositories.attachments.getAttachmentsByEntries([
      Number(firstEntry.id),
      Number(firstEntry.id),
      0,
      Number(secondEntry.id),
      Number.NaN,
    ])).toEqual({
      [Number(firstEntry.id)]: [expect.objectContaining(firstAttachment)],
      [Number(secondEntry.id)]: [expect.objectContaining(secondAttachment)],
    })

    expect(repositories.attachments.removeAttachment(Number(firstAttachment.id))).toEqual({ success: true })
    expect(repositories.attachments.getAttachmentById(Number(firstAttachment.id))).toBeUndefined()
  })

  it('reads, upserts, and lists raw settings values', () => {
    expect(repositories.settings.getSetting('theme')).toBeNull()

    expect(repositories.settings.setSetting('theme', 'dark')).toEqual({ success: true })
    expect(repositories.settings.getSetting('theme')).toBe('dark')

    repositories.settings.setSetting('theme', 'light')
    repositories.settings.setSetting('pomodoroMinutes', '30')

    expect(repositories.settings.getAllSettings()).toEqual({
      theme: 'light',
      pomodoroMinutes: '30',
    })
  })

  it('creates, updates, orders, and deletes subjects with existing defaults', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', total_chapters: 12, color: '#123456' })
    const english = repositories.subjects.createSubject({ name: 'English' })

    expect(math).toEqual({
      id: 1,
      name: 'Math',
      total_chapters: 12,
      completed_chapters: 0,
      color: '#123456',
    })
    expect(english).toEqual({
      id: 2,
      name: 'English',
      total_chapters: 0,
      completed_chapters: 0,
      color: '#0F766E',
    })
    expect(repositories.subjects.getAllSubjects().map(subject => subject.name)).toEqual(['English', 'Math'])

    expect(repositories.subjects.updateSubject(1, {
      name: 'Advanced Math',
      total_chapters: 18,
      completed_chapters: 5,
      color: '#654321',
    })).toEqual({
      id: 1,
      name: 'Advanced Math',
      total_chapters: 18,
      completed_chapters: 5,
      color: '#654321',
    })
    expect(database.prepare('SELECT name, total_chapters, completed_chapters, color FROM subjects WHERE id=?').get(1)).toEqual({
      name: 'Advanced Math',
      total_chapters: 18,
      completed_chapters: 5,
      color: '#654321',
    })

    expect(repositories.subjects.deleteSubject(2)).toEqual({ success: true })
    expect(repositories.subjects.getAllSubjects().map(subject => subject.name)).toEqual(['Advanced Math'])
  })

  it('adds pomodoro sessions with explicit fields and preserves stored values', () => {
    const subject = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })

    expect(repositories.pomodoro.addPomodoroSession({
      subject_id: Number(subject.id),
      duration: 25,
      date_key: '2026-06-06',
      started_at: ' 2026-06-06 09:00:00 ',
      completed_at: ' 2026-06-06 09:25:00 ',
    })).toEqual({
      id: 1,
      date_key: '2026-06-06',
      started_at: '2026-06-06 09:00:00',
      completed_at: '2026-06-06 09:25:00',
    })

    expect(database.prepare(
      'SELECT subject_id, duration, date_key, started_at, completed_at FROM pomodoro_sessions WHERE id=?'
    ).get(1)).toEqual({
      subject_id: Number(subject.id),
      duration: 25,
      date_key: '2026-06-06',
      started_at: '2026-06-06 09:00:00',
      completed_at: '2026-06-06 09:25:00',
    })
  })

  it('keeps zero subject ids as null and falls back to the started_at local date', () => {
    const startedAt = '2026-06-08 12:30:00'
    const completedAt = '2026-06-08 12:55:00'

    const result = repositories.pomodoro.addPomodoroSession({
      subject_id: 0,
      duration: 25,
      date_key: 'not-a-date',
      started_at: startedAt,
      completed_at: completedAt,
    })

    expect(result).toEqual({
      id: 1,
      date_key: getLocalDateKey(new Date(startedAt)),
      started_at: startedAt,
      completed_at: completedAt,
    })
    expect(database.prepare(
      'SELECT subject_id, date_key, started_at, completed_at FROM pomodoro_sessions WHERE id=?'
    ).get(1)).toEqual({
      subject_id: null,
      date_key: getLocalDateKey(new Date(startedAt)),
      started_at: startedAt,
      completed_at: completedAt,
    })
  })

  it('uses the current local date and datetime when optional pomodoro timestamps are blank', () => {
    const now = new Date(2026, 5, 9, 12, 34, 56)
    vi.useFakeTimers()
    vi.setSystemTime(now)

    expect(repositories.pomodoro.addPomodoroSession({
      subject_id: null,
      duration: 15,
      date_key: undefined,
      started_at: '   ',
      completed_at: '   ',
    })).toEqual({
      id: 1,
      date_key: getLocalDateKey(now),
      started_at: null,
      completed_at: toLocalDateTimeString(now),
    })
  })

  it('aggregates daily pomodoro stats by subject without adding ordering', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const english = repositories.subjects.createSubject({ name: 'English', color: '#854D0E' })
    const insertSession = database.prepare(
      'INSERT INTO pomodoro_sessions (subject_id, duration, date_key) VALUES (?, ?, ?)'
    )
    insertSession.run(Number(math.id), 25, '2026-06-06')
    insertSession.run(Number(math.id), 50, '2026-06-06')
    insertSession.run(Number(english.id), 30, '2026-06-06')
    insertSession.run(null, 10, '2026-06-06')
    insertSession.run(Number(math.id), 100, '2026-06-07')

    expect(repositories.pomodoro.getPomodoroStats('2026-06-06')).toEqual(expect.arrayContaining([
      { subject_name: 'Math', color: '#0F766E', total_minutes: 75, session_count: 2 },
      { subject_name: 'English', color: '#854D0E', total_minutes: 30, session_count: 1 },
      { subject_name: null, color: null, total_minutes: 10, session_count: 1 },
    ]))
  })

  it('aggregates range pomodoro stats by subject ordered by total minutes descending', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const english = repositories.subjects.createSubject({ name: 'English', color: '#854D0E' })
    const insertSession = database.prepare(
      'INSERT INTO pomodoro_sessions (subject_id, duration, date_key) VALUES (?, ?, ?)'
    )
    insertSession.run(Number(math.id), 25, '2026-06-01')
    insertSession.run(Number(math.id), 50, '2026-06-02')
    insertSession.run(Number(english.id), 30, '2026-06-03')
    insertSession.run(null, 10, '2026-06-04')
    insertSession.run(Number(english.id), 100, '2026-07-01')

    expect(repositories.pomodoro.getPomodoroStatsRange('2026-06-01', '2026-06-30')).toEqual([
      { subject_name: 'Math', color: '#0F766E', total_minutes: 75, session_count: 2 },
      { subject_name: 'English', color: '#854D0E', total_minutes: 30, session_count: 1 },
      { subject_name: null, color: null, total_minutes: 10, session_count: 1 },
    ])
  })

  it('returns daily study minutes and zero when no pomodoro sessions exist', () => {
    const insertSession = database.prepare(
      'INSERT INTO pomodoro_sessions (subject_id, duration, date_key) VALUES (?, ?, ?)'
    )
    insertSession.run(null, 25, '2026-06-06')
    insertSession.run(null, 35, '2026-06-06')
    insertSession.run(null, 45, '2026-06-07')

    expect(repositories.pomodoro.getDailyStudyMinutes('2026-06-06')).toBe(60)
    expect(repositories.pomodoro.getDailyStudyMinutes('2026-06-08')).toBe(0)
  })

  it('aggregates pomodoro sessions by date over an inclusive range without zero filling', () => {
    const insertSession = database.prepare(
      'INSERT INTO pomodoro_sessions (subject_id, duration, date_key) VALUES (?, ?, ?)'
    )
    insertSession.run(null, 25, '2026-06-01')
    insertSession.run(null, 35, '2026-06-01')
    insertSession.run(null, 45, '2026-06-03')
    insertSession.run(null, 50, '2026-06-05')

    expect(repositories.pomodoro.getPomodoroRange('2026-06-01', '2026-06-03')).toEqual([
      { date: '2026-06-01', total_minutes: 60, session_count: 2 },
      { date: '2026-06-03', total_minutes: 45, session_count: 1 },
    ])
    expect(repositories.pomodoro.getPomodoroRange('2026-06-06', '2026-06-07')).toEqual([])
  })

  it('creates study tasks with defaults and complete stored rows', () => {
    const subject = repositories.subjects.createSubject({ name: 'Math' })
    const entry = database.prepare(
      'INSERT INTO entries (date, title, content, mood, word_count) VALUES (?, ?, ?, ?, ?)'
    ).run('2026-06-10', 'Entry', 'content', null, 1)
    const mistake = database.prepare(
      'INSERT INTO mistakes (subject_id, question, answer) VALUES (?, ?, ?)'
    ).run(Number(subject.id), 'Question', 'Answer')

    const created = repositories.studyTasks.createStudyTask({
      title: '  Review wrong answers  ',
      description: '  keep edge spaces  ',
      type: '' as never,
      subject_id: String(subject.id) as never,
      related_mistake_id: true as never,
      related_entry_id: String(entry.lastInsertRowid) as never,
      planned_date: '2026-99-99',
      estimate_minutes: '' as never,
      status: '' as never,
      source: '' as never,
    })

    expect(created).toEqual(expect.objectContaining({
      id: 1,
      title: 'Review wrong answers',
      description: '  keep edge spaces  ',
      type: 'custom',
      subject_id: Number(subject.id),
      related_mistake_id: Number(mistake.lastInsertRowid),
      related_entry_id: Number(entry.lastInsertRowid),
      planned_date: '2026-99-99',
      estimate_minutes: 25,
      status: 'todo',
      source: 'manual',
    }))
    expect(created.created_at).toEqual(expect.any(String))
    expect(created.updated_at).toEqual(expect.any(String))
  })

  it('validates study task title, date, enums, related ids, estimate, and task ids', () => {
    expect(() => repositories.studyTasks.createStudyTask({
      title: 42 as never,
      planned_date: '2026-06-10',
    })).toThrow('Task title is required')
    expect(() => repositories.studyTasks.createStudyTask({
      title: 'Invalid date',
      planned_date: '06/10/2026',
    })).toThrow('planned_date must be YYYY-MM-DD')
    expect(() => repositories.studyTasks.createStudyTask({
      title: 'Invalid type',
      planned_date: '2026-06-10',
      type: ' REVIEW ' as never,
    })).toThrow('Invalid task type')
    expect(() => repositories.studyTasks.createStudyTask({
      title: 'Invalid status',
      planned_date: '2026-06-10',
      status: 'archived' as never,
    })).toThrow('Invalid task status')
    expect(() => repositories.studyTasks.createStudyTask({
      title: 'Invalid source',
      planned_date: '2026-06-10',
      source: 'timer' as never,
    })).toThrow('Invalid task source')
    expect(() => repositories.studyTasks.createStudyTask({
      title: 'Invalid relation',
      planned_date: '2026-06-10',
      subject_id: false as never,
    })).toThrow('Task related ids must be positive integers')
    expect(() => repositories.studyTasks.createStudyTask({
      title: 'Invalid estimate',
      planned_date: '2026-06-10',
      estimate_minutes: 2.5 as never,
    })).toThrow('estimate_minutes must be a positive integer')
    expect(() => repositories.studyTasks.updateStudyTask('1' as never, { title: 'bad id' })).toThrow('Task id must be a positive integer')
  })

  it('preserves study task foreign key failures from SQLite', () => {
    expect(() => repositories.studyTasks.createStudyTask({
      title: 'Missing subject',
      planned_date: '2026-06-10',
      subject_id: 999,
    })).toThrow(/FOREIGN KEY constraint failed/)
  })

  it('orders study tasks by status priority, creation time, and id', () => {
    const insertTask = database.prepare(`
      INSERT INTO study_tasks (title, type, planned_date, estimate_minutes, status, source, created_at, updated_at)
      VALUES (?, 'custom', ?, 25, ?, ?, ?, ?)
    `)
    insertTask.run('done', '2026-06-10', 'done', 'manual', '2026-06-10 08:00:00', '2026-06-10 08:00:00')
    insertTask.run('todo later', '2026-06-10', 'todo', 'manual', '2026-06-10 09:00:00', '2026-06-10 09:00:00')
    insertTask.run('unknown', '2026-06-10', 'blocked', 'manual', '2026-06-10 07:00:00', '2026-06-10 07:00:00')
    insertTask.run('skipped', '2026-06-10', 'skipped', 'manual', '2026-06-10 07:00:00', '2026-06-10 07:00:00')
    insertTask.run('doing', '2026-06-10', 'doing', 'manual', '2026-06-10 10:00:00', '2026-06-10 10:00:00')
    insertTask.run('todo earlier', '2026-06-10', 'todo', 'manual', '2026-06-10 08:00:00', '2026-06-10 08:00:00')
    insertTask.run('other date', '2026-06-11', 'doing', 'manual', '2026-06-11 08:00:00', '2026-06-11 08:00:00')

    expect(repositories.studyTasks.getStudyTasksByDate('2026-06-10').map(task => task.title)).toEqual([
      'doing',
      'todo earlier',
      'todo later',
      'skipped',
      'done',
      'unknown',
    ])
  })

  it('updates study tasks with stable field order and preserves empty patch behavior', () => {
    const subject = repositories.subjects.createSubject({ name: 'Math' })
    const entry = database.prepare(
      'INSERT INTO entries (date, title, content, mood, word_count) VALUES (?, ?, ?, ?, ?)'
    ).run('2026-06-10', 'Entry', 'content', null, 1)
    const mistake = database.prepare(
      'INSERT INTO mistakes (subject_id, question, answer) VALUES (?, ?, ?)'
    ).run(Number(subject.id), 'Question', 'Answer')
    const created = repositories.studyTasks.createStudyTask({
      title: 'Original',
      planned_date: '2026-06-10',
    })

    const emptyPatchResult = repositories.studyTasks.updateStudyTask(created.id, {})
    expect(emptyPatchResult).toEqual(created)

    const updated = repositories.studyTasks.updateStudyTask(created.id, {
      title: '  Updated  ',
      description: null as never,
      type: 'review',
      subject_id: String(subject.id) as never,
      related_mistake_id: String(mistake.lastInsertRowid) as never,
      related_entry_id: String(entry.lastInsertRowid) as never,
      planned_date: '2026-06-11',
      estimate_minutes: '30' as never,
      status: 'doing',
      source: 'dashboard',
    })

    expect(updated).toEqual(expect.objectContaining({
      id: created.id,
      title: 'Updated',
      description: '',
      type: 'review',
      subject_id: Number(subject.id),
      related_mistake_id: Number(mistake.lastInsertRowid),
      related_entry_id: Number(entry.lastInsertRowid),
      planned_date: '2026-06-11',
      estimate_minutes: 30,
      status: 'doing',
      source: 'dashboard',
    }))
  })

  it('returns delete booleans and complete/skip delegated updates', () => {
    const created = repositories.studyTasks.createStudyTask({
      title: 'Task',
      planned_date: '2026-06-10',
      estimate_minutes: true as never,
    })
    expect(created.estimate_minutes).toBe(1)

    expect(repositories.studyTasks.completeStudyTask(created.id)).toEqual(expect.objectContaining({ status: 'done' }))
    expect(repositories.studyTasks.skipStudyTask(created.id)).toEqual(expect.objectContaining({ status: 'skipped' }))
    expect(repositories.studyTasks.deleteStudyTask(999)).toBe(false)
    expect(repositories.studyTasks.deleteStudyTask(created.id)).toBe(true)
    expect(() => repositories.studyTasks.updateStudyTask(created.id, { title: 'Missing' })).toThrow('Task not found')
  })

  it('creates, updates, orders, and protects diary templates', () => {
    database.prepare(
      'INSERT INTO diary_templates (name, content, is_default, sort_order) VALUES (?, ?, 1, ?)'
    ).run('Default', '# Default', 1)

    const created = repositories.templates.createTemplate({ name: 'Custom' })
    expect(created).toEqual({
      id: 2,
      name: 'Custom',
      content: '',
      is_default: 0,
      sort_order: 99,
    })
    expect(repositories.templates.getAllTemplates().map(template => template.name)).toEqual(['Default', 'Custom'])

    expect(repositories.templates.updateTemplate(2, { content: '# Custom', sort_order: 2 })).toEqual(expect.objectContaining({
      id: 2,
      name: 'Custom',
      content: '# Custom',
      is_default: 0,
      sort_order: 2,
    }))
    expect(repositories.templates.getAllTemplates().map(template => template.name)).toEqual(['Default', 'Custom'])

    expect(repositories.templates.deleteTemplate(1)).toEqual({ success: false, message: '默认模板不可删除' })
    expect(repositories.templates.getAllTemplates().map(template => template.name)).toEqual(['Default', 'Custom'])

    expect(repositories.templates.deleteTemplate(2)).toEqual({ success: true })
    expect(repositories.templates.getAllTemplates().map(template => template.name)).toEqual(['Default'])
  })
})
