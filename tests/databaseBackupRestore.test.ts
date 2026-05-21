// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { normalizeBackupDatabaseData } from '../electron/databaseBackupData'

describe('database backup data normalization', () => {
  it('normalizes settings objects, legacy mistakes wrappers, and raw pomodoro session rows', () => {
    const normalized = normalizeBackupDatabaseData({
      settings: {
        theme: 'dark',
        countdownEvents: [{ id: 'exam', title: 'Exam' }],
      },
      mistakes: {
        data: [{ id: 7, question: '2 + 2', answer: '4' }],
      },
      pomodoro: [{
        id: 6,
        subject_id: 2,
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
    expect(normalized.mistakes).toEqual([{ id: 7, question: '2 + 2', answer: '4' }])
    expect(normalized.pomodoro_sessions).toEqual([{
      id: 6,
      subject_id: 2,
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
})
