// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { logger } from '../electron/logger'
import type { Attachment, DateMood, DiaryEntry, DiaryTemplate, EntryFilters, Mistake, PomodoroRangeEntry, PomodoroSession, PomodoroStat, Subject, Tag } from '../src/types'

type PreparedCall = {
  sql: string
  params: unknown[]
}

type BatchTagRow = Tag & { entry_id: number }
type EntryTagRow = { entry_id: number; tag_id: number }
type EntryRow = DiaryEntry & { content_snippet?: string }
type PomodoroSessionRow = {
  id: number
  subject_id: number | null
  task_id: number | null
  duration: number
  date_key: string | null
  started_at: string | null
  completed_at: string | null
}
type MistakeImageRow = {
  id: number
  image_path: string | null
  answer_image_path?: string | null
  subject_id?: number | null
  question?: string
  answer?: string
  notes?: string
  mastered?: number
  ease_factor?: number
  review_interval?: number
  next_review_date?: string | null
  review_count?: number
  subject_name?: string | null
  subject_color?: string | null
}
type StudyTaskRow = {
  id: number
  title: string
  description: string
  type: string
  subject_id: number | null
  related_mistake_id: number | null
  related_entry_id: number | null
  related_chapter_id: number | null
  planned_date: string
  estimate_minutes: number
  status: string
  source: string
  created_at: string
  updated_at: string
}

type DatabaseModule = {
  initialize: () => void
  createEntry: (entry: Pick<DiaryEntry, 'date' | 'title' | 'content' | 'mood'>) => Partial<DiaryEntry>
  updateEntry: (id: number, entry: Partial<Pick<DiaryEntry, 'title' | 'content' | 'mood'>>) => DiaryEntry | undefined
  deleteEntry: (id: number) => { success: boolean }
  getEntryById: (id: number) => DiaryEntry | undefined
  getEntryByDate: (date: string) => DiaryEntry | undefined
  getAllEntries: (filters?: EntryFilters) => DiaryEntry[]
  searchEntries: (query: string) => DiaryEntry[]
  getDatesWithEntries: (yearMonth: string) => DateMood[]
  getAllTags: () => Tag[]
  createTag: (tag: Partial<Tag>) => Tag
  updateTag: (id: number, tag: Partial<Tag>) => Tag
  deleteTag: (id: number) => { success: boolean }
  setEntryTags: (entryId: number, tagIds: number[]) => { success: boolean }
  getEntryTags: (entryId: number) => Tag[]
  getEntryTagsBatch: (entryIds: number[]) => Record<number, Tag[]>
  getAllMistakes: (filters?: { subject_id?: number; mastered?: boolean | number; search?: string; due?: boolean; dueDate?: string; limit?: number; offset?: number }) => { data: Mistake[], total: number, masteredTotal: number }
  createMistake: (mistake: Partial<Mistake>) => { id: unknown }
  createMistakes: (mistakes: Partial<Mistake>[]) => Array<{ id: unknown }>
  addPomodoroSession: (session: Pick<PomodoroSession, 'subject_id' | 'task_id' | 'duration' | 'date_key' | 'started_at' | 'completed_at'>) => { id: unknown; date_key: string; started_at: string | null; completed_at: string }
  getPomodoroStats: (date: string) => PomodoroStat[]
  getPomodoroStatsRange: (startDate: string, endDate: string) => PomodoroStat[]
  getDailyStudyMinutes: (date: string) => number
  getPomodoroRange: (startDate: string, endDate: string) => PomodoroRangeEntry[]
  getStudyTasksByDate: (date: string) => StudyTaskRow[]
  createStudyTask: (task: Partial<StudyTaskRow>) => StudyTaskRow
  updateStudyTask: (id: number, patch: Partial<StudyTaskRow>) => StudyTaskRow
  deleteStudyTask: (id: number) => boolean
  completeStudyTask: (id: number) => StudyTaskRow
  skipStudyTask: (id: number) => StudyTaskRow
  startStudyTaskFocus: (id: number, date: string) => StudyTaskRow
  updateMistake: (id: number, mistake: Partial<Mistake>) => Promise<{ success: boolean }>
  deleteMistake: (id: number) => Promise<{ success: boolean }>
  discardUnreferencedMistakeImage: (ref: string) => Promise<{ success: true }>
  toggleMistakeMastered: (id: number) => { mastered: number }
  reviewMistake: (id: number, data: Partial<Mistake>) => { success: boolean }
  getDueForReviewCount: (date: string) => number
  getRandomDueMistake: (date: string, subjectId?: number) => Mistake | null
  getAiApiKey: () => string | null
  setAiApiKey: (key: string) => void
  getSetting: (key: string) => unknown | null
  setSetting: (key: string, value: unknown) => { success: boolean }
  getAllSettings: () => Record<string, unknown>
  addAttachment: (entryId: number, attachment: Pick<Attachment, 'filename' | 'filepath' | 'mimetype'>) => Partial<Attachment>
  getAttachmentsByEntry: (entryId: number) => Attachment[]
  getAllSubjects: () => Subject[]
  getAttachmentById: (id: number) => Attachment | undefined
  removeAttachment: (id: number) => { success: boolean }
  getAttachmentsByEntries: (entryIds: number[]) => Record<number, Attachment[]>
  createSubject: (subject: Partial<Subject>) => Subject
  updateSubject: (id: number, subject: Partial<Subject>) => Subject
  deleteSubject: (id: number) => { success: boolean }
  getAllTemplates: () => DiaryTemplate[]
  createTemplate: (template: Partial<DiaryTemplate>) => Partial<DiaryTemplate>
  updateTemplate: (id: number, template: Partial<DiaryTemplate>) => DiaryTemplate | undefined
  deleteTemplate: (id: number) => { success: boolean; message?: string }
}

const state = vi.hoisted(() => ({
  preparedCalls: [] as PreparedCall[],
  execCalls: [] as string[],
  tagRows: [] as BatchTagRow[],
  entryTagRows: [] as EntryTagRow[],
  entryRows: [] as EntryRow[],
  attachmentRows: [] as Attachment[],
  tagById: null as Tag | null,
  allTags: [] as Tag[],
  runChanges: 1,
  settings: {} as Record<string, unknown>,
  mistakeRows: [] as MistakeImageRow[],
  pomodoroSessionRows: [] as PomodoroSessionRow[],
  pomodoroStatsRows: [] as PomodoroStat[],
  taskRows: [] as StudyTaskRow[],
  subjectRows: [] as Subject[],
  templateRows: [] as DiaryTemplate[],
  mistakeImagePathQueryError: null as Error | null,
  userVersion: 0,
  closeCalls: 0,
}))

