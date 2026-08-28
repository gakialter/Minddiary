import { createHash } from 'crypto'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  TODAY_ACTION_CHAPTER_CONTEXT_INVALID_MESSAGE,
  TODAY_ACTION_STALE_REVIEW_AUTHORIZATION_INVALID_MESSAGE,
  TodayActionStaleReviewTokenStore,
  authorizeTodayActionStaleReview,
  readAuthoritativeTodayActionChapterContext,
  serializeTodayActionStaleAuthorizationCore,
  validateTodayActionStaleAuthorizationCore,
} from '../electron/todayActionChapterContext'
import {
  TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS,
  buildTodayActionChapterSignatureInput,
} from '../src/utils/todayActionChapterContext'

const OPERATION_ID = '00000000-0000-4000-8000-000000000001'
const EXPECTED_DATE = '2026-08-21'

function createChapterDatabase(): Database.Database {
  const database = new BetterSqlite3(':memory:')
  database.exec(`
    CREATE TABLE subjects (id INTEGER PRIMARY KEY);
    CREATE TABLE subject_chapters (
      id INTEGER PRIMARY KEY,
      subject_id INTEGER,
      sort_order INTEGER,
      title TEXT,
      completed INTEGER
    );
  `)
  return database
}

function makeCore(overrides: Record<string, unknown> = {}) {
  const payload = {
    title: 'Read one chapter',
    description: 'Continue the current bounded chapter.',
    type: 'focus',
    subject_id: 1,
    related_mistake_id: null,
    related_entry_id: null,
    related_chapter_id: null,
    planned_date: EXPECTED_DATE,
    estimate_minutes: 25,
    status: 'todo',
    source: 'ai',
    ...((overrides.payload as Record<string, unknown> | undefined) ?? {}),
  }
  const { payload: _payload, ...topLevelOverrides } = overrides
  return {
    operationId: OPERATION_ID,
    operationKind: 'today_action',
    actionContractVersion: 'confirmed-study-task-action.v2',
    expectedCurrentDate: EXPECTED_DATE,
    contextProjectionVersion: 'today-action.context-projection.v2',
    originalGenerationContextSignature: '1'.repeat(64),
    generationChapterSignature: '2'.repeat(64),
    latestReviewedChapterSignature: '3'.repeat(64),
    staleContextOverride: true,
    payload,
    ...topLevelOverrides,
  }
}

type FakeDatabaseOptions = {
  subjects?: unknown[]
  chapters?: Map<number, unknown[]>
  rosterError?: Error
  chapterError?: Error
}

function createFakeDatabase(options: FakeDatabaseOptions = {}): {
  database: Database.Database
  getTransactionRuns: () => number
} {
  let transactionRuns = 0
  const database = {
    transaction<T>(operation: () => T) {
      return () => {
        transactionRuns += 1
        return operation()
      }
    },
    prepare(sql: string) {
      if (/FROM\s+subjects/u.test(sql)) {
        return {
          all() {
            if (options.rosterError) throw options.rosterError
            return options.subjects ?? []
          },
        }
      }
      if (/FROM\s+subject_chapters/u.test(sql)) {
        return {
          all(subjectId: number) {
            if (options.chapterError) throw options.chapterError
            return options.chapters?.get(subjectId) ?? []
          },
        }
      }
      throw new Error('unexpected private SQL')
    },
  } as unknown as Database.Database
  return { database, getTransactionRuns: () => transactionRuns }
}

