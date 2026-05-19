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
  getEntryTagsBatch: (entryIds: number[]) => Record<number, Tag[]>
  getAttachmentsByEntries: (entryIds: number[]) => Record<number, Attachment[]>
}

const state = vi.hoisted(() => ({
  preparedCalls: [] as PreparedCall[],
  tagRows: [] as BatchTagRow[],
  attachmentRows: [] as Attachment[],
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
      exec: vi.fn(),
      transaction: vi.fn((callback: () => void) => vi.fn(callback)),
      prepare: vi.fn((sql: string) => ({
        run: vi.fn((...params: unknown[]) => {
          state.preparedCalls.push({ sql, params })
          return { lastInsertRowid: 1 }
        }),
        get: vi.fn((...params: unknown[]) => {
          state.preparedCalls.push({ sql, params })
          if (sql.includes('COUNT(*)')) return { count: 1 }
          return undefined
        }),
        all: vi.fn((...params: unknown[]) => {
          state.preparedCalls.push({ sql, params })
          if (sql.startsWith('PRAGMA table_info')) {
            return [{ name: 'date_key' }, { name: 'started_at' }]
          }
          if (sql.includes('FROM tags') && sql.includes('entry_tags')) {
            return state.tagRows
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

async function loadDatabase(): Promise<DatabaseModule> {
  vi.resetModules()
  state.preparedCalls = []
  state.tagRows = []
  state.attachmentRows = []

  const databaseModulePath = '../electron/database'
  const imported = await import(databaseModulePath) as unknown as DatabaseModule | { default: DatabaseModule }
  const database = 'default' in imported ? imported.default : imported
  database.initialize()
  state.preparedCalls = []
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

  it('groups entry tags by entry id and initializes empty arrays for misses', async () => {
    const database = await loadDatabase()
    state.tagRows = [
      { entry_id: 2, id: 10, name: 'math', color: '#0F766E' },
      { entry_id: 2, id: 11, name: 'english', color: '#0E7490' },
      { entry_id: 4, id: 12, name: 'review', color: '#475569' },
    ]

    expect(database.getEntryTagsBatch([2, 4, 5])).toEqual({
      2: [
        { id: 10, name: 'math', color: '#0F766E' },
        { id: 11, name: 'english', color: '#0E7490' },
      ],
      4: [{ id: 12, name: 'review', color: '#475569' }],
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