const mistakeImageStorageState = vi.hoisted(() => ({
  deleteManagedMistakeImage: vi.fn(async () => undefined),
  getMistakeImageReferenceKey: vi.fn((ref: string) => {
    const normalized = decodeURIComponent(ref.replace(/^local:\/\//, '').replace(/\\/g, '/'))
    if (!normalized.startsWith('mistake_images/')) return null
    return normalized.slice('mistake_images/'.length).toLowerCase()
  }),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\Users\\tester\\AppData\\Roaming\\MindDiary'),
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  },
}))

vi.mock('../electron/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../electron/mistakeImageStorage', () => mistakeImageStorageState)

vi.mock('better-sqlite3', () => {
  const MockBetterSqlite3 = vi.fn(function MockBetterSqlite3() {
    return {
      pragma: vi.fn((statement: string) => {
        if (statement === 'user_version') return state.userVersion
        const userVersionMatch = statement.match(/^user_version\s*=\s*(\d+)$/)
        if (userVersionMatch?.[1]) {
          state.userVersion = Number(userVersionMatch[1])
        }
        return undefined
      }),
      close: vi.fn(() => {
        state.closeCalls += 1
      }),
      exec: vi.fn((sql: string) => {
        state.execCalls.push(sql)
      }),
      transaction: vi.fn((callback: () => void) => vi.fn(callback)),
      prepare: vi.fn((sql: string) => ({
        run: vi.fn((...params: unknown[]) => {
          state.preparedCalls.push({ sql, params })
          if (sql.startsWith('INSERT OR REPLACE INTO settings')) {
            state.settings[String(params[0])] = params[1]
          }
          if (sql.includes('INSERT INTO entries')) {
            const now = '2026-06-06 08:00:00'
            const row: EntryRow = {
              id: state.entryRows.length + 1,
              date: String(params[0]),
              title: String(params[1] ?? ''),
              content: String(params[2] ?? ''),
              mood: params[3] == null ? null : params[3] as DiaryEntry['mood'],
              word_count: Number(params[4] ?? 0),
              created_at: now,
              updated_at: now,
            }
            state.entryRows.push(row)
            return { lastInsertRowid: row.id, changes: 1 }
          }
          if (sql.includes('UPDATE entries SET')) {
            const id = Number(params[4])
            const row = state.entryRows.find(item => item.id === id)
            if (row) {
              row.title = String(params[0] ?? '')
              row.content = String(params[1] ?? '')
              row.mood = params[2] == null ? null : params[2] as DiaryEntry['mood']
              row.word_count = Number(params[3] ?? 0)
              row.updated_at = '2026-06-06 09:00:00'
            }
            return { lastInsertRowid: 0, changes: row ? 1 : 0 }
          }
          if (sql.includes('DELETE FROM entries WHERE id=?')) {
            const id = Number(params[0])
            const before = state.entryRows.length
            state.entryRows = state.entryRows.filter(item => item.id !== id)
            return { lastInsertRowid: 0, changes: before === state.entryRows.length ? 0 : 1 }
          }
          if (sql.includes('INSERT INTO tags')) {
            const row: Tag = {
              id: state.allTags.length + 1,
              name: String(params[0]),
              color: String(params[1]),
              icon: String(params[2] ?? ''),
              variant: params[3] as Tag['variant'],
              pattern: params[4] as Tag['pattern'],
            }
            state.allTags.push(row)
            return { lastInsertRowid: row.id, changes: 1 }
          }
          if (sql.includes('UPDATE tags SET')) {
            const id = Number(params[5])
            const row = state.allTags.find(item => item.id === id)
            if (row) {
              row.name = String(params[0])
              row.color = String(params[1])
              row.icon = String(params[2] ?? '')
              row.variant = params[3] as Tag['variant']
              row.pattern = params[4] as Tag['pattern']
            }
            return { lastInsertRowid: 0, changes: row ? 1 : state.runChanges }
          }
          if (sql.includes('DELETE FROM tags WHERE id=?')) {
            const id = Number(params[0])
            const before = state.allTags.length
            state.allTags = state.allTags.filter(item => item.id !== id)
            state.entryTagRows = state.entryTagRows.filter(item => item.tag_id !== id)
            return { lastInsertRowid: 0, changes: before === state.allTags.length ? 0 : 1 }
          }
          if (sql.includes('DELETE FROM entry_tags WHERE entry_id=?')) {
            const entryId = Number(params[0])
            const before = state.entryTagRows.length
            state.entryTagRows = state.entryTagRows.filter(item => item.entry_id !== entryId)
            return { lastInsertRowid: 0, changes: before === state.entryTagRows.length ? 0 : 1 }
          }
          if (sql.includes('INSERT INTO entry_tags')) {
            state.entryTagRows.push({ entry_id: Number(params[0]), tag_id: Number(params[1]) })
            return { lastInsertRowid: 1, changes: 1 }
          }
          if (sql.includes('INSERT INTO attachments')) {
            const row: Attachment = {
              id: state.attachmentRows.length + 1,
              entry_id: Number(params[0]),
              filename: String(params[1]),
              filepath: String(params[2]),
              mimetype: String(params[3]),
              created_at: '2026-06-06 08:00:00',
            }
            state.attachmentRows.push(row)
            return { lastInsertRowid: row.id, changes: 1 }
          }
          if (sql.includes('DELETE FROM attachments WHERE id=?')) {
            const id = Number(params[0])
            const before = state.attachmentRows.length
            state.attachmentRows = state.attachmentRows.filter(item => item.id !== id)
            return { lastInsertRowid: 0, changes: before === state.attachmentRows.length ? 0 : 1 }
          }
          if (sql.includes('INSERT INTO subjects')) {
            const row: Subject = {
              id: state.subjectRows.length + 1,
              name: String(params[0]),
              total_chapters: Number(params[1] ?? 0),
              completed_chapters: 0,
              color: String(params[2] ?? '#0F766E'),
            }
            state.subjectRows.push(row)
            return { lastInsertRowid: row.id, changes: 1 }
          }
          if (sql.includes('UPDATE subjects SET')) {
            const id = Number(params[4])
            const row = state.subjectRows.find(item => item.id === id)
            if (row) {
              row.name = String(params[0])
              row.total_chapters = Number(params[1] ?? 0)
              row.completed_chapters = Number(params[2] ?? 0)
              row.color = String(params[3] ?? '#0F766E')
            }
            return { lastInsertRowid: 0, changes: row ? 1 : 0 }
          }
          if (sql.includes('DELETE FROM subjects WHERE id=?')) {
            const id = Number(params[0])
            const before = state.subjectRows.length
            state.subjectRows = state.subjectRows.filter(item => item.id !== id)
            return { lastInsertRowid: 0, changes: before === state.subjectRows.length ? 0 : 1 }
          }
          if (sql.includes('INSERT INTO diary_templates')) {
            const now = '2026-06-06 08:00:00'
            const row: DiaryTemplate = {
              id: state.templateRows.length + 1,
              name: String(params[0]),
              content: String(params[1] ?? ''),
              is_default: 0,
              sort_order: Number(params[2] ?? 99),
              created_at: now,
              updated_at: now,
            }
            state.templateRows.push(row)
            return { lastInsertRowid: row.id, changes: 1 }
          }
          if (sql.includes('UPDATE diary_templates SET')) {
            const id = Number(params[params.length - 1])
            const row = state.templateRows.find(item => item.id === id)
            if (!row) return { lastInsertRowid: 0, changes: 0 }
            const assignments = sql.match(/SET (.*) WHERE/)?.[1] ?? ''
            assignments.split(', ').forEach((assignment, index) => {
              const field = assignment.split(' = ?')[0]
              const value = params[index]
              if (field === 'name') {
                row.name = String(value)
              } else if (field === 'content') {
                row.content = String(value)
              } else if (field === 'sort_order') {
                row.sort_order = Number(value)
              } else if (field === 'updated_at') {
                row.updated_at = '2026-06-06 09:00:00'
              }
            })
            row.updated_at = '2026-06-06 09:00:00'
            return { lastInsertRowid: 0, changes: 1 }
          }
          if (sql.includes('DELETE FROM diary_templates WHERE id=?')) {
            const id = Number(params[0])
            const before = state.templateRows.length
            state.templateRows = state.templateRows.filter(item => item.id !== id)
            return { lastInsertRowid: 0, changes: before === state.templateRows.length ? 0 : 1 }
          }
          if (sql.includes('INSERT INTO pomodoro_sessions')) {
            const row: PomodoroSessionRow = {
              id: state.pomodoroSessionRows.length + 1,
              subject_id: params[0] == null ? null : Number(params[0]),
              task_id: params[1] == null ? null : Number(params[1]),
              duration: Number(params[2]),
              date_key: params[3] == null ? null : String(params[3]),
              started_at: params[4] == null ? null : String(params[4]),
              completed_at: params[5] == null ? null : String(params[5]),
            }
            state.pomodoroSessionRows.push(row)
            return { lastInsertRowid: row.id, changes: 1 }
          }
          if (sql.includes('INSERT INTO mistakes')) {
            const row: MistakeImageRow = {
              id: state.mistakeRows.length + 1,
              subject_id: params[0] == null ? null : Number(params[0]),
              question: String(params[1] ?? ''),
              answer: String(params[2] ?? ''),
              notes: String(params[3] ?? ''),
              mastered: 0,
              image_path: params[4] == null ? null : String(params[4]),
              answer_image_path: params[5] == null ? null : String(params[5]),
            }
            state.mistakeRows.push(row)
            return { lastInsertRowid: row.id, changes: 1 }
          }
          if (sql.includes('UPDATE mistakes SET mastered = 1 - mastered')) {
            const id = Number(params[0])
            const row = state.mistakeRows.find(item => item.id === id)
            if (row) {
              row.mastered = 1 - (row.mastered ?? 0)
            }
            return { lastInsertRowid: 0, changes: row ? 1 : state.runChanges }
          }
          if (sql.includes('UPDATE mistakes SET')) {
            const id = Number(params[params.length - 1])
            const row = state.mistakeRows.find(item => item.id === id)
            if (row) {
              const assignments = sql.match(/SET (.*) WHERE id=\?/)?.[1] ?? ''
              assignments.split(', ').forEach((assignment, index) => {
                const field = assignment.split(' = ?')[0]
                const value = params[index]
                if (field === 'subject_id') {
                  row.subject_id = value == null ? null : Number(value)
                } else if (field === 'question') {
                  row.question = String(value)
                } else if (field === 'answer') {
                  row.answer = String(value)
                } else if (field === 'notes') {
                  row.notes = String(value)
                } else if (field === 'mastered') {
                  row.mastered = Number(value)
                } else if (field === 'image_path') {
                  row.image_path = value as string | null
                } else if (field === 'answer_image_path') {
                  row.answer_image_path = value as string | null
                }
              })
            }
            return { lastInsertRowid: 0, changes: row ? 1 : state.runChanges }
          }
          if (sql.includes('DELETE FROM mistakes WHERE id=?')) {
            const id = Number(params[0])
            const before = state.mistakeRows.length
            state.mistakeRows = state.mistakeRows.filter(item => item.id !== id)
            return { lastInsertRowid: 0, changes: before === state.mistakeRows.length ? 0 : 1 }
          }
          if (sql.includes('INSERT INTO study_tasks')) {
            const now = '2026-05-31 08:00:00'
            const row: StudyTaskRow = {
              id: state.taskRows.length + 1,
              title: String(params[0]),
              description: String(params[1] ?? ''),
              type: String(params[2] ?? 'custom'),
              subject_id: params[3] == null ? null : Number(params[3]),
              related_mistake_id: params[4] == null ? null : Number(params[4]),
              related_entry_id: params[5] == null ? null : Number(params[5]),
              related_chapter_id: params[6] == null ? null : Number(params[6]),
              planned_date: String(params[7]),
              estimate_minutes: Number(params[8] ?? 25),
              status: String(params[9] ?? 'todo'),
              source: String(params[10] ?? 'manual'),
              created_at: now,
              updated_at: now,
            }
            state.taskRows.push(row)
            return { lastInsertRowid: row.id, changes: 1 }
          }
          if (sql.includes('UPDATE study_tasks SET')) {
            const id = Number(params[params.length - 1])
            const row = state.taskRows.find(item => item.id === id)
            if (!row) return { lastInsertRowid: 0, changes: 0 }
            const assignments = sql.match(/SET (.*), updated_at = CURRENT_TIMESTAMP WHERE/)?.[1] ?? ''
            assignments.split(', ').forEach((assignment, index) => {
              const field = assignment.split(' = ?')[0]
              const value = params[index]
              if (field === 'title') {
                row.title = String(value)
              } else if (field === 'description') {
                row.description = String(value)
              } else if (field === 'type') {
                row.type = String(value)
              } else if (field === 'subject_id') {
                row.subject_id = value == null ? null : Number(value)
              } else if (field === 'related_mistake_id') {
                row.related_mistake_id = value == null ? null : Number(value)
              } else if (field === 'related_entry_id') {
                row.related_entry_id = value == null ? null : Number(value)
              } else if (field === 'related_chapter_id') {
                row.related_chapter_id = value == null ? null : Number(value)
              } else if (field === 'planned_date') {
                row.planned_date = String(value)
              } else if (field === 'estimate_minutes') {
                row.estimate_minutes = Number(value)
              } else if (field === 'status') {
                row.status = String(value)
              } else if (field === 'source') {
                row.source = String(value)
              }
            })
            row.updated_at = '2026-05-31 09:00:00'
            return { lastInsertRowid: 0, changes: 1 }
          }
          if (sql.includes('DELETE FROM study_tasks WHERE id = ?')) {
            const id = Number(params[0])
            const before = state.taskRows.length
            state.taskRows = state.taskRows.filter(item => item.id !== id)
            return { lastInsertRowid: 0, changes: before === state.taskRows.length ? 0 : 1 }
          }
          return { lastInsertRowid: 1, changes: state.runChanges }
        }),
        get: vi.fn((...params: unknown[]) => {
          state.preparedCalls.push({ sql, params })
          if (sql === 'PRAGMA user_version') return { user_version: state.userVersion }
          if (sql.includes('SELECT COUNT(*) as total, SUM(CASE WHEN m.mastered = 1')) {
            return {
              total: state.mistakeRows.length,
              mastered_total: state.mistakeRows.filter(row => row.mastered === 1).length,
            }
          }
          if (sql.includes('SELECT COUNT(*) as cnt FROM mistakes m')) {
            return { cnt: state.mistakeRows.filter(row => row.mastered !== 1).length }
          }
          if (sql.includes('SELECT COUNT(*) as count FROM mistakes')) {
            return { count: state.mistakeRows.filter(row => row.mastered !== 1).length }
          }
          if (sql.includes('COUNT(*)')) return { count: 1 }
          if (sql.includes('SELECT value FROM settings WHERE key=?')) {
            const key = String(params[0])
            return Object.prototype.hasOwnProperty.call(state.settings, key)
              ? { value: state.settings[key] }
              : undefined
          }
          if (sql.includes('SELECT COALESCE(SUM(duration), 0) as total FROM pomodoro_sessions WHERE date_key = ?')) {
            const date = String(params[0])
            return {
              total: state.pomodoroSessionRows
                .filter(row => row.date_key === date)
                .reduce((sum, row) => sum + row.duration, 0),
            }
          }
          if (sql.includes('SELECT * FROM entries WHERE id=?')) {
            const id = Number(params[0])
            return state.entryRows.find(item => item.id === id)
          }
          if (sql.includes('SELECT * FROM entries WHERE date=?')) {
            const date = String(params[0])
            return state.entryRows.find(item => item.date === date)
          }
          if (sql.includes('SELECT * FROM attachments WHERE id=?')) {
            const id = Number(params[0])
            return state.attachmentRows.find(item => item.id === id)
          }
          if (sql.includes('SELECT is_default FROM diary_templates WHERE id=?')) {
            const id = Number(params[0])
            const row = state.templateRows.find(item => item.id === id)
            return row ? { is_default: row.is_default } : undefined
          }
          if (sql.includes('SELECT * FROM diary_templates WHERE id=?')) {
            const id = Number(params[0])
            return state.templateRows.find(item => item.id === id)
          }
          if (sql.includes('SELECT image_path, answer_image_path FROM mistakes WHERE id = ?')) {
            if (state.mistakeImagePathQueryError) throw state.mistakeImagePathQueryError
            const id = Number(params[0])
            return state.mistakeRows.find(item => item.id === id)
          }
          if (sql.includes('SELECT mastered FROM mistakes WHERE id=?')) {
            const id = Number(params[0])
            const row = state.mistakeRows.find(item => item.id === id)
            return row ? { mastered: row.mastered ?? 0 } : undefined
          }
          if (sql.includes('FROM mistakes m LEFT JOIN subjects s') && sql.includes('WHERE m.id = ?')) {
            const id = Number(params[0])
            const row = state.mistakeRows.find(item => item.id === id)
            if (!row) return undefined
            const subject = state.subjectRows.find(item => item.id === row.subject_id)
            return {
              ...row,
              subject_name: subject?.name ?? null,
              subject_color: subject?.color ?? null,
            }
          }
          if (sql.includes('FROM mistakes m LEFT JOIN subjects s') && sql.includes('LIMIT 1 OFFSET ?')) {
            const subjectId = sql.includes('AND m.subject_id = ?') ? Number(params[1]) : null
            const offset = Number(params[params.length - 1])
            const rows = state.mistakeRows.filter(row => (
              row.mastered !== 1 &&
              (subjectId == null || row.subject_id === subjectId)
            ))
            return rows[offset]
          }
          if (sql.includes('FROM study_tasks t') && sql.includes('WHERE t.id = ?')) {
            const id = Number(params[0])
            return state.taskRows.find(item => item.id === id)
          }
          if (sql.includes('FROM tags') && sql.includes('WHERE id=?')) {
            const id = Number(params[0])
            return state.tagById ?? state.allTags.find(item => item.id === id)
          }
          return undefined
        }),
        all: vi.fn((...params: unknown[]) => {
          state.preparedCalls.push({ sql, params })
          if (sql.startsWith('PRAGMA table_info')) {
            const tableName = sql.match(/PRAGMA table_info\(([^)]+)\)/)?.[1]?.replace(/^"|"$/g, '')
            if (tableName === 'tags') {
              return [{ name: 'id' }, { name: 'name' }, { name: 'color' }]
            }
            if (tableName === 'pomodoro_sessions') {
              return [{ name: 'date_key' }, { name: 'started_at' }]
            }
            return []
          }
          if (sql.includes('FROM tags') && sql.includes('entry_tags')) {
            if (state.tagRows.length > 0) return state.tagRows
            if (sql.includes('WHERE et.entry_id = ?')) {
              const entryId = Number(params[0])
              return state.entryTagRows
                .filter(row => row.entry_id === entryId)
                .map(row => state.allTags.find(tag => tag.id === row.tag_id))
                .filter((tag): tag is Tag => Boolean(tag))
            }
            const entryIds = new Set(params.map(Number))
            return state.entryTagRows
              .filter(row => entryIds.has(row.entry_id))
              .map(row => {
                const tag = state.allTags.find(item => item.id === row.tag_id)
                return tag ? { entry_id: row.entry_id, ...tag } : null
              })
              .filter((row): row is BatchTagRow => Boolean(row))
          }
          if (sql.includes('FROM tags')) {
            return state.allTags
          }
          if (sql.includes('SELECT * FROM settings')) {
            return Object.entries(state.settings).map(([key, value]) => ({ key, value }))
          }
          if (sql.includes('SUBSTR(content, 1, 200) AS content_snippet FROM entries')) {
            const rawTerm = String(params[0] ?? '').replace(/^%|%$/g, '')
            return state.entryRows
              .filter(row => row.content.includes(rawTerm) || row.title.includes(rawTerm))
              .sort((a, b) => b.date.localeCompare(a.date))
              .map(({ content, ...row }) => ({ ...row, content_snippet: content.slice(0, 200) }))
          }
          if (sql.includes('SELECT date, mood FROM entries WHERE date LIKE ?')) {
            const rawPattern = String(params[0] ?? '').replace(/%$/g, '')
            return state.entryRows
              .filter(row => row.date.startsWith(rawPattern))
              .map(({ date, mood }) => ({ date, mood }))
          }
          if (sql.includes('FROM entries')) {
            let rows = [...state.entryRows]
            const includeContent = sql.startsWith('SELECT * FROM entries')
            const hasMood = sql.includes('mood = ?')
            const hasStartDate = sql.includes('date >= ?')
            const hasEndDate = sql.includes('date <= ?')
            const hasLimit = sql.includes('LIMIT ?')
            let paramIndex = 0
            if (hasMood) {
              const mood = params[paramIndex++]
              rows = rows.filter(row => row.mood === mood)
            }
            if (hasStartDate) {
              const startDate = String(params[paramIndex++])
              rows = rows.filter(row => row.date >= startDate)
            }
            if (hasEndDate) {
              const endDate = String(params[paramIndex++])
              rows = rows.filter(row => row.date <= endDate)
            }
            if (sql.includes('entry_tags')) {
              paramIndex += 1
            }
            rows = rows.sort((a, b) => b.date.localeCompare(a.date))
            if (hasLimit) {
              rows = rows.slice(0, Number(params[paramIndex]))
            }
            return includeContent
              ? rows
              : rows.map(({ content, ...row }) => row)
          }
          if (sql.includes('SELECT * FROM subjects ORDER BY name')) {
            return [...state.subjectRows].sort((a, b) => a.name.localeCompare(b.name))
          }
          if (sql.includes('SELECT * FROM diary_templates ORDER BY sort_order ASC, id ASC')) {
            return [...state.templateRows].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
          }
          if (sql.includes('SELECT * FROM attachments WHERE entry_id=?')) {
            const entryId = Number(params[0])
            return state.attachmentRows.filter(row => row.entry_id === entryId)
          }
          if (sql.includes('FROM attachments')) {
            return state.attachmentRows
          }
          if (sql.includes('FROM pomodoro_sessions p') && sql.includes('GROUP BY p.subject_id')) {
            if (state.pomodoroStatsRows.length > 0) return state.pomodoroStatsRows

            const rows = sql.includes('WHERE p.date_key BETWEEN ? AND ?')
              ? state.pomodoroSessionRows.filter(row => row.date_key != null && row.date_key >= String(params[0]) && row.date_key <= String(params[1]))
              : state.pomodoroSessionRows.filter(row => row.date_key === String(params[0]))
            const grouped = new Map<string, PomodoroStat>()
            for (const row of rows) {
              const key = row.subject_id == null ? 'null' : String(row.subject_id)
              const subject = state.subjectRows.find(item => item.id === row.subject_id)
              const current = grouped.get(key) ?? {
                subject_name: subject?.name ?? null,
                color: subject?.color ?? null,
                total_minutes: 0,
                session_count: 0,
              } as unknown as PomodoroStat
              current.total_minutes += row.duration
              current.session_count += 1
              grouped.set(key, current)
            }
            const result = Array.from(grouped.values())
            return sql.includes('ORDER BY total_minutes DESC')
              ? result.sort((a, b) => b.total_minutes - a.total_minutes)
              : result
          }
          if (sql.includes('FROM pomodoro_sessions') && sql.includes('GROUP BY date_key')) {
            const rows = state.pomodoroSessionRows.filter(row =>
              row.date_key != null &&
              row.date_key >= String(params[0]) &&
              row.date_key <= String(params[1])
            )
            const grouped = new Map<string, PomodoroRangeEntry>()
            for (const row of rows) {
              const date = row.date_key!
              const current = grouped.get(date) ?? { date, total_minutes: 0, session_count: 0 }
              current.total_minutes += row.duration
              current.session_count += 1
              grouped.set(date, current)
            }
            return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date))
          }
          if (sql.includes('FROM study_tasks t') && sql.includes('WHERE t.planned_date = ?')) {
            const date = String(params[0])
            return state.taskRows.filter(row => row.planned_date === date)
          }
          if (sql.includes('FROM mistakes') && sql.includes('id <> ?')) {
            if (state.mistakeImagePathQueryError) throw state.mistakeImagePathQueryError
            const excludedId = Number(params[0])
            return state.mistakeRows.filter(row => row.id !== excludedId && (row.image_path || row.answer_image_path))
          }
          if (sql.includes('SELECT id, image_path, answer_image_path') && sql.includes('FROM mistakes')) {
            return state.mistakeRows.filter(row => row.image_path || row.answer_image_path)
          }
          return []
        }),
      })),
    }
  })

  return { default: MockBetterSqlite3 }
})