describe('Today Action privileged authoritative chapter context', () => {
  it('reads the complete roster in a transaction and maps raw completed 0/1 exactly', () => {
    const database = createChapterDatabase()
    try {
      database.prepare('INSERT INTO subjects (id) VALUES (?), (?)').run(2, 1)
      database.prepare(`
        INSERT INTO subject_chapters (id, subject_id, sort_order, title, completed)
        VALUES (?, ?, ?, ?, ?)
      `).run(3, 1, 1, 'S1 anchor', 0)
      database.prepare(`
        INSERT INTO subject_chapters (id, subject_id, sort_order, title, completed)
        VALUES (?, ?, ?, ?, ?)
      `).run(2, 1, 0, 'S1 before', 1)
      database.prepare(`
        INSERT INTO subject_chapters (id, subject_id, sort_order, title, completed)
        VALUES (?, ?, ?, ?, ?)
      `).run(4, 2, 0, 'S2 anchor', 0)

      const context = readAuthoritativeTodayActionChapterContext(database)

      expect(context.chapterProjection.chapter_progress).toEqual([
        { subject_ref: 'subject:1', title: 'S1 anchor', completed: false },
        { subject_ref: 'subject:2', title: 'S2 anchor', completed: false },
        { subject_ref: 'subject:1', title: 'S1 before', completed: true },
      ])
      expect(context.chapterProjectionJson).toBe(JSON.stringify(context.chapterProjection))
      expect(context.currentChapterSignature).toBe(
        createHash('sha256')
          .update(buildTodayActionChapterSignatureInput(context.chapterProjection), 'utf8')
          .digest('hex'),
      )
    } finally {
      database.close()
    }
  })

  it('accepts authoritative CJK context by UTF-16 code units even when UTF-8 exceeds 4096 bytes', () => {
    const database = createChapterDatabase()
    const title = '章节复习数学'.repeat(20)
    try {
      const insertSubject = database.prepare('INSERT INTO subjects (id) VALUES (?)')
      const insertChapter = database.prepare(`
        INSERT INTO subject_chapters (id, subject_id, sort_order, title, completed)
        VALUES (?, ?, 0, ?, 0)
      `)
      for (let id = 1; id <= 12; id += 1) {
        insertSubject.run(id)
        insertChapter.run(id, id, title)
      }

      const context = readAuthoritativeTodayActionChapterContext(database)
      const utf8Length = Buffer.byteLength(context.chapterProjectionJson, 'utf8')

      expect(context.chapterProjection.chapter_progress).toHaveLength(12)
      expect(context.chapterProjectionJson).toHaveLength(2149)
      expect(context.chapterProjectionJson.length)
        .toBeLessThanOrEqual(TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS)
      expect(utf8Length).toBe(5029)
      expect(utf8Length).toBeGreaterThan(TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS)
    } finally {
      database.close()
    }
  })

  it('rejects every malformed subject id instead of omitting or coercing it', () => {
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined]) {
      const { database, getTransactionRuns } = createFakeDatabase({ subjects: [{ id }] })
      expect(() => readAuthoritativeTodayActionChapterContext(database))
        .toThrow(TODAY_ACTION_CHAPTER_CONTEXT_INVALID_MESSAGE)
      expect(getTransactionRuns()).toBe(1)
    }
  })

  it('rejects malformed chapter ids, owners, sort orders, titles, and every non-0/1 raw completed value', () => {
    const validRow = {
      id: 1,
      subject_id: 1,
      sort_order: 0,
      title: 'chapter',
      completed: 0,
    }
    const malformedRows = [
      { ...validRow, id: 0 },
      { ...validRow, id: 1.5 },
      { ...validRow, id: Number.MAX_SAFE_INTEGER + 1 },
      { ...validRow, subject_id: 0 },
      { ...validRow, subject_id: 2 },
      { ...validRow, subject_id: '1' },
      { ...validRow, sort_order: -1 },
      { ...validRow, sort_order: 0.5 },
      { ...validRow, sort_order: Number.MAX_SAFE_INTEGER + 1 },
      { ...validRow, title: null },
      { ...validRow, title: 1 },
      ...[2, -1, '1', true, null, undefined, 0.5, {}].map(completed => ({
        ...validRow,
        completed,
      })),
    ]

    for (const row of malformedRows) {
      const { database } = createFakeDatabase({
        subjects: [{ id: 1 }],
        chapters: new Map([[1, [row]]]),
      })
      expect(() => readAuthoritativeTodayActionChapterContext(database))
        .toThrow(TODAY_ACTION_CHAPTER_CONTEXT_INVALID_MESSAGE)
    }
  })

  it('fails closed for reads, projection failures, and serialization over 4096 UTF-16 code units', () => {
    const rosterFailure = createFakeDatabase({ rosterError: new Error('private roster failure') })
    expect(() => readAuthoritativeTodayActionChapterContext(rosterFailure.database))
      .toThrow(TODAY_ACTION_CHAPTER_CONTEXT_INVALID_MESSAGE)

    const chapterFailure = createFakeDatabase({
      subjects: [{ id: 1 }],
      chapterError: new Error('private chapter failure'),
    })
    expect(() => readAuthoritativeTodayActionChapterContext(chapterFailure.database))
      .toThrow(TODAY_ACTION_CHAPTER_CONTEXT_INVALID_MESSAGE)

    const valid = createFakeDatabase({ subjects: [{ id: 1 }] })
    expect(() => readAuthoritativeTodayActionChapterContext(valid.database, {
      projector: () => { throw new Error('private projector failure') },
    })).toThrow(TODAY_ACTION_CHAPTER_CONTEXT_INVALID_MESSAGE)
    expect(() => readAuthoritativeTodayActionChapterContext(valid.database, {
      projector: () => ({
        chapter_progress: [{ subject_ref: 'subject:1', title: 'x'.repeat(4096), completed: false }],
      }),
    })).toThrow(TODAY_ACTION_CHAPTER_CONTEXT_INVALID_MESSAGE)

    for (const operation of [
      () => readAuthoritativeTodayActionChapterContext(rosterFailure.database),
      () => readAuthoritativeTodayActionChapterContext(chapterFailure.database),
    ]) {
      try {
        operation()
      } catch (error) {
        expect(String(error)).not.toContain('private')
      }
    }
  })
})

