// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { DATABASE_BACKUP_TABLES, normalizeBackupDatabaseData } from '../electron/databaseBackupData'

describe('database backup data normalization', () => {
  it('normalizes settings objects, legacy mistakes wrappers, and raw pomodoro session rows', () => {
    const normalized = normalizeBackupDatabaseData({
      settings: {
        theme: 'dark',
        countdownEvents: [{ id: 'exam', title: 'Exam' }],
      },
      mistakes: {
        data: [{ id: 7, question: '2 + 2', answer: '4', image_path: 'mistake_images/q.png' }],
      },
      pomodoro: [{
        id: 6,
        subject_id: 2,
        task_id: 3,
        duration: 25,
        date_key: '2026-05-20',
        started_at: '2026-05-20 01:00:00',
        completed_at: '2026-05-20 01:25:00',
      }],
    })

    expect(normalized.settings).toEqual([
      { key: 'theme', value: 'dark' },
      { key: 'countdownEvents', value: JSON.stringify([{ id: 'exam', title: 'Exam' }]) },
    ])
    expect(normalized.mistakes).toEqual([{ id: 7, question: '2 + 2', answer: '4', image_path: 'mistake_images/q.png' }])
    expect(normalized.pomodoro_sessions).toEqual([{
      id: 6,
      subject_id: 2,
      task_id: 3,
      duration: 25,
      date_key: '2026-05-20',
      started_at: '2026-05-20 01:00:00',
      completed_at: '2026-05-20 01:25:00',
    }])
  })

  it('treats old aggregate pomodoro backup rows as non-restorable sessions', () => {
    const normalized = normalizeBackupDatabaseData({
      pomodoro: [{ date: '2026-05-20', total_minutes: 50, session_count: 2 }],
    })

    expect(normalized.pomodoro_sessions).toEqual([])
  })

  it('keeps study task rows in the normalized backup payload', () => {
    const task = {
      id: 3,
      title: 'Review risk pool',
      description: '',
      type: 'review',
      subject_id: 2,
      related_mistake_id: null,
      related_entry_id: null,
      related_chapter_id: 9,
      planned_date: '2026-05-31',
      estimate_minutes: 25,
      status: 'todo',
      source: 'dashboard',
      created_at: '2026-05-31 08:00:00',
      updated_at: '2026-05-31 08:00:00',
    }

    const normalized = normalizeBackupDatabaseData({
      study_tasks: [task],
    })

    expect(normalized.study_tasks).toEqual([task])
    const taskTable = DATABASE_BACKUP_TABLES.find(item => item.table === 'study_tasks')
    expect(taskTable?.columns).toContain('related_chapter_id')
  })

  it('normalizes subject chapters and restores them immediately after subjects', () => {
    const chapter = {
      id: 2,
      subject_id: 1,
      title: '第一章 函数',
      notes: '重点',
      completed: 1,
      sort_order: 0,
      created_at: '2026-06-13 08:00:00',
      updated_at: '2026-06-13 08:00:00',
    }
    const subjectsIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'subjects')
    const chaptersIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'subject_chapters')
    const taskIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'study_tasks')
    const mistakesIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'mistakes')
    const chaptersTable = DATABASE_BACKUP_TABLES[chaptersIndex]

    expect(subjectsIndex).toBeGreaterThanOrEqual(0)
    expect(chaptersIndex).toBeGreaterThan(subjectsIndex)
    expect(mistakesIndex).toBeGreaterThan(chaptersIndex)
    expect(taskIndex).toBeGreaterThan(chaptersIndex)
    expect(chaptersTable?.columns).toEqual([
      'id',
      'subject_id',
      'title',
      'notes',
      'completed',
      'sort_order',
      'created_at',
      'updated_at',
    ])

    expect(normalizeBackupDatabaseData({ subject_chapters: [chapter] }).subject_chapters).toEqual([chapter])
    expect(normalizeBackupDatabaseData({ subjects: [] }).subject_chapters).toEqual([])
  })

  it('exports pomodoro task attribution after study tasks for dependency-safe restore', () => {
    const taskIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'study_tasks')
    const pomodoroIndex = DATABASE_BACKUP_TABLES.findIndex(item => item.table === 'pomodoro_sessions')
    const pomodoroTable = DATABASE_BACKUP_TABLES[pomodoroIndex]

    expect(taskIndex).toBeGreaterThanOrEqual(0)
    expect(pomodoroIndex).toBeGreaterThan(taskIndex)
    expect(pomodoroTable?.columns).toEqual(expect.arrayContaining(['task_id']))

    const normalized = normalizeBackupDatabaseData({
      pomodoro_sessions: [{
        id: 10,
        subject_id: null,
        duration: 30,
        date_key: '2026-06-12',
      }],
    })

    expect(normalized.pomodoro_sessions).toEqual([{
      id: 10,
      subject_id: null,
      duration: 30,
      date_key: '2026-06-12',
    }])
  })

  it('exports answer image paths in the mistake backup column list without requiring old backups to contain them', () => {
    const mistakeTable = DATABASE_BACKUP_TABLES.find(item => item.table === 'mistakes')

    expect(mistakeTable?.columns).toEqual(expect.arrayContaining(['image_path', 'answer_image_path']))
    expect(mistakeTable?.columns.indexOf('answer_image_path')).toBe(
      (mistakeTable?.columns.indexOf('image_path') ?? -2) + 1,
    )

    const normalized = normalizeBackupDatabaseData({
      mistakes: [{ id: 8, question: 'legacy', image_path: 'mistake_images/legacy.png' }],
    })

    expect(normalized.mistakes).toEqual([
      { id: 8, question: 'legacy', image_path: 'mistake_images/legacy.png' },
    ])
  })

  it('filters sensitive settings from object-shaped restore payloads', () => {
    const normalized = normalizeBackupDatabaseData({
      settings: {
        theme: 'dark',
        aiApiKey: 'enc:v1:secret',
      },
    })

    expect(normalized.settings).toEqual([{ key: 'theme', value: 'dark' }])
  })

  it('filters sensitive settings from row-shaped restore payloads', () => {
    const normalized = normalizeBackupDatabaseData({
      settings: [
        { key: 'theme', value: 'dark' },
        { key: 'aiApiKey', value: 'enc:v1:secret' },
      ],
    })

    expect(normalized.settings).toEqual([{ key: 'theme', value: 'dark' }])
  })

  it('rejects invalid table shapes before SQLite restore starts', () => {
    expect(() => normalizeBackupDatabaseData({
      entries: { id: 1 },
    })).toThrow(/entries/i)
  })

  it.each([
    ['parent traversal', '../outside.txt'],
    ['absolute path', '/var/tmp/outside.txt'],
    ['Windows drive path', 'C:\\Users\\x\\outside.txt'],
    ['mixed-separator traversal', 'nested/..\\..\\outside.txt'],
  ])('rejects unsafe restored attachment filepaths: %s', (_label, filepath) => {
    expect(() => normalizeBackupDatabaseData({
      attachments: [{
        id: 1,
        entry_id: 1,
        filename: 'attachment.png',
        filepath,
        mimetype: 'image/png',
      }],
    })).toThrow(/attachment.*filepath/i)
  })

  it.each([
    'abc.png',
    'timestamp-random.png',
    '1_1779000000000.webp',
  ])('keeps valid legacy attachment filepath %s', (filepath) => {
    const normalized = normalizeBackupDatabaseData({
      attachments: [{
        id: 1,
        entry_id: 1,
        filename: 'attachment.png',
        filepath,
        mimetype: 'image/png',
      }],
    })

    expect(normalized.attachments[0]?.filepath).toBe(filepath)
  })
})
