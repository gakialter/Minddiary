import { describe, expect, it, vi } from 'vitest'
import {
  TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS,
  allocateTodayActionChapterProjection,
  assertTodayActionChapterProjectionWithinBound,
  buildTodayActionChapterProjection,
  buildTodayActionChapterSignatureInput,
  buildTodayActionSubjectRef,
  canonicalizeTodayActionChapterTitle,
  loadTodayActionChapterProjectionForGeneration,
  parseTodayActionSubjectRef,
  prepareTodayActionChapterSubject,
  serializeTodayActionChapterProjection,
} from '../src/utils/todayActionChapterContext'

function chapter(
  id: number,
  subjectId: number,
  sortOrder: number,
  completed: boolean,
  title = `S${subjectId}-C${id}`,
) {
  return { id, subject_id: subjectId, sort_order: sortOrder, completed, title }
}

describe('Today Action bounded chapter context', () => {
  it('uses the frozen subject_ref grammar and positive safe-integer boundary', () => {
    expect(buildTodayActionSubjectRef(1)).toBe('subject:1')
    expect(buildTodayActionSubjectRef(Number.MAX_SAFE_INTEGER)).toBe('subject:9007199254740991')
    expect(parseTodayActionSubjectRef('subject:1')).toBe(1)
    expect(parseTodayActionSubjectRef('subject:9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)

    for (const value of ['subject:0', 'subject:01', 'subject:-1', 'subject:1.2', 'subject:9007199254740992']) {
      expect(() => parseTodayActionSubjectRef(value)).toThrow('subject_ref')
    }
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildTodayActionSubjectRef(value)).toThrow('subject id')
    }
  })

  it('canonicalizes chapter titles with the exact frozen Unicode pipeline', () => {
    expect(canonicalizeTodayActionChapterTitle('\uD800')).toBe('\uFFFD')
    expect(canonicalizeTodayActionChapterTitle('\uDC00')).toBe('\uFFFD')
    expect(canonicalizeTodayActionChapterTitle('A\u{1F642}B')).toBe('A\u{1F642}B')
    expect(canonicalizeTodayActionChapterTitle('\uFF21\u00A0B')).toBe('A B')
    for (const disallowed of [
      '\u0000',
      '\u001F',
      '\u007F',
      '\u0085',
      '\u009F',
      '\u00AD',
      '\u200B',
      '\u200C',
      '\u200D',
      '\u2060',
      '\uFEFF',
    ]) {
      expect(canonicalizeTodayActionChapterTitle(`A${disallowed}B`)).toBe('A B')
    }
    expect(canonicalizeTodayActionChapterTitle('  A\t\n B  ')).toBe('A B')
    expect(canonicalizeTodayActionChapterTitle('\u034F')).toBe('\u034F')
    expect(canonicalizeTodayActionChapterTitle('\u0000\u200B\t')).toBeNull()

    expect(canonicalizeTodayActionChapterTitle('a'.repeat(120))).toBe('a'.repeat(120))
    expect(canonicalizeTodayActionChapterTitle(`${'a'.repeat(119)}\u{1F642}`)).toBe('a'.repeat(119))
    expect(canonicalizeTodayActionChapterTitle(`${'a'.repeat(119)} \u{1F642}`)).toBe('a'.repeat(119))
    expect('\u{1F642}').toHaveLength(2)
    expect(canonicalizeTodayActionChapterTitle('\u{1F642}'.repeat(60))).toBe('\u{1F642}'.repeat(60))
    expect(canonicalizeTodayActionChapterTitle('\u{1F642}'.repeat(61))).toBe('\u{1F642}'.repeat(60))
  })

  it('emits the bounded subject:<DB id> Provider reference without standalone chapter database metadata', () => {
    const projection = buildTodayActionChapterProjection([{
      id: 1,
      chapters: [
        chapter(9, 1, 0, false, '\u200B'),
        chapter(3, 1, 1, true, 'before'),
        chapter(2, 1, 2, false, 'anchor'),
        chapter(1, 1, 3, false, 'after'),
      ],
    }])

    expect(projection.chapter_progress.map(item => item.title)).toEqual(['anchor', 'before', 'after'])
    expect(Object.keys(projection.chapter_progress[0]!)).toEqual(['subject_ref', 'title', 'completed'])
    expect(projection.chapter_progress[0]!.subject_ref).toBe('subject:1')
    const serialized = JSON.stringify(projection)
    for (const forbidden of [
      'subject_id',
      'chapter_id',
      'chapter_ref',
      'related_chapter_id',
      'sort_order',
      'notes',
      'description',
      'created_at',
      'updated_at',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }

    const invalidRows = [
      { subjectId: Number.MAX_SAFE_INTEGER + 1, row: chapter(1, 1, 0, false) },
      { subjectId: 1, row: chapter(Number.MAX_SAFE_INTEGER + 1, 1, 0, false) },
      { subjectId: 1, row: chapter(1, 2, 0, false) },
      { subjectId: 1, row: chapter(1, 1, -1, false) },
      { subjectId: 1, row: chapter(1, 1, Number.MAX_SAFE_INTEGER + 1, false) },
      { subjectId: 1, row: { ...chapter(1, 1, 0, false), completed: 1 } },
      { subjectId: 1, row: { ...chapter(1, 1, 0, false), title: null } },
    ]
    for (const fixture of invalidRows) {
      expect(() => prepareTodayActionChapterSubject(fixture.subjectId, [fixture.row]))
        .toThrow()
    }
    for (const completed of [0, 1, 2, -1, '1', null, undefined, {}, 0.5]) {
      expect(() => prepareTodayActionChapterSubject(1, [{
        ...chapter(1, 1, 0, false),
        completed,
      }])).toThrow()
    }
  })

  it('uses the frozen K=3 local windows and global anchor/before/after total order', () => {
    const subject1 = prepareTodayActionChapterSubject(1, [
      chapter(4, 1, 3, false, 'S1 after'),
      chapter(2, 1, 1, true, 'S1 before'),
      chapter(3, 1, 2, false, 'S1 anchor'),
      chapter(1, 1, 0, true, 'outside'),
    ])
    const subject2 = prepareTodayActionChapterSubject(2, [
      chapter(7, 2, 2, false, 'S2 after'),
      chapter(5, 2, 0, true, 'S2 before'),
      chapter(6, 2, 1, false, 'S2 anchor'),
    ])

    expect(allocateTodayActionChapterProjection([subject2, subject1]).chapter_progress.map(item => item.title))
      .toEqual([
        'S1 anchor',
        'S2 anchor',
        'S1 before',
        'S2 before',
        'S1 after',
        'S2 after',
      ])

    expect(buildTodayActionChapterProjection([{ id: 1, chapters: [] }]).chapter_progress).toEqual([])
    expect(buildTodayActionChapterProjection([{
      id: 1,
      chapters: [chapter(2, 1, 0, true, 'tie-2'), chapter(1, 1, 0, true, 'tie-1')],
    }]).chapter_progress.map(item => item.title)).toEqual(['tie-2', 'tie-1'])
  })

  it('covers frozen local-window boundaries, including anchor-last and missing neighbors', () => {
    const titles = (rows: ReturnType<typeof chapter>[]) => (
      allocateTodayActionChapterProjection([
        prepareTodayActionChapterSubject(1, rows),
      ]).chapter_progress.map(item => item.title)
    )

    expect(titles([])).toEqual([])
    expect(titles([chapter(1, 1, 0, false, 'only')])).toEqual(['only'])
    expect(titles([
      chapter(1, 1, 0, false, 'first'),
      chapter(2, 1, 1, false, 'after-1'),
    ])).toEqual(['first', 'after-1'])
    expect(titles([
      chapter(1, 1, 0, true, 'before-1'),
      chapter(2, 1, 1, false, 'last'),
    ])).toEqual(['last', 'before-1'])
    expect(titles([
      chapter(1, 1, 0, true, 'outside-before'),
      chapter(2, 1, 1, true, 'before-1'),
      chapter(3, 1, 2, false, 'middle'),
      chapter(4, 1, 3, false, 'after-1'),
      chapter(5, 1, 4, false, 'outside-after'),
    ])).toEqual(['middle', 'before-1', 'after-1'])
    expect(titles([
      chapter(1, 1, 0, true, 'outside-before-2'),
      chapter(2, 1, 1, true, 'outside-before-1'),
      chapter(3, 1, 2, true, 'before-2'),
      chapter(4, 1, 3, true, 'before-1'),
      chapter(5, 1, 4, false, 'last'),
    ])).toEqual(['last', 'before-1', 'before-2'])
    expect(titles([
      chapter(1, 1, 0, true, 'outside-before-2'),
      chapter(2, 1, 1, true, 'outside-before-1'),
      chapter(3, 1, 2, true, 'before-2'),
      chapter(4, 1, 3, true, 'before-1'),
      chapter(5, 1, 4, true, 'all-complete-last'),
    ])).toEqual(['all-complete-last', 'before-1', 'before-2'])
  })

  it('uses the exact 4-subject golden layers and preserves missing-neighbor emission order', () => {
    const fullSubjects = Array.from({ length: 4 }, (_, index) => {
      const subjectId = index + 1
      return prepareTodayActionChapterSubject(subjectId, [
        chapter(subjectId * 10 + 1, subjectId, 0, true, `S${subjectId} before`),
        chapter(subjectId * 10 + 2, subjectId, 1, false, `S${subjectId} anchor`),
        chapter(subjectId * 10 + 3, subjectId, 2, false, `S${subjectId} after`),
      ])
    })
    expect(allocateTodayActionChapterProjection(fullSubjects).chapter_progress.map(item => item.title))
      .toEqual([
        'S1 anchor', 'S2 anchor', 'S3 anchor', 'S4 anchor',
        'S1 before', 'S2 before', 'S3 before', 'S4 before',
        'S1 after', 'S2 after', 'S3 after', 'S4 after',
      ])

    const anchorFirst = prepareTodayActionChapterSubject(1, [
      chapter(1, 1, 0, false, 'S1 anchor'),
      chapter(2, 1, 1, false, 'S1 after'),
    ])
    const anchorLast = prepareTodayActionChapterSubject(2, [
      chapter(3, 2, 0, true, 'S2 before'),
      chapter(4, 2, 1, false, 'S2 anchor'),
    ])
    expect(allocateTodayActionChapterProjection([anchorLast, anchorFirst]).chapter_progress.map(item => item.title))
      .toEqual(['S1 anchor', 'S2 anchor', 'S2 before', 'S1 after'])
  })

  it('stops at N=12 anchors without post-allocation sorting', () => {
    const subjects = Array.from({ length: 14 }, (_, index) => ({
      id: 14 - index,
      chapters: [chapter(100 + index, 14 - index, 0, false, `subject-${14 - index}`)],
    }))
    const projection = buildTodayActionChapterProjection(subjects)

    expect(projection.chapter_progress).toHaveLength(12)
    expect(projection.chapter_progress.map(item => item.subject_ref)).toEqual(
      Array.from({ length: 12 }, (_, index) => `subject:${index + 1}`),
    )
  })

  it('serializes the reachable worst case to the frozen 3766 UTF-16-code-unit bound proof', () => {
    const subjectIds = [
      1_000_000_000_000_000,
      1_000_000_000_000_001,
      1_000_000_000_000_002,
      1_000_000_000_000_003,
    ]
    const worstTitle = '\\"'.repeat(60)
    const projection = buildTodayActionChapterProjection(subjectIds.map((subjectId, subjectIndex) => ({
      id: subjectId,
      chapters: Array.from({ length: 3 }, (_, chapterIndex) => chapter(
        subjectIndex * 3 + chapterIndex + 1,
        subjectId,
        chapterIndex,
        false,
        worstTitle,
      )),
    })))
    const serialized = serializeTodayActionChapterProjection(projection)

    expect(JSON.stringify({ subject_ref: '', title: '', completed: false })).toHaveLength(47)
    expect(JSON.stringify(projection.chapter_progress[0])).toHaveLength(311)
    expect(JSON.stringify(projection.chapter_progress)).toHaveLength(3745)
    expect(serialized.length - JSON.stringify(projection.chapter_progress).length).toBe(21)
    expect(serialized).toHaveLength(3766)
    expect(TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS).toBe(4096)
    expect(buildTodayActionChapterSignatureInput(projection)).toBe(
      `today-action.context-projection.v2\u0000${serialized}`,
    )

    expect(() => assertTodayActionChapterProjectionWithinBound({
      chapter_progress: [{ subject_ref: 'subject:1', title: 'x'.repeat(4096), completed: false }],
    })).toThrow('4096')
  })

  it('degrades generation by failed subject while preserving deterministic successful read sets', async () => {
    const rows = new Map<number, unknown[]>([
      [1, [chapter(1, 1, 0, false, 'one')]],
      [2, [chapter(2, 2, 0, false, 'two')]],
      [3, [{ ...chapter(3, 3, 0, false, 'malformed'), completed: 2 }]],
    ])
    const load = (failed: ReadonlySet<number>) => loadTodayActionChapterProjectionForGeneration({
      loadSubjects: async () => [{ id: 3 }, { id: 2 }, { id: 1 }],
      loadChapters: async subjectId => {
        if (failed.has(subjectId)) throw new Error(`private failure ${subjectId}`)
        return rows.get(subjectId) ?? []
      },
    })

    const first = await load(new Set([2]))
    const second = await load(new Set([2]))
    expect(first).toEqual({
      chapter_progress: [{ subject_ref: 'subject:1', title: 'one', completed: false }],
    })
    expect(serializeTodayActionChapterProjection(first)).toBe(serializeTodayActionChapterProjection(second))

    expect(await loadTodayActionChapterProjectionForGeneration({
      loadSubjects: async () => { throw new Error('private roster failure') },
      loadChapters: async () => [],
    })).toEqual({ chapter_progress: [] })
    expect(await load(new Set([1, 2, 3]))).toEqual({ chapter_progress: [] })

    expect(await loadTodayActionChapterProjectionForGeneration({
      loadSubjects: async () => [{ id: 1 }, { id: 2 }, { id: 3 }],
      loadChapters: async subjectId => {
        if (subjectId !== 3) throw new Error('private subject read failure')
        return [chapter(3, 3, 0, false, 'three')]
      },
    })).toEqual({
      chapter_progress: [{ subject_ref: 'subject:3', title: 'three', completed: false }],
    })
    expect(await loadTodayActionChapterProjectionForGeneration({
      loadSubjects: async () => [{ id: 1 }, { id: 2 }],
      loadChapters: async subjectId => [chapter(subjectId, subjectId, 0, false, '\u200B')],
    })).toEqual({ chapter_progress: [] })
  })

  it('degrades when an accepted roster array throws during projection iteration', async () => {
    const throwingRoster = new Proxy([], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          return () => { throw new Error('private projector iteration failure') }
        }
        return Reflect.get(target, property, receiver)
      },
    })

    await expect(loadTodayActionChapterProjectionForGeneration({
      loadSubjects: async () => throwingRoster,
      loadChapters: async () => [],
    })).resolves.toEqual({ chapter_progress: [] })
  })

  it('degrades the whole generation projection on a title-normalization runtime failure', async () => {
    const originalNormalize = String.prototype.normalize
    const normalize = vi.spyOn(String.prototype, 'normalize').mockImplementation(function (
      this: string,
      form?: string,
    ) {
      if (String(this) === 'explode') throw new Error('private normalization failure')
      return originalNormalize.call(this, form)
    })
    try {
      await expect(loadTodayActionChapterProjectionForGeneration({
        loadSubjects: async () => [{ id: 1 }, { id: 2 }],
        loadChapters: async subjectId => [chapter(
          subjectId,
          subjectId,
          0,
          false,
          subjectId === 1 ? 'explode' : 'survivor',
        )],
      })).resolves.toEqual({ chapter_progress: [] })
    } finally {
      normalize.mockRestore()
    }
  })

  it('keeps a legal CJK projection when UTF-16 code units fit but UTF-8 bytes exceed 4096', async () => {
    const title = '章节复习数学'.repeat(20)
    const projection = await loadTodayActionChapterProjectionForGeneration({
      loadSubjects: async () => Array.from({ length: 12 }, (_, index) => ({ id: index + 1 })),
      loadChapters: async subjectId => [chapter(subjectId, subjectId, 0, false, title)],
    })
    const serialized = JSON.stringify(projection)
    const utf8Length = new TextEncoder().encode(serialized).length

    expect(title).toHaveLength(120)
    expect(projection.chapter_progress).toHaveLength(12)
    expect(serialized).toHaveLength(2149)
    expect(serialized.length).toBeLessThanOrEqual(TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS)
    expect(utf8Length).toBe(5029)
    expect(utf8Length).toBeGreaterThan(TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS)
  })

  it('degrades generation instead of emitting a projection whose serialization overflows', async () => {
    const originalStringify = JSON.stringify
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown) => {
      if (
        value !== null
        && typeof value === 'object'
        && 'chapter_progress' in value
        && Array.isArray(value.chapter_progress)
        && value.chapter_progress.length > 0
      ) {
        return 'x'.repeat(TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS + 1)
      }
      return originalStringify(value)
    }) as typeof JSON.stringify)
    let result
    try {
      result = await loadTodayActionChapterProjectionForGeneration({
        loadSubjects: async () => [{ id: 1 }],
        loadChapters: async () => [chapter(1, 1, 0, false, 'one')],
      })
    } finally {
      stringify.mockRestore()
    }
    expect(result).toEqual({ chapter_progress: [] })
  })
})