describe('Today Action stale-review core and token authority', () => {
  it('validates exact authorization-core and payload keys and emits fixed canonical bytes', () => {
    const validated = validateTodayActionStaleAuthorizationCore(makeCore({
      payload: { title: '  Read\tchapter  ', description: '  Keep\nworking  ' },
    }))
    expect(validated.payload.title).toBe('Read chapter')
    expect(validated.payload.description).toBe('Keep working')

    const serialized = serializeTodayActionStaleAuthorizationCore(validated)
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      'operationId',
      'operationKind',
      'actionContractVersion',
      'expectedCurrentDate',
      'contextProjectionVersion',
      'originalGenerationContextSignature',
      'generationChapterSignature',
      'latestReviewedChapterSignature',
      'staleContextOverride',
      'payload',
    ])
    expect(Object.keys(JSON.parse(serialized).payload)).toEqual([
      'title',
      'description',
      'type',
      'subject_id',
      'related_mistake_id',
      'related_entry_id',
      'related_chapter_id',
      'planned_date',
      'estimate_minutes',
      'status',
      'source',
    ])
  })

  it('rejects malformed top-level and payload cores, including a staleReviewToken field', () => {
    const { payload: _missingPayload, ...missingPayload } = makeCore()
    const malformed = [
      missingPayload,
      { ...makeCore(), extra: true },
      { ...makeCore(), staleReviewToken: 'a'.repeat(64) },
      makeCore({ operationId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }),
      makeCore({ operationId: '00000000-0000-1000-8000-000000000001' }),
      makeCore({ operationKind: 'daily_review' }),
      makeCore({ actionContractVersion: 'confirmed-study-task-action.v1' }),
      makeCore({ contextProjectionVersion: 'today-action.context-projection.v1' }),
      makeCore({ originalGenerationContextSignature: 'A'.repeat(64) }),
      makeCore({ generationChapterSignature: 'a'.repeat(63) }),
      makeCore({ latestReviewedChapterSignature: 'g'.repeat(64) }),
      makeCore({ staleContextOverride: false }),
      makeCore({ expectedCurrentDate: '2026-02-30' }),
      makeCore({ payload: { extra: true } }),
      makeCore({ payload: { title: '' } }),
      makeCore({ payload: { description: 'x'.repeat(241) } }),
      makeCore({ payload: { type: 'unknown' } }),
      makeCore({ payload: { subject_id: Number.MAX_SAFE_INTEGER + 1 } }),
      makeCore({ payload: { related_mistake_id: -1 } }),
      makeCore({ payload: { related_entry_id: '1' } }),
      makeCore({ payload: { related_chapter_id: 1 } }),
      makeCore({ payload: { planned_date: '2026-08-20' } }),
      makeCore({ payload: { estimate_minutes: 4 } }),
      makeCore({ payload: { status: 'doing' } }),
      makeCore({ payload: { source: 'manual' } }),
    ]
    for (const value of malformed) {
      expect(() => validateTodayActionStaleAuthorizationCore(value))
        .toThrow(TODAY_ACTION_STALE_REVIEW_AUTHORIZATION_INVALID_MESSAGE)
    }
  })

  it('authorizes only reviewed stale context after the current-date gate and authoritative reread', () => {
    const database = createChapterDatabase()
    try {
      database.prepare('INSERT INTO subjects (id) VALUES (1)').run()
      database.prepare(`
        INSERT INTO subject_chapters (id, subject_id, sort_order, title, completed)
        VALUES (1, 1, 0, 'current chapter', 0)
      `).run()
      const currentSignature = readAuthoritativeTodayActionChapterContext(database).currentChapterSignature
      const generationSignature = currentSignature === '2'.repeat(64)
        ? '4'.repeat(64)
        : '2'.repeat(64)
      const core = makeCore({
        generationChapterSignature: generationSignature,
        latestReviewedChapterSignature: currentSignature,
      })
      const session = {}
      const tokenStore = new TodayActionStaleReviewTokenStore()

      const result = authorizeTodayActionStaleReview(core, {
        database,
        getCurrentDateKey: () => EXPECTED_DATE,
        trustedSession: session,
        tokenStore,
      })
      expect(result.staleReviewToken).toMatch(/^[0-9a-f]{64}$/)
      expect(tokenStore.check(result.staleReviewToken, session, core)).toBe(true)

      expect(() => authorizeTodayActionStaleReview(makeCore({
        generationChapterSignature: currentSignature,
        latestReviewedChapterSignature: currentSignature,
      }), {
        database,
        getCurrentDateKey: () => EXPECTED_DATE,
        trustedSession: session,
        tokenStore,
      })).toThrow(TODAY_ACTION_STALE_REVIEW_AUTHORIZATION_INVALID_MESSAGE)

      database.prepare("UPDATE subject_chapters SET title = 'second drift' WHERE id = 1").run()
      expect(() => authorizeTodayActionStaleReview(core, {
        database,
        getCurrentDateKey: () => EXPECTED_DATE,
        trustedSession: session,
        tokenStore,
      })).toThrow(TODAY_ACTION_STALE_REVIEW_AUTHORIZATION_INVALID_MESSAGE)
    } finally {
      database.close()
    }
  })

  it('validates the actual current date before attempting an authoritative chapter read', () => {
    const fake = createFakeDatabase({ rosterError: new Error('must not be read') })
    expect(() => authorizeTodayActionStaleReview(makeCore(), {
      database: fake.database,
      getCurrentDateKey: () => '2026-08-20',
      trustedSession: {},
      tokenStore: new TodayActionStaleReviewTokenStore(),
    })).toThrow(TODAY_ACTION_STALE_REVIEW_AUTHORIZATION_INVALID_MESSAGE)
    expect(fake.getTransactionRuns()).toBe(0)

    expect(() => authorizeTodayActionStaleReview(makeCore(), {
      database: fake.database,
      getCurrentDateKey: () => '2026-02-30',
      trustedSession: {},
      tokenStore: new TodayActionStaleReviewTokenStore(),
    })).toThrow(TODAY_ACTION_STALE_REVIEW_AUTHORIZATION_INVALID_MESSAGE)
    expect(fake.getTransactionRuns()).toBe(0)
  })

  it('binds tokens to exact canonical core bytes and trusted-session object identity', () => {
    const token = 'a'.repeat(64)
    const store = new TodayActionStaleReviewTokenStore(() => token)
    const session = { id: 1 }
    const sameShapeDifferentSession = { id: 1 }
    const core = makeCore()

    expect(store.issue(session, core)).toBe(token)
    expect(store.check('b'.repeat(64), session, core)).toBe(false)
    expect(store.check(token, sameShapeDifferentSession, core)).toBe(false)
    expect(store.check(token, session, makeCore({ payload: { title: 'Different' } }))).toBe(false)
    expect(store.check(token, session, core)).toBe(true)
  })

  it('invalidates or consumes only an exact binding and never consumes during check', () => {
    const tokens = ['c'.repeat(64), 'd'.repeat(64)]
    const store = new TodayActionStaleReviewTokenStore(() => tokens.shift()!)
    const session = {}
    const core = makeCore()

    const invalidated = store.issue(session, core)
    expect(store.check(invalidated, session, core)).toBe(true)
    expect(store.check(invalidated, session, core)).toBe(true)
    expect(store.invalidate(invalidated, {}, core)).toBe(false)
    expect(store.check(invalidated, session, core)).toBe(true)
    expect(store.invalidate(invalidated, session, core)).toBe(true)
    expect(store.check(invalidated, session, core)).toBe(false)

    const consumed = store.issue(session, core)
    expect(store.consume(consumed, session, makeCore({ payload: { title: 'Different' } }))).toBe(false)
    expect(store.check(consumed, session, core)).toBe(true)
    expect(store.consume(consumed, session, core)).toBe(true)
    expect(store.check(consumed, session, core)).toBe(false)
    expect(store.consume(consumed, session, core)).toBe(false)
  })
})