async function loadDatabase(options: { preserveInitializeCalls?: boolean } = {}): Promise<DatabaseModule> {
  vi.resetModules()
  state.preparedCalls = []
  state.execCalls = []
  state.tagRows = []
  state.entryTagRows = []
  state.entryRows = []
  state.attachmentRows = []
  state.tagById = null
  state.allTags = []
  state.runChanges = 1
  state.settings = {}
  state.mistakeRows = []
  state.pomodoroSessionRows = []
  state.pomodoroStatsRows = []
  state.taskRows = []
  state.subjectRows = []
  state.templateRows = []
  state.mistakeImagePathQueryError = null
  state.userVersion = 0
  state.closeCalls = 0
  mistakeImageStorageState.deleteManagedMistakeImage.mockReset()
  mistakeImageStorageState.deleteManagedMistakeImage.mockResolvedValue(undefined)
  mistakeImageStorageState.getMistakeImageReferenceKey.mockClear()

  const databaseModulePath = '../electron/database'
  const imported = await import(databaseModulePath) as unknown as DatabaseModule | { default: DatabaseModule }
  const database = 'default' in imported ? imported.default : imported
  database.initialize()
  if (!options.preserveInitializeCalls) {
    state.preparedCalls = []
    state.execCalls = []
  }
  return database
}

