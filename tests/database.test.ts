// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { logger } from '../electron/logger'
import type { Attachment, Mistake, PomodoroStat, Tag } from '../src/types'

type PreparedCall = {
  sql: string
  params: unknown[]
}

type BatchTagRow = Tag & { entry_id: number }
type MistakeImageRow = { id: number; image_path: string | null }

type DatabaseModule = {
  initialize: () => void
  getAllTags: () => Tag[]
  createTag: (tag: Partial<Tag>) => Tag
  updateTag: (id: number, tag: Partial<Tag>) => Tag
  getEntryTagsBatch: (entryIds: number[]) => Record<number, Tag[]>
  getAttachmentsByEntries: (entryIds: number[]) => Record<number, Attachment[]>
  getAllMistakes: (filters?: { due?: boolean; dueDate?: string }) => { data: Mistake[], total: number, masteredTotal: number }
  getPomodoroStatsRange: (startDate: string, endDate: string) => PomodoroStat[]
  updateMistake: (id: number, mistake: { image_path?: string | null; question?: string }) => Promise<{ success: boolean }>
  deleteMistake: (id: number) => Promise<{ success: boolean }>
  getAiApiKey: () => string | null
  setAiApiKey: (key: string) => void
  getAllSettings: () => Record<string, unknown>
}

const state = vi.hoisted(() => ({
  preparedCalls: [] as PreparedCall[],
  execCalls: [] as string[],
  tagRows: [] as BatchTagRow[],
  attachmentRows: [] as Attachment[],
  tagById: null as Tag | null,
  allTags: [] as Tag[],
  runChanges: 1,
  settings: {} as Record<string, unknown>,
  mistakeRows: [] as MistakeImageRow[],
  pomodoroStatsRows: [] as PomodoroStat[],
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
      pragma: vi.fn(),
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
          if (sql.includes('UPDATE mistakes SET')) {
            const id = Number(params[params.length - 1])
            const row = state.mistakeRows.find(item => item.id === id)
            if (row && sql.includes('image_path = ?')) {
              const imagePathIndex = sql.split(', ').findIndex(part => part.includes('image_path = ?'))
              row.image_path = params[imagePathIndex] as string | null
            }
          }
          if (sql.includes('DELETE FROM mistakes WHERE id=?')) {
            const id = Number(params[0])
            state.mistakeRows = state.mistakeRows.filter(item => item.id !== id)
          }
          return { lastInsertRowid: 1, changes: state.runChanges }
        }),
        get: vi.fn((...params: unknown[]) => {
          state.preparedCalls.push({ sql, params })
          if (sql.includes('COUNT(*)')) return { count: 1 }
          if (sql.includes('SELECT value FROM settings WHERE key=?')) {
            const key = String(params[0])
            return Object.prototype.hasOwnProperty.call(state.settings, key)
              ? { value: state.settings[key] }
              : undefined
          }
          if (sql.includes('SELECT image_path FROM mistakes WHERE id = ?')) {
            const id = Number(params[0])
            return state.mistakeRows.find(item => item.id === id)
          }
          if (sql.includes('FROM tags') && sql.includes('WHERE id=?')) return state.tagById
          return undefined
        }),
        all: vi.fn((...params: unknown[]) => {
          state.preparedCalls.push({ sql, params })
          if (sql.startsWith('PRAGMA table_info')) {
            const tableName = sql.match(/PRAGMA table_info\(([^)]+)\)/)?.[1]
            if (tableName === 'tags') {
              return [{ name: 'id' }, { name: 'name' }, { name: 'color' }]
            }
            if (tableName === 'pomodoro_sessions') {
              return [{ name: 'date_key' }, { name: 'started_at' }]
            }
            return []
          }
          if (sql.includes('FROM tags') && sql.includes('entry_tags')) {
            return state.tagRows
          }
          if (sql.includes('FROM tags')) {
            return state.allTags
          }
          if (sql.includes('SELECT * FROM settings')) {
            return Object.entries(state.settings).map(([key, value]) => ({ key, value }))
          }
          if (sql.includes('FROM attachments')) {
            return state.attachmentRows
          }
          if (sql.includes('FROM pomodoro_sessions p') && sql.includes('GROUP BY p.subject_id')) {
            return state.pomodoroStatsRows
          }
          if (sql.includes('FROM mistakes') && sql.includes('id <> ?')) {
            const excludedId = Number(params[0])
            return state.mistakeRows.filter(row => row.id !== excludedId && row.image_path)
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
  state.attachmentRows = []
  state.tagById = null
  state.allTags = []
  state.runChanges = 1
  state.settings = {}
  state.mistakeRows = []
  state.pomodoroStatsRows = []
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
      expect.stringContaining('ALTER TABLE tags ADD COLUMN icon'),
      expect.stringContaining('ALTER TABLE tags ADD COLUMN variant'),
      expect.stringContaining('ALTER TABLE tags ADD COLUMN pattern'),
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

describe('database pomodoro range subject stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('deletes a removed single-image legacy reference', async () => {
    const database = await loadDatabase()
    state.mistakeRows = [{ id: 1, image_path: 'mistake_images/old.png' }]

    await expect(database.updateMistake(1, { image_path: null })).resolves.toEqual({ success: true })

    expect(mistakeImageStorageState.deleteManagedMistakeImage).toHaveBeenCalledWith('mistake_images/old.png')
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
})
