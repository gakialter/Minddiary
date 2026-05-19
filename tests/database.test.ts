// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment, Tag } from '../src/types'

type PreparedCall = {
  sql: string
  params: unknown[]
}

type BatchTagRow = Tag & { entry_id: number }

type DatabaseModule = {
  initialize: () => void
  getAllTags: () => Tag[]
  createTag: (tag: Partial<Tag>) => Tag
  updateTag: (id: number, tag: Partial<Tag>) => Tag
  getEntryTagsBatch: (entryIds: number[]) => Record<number, Tag[]>
  getAttachmentsByEntries: (entryIds: number[]) => Record<number, Attachment[]>
}

const state = vi.hoisted(() => ({
  preparedCalls: [] as PreparedCall[],
  execCalls: [] as string[],
  tagRows: [] as BatchTagRow[],
  attachmentRows: [] as Attachment[],
  tagById: null as Tag | null,
  allTags: [] as Tag[],
  runChanges: 1,
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
          return { lastInsertRowid: 1, changes: state.runChanges }
        }),
        get: vi.fn((...params: unknown[]) => {
          state.preparedCalls.push({ sql, params })
          if (sql.includes('COUNT(*)')) return { count: 1 }
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
          if (sql.includes('FROM attachments')) {
            return state.attachmentRows
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