function lastPreparedCall(): PreparedCall {
  const lastCall = state.preparedCalls[state.preparedCalls.length - 1]
  if (!lastCall) throw new Error('Expected a prepared statement call')
  return lastCall
}

describe('database batch entry metadata APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    vi.mocked(safeStorage.encryptString).mockImplementation((value: string) => Buffer.from(value))
    vi.mocked(safeStorage.decryptString).mockImplementation((value: Buffer) => value.toString('utf8'))
  })

  it('returns empty records for empty tag and attachment batch inputs without querying', async () => {
    const database = await loadDatabase()

    expect(database.getEntryTagsBatch([])).toEqual({})
    expect(database.getAttachmentsByEntries([])).toEqual({})
    expect(state.preparedCalls).toEqual([])
  })

  it('migrates legacy tag tables with style columns and safe defaults', async () => {
    await loadDatabase({ preserveInitializeCalls: true })

    expect(state.execCalls).toEqual(expect.arrayContaining([
      expect.stringContaining('ADD COLUMN "icon"'),
      expect.stringContaining('ADD COLUMN "variant"'),
      expect.stringContaining('ADD COLUMN "pattern"'),
    ]))
  })

  it('creates styled tags and preserves omitted fields on partial updates', async () => {
    const database = await loadDatabase()

    const created = database.createTag({
      name: 'focus',
      color: '#0E7490',
      icon: ' 🌿🌿🌿🌿🌿 ',
      variant: 'solid',
      pattern: 'dots',
    })

    expect(created).toEqual({
      id: 1,
      name: 'focus',
      color: '#0E7490',
      icon: '🌿🌿🌿🌿',
      variant: 'solid',
      pattern: 'dots',
    })

    state.tagById = {
      id: 7,
      name: 'focus',
      color: '#0E7490',
      icon: '',
      variant: 'soft',
      pattern: 'none',
    }

    expect(database.updateTag(7, { icon: '☆', pattern: 'grid' })).toEqual({
      id: 7,
      name: 'focus',
      color: '#0E7490',
      icon: '☆',
      variant: 'soft',
      pattern: 'grid',
    })

    const updateCall = state.preparedCalls.find(call => call.sql.includes('UPDATE tags SET'))
    expect(updateCall?.params).toEqual(['focus', '#0E7490', '☆', 'soft', 'grid', 7])
  })

  it('throws when updating a missing tag id', async () => {
    const database = await loadDatabase()

    expect(() => database.updateTag(404, { name: 'missing' })).toThrow('Tag not found')
    expect(state.preparedCalls.some(call => call.sql.includes('UPDATE tags SET'))).toBe(false)
  })

  it('throws when creating or updating tags with empty names', async () => {
    const database = await loadDatabase()

    expect(() => database.createTag({ name: '   ', color: '#0F766E' })).toThrow('Tag name is required')

    state.tagById = {
      id: 7,
      name: 'focus',
      color: '#0E7490',
      icon: '',
      variant: 'soft',
      pattern: 'none',
    }

    expect(() => database.updateTag(7, { name: '   ' })).toThrow('Tag name is required')
  })

  it('groups entry tags by entry id and initializes empty arrays for misses', async () => {
    const database = await loadDatabase()
    state.tagRows = [
      { entry_id: 2, id: 10, name: 'math', color: '#0F766E' },
      { entry_id: 2, id: 11, name: 'english', color: '#0E7490' },
      { entry_id: 4, id: 12, name: 'review', color: '#475569' },
    ]

    expect(database.getEntryTagsBatch([2, 4, 5])).toEqual({
      2: [
        { id: 10, name: 'math', color: '#0F766E', icon: '', variant: 'soft', pattern: 'none' },
        { id: 11, name: 'english', color: '#0E7490', icon: '', variant: 'soft', pattern: 'none' },
      ],
      4: [{ id: 12, name: 'review', color: '#475569', icon: '', variant: 'soft', pattern: 'none' }],
      5: [],
    })

    const call = lastPreparedCall()
    expect(call.sql).toContain('et.entry_id IN (?, ?, ?)')
    expect(call.params).toEqual([2, 4, 5])
  })

  it('deduplicates and filters invalid tag batch ids before querying', async () => {
    const database = await loadDatabase()

    expect(database.getEntryTagsBatch([2, 2, 0, -1, 3.5, Number.NaN, 4])).toEqual({
      2: [],
      4: [],
    })

    const call = lastPreparedCall()
    expect(call.sql).toContain('et.entry_id IN (?, ?)')
    expect(call.params).toEqual([2, 4])
  })

  it('groups attachments by entry id and initializes empty arrays for misses', async () => {
    const database = await loadDatabase()
    state.attachmentRows = [
      {
        id: 20,
        entry_id: 2,
        filename: 'a.png',
        filepath: '2_a.png',
        mimetype: 'image/png',
        created_at: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 21,
        entry_id: 4,
        filename: 'b.png',
        filepath: '4_b.png',
        mimetype: 'image/png',
        created_at: '2026-05-18T00:00:00.000Z',
      },
    ]

    expect(database.getAttachmentsByEntries([2, 4, 5])).toEqual({
      2: [state.attachmentRows[0]],
      4: [state.attachmentRows[1]],
      5: [],
    })

    const call = lastPreparedCall()
    expect(call.sql).toContain('entry_id IN (?, ?, ?)')
    expect(call.params).toEqual([2, 4, 5])
  })

  it('deduplicates and filters invalid attachment batch ids before querying', async () => {
    const database = await loadDatabase()

    expect(database.getAttachmentsByEntries([2, 2, 0, -1, 3.5, Number.NaN, 4])).toEqual({
      2: [],
      4: [],
    })

    const call = lastPreparedCall()
    expect(call.sql).toContain('entry_id IN (?, ?)')
    expect(call.params).toEqual([2, 4])
  })
})

