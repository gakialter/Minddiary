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

      CREATE TABLE subject_chapters (
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
      CREATE INDEX idx_subject_chapters_subject_id ON subject_chapters(subject_id);
      CREATE INDEX idx_subject_chapters_subject_order ON subject_chapters(subject_id, sort_order);

      CREATE TABLE pomodoro_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER REFERENCES subjects(id),
        task_id INTEGER REFERENCES study_tasks(id) ON DELETE SET NULL,
        duration INTEGER NOT NULL,
        date_key TEXT,
        started_at DATETIME,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_pomodoro_completed ON pomodoro_sessions(completed_at);
      CREATE INDEX idx_pomodoro_date_key ON pomodoro_sessions(date_key);
      CREATE INDEX idx_pomodoro_task_id ON pomodoro_sessions(task_id);

      CREATE TABLE mistakes (
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
        image_path TEXT,
        answer_image_path TEXT
      );

      CREATE TABLE study_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        type TEXT NOT NULL DEFAULT 'custom',
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        related_mistake_id INTEGER REFERENCES mistakes(id) ON DELETE SET NULL,
        related_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
        related_chapter_id INTEGER REFERENCES subject_chapters(id) ON DELETE SET NULL,
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
      CREATE INDEX idx_study_tasks_related_chapter_id ON study_tasks(related_chapter_id);

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

  function insertMistake(overrides: Partial<{
    subject_id: number | null
    question: string
    answer: string | null
    notes: string | null
    mastered: number
    created_at: string
    updated_at: string
    ease_factor: number
    review_interval: number
    next_review_date: string | null
    review_count: number
    image_path: string | null
    answer_image_path: string | null
  }> = {}) {
    const row = {
      subject_id: null,
      question: 'Question',
      answer: 'Answer',
      notes: '',
      mastered: 0,
      created_at: '2026-06-01 08:00:00',
      updated_at: '2026-06-01 08:00:00',
      ease_factor: 2.5,
      review_interval: 1,
      next_review_date: null,
      review_count: 0,
      image_path: null,
      answer_image_path: null,
      ...overrides,
    }
    const result = database.prepare(`
      INSERT INTO mistakes (
        subject_id,
        question,
        answer,
        notes,
        mastered,
        created_at,
        updated_at,
        ease_factor,
        review_interval,
        next_review_date,
        review_count,
        image_path,
        answer_image_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.subject_id,
      row.question,
      row.answer,
      row.notes,
      row.mastered,
      row.created_at,
      row.updated_at,
      row.ease_factor,
      row.review_interval,
      row.next_review_date,
      row.review_count,
      row.image_path,
      row.answer_image_path,
    )
    return Number(result.lastInsertRowid)
  }

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

    expect(repositories.entries.updateEntry(Number(first.id), {
      title: 'Retitled only',
    })).toEqual(expect.objectContaining({
      id: first.id,
      title: 'Retitled only',
      content: 'two words',
      mood: null,
      word_count: 8,
    }))
    expect(repositories.entries.updateEntry(Number(first.id), {
      content: 'three words now',
    })).toEqual(expect.objectContaining({
      id: first.id,
      title: 'Retitled only',
      content: 'three words now',
      mood: null,
      word_count: 13,
    }))
    expect(repositories.entries.deleteEntry(Number(second.id))).toEqual({ success: true })
    expect(repositories.entries.getEntryById(Number(second.id))).toBeUndefined()
  })

  it('clears study task entry links through the Electron foreign key when entries are deleted', () => {
    const entry = repositories.entries.createEntry({
      date: '2026-06-06',
      title: 'Linked',
      content: 'valid diary body',
      mood: 'happy',
    })
    const task = repositories.studyTasks.createStudyTask({
      title: 'Write linked diary',
      type: 'diary',
      planned_date: '2026-06-06',
      related_entry_id: Number(entry.id),
      status: 'done',
    })

    expect(repositories.entries.deleteEntry(Number(entry.id))).toEqual({ success: true })

    expect(repositories.studyTasks.findStudyTasks({ planned_date: '2026-06-06' })).toEqual([
      expect.objectContaining({
        id: task.id,
        related_entry_id: null,
        status: 'done',
      }),
    ])
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

  it('creates, patches, toggles, reorders, and deletes detailed subject chapters with synced summaries', () => {
    const subject = repositories.subjects.createSubject({
      name: 'Math',
      total_chapters: 8,
      completed_chapters: 3,
      color: '#0F766E',
    })
    const subjectId = Number(subject.id)

    const first = repositories.subjectChapters.createChapter({
      subject_id: subjectId,
      title: '  第一章   函数  ',
      notes: '  limits  ',
      completed: true,
    })
    const second = repositories.subjectChapters.createChapter({
      subject_id: subjectId,
      title: '第一章 函数',
      notes: '',
      completed: false,
    })
    const bulk = repositories.subjectChapters.bulkCreateChapters({
      subject_id: subjectId,
      chapters: [
        { title: '第二章 导数' },
        { title: '第三章 积分', completed: true },
        { title: '第二章 导数' },
      ],
    })

    expect(first).toEqual(expect.objectContaining({
      subject_id: subjectId,
      title: '第一章 函数',
      notes: 'limits',
      completed: true,
      sort_order: 0,
    }))
    expect(second.title).toBe('第一章 函数')
    expect(bulk.map(chapter => chapter.title)).toEqual(['第二章 导数', '第三章 积分'])
    expect(repositories.subjectChapters.getBySubject(subjectId).map(chapter => chapter.title)).toEqual([
      '第一章 函数',
      '第一章 函数',
      '第二章 导数',
      '第三章 积分',
    ])
    expect(database.prepare('SELECT total_chapters, completed_chapters FROM subjects WHERE id = ?').get(subjectId)).toEqual({
      total_chapters: 4,
      completed_chapters: 2,
    })

    const patched = repositories.subjectChapters.patchChapter(second.id, { notes: 'keep title' })
    expect(patched).toEqual(expect.objectContaining({
      title: '第一章 函数',
      notes: 'keep title',
      completed: false,
    }))
    expect(repositories.subjectChapters.toggleChapterCompleted(second.id, true)).toEqual(expect.objectContaining({ completed: true }))
    expect(database.prepare('SELECT total_chapters, completed_chapters FROM subjects WHERE id = ?').get(subjectId)).toEqual({
      total_chapters: 4,
      completed_chapters: 3,
    })

    const ordered = repositories.subjectChapters.reorderChapters(subjectId, [
      bulk[1]!.id,
      bulk[0]!.id,
      second.id,
      first.id,
    ])
    expect(ordered.map(chapter => chapter.title)).toEqual([
      '第三章 积分',
      '第二章 导数',
      '第一章 函数',
      '第一章 函数',
    ])
    expect(() => repositories.subjectChapters.reorderChapters(subjectId, [first.id])).toThrow('chapterIds must include each subject chapter exactly once')

    expect(repositories.subjectChapters.deleteChapter(bulk[0]!.id)).toEqual({ success: true })
    expect(database.prepare('SELECT total_chapters, completed_chapters FROM subjects WHERE id = ?').get(subjectId)).toEqual({
      total_chapters: 3,
      completed_chapters: 3,
    })
  })

  it('converts legacy summary subjects transactionally and preserves summary when exiting detailed mode', () => {
    const summarySubject = repositories.subjects.createSubject({
      name: 'Legacy Math',
      total_chapters: 5,
      completed_chapters: 2,
      color: '#0F766E',
    })
    const summarySubjectId = Number(summarySubject.id)
    database.prepare('UPDATE subjects SET completed_chapters = 2 WHERE id = ?').run(summarySubjectId)

    expect(repositories.subjectChapters.clearDetailedChapters(summarySubjectId)).toEqual(expect.objectContaining({
      id: summarySubjectId,
      total_chapters: 5,
      completed_chapters: 2,
    }))
    expect(database.prepare('SELECT total_chapters, completed_chapters FROM subjects WHERE id = ?').get(summarySubjectId)).toEqual({
      total_chapters: 5,
      completed_chapters: 2,
    })

    const converted = repositories.subjectChapters.convertSubjectToDetailedChapters({
      subject_id: summarySubjectId,
      markCompletedCount: 2,
      chapters: [
        { title: '第一章 函数' },
        { title: '第二章 导数' },
        { title: '第三章 积分' },
      ],
    })

    expect(converted.map(chapter => ({ title: chapter.title, completed: chapter.completed }))).toEqual([
      { title: '第一章 函数', completed: true },
      { title: '第二章 导数', completed: true },
      { title: '第三章 积分', completed: false },
    ])
    expect(database.prepare('SELECT total_chapters, completed_chapters FROM subjects WHERE id = ?').get(summarySubjectId)).toEqual({
      total_chapters: 3,
      completed_chapters: 2,
    })
    expect(() => repositories.subjectChapters.convertSubjectToDetailedChapters({
      subject_id: summarySubjectId,
      markCompletedCount: 0,
      chapters: [{ title: 'Already detailed' }],
    })).toThrow('Subject already has detailed chapters')

    const cleared = repositories.subjectChapters.clearDetailedChapters(summarySubjectId)
    expect(cleared).toEqual(expect.objectContaining({
      id: summarySubjectId,
      total_chapters: 3,
      completed_chapters: 2,
    }))
    expect(repositories.subjectChapters.getBySubject(summarySubjectId)).toEqual([])
    expect(database.prepare('SELECT total_chapters, completed_chapters FROM subjects WHERE id = ?').get(summarySubjectId)).toEqual({
      total_chapters: 3,
      completed_chapters: 2,
    })
  })

  it('rolls back detailed chapter conversion failures without changing legacy summary progress', () => {
    const subject = repositories.subjects.createSubject({
      name: 'Physics',
      total_chapters: 4,
      color: '#0F766E',
    })
    const subjectId = Number(subject.id)
    database.prepare('UPDATE subjects SET completed_chapters = 3 WHERE id = ?').run(subjectId)
    database.exec(`
      CREATE TRIGGER fail_subject_chapter_insert
      BEFORE INSERT ON subject_chapters
      WHEN NEW.title = 'Boom'
      BEGIN
        SELECT RAISE(ABORT, 'chapter insert failed');
      END;
    `)

    expect(() => repositories.subjectChapters.convertSubjectToDetailedChapters({
      subject_id: subjectId,
      markCompletedCount: 1,
      chapters: [{ title: 'First' }, { title: 'Boom' }],
    })).toThrow('chapter insert failed')

    expect(repositories.subjectChapters.getBySubject(subjectId)).toEqual([])
    expect(database.prepare('SELECT total_chapters, completed_chapters FROM subjects WHERE id = ?').get(subjectId)).toEqual({
      total_chapters: 4,
      completed_chapters: 3,
    })
  })

  it('cascades detailed chapters on subject deletion while preserving related history rows', () => {
    const subject = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const subjectId = Number(subject.id)
    const chapter = repositories.subjectChapters.createChapter({
      subject_id: subjectId,
      title: '第一章 函数',
      completed: true,
    })
    const mistakeId = insertMistake({ subject_id: subjectId, question: 'Math question' })
    const pomodoroId = Number(database.prepare(`
      INSERT INTO pomodoro_sessions (subject_id, duration, date_key, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(subjectId, 25, '2026-06-07', '2026-06-07 09:00:00', '2026-06-07 09:25:00').lastInsertRowid)
    const task = repositories.studyTasks.createStudyTask({
      title: 'Math task',
      subject_id: subjectId,
      related_chapter_id: chapter.id,
      planned_date: '2026-06-07',
    })

    expect(repositories.subjects.deleteSubject(subjectId)).toEqual({ success: true })

    expect(database.prepare('SELECT id FROM subject_chapters WHERE id = ?').get(chapter.id)).toBeUndefined()
    expect(database.prepare('SELECT subject_id FROM mistakes WHERE id = ?').get(mistakeId)).toEqual({ subject_id: null })
    expect(database.prepare('SELECT subject_id FROM pomodoro_sessions WHERE id = ?').get(pomodoroId)).toEqual({ subject_id: null })
    expect(database.prepare('SELECT subject_id, related_chapter_id FROM study_tasks WHERE id = ?').get(task.id)).toEqual({
      subject_id: null,
      related_chapter_id: null,
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('validates chapter-attributed tasks and clears attribution when a chapter is deleted', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const english = repositories.subjects.createSubject({ name: 'English', color: '#854D0E' })
    const mathChapter = repositories.subjectChapters.createChapter({
      subject_id: Number(math.id),
      title: '第一章 函数',
    })

    const task = repositories.studyTasks.createStudyTask({
      title: '学习：第一章 函数',
      type: 'focus',
      subject_id: Number(math.id),
      related_chapter_id: mathChapter.id,
      planned_date: '2026-06-21',
      source: 'manual',
    })
    expect(task.related_chapter_id).toBe(mathChapter.id)
    expect(repositories.studyTasks.findStudyTasks({
      planned_date: '2026-06-21',
      related_chapter_id: mathChapter.id,
    })).toEqual([expect.objectContaining({ id: task.id, related_chapter_id: mathChapter.id })])

    expect(() => repositories.studyTasks.createStudyTask({
      title: 'Missing chapter',
      subject_id: Number(math.id),
      related_chapter_id: 999,
      planned_date: '2026-06-21',
    })).toThrow('Chapter not found')
    expect(() => repositories.studyTasks.createStudyTask({
      title: 'Cross-subject chapter',
      subject_id: Number(english.id),
      related_chapter_id: mathChapter.id,
      planned_date: '2026-06-21',
    })).toThrow('Task subject must match chapter subject')
    expect(() => repositories.studyTasks.updateStudyTask(task.id, { subject_id: Number(english.id) })).toThrow(
      'Task subject must match chapter subject',
    )

    repositories.subjectChapters.deleteChapter(mathChapter.id)
    expect(repositories.studyTasks.findStudyTasks({ planned_date: '2026-06-21' })).toEqual([
      expect.objectContaining({ id: task.id, related_chapter_id: null }),
    ])
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('deletes subjects by clearing related history subject ids without deleting history', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const english = repositories.subjects.createSubject({ name: 'English', color: '#854D0E' })
    const mathId = Number(math.id)
    const englishId = Number(english.id)

    const mistakeId = insertMistake({
      subject_id: mathId,
      question: 'Math question',
      answer: 'Math answer',
      notes: 'Keep these notes',
      mastered: 1,
      ease_factor: 2.2,
      review_interval: 7,
      next_review_date: '2026-06-12',
      review_count: 3,
      image_path: 'mistakes/math.png',
    })
    const englishMistakeId = insertMistake({ subject_id: englishId, question: 'English question' })
    const pomodoroId = Number(database.prepare(`
      INSERT INTO pomodoro_sessions (subject_id, duration, date_key, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      mathId,
      50,
      '2026-06-07',
      '2026-06-07 09:00:00',
      '2026-06-07 09:50:00',
    ).lastInsertRowid)
    const englishPomodoroId = Number(database.prepare(`
      INSERT INTO pomodoro_sessions (subject_id, duration, date_key, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      englishId,
      25,
      '2026-06-07',
      '2026-06-07 10:00:00',
      '2026-06-07 10:25:00',
    ).lastInsertRowid)
    const task = repositories.studyTasks.createStudyTask({
      title: 'Math review task',
      description: 'Keep task detail',
      type: 'review',
      subject_id: mathId,
      planned_date: '2026-06-07',
      estimate_minutes: 45,
      status: 'doing',
      source: 'dashboard',
    })
    const englishTask = repositories.studyTasks.createStudyTask({
      title: 'English review task',
      subject_id: englishId,
      planned_date: '2026-06-07',
    })

    expect(repositories.subjects.deleteSubject(mathId)).toEqual({ success: true })

    expect(repositories.subjects.getAllSubjects().map(subject => subject.name)).toEqual(['English'])
    expect(database.prepare(`
      SELECT subject_id, question, answer, notes, mastered, ease_factor, review_interval, next_review_date, review_count, image_path
      FROM mistakes WHERE id = ?
    `).get(mistakeId)).toEqual({
      subject_id: null,
      question: 'Math question',
      answer: 'Math answer',
      notes: 'Keep these notes',
      mastered: 1,
      ease_factor: 2.2,
      review_interval: 7,
      next_review_date: '2026-06-12',
      review_count: 3,
      image_path: 'mistakes/math.png',
    })
    expect(database.prepare('SELECT subject_id FROM mistakes WHERE id = ?').get(englishMistakeId)).toEqual({
      subject_id: englishId,
    })
    expect(database.prepare(`
      SELECT subject_id, duration, date_key, started_at, completed_at
      FROM pomodoro_sessions WHERE id = ?
    `).get(pomodoroId)).toEqual({
      subject_id: null,
      duration: 50,
      date_key: '2026-06-07',
      started_at: '2026-06-07 09:00:00',
      completed_at: '2026-06-07 09:50:00',
    })
    expect(database.prepare('SELECT subject_id FROM pomodoro_sessions WHERE id = ?').get(englishPomodoroId)).toEqual({
      subject_id: englishId,
    })
    expect(database.prepare(`
      SELECT title, description, type, subject_id, planned_date, estimate_minutes, status, source
      FROM study_tasks WHERE id = ?
    `).get(task.id)).toEqual({
      title: 'Math review task',
      description: 'Keep task detail',
      type: 'review',
      subject_id: null,
      planned_date: '2026-06-07',
      estimate_minutes: 45,
      status: 'doing',
      source: 'dashboard',
    })
    expect(database.prepare('SELECT subject_id FROM study_tasks WHERE id = ?').get(englishTask.id)).toEqual({
      subject_id: englishId,
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('keeps existing subjects and related history unchanged when deleting a missing subject id', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const mathId = Number(math.id)
    const mistakeId = insertMistake({ subject_id: mathId, question: 'Math question' })
    const pomodoroId = Number(database.prepare(`
      INSERT INTO pomodoro_sessions (subject_id, duration, date_key, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      mathId,
      25,
      '2026-06-07',
      '2026-06-07 09:00:00',
      '2026-06-07 09:25:00',
    ).lastInsertRowid)
    const task = repositories.studyTasks.createStudyTask({
      title: 'Math review task',
      subject_id: mathId,
      planned_date: '2026-06-07',
    })

    expect(repositories.subjects.deleteSubject(999)).toEqual({ success: true })

    expect(repositories.subjects.getAllSubjects()).toEqual([math])
    expect(database.prepare('SELECT subject_id, question FROM mistakes WHERE id = ?').get(mistakeId)).toEqual({
      subject_id: mathId,
      question: 'Math question',
    })
    expect(database.prepare('SELECT subject_id, duration, date_key, started_at, completed_at FROM pomodoro_sessions WHERE id = ?').get(pomodoroId)).toEqual({
      subject_id: mathId,
      duration: 25,
      date_key: '2026-06-07',
      started_at: '2026-06-07 09:00:00',
      completed_at: '2026-06-07 09:25:00',
    })
    expect(database.prepare('SELECT subject_id, title, planned_date FROM study_tasks WHERE id = ?').get(task.id)).toEqual({
      subject_id: mathId,
      title: 'Math review task',
      planned_date: '2026-06-07',
    })
  })

  it('rolls back subject history unlinking when subject deletion fails mid-transaction', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const mathId = Number(math.id)
    const mistakeId = insertMistake({ subject_id: mathId, question: 'Math question' })
    const pomodoroId = Number(database.prepare(`
      INSERT INTO pomodoro_sessions (subject_id, duration, date_key)
      VALUES (?, ?, ?)
    `).run(mathId, 25, '2026-06-07').lastInsertRowid)
    const task = repositories.studyTasks.createStudyTask({
      title: 'Math review task',
      subject_id: mathId,
      planned_date: '2026-06-07',
    })

    database.exec(`
      CREATE TRIGGER fail_pomodoro_subject_unlink
      BEFORE UPDATE OF subject_id ON pomodoro_sessions
      WHEN NEW.subject_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'pomodoro subject unlink failed');
      END;
    `)

    expect(() => repositories.subjects.deleteSubject(mathId)).toThrow('pomodoro subject unlink failed')
    expect(database.prepare('SELECT id FROM subjects WHERE id = ?').get(mathId)).toEqual({ id: mathId })
    expect(database.prepare('SELECT subject_id FROM mistakes WHERE id = ?').get(mistakeId)).toEqual({
      subject_id: mathId,
    })
    expect(database.prepare('SELECT subject_id FROM pomodoro_sessions WHERE id = ?').get(pomodoroId)).toEqual({
      subject_id: mathId,
    })
    expect(database.prepare('SELECT subject_id FROM study_tasks WHERE id = ?').get(task.id)).toEqual({
      subject_id: mathId,
    })
  })

  it('adds pomodoro sessions with explicit fields and preserves stored values', () => {
    const subject = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const task = repositories.studyTasks.createStudyTask({
      title: 'Math focus',
      subject_id: Number(subject.id),
      planned_date: '2026-06-06',
      status: 'doing',
    })

    expect(repositories.pomodoro.addPomodoroSession({
      subject_id: Number(subject.id),
      task_id: task.id,
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
      'SELECT subject_id, task_id, duration, date_key, started_at, completed_at FROM pomodoro_sessions WHERE id=?'
    ).get(1)).toEqual({
      subject_id: Number(subject.id),
      task_id: task.id,
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
      'SELECT subject_id, task_id, date_key, started_at, completed_at FROM pomodoro_sessions WHERE id=?'
    ).get(1)).toEqual({
      subject_id: null,
      task_id: null,
      date_key: getLocalDateKey(new Date(startedAt)),
      started_at: startedAt,
      completed_at: completedAt,
    })
  })

  it('validates pomodoro task attribution ids while preserving historical task status', () => {
    const todo = repositories.studyTasks.createStudyTask({
      title: 'Todo focus',
      planned_date: '2026-06-06',
      status: 'todo',
    })
    const done = repositories.studyTasks.createStudyTask({
      title: 'Done focus',
      planned_date: '2026-06-06',
      status: 'done',
    })
    const skipped = repositories.studyTasks.createStudyTask({
      title: 'Skipped focus',
      planned_date: '2026-06-06',
      status: 'skipped',
    })

    expect(repositories.pomodoro.addPomodoroSession({
      subject_id: null,
      task_id: todo.id,
      duration: 25,
      date_key: '2026-06-06',
    })).toEqual(expect.objectContaining({ id: 1 }))
    expect(() => repositories.pomodoro.addPomodoroSession({
      subject_id: null,
      task_id: 0,
      duration: 25,
      date_key: '2026-06-06',
    })).toThrow('pomodoro task_id must be a positive integer or null')
    expect(() => repositories.pomodoro.addPomodoroSession({
      subject_id: null,
      task_id: 999,
      duration: 25,
      date_key: '2026-06-06',
    })).toThrow('Task not found')
    expect(repositories.pomodoro.addPomodoroSession({
      subject_id: null,
      task_id: done.id,
      duration: 25,
      date_key: '2026-06-06',
    })).toEqual(expect.objectContaining({ id: 2 }))
    expect(repositories.pomodoro.addPomodoroSession({
      subject_id: null,
      task_id: skipped.id,
      duration: 25,
      date_key: '2026-06-06',
    })).toEqual(expect.objectContaining({ id: 3 }))
  })

  it('starts focus only for today todo or doing tasks', () => {
    const todo = repositories.studyTasks.createStudyTask({
      title: 'Todo focus',
      planned_date: '2026-06-06',
      status: 'todo',
    })
    const doing = repositories.studyTasks.createStudyTask({
      title: 'Doing focus',
      planned_date: '2026-06-06',
      status: 'doing',
    })
    const done = repositories.studyTasks.createStudyTask({
      title: 'Done focus',
      planned_date: '2026-06-06',
      status: 'done',
    })
    const skipped = repositories.studyTasks.createStudyTask({
      title: 'Skipped focus',
      planned_date: '2026-06-06',
      status: 'skipped',
    })

    expect(repositories.studyTasks.startStudyTaskFocus(todo.id, '2026-06-06')).toEqual(expect.objectContaining({
      id: todo.id,
      status: 'doing',
    }))
    expect(repositories.studyTasks.startStudyTaskFocus(doing.id, '2026-06-06')).toEqual(expect.objectContaining({
      id: doing.id,
      status: 'doing',
    }))
    expect(() => repositories.studyTasks.startStudyTaskFocus(todo.id, '2026-06-07')).toThrow('Task is not planned for this date')
    expect(() => repositories.studyTasks.startStudyTaskFocus(done.id, '2026-06-06')).toThrow('Cannot start focus for a completed or skipped task')
    expect(() => repositories.studyTasks.startStudyTaskFocus(skipped.id, '2026-06-06')).toThrow('Cannot start focus for a completed or skipped task')
    expect(() => repositories.studyTasks.startStudyTaskFocus(999, '2026-06-06')).toThrow('Task not found')
  })

  it('clears historical pomodoro task ids when the linked study task is deleted', () => {
    const task = repositories.studyTasks.createStudyTask({
      title: 'Linked focus',
      planned_date: '2026-06-06',
      status: 'doing',
    })
    const session = repositories.pomodoro.addPomodoroSession({
      subject_id: null,
      task_id: task.id,
      duration: 25,
      date_key: '2026-06-06',
    })

    expect(repositories.studyTasks.deleteStudyTask(task.id)).toBe(true)

    expect(database.prepare('SELECT task_id FROM pomodoro_sessions WHERE id = ?').get(Number(session.id))).toEqual({
      task_id: null,
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
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

  it('lists mistakes with filters, counts, joins, ordering, pagination, and empty results', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const english = repositories.subjects.createSubject({ name: 'English', color: '#854D0E' })
    insertMistake({
      subject_id: Number(math.id),
      question: 'question needle',
      answer: 'alpha answer',
      notes: 'alpha notes',
      mastered: 0,
      created_at: '2026-06-01 08:00:00',
    })
    insertMistake({
      subject_id: Number(math.id),
      question: 'gamma question',
      answer: 'gamma answer needle',
      notes: 'gamma notes',
      mastered: 0,
      created_at: '2026-06-02 08:00:00',
    })
    insertMistake({
      subject_id: Number(english.id),
      question: 'beta question',
      answer: 'beta answer',
      notes: 'notes needle',
      mastered: 1,
      created_at: '2026-06-03 08:00:00',
    })

    const all = repositories.mistakes.getAllMistakes()
    expect(all.total).toBe(3)
    expect(all.masteredTotal).toBe(1)
    expect(all.data.map(mistake => mistake.question)).toEqual([
      'beta question',
      'gamma question',
      'question needle',
    ])
    expect(all.data[0]).toEqual(expect.objectContaining({
      subject_name: 'English',
      subject_color: '#854D0E',
    }))

    expect(repositories.mistakes.getAllMistakes({ subject_id: Number(math.id) }).data.map(mistake => mistake.question)).toEqual([
      'gamma question',
      'question needle',
    ])
    expect(repositories.mistakes.getAllMistakes({ mastered: true }).data.map(mistake => mistake.question)).toEqual([
      'beta question',
    ])
    expect(repositories.mistakes.getAllMistakes({ search: 'question needle' }).data.map(mistake => mistake.question)).toEqual([
      'question needle',
    ])
    expect(repositories.mistakes.getAllMistakes({ search: 'answer needle' }).data.map(mistake => mistake.question)).toEqual([
      'gamma question',
    ])
    expect(repositories.mistakes.getAllMistakes({ search: 'notes needle' }).data.map(mistake => mistake.question)).toEqual([
      'beta question',
    ])
    expect(repositories.mistakes.getAllMistakes({ limit: 1, offset: 1 }).data.map(mistake => mistake.question)).toEqual([
      'gamma question',
    ])

    const empty = repositories.mistakes.getAllMistakes({ search: 'missing' })
    expect(empty).toEqual({ data: [], total: 0, masteredTotal: 0 })
  })

  it('orders equal-time mistakes by descending id before applying pagination', () => {
    const createdAt = '2026-06-04 08:00:00'
    const firstId = insertMistake({ question: 'first', created_at: createdAt })
    const secondId = insertMistake({ question: 'second', created_at: createdAt })
    const thirdId = insertMistake({ question: 'third', created_at: createdAt })

    expect(repositories.mistakes.getAllMistakes().data.map(mistake => mistake.id)).toEqual([
      thirdId,
      secondId,
      firstId,
    ])
    expect(repositories.mistakes.getAllMistakes({ limit: 1, offset: 1 }).data.map(mistake => mistake.id)).toEqual([
      secondId,
    ])
  })

  it('filters due mistakes with default local date, explicit date, and due priority over mastered', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 6, 12, 0, 0))
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    insertMistake({
      subject_id: Number(math.id),
      question: 'due null',
      mastered: 0,
      next_review_date: null,
      created_at: '2026-06-01 08:00:00',
    })
    insertMistake({
      subject_id: Number(math.id),
      question: 'due equal default date',
      mastered: 0,
      next_review_date: '2026-06-06',
      created_at: '2026-06-04 08:00:00',
    })
    insertMistake({
      subject_id: Number(math.id),
      question: 'due explicit date',
      mastered: 0,
      next_review_date: '2026-06-05',
      created_at: '2026-06-03 08:00:00',
    })
    insertMistake({
      subject_id: Number(math.id),
      question: 'future',
      mastered: 0,
      next_review_date: '2026-06-07',
      created_at: '2026-06-05 08:00:00',
    })
    insertMistake({
      subject_id: Number(math.id),
      question: 'mastered due',
      mastered: 1,
      next_review_date: null,
      created_at: '2026-06-06 08:00:00',
    })

    expect(repositories.mistakes.getAllMistakes({ due: true, mastered: true }).data.map(mistake => mistake.question)).toEqual([
      'due equal default date',
      'due explicit date',
      'due null',
    ])
    expect(repositories.mistakes.getAllMistakes({ due: true, dueDate: '2026-06-05' }).data.map(mistake => mistake.question)).toEqual([
      'due explicit date',
      'due null',
    ])
  })

  it('creates mistakes with existing defaults and preserves SQLite foreign-key errors', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const created = repositories.mistakes.createMistake({
      subject_id: Number(math.id),
      question: 'Question',
      answer: 'Answer',
      notes: 'Notes',
      image_path: 'mistake_images/a.png',
      answer_image_path: 'mistake_images/answer.png',
    })

    expect(created).toEqual({ id: 1 })
    expect(database.prepare(
      'SELECT subject_id, question, answer, notes, image_path, answer_image_path FROM mistakes WHERE id=?'
    ).get(Number(created.id))).toEqual({
      subject_id: Number(math.id),
      question: 'Question',
      answer: 'Answer',
      notes: 'Notes',
      image_path: 'mistake_images/a.png',
      answer_image_path: 'mistake_images/answer.png',
    })

    const defaulted = repositories.mistakes.createMistake({
      subject_id: 0,
      question: '',
      answer: '',
      notes: '',
      image_path: '',
      answer_image_path: '',
    })
    expect(database.prepare(
      'SELECT subject_id, question, answer, notes, image_path, answer_image_path FROM mistakes WHERE id=?'
    ).get(Number(defaulted.id))).toEqual({
      subject_id: null,
      question: '',
      answer: '',
      notes: '',
      image_path: null,
      answer_image_path: null,
    })

    expect(() => repositories.mistakes.createMistake({
      subject_id: 999,
      question: 'Missing subject',
    })).toThrow(/FOREIGN KEY constraint failed/)
  })

  it('updates mistakes with stable field semantics and empty patch behavior', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const english = repositories.subjects.createSubject({ name: 'English', color: '#854D0E' })
    const id = insertMistake({
      subject_id: Number(math.id),
      question: 'Original',
      answer: 'Original answer',
      notes: 'Original notes',
      mastered: 0,
      updated_at: '2026-01-01 00:00:00',
      image_path: 'mistake_images/old.png',
      answer_image_path: 'mistake_images/old-answer.png',
    })

    expect(repositories.mistakes.updateMistake(id, {
      subject_id: Number(english.id),
      question: 'Updated',
      answer: 'Updated answer',
      notes: 'Updated notes',
      mastered: true,
      image_path: 'mistake_images/new.png',
      answer_image_path: 'mistake_images/new-answer.png',
    })).toEqual({ success: true })
    expect(database.prepare(`
      SELECT subject_id, question, answer, notes, mastered, image_path, answer_image_path
      FROM mistakes WHERE id=?
    `).get(id)).toEqual({
      subject_id: Number(english.id),
      question: 'Updated',
      answer: 'Updated answer',
      notes: 'Updated notes',
      mastered: 1,
      image_path: 'mistake_images/new.png',
      answer_image_path: 'mistake_images/new-answer.png',
    })

    expect(repositories.mistakes.updateMistake(id, {
      answer_image_path: 'mistake_images/answer-only.png',
    })).toEqual({ success: true })
    expect(database.prepare('SELECT image_path, answer_image_path FROM mistakes WHERE id=?').get(id)).toEqual({
      image_path: 'mistake_images/new.png',
      answer_image_path: 'mistake_images/answer-only.png',
    })

    const emptyPatchId = insertMistake({ updated_at: '2026-01-01 00:00:00' })
    expect(repositories.mistakes.updateMistake(emptyPatchId, {})).toEqual({ success: true })
    expect(database.prepare('SELECT updated_at FROM mistakes WHERE id=?').get(emptyPatchId)).not.toEqual({
      updated_at: '2026-01-01 00:00:00',
    })
    expect(repositories.mistakes.updateMistake(999, { question: 'Missing' })).toEqual({ success: true })
  })

  it('deletes mistakes and keeps missing ids successful', () => {
    const id = insertMistake()
    const task = repositories.studyTasks.createStudyTask({
      title: 'Review linked mistake',
      type: 'review',
      planned_date: '2026-06-06',
      related_mistake_id: id,
      status: 'done',
    })

    expect(repositories.mistakes.deleteMistake(id)).toEqual({ success: true })
    expect(database.prepare('SELECT id FROM mistakes WHERE id=?').get(id)).toBeUndefined()
    expect(repositories.studyTasks.findStudyTasks({ planned_date: '2026-06-06' })).toEqual([
      expect.objectContaining({
        id: task.id,
        related_mistake_id: null,
        status: 'done',
      }),
    ])
    expect(repositories.mistakes.deleteMistake(999)).toEqual({ success: true })
  })

  it('toggles mastered state and updates the timestamp', () => {
    const id = insertMistake({ mastered: 0, updated_at: '2026-01-01 00:00:00' })

    expect(repositories.mistakes.toggleMistakeMastered(id)).toEqual({ mastered: 1 })
    expect(database.prepare('SELECT mastered, updated_at FROM mistakes WHERE id=?').get(id)).toEqual(expect.objectContaining({
      mastered: 1,
    }))
    expect(database.prepare('SELECT updated_at FROM mistakes WHERE id=?').get(id)).not.toEqual({
      updated_at: '2026-01-01 00:00:00',
    })
    expect(repositories.mistakes.toggleMistakeMastered(id)).toEqual({ mastered: 0 })
  })

  it('writes spaced-repetition review fields without computing them', () => {
    const id = insertMistake()

    expect(repositories.mistakes.reviewMistake(id, {
      ease_factor: 2.1,
      review_interval: 6,
      next_review_date: '2026-06-12',
      review_count: 4,
    })).toEqual({
      success: true,
      mistake: expect.objectContaining({
        id,
        ease_factor: 2.1,
        review_interval: 6,
        next_review_date: '2026-06-12',
        review_count: 4,
      }),
    })

    expect(database.prepare(`
      SELECT ease_factor, review_interval, next_review_date, review_count
      FROM mistakes WHERE id=?
    `).get(id)).toEqual({
      ease_factor: 2.1,
      review_interval: 6,
      next_review_date: '2026-06-12',
      review_count: 4,
    })
    expect(() => repositories.mistakes.reviewMistake(999, {
      ease_factor: 2.1,
      review_interval: 6,
      next_review_date: '2026-06-12',
      review_count: 4,
    })).toThrow('Mistake not found')
  })

  it('counts and selects due mistakes with count plus random offset semantics', () => {
    const math = repositories.subjects.createSubject({ name: 'Math', color: '#0F766E' })
    const english = repositories.subjects.createSubject({ name: 'English', color: '#854D0E' })
    const emptySubject = repositories.subjects.createSubject({ name: 'Chemistry', color: '#0E7490' })
    insertMistake({ subject_id: Number(math.id), question: 'due null', mastered: 0, next_review_date: null })
    insertMistake({ subject_id: Number(english.id), question: 'due equal', mastered: 0, next_review_date: '2026-06-06' })
    insertMistake({ subject_id: Number(math.id), question: 'future', mastered: 0, next_review_date: '2026-06-07' })
    insertMistake({ subject_id: Number(math.id), question: 'mastered due', mastered: 1, next_review_date: null })
    insertMistake({ subject_id: Number(math.id), question: 'due past', mastered: 0, next_review_date: '2026-06-05' })

    expect(repositories.mistakes.getDueForReviewCount('2026-06-06')).toBe(3)

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(repositories.mistakes.getRandomDueMistake('2026-06-06')).toEqual(expect.objectContaining({
      question: 'due equal',
      subject_name: 'English',
      subject_color: '#854D0E',
    }))
    randomSpy.mockReturnValue(0.9)
    expect(repositories.mistakes.getRandomDueMistake('2026-06-06', Number(math.id))).toEqual(expect.objectContaining({
      question: 'due past',
      subject_name: 'Math',
      subject_color: '#0F766E',
    }))
    expect(repositories.mistakes.getRandomDueMistake('2026-06-06', Number(emptySubject.id))).toBeNull()
  })

  it('returns raw mistake image-path query data without parsing or cleanup', () => {
    const jsonPath = JSON.stringify(['mistake_images/b.png'])
    const firstId = insertMistake({ image_path: 'mistake_images/a.png', answer_image_path: 'mistake_images/answer-a.png' })
    insertMistake({ image_path: null })
    const thirdId = insertMistake({ image_path: jsonPath })
    const fourthId = insertMistake({ image_path: null, answer_image_path: 'mistake_images/answer-only.png' })

    expect(repositories.mistakes.getMistakeImageFields(firstId)).toEqual({
      image_path: 'mistake_images/a.png',
      answer_image_path: 'mistake_images/answer-a.png',
    })
    expect(repositories.mistakes.getMistakeImageFields(999)).toEqual({
      image_path: null,
      answer_image_path: null,
    })
    expect(repositories.mistakes.getOtherMistakeImageFields(firstId)).toEqual([
      { id: thirdId, image_path: jsonPath, answer_image_path: null },
      { id: fourthId, image_path: null, answer_image_path: 'mistake_images/answer-only.png' },
    ])
    expect(repositories.mistakes.getAllMistakeImageFields()).toEqual([
      { id: firstId, image_path: 'mistake_images/a.png', answer_image_path: 'mistake_images/answer-a.png' },
      { id: thirdId, image_path: jsonPath, answer_image_path: null },
      { id: fourthId, image_path: null, answer_image_path: 'mistake_images/answer-only.png' },
    ])
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
    expect(repositories.studyTasks.findStudyTasks({
      planned_date: '2026-06-11',
      type: 'review',
      status: ['todo', 'doing'],
      related_mistake_id: Number(mistake.lastInsertRowid),
    })).toEqual([
      expect.objectContaining({
        id: created.id,
        status: 'doing',
        related_mistake_id: Number(mistake.lastInsertRowid),
      }),
    ])
    expect(repositories.studyTasks.findStudyTasks({
      planned_date: '2026-06-11',
      related_entry_id: null,
    })).toEqual([])
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
