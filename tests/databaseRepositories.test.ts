// @vitest-environment node

import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseRepositories } from '../electron/repositories/databaseRepositoryFactory'
import type Database from 'better-sqlite3'

describe('database repositories', () => {
  let database: Database.Database
  let repositories: ReturnType<typeof createDatabaseRepositories>

  beforeEach(() => {
    database = new BetterSqlite3(':memory:')
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

      CREATE TABLE entry_tags (
        entry_id INTEGER,
        tag_id INTEGER,
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
    database.close()
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
    database.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').run(first.id, 7)

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
      tagId: 7,
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