describe('database repository facade APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves entry CRUD, list, search, and date behavior through database.ts', async () => {
    const database = await loadDatabase()

    expect(database.createEntry({
      date: '2026-06-06',
      title: 'First',
      content: 'hello world',
      mood: 'happy',
    })).toEqual({
      id: 1,
      date: '2026-06-06',
      title: 'First',
      content: 'hello world',
      mood: 'happy',
      word_count: 10,
    })
    database.createEntry({
      date: '2026-06-07',
      title: 'Second',
      content: 'quiet focus',
      mood: 'calm',
    })

    expect(database.getEntryById(1)).toEqual(expect.objectContaining({ id: 1, title: 'First' }))
    expect(database.getEntryByDate('2026-06-07')).toEqual(expect.objectContaining({ id: 2, title: 'Second' }))
    expect(database.getAllEntries({
      mood: 'happy',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      tagId: 7,
      limit: 1,
    })).toEqual([expect.objectContaining({ id: 1, title: 'First' })])
    expect(database.searchEntries('focus')).toEqual([expect.objectContaining({ id: 2, content_snippet: 'quiet focus' })])
    expect(database.getDatesWithEntries('2026-06')).toEqual([
      { date: '2026-06-06', mood: 'happy' },
      { date: '2026-06-07', mood: 'calm' },
    ])
    expect(database.updateEntry(1, {
      title: 'Updated',
      content: 'two words',
      mood: null,
    })).toEqual(expect.objectContaining({
      id: 1,
      title: 'Updated',
      content: 'two words',
      mood: null,
      word_count: 8,
    }))
    expect(database.deleteEntry(2)).toEqual({ success: true })

    expect(state.preparedCalls.some(call => call.sql === 'INSERT INTO entries (date, title, content, mood, word_count) VALUES (?, ?, ?, ?, ?)')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'UPDATE entries SET title=?, content=?, mood=?, word_count=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')).toBe(true)
    const listCall = state.preparedCalls.find(call => call.sql.includes('id IN (SELECT entry_id FROM entry_tags WHERE tag_id = ?)'))
    expect(listCall?.params).toEqual(['happy', '2026-06-01', '2026-06-30', 7, 1])
  })

  it('preserves attachment CRUD and batch behavior through database.ts', async () => {
    const database = await loadDatabase()

    const first = database.addAttachment(2, {
      filename: 'first.png',
      filepath: 'attachments/first.png',
      mimetype: 'image/png',
    })
    const second = database.addAttachment(4, {
      filename: 'second.jpg',
      filepath: 'attachments/second.jpg',
      mimetype: 'image/jpeg',
    })

    expect(first).toEqual({
      id: 1,
      entry_id: 2,
      filename: 'first.png',
      filepath: 'attachments/first.png',
      mimetype: 'image/png',
    })
    expect(database.getAttachmentsByEntry(2)).toEqual([expect.objectContaining(first)])
    expect(database.getAttachmentById(2)).toEqual(expect.objectContaining(second))
    expect(database.getAttachmentsByEntries([2, 2, 0, -1, 3.5, Number.NaN, 4])).toEqual({
      2: [expect.objectContaining(first)],
      4: [expect.objectContaining(second)],
    })
    expect(database.removeAttachment(1)).toEqual({ success: true })
    expect(database.getAttachmentById(1)).toBeUndefined()

    expect(state.preparedCalls.some(call => call.sql === 'INSERT INTO attachments (entry_id, filename, filepath, mimetype) VALUES (?, ?, ?, ?)')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'SELECT * FROM attachments WHERE entry_id=?')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'DELETE FROM attachments WHERE id=?')).toBe(true)
  })

  it('preserves tag facade exports, CRUD, relation replacement, and batch behavior through database.ts', async () => {
    const database = await loadDatabase()

    expect(database.getAllTags).toBeTypeOf('function')
    expect(database.createTag).toBeTypeOf('function')
    expect(database.updateTag).toBeTypeOf('function')
    expect(database.deleteTag).toBeTypeOf('function')
    expect(database.setEntryTags).toBeTypeOf('function')
    expect(database.getEntryTags).toBeTypeOf('function')
    expect(database.getEntryTagsBatch).toBeTypeOf('function')
    expect(Object.prototype.hasOwnProperty.call(database, 'getTagById')).toBe(false)

    const alpha = database.createTag({
      name: ' alpha ',
      color: '#0E7490',
      icon: 'abcde',
      variant: 'solid',
      pattern: 'dots',
    })
    const beta = database.createTag({ name: 'beta' })

    expect(alpha).toEqual({
      id: 1,
      name: 'alpha',
      color: '#0E7490',
      icon: 'abcd',
      variant: 'solid',
      pattern: 'dots',
    })
    expect(beta).toEqual({
      id: 2,
      name: 'beta',
      color: '#0F766E',
      icon: '',
      variant: 'soft',
      pattern: 'none',
    })
    expect(database.getAllTags()).toEqual([alpha, beta])

    expect(database.updateTag(alpha.id, { icon: 'xyz12', pattern: 'grid' })).toEqual({
      id: alpha.id,
      name: 'alpha',
      color: '#0E7490',
      icon: 'xyz1',
      variant: 'solid',
      pattern: 'grid',
    })
    expect(database.setEntryTags(7, [alpha.id, beta.id])).toEqual({ success: true })
    expect(database.getEntryTags(7)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: alpha.id, name: 'alpha', icon: 'xyz1', pattern: 'grid' }),
      beta,
    ]))
    expect(database.getEntryTagsBatch([7, 7, 0, -1, 3.5, Number.NaN, 8])).toEqual({
      7: expect.arrayContaining([
        expect.objectContaining({ id: alpha.id, name: 'alpha', icon: 'xyz1', pattern: 'grid' }),
        beta,
      ]),
      8: [],
    })
    expect(database.deleteTag(beta.id)).toEqual({ success: true })

    expect(state.preparedCalls.some(call => call.sql === 'SELECT * FROM tags ORDER BY name')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'INSERT INTO tags (name, color, icon, variant, pattern) VALUES (?, ?, ?, ?, ?)')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'SELECT * FROM tags WHERE id=?')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'UPDATE tags SET name=?, color=?, icon=?, variant=?, pattern=? WHERE id=?')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'DELETE FROM tags WHERE id=?')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'DELETE FROM entry_tags WHERE entry_id=?')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'SELECT t.* FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id = ?')).toBe(true)
    const batchCall = state.preparedCalls.find(call => call.sql.includes('SELECT et.entry_id, t.* FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id IN'))
    expect(batchCall?.sql).toContain('et.entry_id IN (?, ?)')
    expect(batchCall?.params).toEqual([7, 8])
    const relationCalls = state.preparedCalls.filter(call =>
      call.sql === 'DELETE FROM entry_tags WHERE entry_id=?' ||
      call.sql === 'INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)'
    )
    expect(relationCalls.map(call => call.params)).toEqual([
      [7],
      [7, alpha.id],
      [7, beta.id],
    ])
  })

  it('preserves raw settings get, set, and getAll behavior through database.ts', async () => {
    const database = await loadDatabase()

    expect(database.getSetting('theme')).toBeNull()
    expect(database.setSetting('theme', 'dark')).toEqual({ success: true })
    expect(database.getSetting('theme')).toBe('dark')
    expect(database.getAllSettings()).toEqual({ theme: 'dark' })

    expect(state.preparedCalls.map(call => call.sql)).toEqual([
      'SELECT value FROM settings WHERE key=?',
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      'SELECT value FROM settings WHERE key=?',
      'SELECT * FROM settings',
    ])
  })

  it('preserves subject CRUD behavior through database.ts', async () => {
    const database = await loadDatabase()

    expect(database.createSubject({ name: 'Math' })).toEqual({
      id: 1,
      name: 'Math',
      total_chapters: 0,
      completed_chapters: 0,
      color: '#0F766E',
    })
    expect(database.updateSubject(1, {
      name: 'Advanced Math',
      total_chapters: 12,
      completed_chapters: 3,
      color: '#123456',
    })).toEqual({
      id: 1,
      name: 'Advanced Math',
      total_chapters: 12,
      completed_chapters: 3,
      color: '#123456',
    })
    expect(database.getAllSubjects()).toEqual([{
      id: 1,
      name: 'Advanced Math',
      total_chapters: 12,
      completed_chapters: 3,
      color: '#123456',
    }])
    expect(database.deleteSubject(1)).toEqual({ success: true })
    expect(database.getAllSubjects()).toEqual([])

    expect(state.preparedCalls.some(call => call.sql === 'INSERT INTO subjects (name, total_chapters, color) VALUES (?, ?, ?)')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'UPDATE subjects SET name=?, total_chapters=?, completed_chapters=?, color=? WHERE id=?')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'DELETE FROM subjects WHERE id=?')).toBe(true)
  })

  it('preserves template CRUD behavior through database.ts', async () => {
    const database = await loadDatabase()
    state.templateRows = [{
      id: 1,
      name: 'Default',
      content: '# Default',
      is_default: 1,
      sort_order: 1,
      created_at: '2026-06-06 08:00:00',
      updated_at: '2026-06-06 08:00:00',
    }]

    expect(database.createTemplate({ name: 'Custom', content: '# Custom', sort_order: 4 })).toEqual({
      id: 2,
      name: 'Custom',
      content: '# Custom',
      is_default: 0,
      sort_order: 4,
    })
    expect(database.getAllTemplates().map(template => template.name)).toEqual(['Default', 'Custom'])
    expect(database.updateTemplate(2, { content: '# Updated', sort_order: 2 })).toEqual(expect.objectContaining({
      id: 2,
      name: 'Custom',
      content: '# Updated',
      is_default: 0,
      sort_order: 2,
    }))
    expect(database.deleteTemplate(1)).toEqual({ success: false, message: '默认模板不可删除' })
    expect(database.deleteTemplate(2)).toEqual({ success: true })
    expect(database.getAllTemplates().map(template => template.name)).toEqual(['Default'])

    expect(state.preparedCalls.some(call => call.sql === 'SELECT * FROM diary_templates ORDER BY sort_order ASC, id ASC')).toBe(true)
    expect(state.preparedCalls.some(call => call.sql.includes('UPDATE diary_templates SET content = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id=?'))).toBe(true)
    expect(state.preparedCalls.some(call => call.sql === 'SELECT is_default FROM diary_templates WHERE id=?')).toBe(true)
  })
})

