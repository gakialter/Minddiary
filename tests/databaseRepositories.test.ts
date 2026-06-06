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