describe('database pomodoro facade APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves pomodoro exports, insert SQL, and daily/range query behavior through database.ts', async () => {
    const database = await loadDatabase()

    expect(database.addPomodoroSession).toBeTypeOf('function')
    expect(database.getPomodoroStats).toBeTypeOf('function')
    expect(database.getPomodoroStatsRange).toBeTypeOf('function')
    expect(database.getDailyStudyMinutes).toBeTypeOf('function')
    expect(database.getPomodoroRange).toBeTypeOf('function')
    expect(Object.prototype.hasOwnProperty.call(database, 'normalizeOptionalDateTime')).toBe(false)

    expect(database.addPomodoroSession({
      subject_id: 0,
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

    const insertCall = lastPreparedCall()
    expect(insertCall.sql).toBe('INSERT INTO pomodoro_sessions (subject_id, task_id, duration, date_key, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)')
    expect(insertCall.params).toEqual([null, null, 25, '2026-06-06', '2026-06-06 09:00:00', '2026-06-06 09:25:00'])

    state.pomodoroStatsRows = [
      { subject_name: 'Math', color: '#0F766E', total_minutes: 25, session_count: 1 },
    ]
    expect(database.getPomodoroStats('2026-06-06')).toEqual(state.pomodoroStatsRows)
    const statsCall = lastPreparedCall()
    expect(statsCall.sql).toContain('FROM pomodoro_sessions p')
    expect(statsCall.sql).toContain('LEFT JOIN subjects s ON p.subject_id = s.id')
    expect(statsCall.sql).toContain('WHERE p.date_key = ?')
    expect(statsCall.sql).toContain('GROUP BY p.subject_id')
    expect(statsCall.sql).not.toContain('ORDER BY')
    expect(statsCall.params).toEqual(['2026-06-06'])

    state.pomodoroStatsRows = [
      { subject_name: 'Math', color: '#0F766E', total_minutes: 75, session_count: 3 },
      { subject_name: 'English', color: '#854D0E', total_minutes: 30, session_count: 1 },
    ]
    expect(database.getPomodoroStatsRange('2026-06-01', '2026-06-30')).toEqual(state.pomodoroStatsRows)
    const rangeStatsCall = lastPreparedCall()
    expect(rangeStatsCall.sql).toContain('WHERE p.date_key BETWEEN ? AND ?')
    expect(rangeStatsCall.sql).toContain('GROUP BY p.subject_id')
    expect(rangeStatsCall.sql).toContain('ORDER BY total_minutes DESC')
    expect(rangeStatsCall.params).toEqual(['2026-06-01', '2026-06-30'])

    expect(database.getDailyStudyMinutes('2026-06-06')).toBe(25)
    const dailyTotalCall = lastPreparedCall()
    expect(dailyTotalCall.sql).toBe('SELECT COALESCE(SUM(duration), 0) as total FROM pomodoro_sessions WHERE date_key = ?')
    expect(dailyTotalCall.params).toEqual(['2026-06-06'])

    expect(database.getPomodoroRange('2026-06-01', '2026-06-30')).toEqual([
      { date: '2026-06-06', total_minutes: 25, session_count: 1 },
    ])
    const rangeCall = lastPreparedCall()
    expect(rangeCall.sql).toContain('FROM pomodoro_sessions')
    expect(rangeCall.sql).toContain('WHERE date_key BETWEEN ? AND ?')
    expect(rangeCall.sql).toContain('GROUP BY date_key')
    expect(rangeCall.sql).toContain('ORDER BY date ASC')
    expect(rangeCall.params).toEqual(['2026-06-01', '2026-06-30'])
  })

  it('aggregates pomodoro sessions by subject over an inclusive date range', async () => {
    state.pomodoroStatsRows = [
      { subject_name: 'Math', color: '#0F766E', total_minutes: 75, session_count: 3 },
      { subject_name: 'English', color: '#854D0E', total_minutes: 30, session_count: 1 },
    ]
    const database = await loadDatabase()

    const result = database.getPomodoroStatsRange('2026-05-01', '2026-05-31')

    expect(result).toEqual(state.pomodoroStatsRows)
    const call = lastPreparedCall()
    expect(call.sql).toContain('FROM pomodoro_sessions p')
    expect(call.sql).toContain('LEFT JOIN subjects s ON p.subject_id = s.id')
    expect(call.sql).toContain('WHERE p.date_key BETWEEN ? AND ?')
    expect(call.sql).toContain('GROUP BY p.subject_id')
    expect(call.sql).toContain('ORDER BY total_minutes DESC')
    expect(call.params).toEqual(['2026-05-01', '2026-05-31'])
  })
})

describe('database study task APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates the study_tasks table and supporting indexes during initialize', async () => {
    await loadDatabase({ preserveInitializeCalls: true })

    expect(state.execCalls).toEqual(expect.arrayContaining([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS study_tasks'),
      expect.stringContaining('idx_study_tasks_planned_date'),
      expect.stringContaining('idx_study_tasks_status'),
      expect.stringContaining('idx_study_tasks_subject_id'),
    ]))
  })

  it('creates and lists study tasks by planned date', async () => {
    const database = await loadDatabase()

    expect(database.getStudyTasksByDate).toBeTypeOf('function')
    expect(database.createStudyTask).toBeTypeOf('function')
    expect(database.updateStudyTask).toBeTypeOf('function')
    expect(database.deleteStudyTask).toBeTypeOf('function')
    expect(database.completeStudyTask).toBeTypeOf('function')
    expect(database.skipStudyTask).toBeTypeOf('function')
    expect(database.startStudyTaskFocus).toBeTypeOf('function')
    expect(Object.prototype.hasOwnProperty.call(database, 'getStudyTaskById')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(database, 'requireStudyTask')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(database, 'normalizeStudyTaskTitle')).toBe(false)

    const created = database.createStudyTask({
      title: 'Review wrong answers',
      description: '10 high-risk questions',
      type: 'review',
      subject_id: 2,
      planned_date: '2026-05-31',
      estimate_minutes: 30,
      source: 'dashboard',
    })

    const insertCall = state.preparedCalls.find(call => call.sql.includes('INSERT INTO study_tasks'))
    expect(insertCall?.sql).toContain(`INSERT INTO study_tasks (
          title,
          description,
          type,
          subject_id,
          related_mistake_id,
          related_entry_id,
          related_chapter_id,
          planned_date,
          estimate_minutes,
          status,
          source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    expect(insertCall?.params).toEqual([
      'Review wrong answers',
      '10 high-risk questions',
      'review',
      2,
      null,
      null,
      null,
      '2026-05-31',
      30,
      'todo',
      'dashboard',
    ])

    expect(created).toEqual(expect.objectContaining({
      id: 1,
      title: 'Review wrong answers',
      description: '10 high-risk questions',
      type: 'review',
      subject_id: 2,
      planned_date: '2026-05-31',
      estimate_minutes: 30,
      status: 'todo',
      source: 'dashboard',
    }))

    expect(database.getStudyTasksByDate('2026-05-31')).toEqual([created])
    const listCall = lastPreparedCall()
    expect(listCall.sql).toContain('WHERE t.planned_date = ?')
    expect(listCall.sql).toContain("WHEN 'doing' THEN 0")
    expect(listCall.sql).toContain("WHEN 'todo' THEN 1")
    expect(listCall.sql).toContain("WHEN 'skipped' THEN 2")
    expect(listCall.sql).toContain("WHEN 'done' THEN 3")
    expect(listCall.sql).toContain('t.created_at ASC')
    expect(listCall.sql).toContain('t.id ASC')
    expect(listCall.params).toEqual(['2026-05-31'])
  })

  it('updates, completes, skips, and deletes study tasks', async () => {
    const database = await loadDatabase()
    const created = database.createStudyTask({
      title: 'Write reflection',
      planned_date: '2026-05-31',
    })

    const updated = database.updateStudyTask(created.id, {
      title: 'Write daily reflection',
      description: null as never,
      type: 'diary',
      subject_id: 3,
      related_mistake_id: 4,
      related_entry_id: 5,
      planned_date: '2026-06-01',
      status: 'doing',
      estimate_minutes: 15,
      source: 'ai',
    })
    expect(updated).toEqual(expect.objectContaining({
      id: created.id,
      title: 'Write daily reflection',
      description: '',
      type: 'diary',
      subject_id: 3,
      related_mistake_id: 4,
      related_entry_id: 5,
      planned_date: '2026-06-01',
      status: 'doing',
      estimate_minutes: 15,
      source: 'ai',
    }))
    const updateCall = state.preparedCalls.find(call => call.sql.includes('UPDATE study_tasks SET title = ?'))
    expect(updateCall?.sql).toContain('UPDATE study_tasks SET title = ?, description = ?, type = ?, subject_id = ?, related_mistake_id = ?, related_entry_id = ?, planned_date = ?, estimate_minutes = ?, status = ?, source = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    expect(updateCall?.params).toEqual([
      'Write daily reflection',
      '',
      'diary',
      3,
      4,
      5,
      '2026-06-01',
      15,
      'doing',
      'ai',
      created.id,
    ])

    state.preparedCalls = []
    expect(database.updateStudyTask(created.id, {})).toEqual(expect.objectContaining({ id: created.id, title: 'Write daily reflection' }))
    expect(state.preparedCalls.some(call => call.sql.includes('UPDATE study_tasks SET'))).toBe(false)

    await expect(database.startStudyTaskFocus(created.id, '2026-06-01')).toEqual(expect.objectContaining({ status: 'doing' }))
    await expect(database.completeStudyTask(created.id)).toEqual(expect.objectContaining({ status: 'done' }))
    const completeCall = state.preparedCalls.find(call => call.sql.includes('UPDATE study_tasks SET status = ?') && call.params[0] === 'done')
    expect(completeCall?.params).toEqual(['done', created.id])
    await expect(database.skipStudyTask(created.id)).toEqual(expect.objectContaining({ status: 'skipped' }))
    const skipCall = state.preparedCalls.find(call => call.sql.includes('UPDATE study_tasks SET status = ?') && call.params[0] === 'skipped')
    expect(skipCall?.params).toEqual(['skipped', created.id])
    expect(database.deleteStudyTask(created.id)).toBe(true)
    const deleteCall = state.preparedCalls.find(call => call.sql === 'DELETE FROM study_tasks WHERE id = ?')
    expect(deleteCall?.params).toEqual([created.id])
    expect(database.getStudyTasksByDate('2026-05-31')).toEqual([])
  })

  it('rejects invalid study task input before writing', async () => {
    const database = await loadDatabase()

    expect(() => database.createStudyTask({
      title: '   ',
      planned_date: '2026-05-31',
    })).toThrow('Task title is required')

    expect(() => database.createStudyTask({
      title: 'Invalid date',
      planned_date: '05/31/2026',
    })).toThrow('planned_date must be YYYY-MM-DD')

    expect(() => database.createStudyTask({
      title: 'Invalid type',
      planned_date: '2026-05-31',
      type: 'quiz',
    })).toThrow('Invalid task type')

    expect(() => database.updateStudyTask(1, { status: 'archived' })).toThrow('Invalid task status')
    expect(state.preparedCalls.some(call => call.sql.includes('INSERT INTO study_tasks'))).toBe(false)
  })
})

describe('database mistake due filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters due-review mistakes with the same risk-pool condition', async () => {
    const database = await loadDatabase()

    database.getAllMistakes({ due: true, dueDate: '2026-05-30' })

    const countCall = state.preparedCalls.find(call => call.sql.includes('SUM(CASE WHEN m.mastered = 1'))
    expect(countCall?.sql).toContain('m.mastered = 0')
    expect(countCall?.sql).toContain('(m.next_review_date IS NULL OR m.next_review_date <= ?)')
    expect(countCall?.params).toEqual(['2026-05-30'])

    const listCall = state.preparedCalls.find(call => call.sql.includes('SELECT m.*, s.name as subject_name'))
    expect(listCall?.sql).toContain('m.mastered = 0')
    expect(listCall?.sql).toContain('(m.next_review_date IS NULL OR m.next_review_date <= ?)')
    expect(listCall?.params).toEqual(['2026-05-30'])
  })
})

describe('database AI key storage safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    vi.mocked(safeStorage.encryptString).mockImplementation((value: string) => Buffer.from(`encrypted:${value}`))
    vi.mocked(safeStorage.decryptString).mockImplementation((value: Buffer) => {
      const raw = value.toString('utf8')
      if (!raw.startsWith('encrypted:')) {
        throw new Error('decrypt failed')
      }
      return raw.replace(/^encrypted:/, '')
    })
  })

  it('stores encrypted API keys when safeStorage is available', async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    const database = await loadDatabase()

    database.setAiApiKey('sk-secret-key')

    expect(String(state.settings.aiApiKey)).not.toContain('sk-secret-key')
    expect(state.settings.aiApiKey).toBe(`enc:v1:${Buffer.from('encrypted:sk-secret-key').toString('base64')}`)
    expect(database.getAiApiKey()).toBe('sk-secret-key')
  })

  it('migrates legacy plaintext API keys when safeStorage is available', async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    const database = await loadDatabase()
    state.settings.aiApiKey = 'sk-legacy-key'

    expect(database.getAiApiKey()).toBe('sk-legacy-key')

    expect(String(state.settings.aiApiKey)).toMatch(/^enc:v1:/)
    expect(String(state.settings.aiApiKey)).not.toContain('sk-legacy-key')
    const warningText = vi.mocked(logger.warn).mock.calls.flat().map(String).join(' ')
    expect(warningText).not.toContain('sk-legacy-key')
  })

  it('does not re-encrypt API keys that already have the current encryption prefix', async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    const database = await loadDatabase()
    const encrypted = `enc:v1:${Buffer.from('encrypted:sk-current-key').toString('base64')}`
    state.settings.aiApiKey = encrypted
    vi.mocked(safeStorage.encryptString).mockClear()

    expect(database.getAiApiKey()).toBe('sk-current-key')

    expect(state.settings.aiApiKey).toBe(encrypted)
    expect(safeStorage.encryptString).not.toHaveBeenCalled()
  })

  it('refuses to persist API keys when safeStorage is unavailable', async () => {
    const database = await loadDatabase()

    expect(() => database.setAiApiKey('sk-secret-key')).toThrow('当前系统加密能力不可用，无法安全保存 API Key')
    expect(state.settings.aiApiKey).toBeUndefined()

    const warningText = vi.mocked(logger.warn).mock.calls.flat().map(String).join(' ')
    expect(warningText).toContain('safeStorage unavailable')
    expect(warningText).not.toContain('sk-secret-key')
  })
})

describe('database mistake image cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps public mistake exports while hiding cleanup query helpers from module exports', async () => {
    const database = await loadDatabase()

    expect(database.getAllMistakes).toEqual(expect.any(Function))
    expect(database.createMistake).toEqual(expect.any(Function))
    expect(database.createMistakes).toEqual(expect.any(Function))
    expect(database.updateMistake).toEqual(expect.any(Function))
    expect(database.deleteMistake).toEqual(expect.any(Function))
    expect(database.toggleMistakeMastered).toEqual(expect.any(Function))
    expect(database.reviewMistake).toEqual(expect.any(Function))
    expect(database.getDueForReviewCount).toEqual(expect.any(Function))
    expect(database.getRandomDueMistake).toEqual(expect.any(Function))
    expect(database).not.toHaveProperty('getMistakeImagePath')
    expect(database).not.toHaveProperty('getOtherMistakeImagePaths')
    expect(database).not.toHaveProperty('getMistakeImageFields')
    expect(database).not.toHaveProperty('getOtherMistakeImageFields')
  })

  it('keeps mistake facade SQL and parameter order stable through the repository', async () => {
    const database = await loadDatabase()

    expect(database.createMistake({
      subject_id: 0,
      question: '',
      answer: 'Answer',
      notes: '',
      mastered: true,
      ease_factor: 1.8,
      review_interval: 14,
      next_review_date: '2027-01-15',
      review_count: 4,
      image_path: '',
      answer_image_path: '',
    })).toEqual({ id: 1 })
    const insertCall = state.preparedCalls.find(call => call.sql.includes('INSERT INTO mistakes'))
    expect(insertCall).toEqual({
      sql: `INSERT INTO mistakes (
                subject_id, question, answer, notes, mastered,
                ease_factor, review_interval, next_review_date, review_count,
                image_path, answer_image_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [null, '', 'Answer', '', 1, 1.8, 14, '2027-01-15', 4, null, null],
    })

    state.mistakeRows = [{ id: 3, image_path: null, answer_image_path: null, mastered: 0 }]
    await expect(database.updateMistake(3, {
      subject_id: 2,
      question: 'Question',
      answer: 'Answer',
      notes: 'Notes',
      mastered: false,
      ease_factor: 2.2,
      review_interval: 21,
      next_review_date: null,
      review_count: 5,
      image_path: 'mistake_images/new.png',
      answer_image_path: 'mistake_images/answer.png',
    })).resolves.toEqual({ success: true })
    const updateCall = state.preparedCalls.find(call => call.sql.includes('UPDATE mistakes SET subject_id = ?'))
    expect(updateCall).toEqual({
      sql: 'UPDATE mistakes SET subject_id = ?, question = ?, answer = ?, notes = ?, mastered = ?, ease_factor = ?, review_interval = ?, next_review_date = ?, review_count = ?, image_path = ?, answer_image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id=?',
      params: [2, 'Question', 'Answer', 'Notes', 0, 2.2, 21, null, 5, 'mistake_images/new.png', 'mistake_images/answer.png', 3],
    })

    expect(database.toggleMistakeMastered(3)).toEqual({ mastered: 1 })
    expect(state.preparedCalls).toEqual(expect.arrayContaining([
      {
        sql: 'UPDATE mistakes SET mastered = 1 - mastered, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        params: [3],
      },
      {
        sql: 'SELECT mastered FROM mistakes WHERE id=?',
        params: [3],
      },
    ]))

    state.mistakeRows = [{ id: 3, image_path: null, answer_image_path: null, mastered: 0 }]
    expect(database.reviewMistake(3, {
      ease_factor: 2.4,
      review_interval: 5,
      next_review_date: '2026-06-11',
      review_count: 2,
    })).toEqual({ success: true, mistake: expect.objectContaining({ id: 3 }) })
    const reviewCall = state.preparedCalls.find(call => call.sql.includes('SET ease_factor = ?'))
    expect(reviewCall?.params).toEqual([2.4, 5, '2026-06-11', 2, 3])

    state.mistakeRows = [{ id: 3, image_path: null, answer_image_path: null, mastered: 0 }]
    expect(database.getDueForReviewCount('2026-06-06')).toBe(1)
    const dueCountCall = state.preparedCalls.find(call => call.sql.includes('SELECT COUNT(*) as count FROM mistakes'))
    expect(dueCountCall?.sql).toContain('mastered = 0 AND (next_review_date IS NULL OR next_review_date <= ?)')
    expect(dueCountCall?.params).toEqual(['2026-06-06'])

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.75)
    state.mistakeRows = [
      { id: 10, image_path: null, answer_image_path: null, subject_id: 2, mastered: 0, question: 'first' },
      { id: 11, image_path: null, answer_image_path: null, subject_id: 2, mastered: 0, question: 'second' },
      { id: 12, image_path: null, answer_image_path: null, subject_id: 2, mastered: 0, question: 'third' },
      { id: 13, image_path: null, answer_image_path: null, subject_id: 2, mastered: 0, question: 'fourth' },
    ]
    expect(database.getRandomDueMistake('2026-06-06', 2)).toEqual(expect.objectContaining({ id: 13 }))
    randomSpy.mockRestore()
    const randomCountCall = state.preparedCalls.find(call => call.sql.includes('SELECT COUNT(*) as cnt FROM mistakes m'))
    const randomSelectCall = state.preparedCalls.find(call => call.sql.includes('LIMIT 1 OFFSET ?'))
    expect(randomCountCall?.params).toEqual(['2026-06-06', 2])
    expect(randomSelectCall?.params).toEqual(['2026-06-06', 2, 3])
  })

  it('deletes a removed single-image legacy reference', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{ id: 1, image_path: 'mistake_images/old.png' }]

    await expect(database.updateMistake(1, { image_path: null })).resolves.toEqual({ success: true })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledWith('mistake_images/old.png')
  })

  it('discards an unreferenced pending image but refuses to delete a committed image', async () => {
    const database = await loadDatabase()

    await expect(database.discardUnreferencedMistakeImage('mistake_images/pending.png')).resolves.toEqual({ success: true })
    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledWith('mistake_images/pending.png')

    mistakeImageStorageState.deleteManagedMistakeImage.mockClear()
    state.mistakeRows = [{ id: 1, image_path: null, answer_image_path: 'mistake_images/committed.png' }]

    await expect(database.discardUnreferencedMistakeImage('local://mistake_images/Committed.png')).rejects.toThrow(/still referenced/i)
    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()
  })

  it('deletes a removed answer-image reference', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{ id: 1, image_path: null, answer_image_path: 'mistake_images/old-answer.png' }]

    await expect(database.updateMistake(1, { answer_image_path: null })).resolves.toEqual({ success: true })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledWith('mistake_images/old-answer.png')
  })

  it('deletes only the removed image from a JSON image list', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{ id: 1, image_path: JSON.stringify(['mistake_images/a.png', 'mistake_images/b.png']) }]

    await database.updateMistake(1, { image_path: JSON.stringify(['mistake_images/b.png']) })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledTimes(1)
    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledWith('mistake_images/a.png')
  })

  it('does not delete a removed image still referenced by another mistake', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [
      { id: 1, image_path: 'mistake_images/shared.png' },
      { id: 2, image_path: 'mistake_images/shared.png' },
    ]

    await database.updateMistake(1, { image_path: null })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()
  })

  it('does not delete when moving an image between question and answer roles on the same mistake', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [
      { id: 1, image_path: 'mistake_images/move.png', answer_image_path: null },
    ]

    await database.updateMistake(1, {
      image_path: null,
      answer_image_path: 'mistake_images/move.png',
    })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()

    state.mistakeRows = [
      { id: 1, image_path: null, answer_image_path: 'mistake_images/move.png' },
    ]
    await database.updateMistake(1, {
      image_path: 'mistake_images/move.png',
      answer_image_path: null,
    })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()
  })

  it('does not delete when the same mistake still references the image in the other role', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [
      { id: 1, image_path: 'mistake_images/shared-role.png', answer_image_path: 'mistake_images/shared-role.png' },
    ]

    await database.updateMistake(1, { image_path: null })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()
  })

  it('does not delete when another mistake references the image through the opposite role', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [
      { id: 1, image_path: 'mistake_images/cross.png', answer_image_path: null },
      { id: 2, image_path: null, answer_image_path: 'mistake_images/cross.png' },
    ]

    await database.updateMistake(1, { image_path: null })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()
  })

  it('deduplicates equivalent removed refs across both roles before deleting', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [
      { id: 1, image_path: 'local://mistake_images/Case.png', answer_image_path: 'mistake_images/case.png' },
    ]

    await database.updateMistake(1, { image_path: null, answer_image_path: null })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledTimes(1)
    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledWith('local://mistake_images/Case.png')
  })

  it('does not delete paths outside the managed mistake image directory', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{ id: 1, image_path: 'C:\\Users\\tester\\Desktop\\outside.png' }]

    await database.updateMistake(1, { image_path: null })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped unmanaged mistake image cleanup'), expect.any(String))
  })

  it('keeps the database update successful when physical deletion fails', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{ id: 1, image_path: 'mistake_images/fail.png' }]
    mistakeImageStorageState.deleteManagedMistakeImage.mockRejectedValueOnce(new Error('disk locked'))

    await expect(database.updateMistake(1, { image_path: null })).resolves.toEqual({ success: true })

    expect(state.preparedCalls.some(call => call.sql.includes('UPDATE mistakes SET'))).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to delete removed mistake image'), 'disk locked')
  })

  it('keeps deleteMistake cleanup before deleting the database row', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{ id: 1, image_path: 'mistake_images/remove.png', answer_image_path: 'mistake_images/remove-answer.png' }]
    let rowStillExistsDuringCleanup = false
    mistakeImageStorageState.deleteManagedMistakeImage.mockImplementationOnce(async () => {
      rowStillExistsDuringCleanup = state.mistakeRows.some(row => row.id === 1)
    })

    await expect(database.deleteMistake(1)).resolves.toEqual({ success: true })

    expect(rowStillExistsDuringCleanup).toBe(true)
    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledWith('mistake_images/remove.png')
    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledWith('mistake_images/remove-answer.png')
    expect(state.mistakeRows).toEqual([])
    const cleanupSelectIndex = state.preparedCalls.findIndex(call => call.sql === 'SELECT image_path, answer_image_path FROM mistakes WHERE id = ?')
    const deleteIndex = state.preparedCalls.findIndex(call => call.sql === 'DELETE FROM mistakes WHERE id=?')
    expect(cleanupSelectIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeGreaterThan(cleanupSelectIndex)
  })

  it('deduplicates deleteMistake cleanup across both image roles', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{ id: 1, image_path: 'mistake_images/same.png', answer_image_path: 'local://mistake_images/Same.png' }]

    await expect(database.deleteMistake(1)).resolves.toEqual({ success: true })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledTimes(1)
    expect(state.mistakeRows).toEqual([])
  })

  it('keeps deleting the database row and logs the original cleanup error when cleanup fails', async () => {
    const database = await loadDatabase()
    const cleanupError = new Error('cleanup query failed')
    state.mistakeRows = [{ id: 1, image_path: 'mistake_images/remove.png' }]
    state.mistakeImagePathQueryError = cleanupError

    await expect(database.deleteMistake(1)).resolves.toEqual({ success: true })

    expect(state.mistakeRows).toEqual([])
    expect(logger.error).toHaveBeenCalledWith('Failed to cleanup mistake image', cleanupError)
  })

  it('does not query old image paths or cleanup files when updateMistake omits image_path', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{ id: 1, image_path: 'mistake_images/old.png' }]

    await expect(database.updateMistake(1, { question: 'No image change' })).resolves.toEqual({ success: true })

    expect(state.preparedCalls.some(call => call.sql === 'SELECT image_path, answer_image_path FROM mistakes WHERE id = ?')).toBe(false)
    expect(state.preparedCalls.some(call => call.sql.includes('SELECT id, image_path, answer_image_path'))).toBe(false)
    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()
    expect(state.preparedCalls).toEqual(expect.arrayContaining([
      {
        sql: 'UPDATE mistakes SET question = ?, updated_at = CURRENT_TIMESTAMP WHERE id=?',
        params: ['No image change', 1],
      },
    ]))
  })

  it('does not delete images still referenced after update or equivalent reference-key changes', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{
      id: 1,
      image_path: JSON.stringify(['mistake_images/a.png', 'mistake_images/b.png']),
    }]

    await database.updateMistake(1, {
      image_path: JSON.stringify(['mistake_images/b.png', 'mistake_images/a.png']),
    })
    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()

    state.mistakeRows = [{ id: 1, image_path: 'local://mistake_images/Case.png' }]
    await database.updateMistake(1, { image_path: 'mistake_images/case.png' })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).not.toHaveBeenCalled()
  })
})
