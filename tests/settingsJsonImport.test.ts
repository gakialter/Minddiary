// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Subject, SubjectChapter, Tag } from '../src/types'
import { parseSettingsJsonBackup, prepareSettingsJsonImport } from '../src/utils/settingsJsonImport'

const entry = { date: '2024-02-29', title: '复习', content: '正文', mood: null }
const subject = { id: 7, name: '数学', color: '#123456', total_chapters: 4, completed_chapters: 2 }
const wrap = (data: Record<string, unknown>) => ({ version: '1.0.0', data: { entries: [], ...data } })
function api(subjects: Subject[] = [], tags: Tag[] = [], chapters: SubjectChapter[] = []) {
  return {
    subjects: { getAll: vi.fn(async () => subjects) },
    tags: { getAll: vi.fn(async () => tags) },
    subjectChapters: { getBySubject: vi.fn(async () => chapters) },
  }
}
function chapter(id: number, completed: boolean): SubjectChapter {
  return { id, completed, subject_id: 70, title: `章节 ${id}`, notes: '', sort_order: id,
    created_at: '', updated_at: '' }
}

describe('Settings JSON backup validation', () => {
  it('keeps complete chapter summaries and projects diary fields without source metadata or media', () => {
    const backup = parseSettingsJsonBackup(wrap({
      entries: [{ ...entry, id: 999, created_at: 'old', word_count: 999, tags: [1], images: ['a.png'] }],
      subjects: [subject], mistakes: [{ question: '题目', subject_id: 7 }],
    }))
    expect(backup.entries).toEqual([entry])
    expect(backup.subjects).toEqual([subject])
    expect(backup.mistakes).toEqual([{ question: '题目', subject_id: 7 }])
  })

  it('recognizes mistakes-only backups and defaults absent optional groups', () => {
    expect(parseSettingsJsonBackup({ data: { mistakes: [{ question: '' , image_path: 'q.png' }] } }))
      .toEqual({ entries: [], tags: [], subjects: [], mistakes: [{ question: '', image_path: 'q.png' }] })
  })

  it.each([null, [], 'json', { data: null }, { data: [] }, { data: {} },
    { data: { subjects: [] } }, { version: 1, data: { entries: [] } }])('rejects malformed root/data/version: %j', value => {
    expect(() => parseSettingsJsonBackup(value)).toThrow()
  })

  it.each(['entries', 'tags', 'subjects', 'mistakes'])('rejects invalid %s containers and non-record members', key => {
    for (const value of [null, {}, 'bad', [null], [[]], ['bad']]) {
      expect(() => parseSettingsJsonBackup(wrap({ [key]: value }))).toThrow()
    }
  })

  it.each([
    { date: '2023-02-29' }, { date: '2024-04-31' }, { date: '0000-01-01' }, { date: '2024-1-01' },
    { title: null }, { title: 'x'.repeat(501) }, { content: null }, { content: 'x'.repeat(200_001) },
    { mood: 'invalid' }, { mood: undefined }, { tags: null }, { tags: [0] }, { tags: ['1'] },
    { images: {} }, { images: [1] }, { images: ['x'.repeat(2_001)] },
  ])('rejects invalid diary fields', patch => {
    expect(() => parseSettingsJsonBackup(wrap({ entries: [{ ...entry, ...patch }] }))).toThrow(/日记第 1 项/)
  })

  it('accepts nullable mood and every supported mood identifier', () => {
    for (const mood of [null, 'motivated', 'happy', 'calm', 'tired', 'anxious', 'sad']) {
      expect(parseSettingsJsonBackup(wrap({ entries: [{ ...entry, mood }] })).entries[0]?.mood).toBe(mood)
    }
  })

  it.each([
    { id: 0 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { name: '' }, { name: ' ' }, { color: '' },
    { total_chapters: null }, { total_chapters: undefined }, { total_chapters: -1 },
    { total_chapters: 1.5 }, { completed_chapters: null }, { completed_chapters: undefined },
    { completed_chapters: -1 }, { completed_chapters: 5 }, { completed_chapters: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects incomplete or invalid subject fields: %j', patch => {
    expect(() => parseSettingsJsonBackup(wrap({ subjects: [{ ...subject, ...patch }] }))).toThrow(/科目第 1 项/)
  })

  it('rejects repeated source IDs and exact names but preserves distinct whitespace in names', () => {
    expect(() => parseSettingsJsonBackup(wrap({ subjects: [subject, { ...subject, name: '英语' }] }))).toThrow(/ID 7 重复/)
    expect(() => parseSettingsJsonBackup(wrap({ subjects: [subject, { ...subject, id: 8 }] }))).toThrow(/名称.*重复/)
    const subjects = [subject, { ...subject, id: 8, name: '数学 ' }]
    expect(parseSettingsJsonBackup(wrap({ subjects })).subjects).toEqual(subjects)
  })

  it('preserves legacy mastery booleans, numeric 0/1 and nullable next review date without inventing review fields', () => {
    for (const mastered of [false, true, 0, 1]) {
      const mistake = parseSettingsJsonBackup(wrap({ mistakes: [{ question: '', mastered, next_review_date: null }] })).mistakes[0]
      expect(mistake).toEqual({ question: '', mastered: Boolean(mastered), next_review_date: null })
      expect(mistake).not.toHaveProperty('review_interval')
    }
    expect(parseSettingsJsonBackup(wrap({ mistakes: [{ question: 'q', subject_id: 0,
      ease_factor: 2.5, review_interval: 0, review_count: 0, next_review_date: '2024-02-29' }] })).mistakes[0])
      .toEqual({ question: 'q', subject_id: null, ease_factor: 2.5, review_interval: 0, review_count: 0, next_review_date: '2024-02-29' })
  })

  it.each([{}, { question: null }, { question: 'q', mastered: 2 }, { question: 'q', review_count: -1 },
    { question: 'q', review_interval: Number.MAX_SAFE_INTEGER + 1 },
    { question: 'q', subject_id: Number.MAX_SAFE_INTEGER + 1 },
    { question: 'q', next_review_date: '2023-02-29' }, { question: 'q', answer: null }])('rejects invalid mistakes: %j', mistake => {
    expect(() => parseSettingsJsonBackup(wrap({ mistakes: [mistake] }))).toThrow(/错题第 1 项/)
  })

  it('rejects a late invalid entry and a late invalid mistake instead of returning a partial backup', () => {
    expect(() => parseSettingsJsonBackup(wrap({ entries: [entry, { ...entry, mood: 'bad' }] }))).toThrow(/日记第 2 项/)
    expect(() => parseSettingsJsonBackup(wrap({ entries: [entry], subjects: [subject],
      mistakes: [{ question: 'valid', subject_id: 7 }, { question: 'late', subject_id: 8 }] }))).toThrow(/错题第 2 项.*本文件/)
  })

  it.each([undefined, []])('rejects references without the source subjects group, even if destination could have that ID: %j', subjects => {
    const data = subjects === undefined ? {} : { subjects }
    expect(() => parseSettingsJsonBackup(wrap({ ...data, mistakes: [{ question: 'q', subject_id: 7 }] })))
      .toThrow(/科目 ID 7 不在本文件科目中/)
  })

  it('normalizes tag presentation, trims names and discards source IDs', () => {
    const tag = parseSettingsJsonBackup(wrap({ tags: [{ id: 999, name: ' 新标签 ', color: 'invalid',
      icon: ' abcdef ', variant: 'invalid', pattern: 'invalid' }] })).tags[0]
    expect(tag).toEqual({ id: 0, name: '新标签', color: '#0F766E', icon: 'abcd', variant: 'soft', pattern: 'none' })
  })

  it.each([{ name: ' ' }, { name: 1 }, { name: 'a', color: null }, { name: 'a', icon: 1 },
    { name: 'a', variant: null }, { name: 'a', pattern: [] }])('rejects invalid supplied tag fields: %j', tag => {
    expect(() => parseSettingsJsonBackup(wrap({ tags: [tag] }))).toThrow(/标签第 1 项/)
  })
})

describe('Settings JSON import preflight', () => {
  it('plans exact target IDs and new subjects without writes and ignores unrelated target duplicates', async () => {
    const backup = parseSettingsJsonBackup(wrap({ subjects: [subject, { ...subject, id: 8, name: '英语' }] }))
    const readApi = api([{ ...subject, id: 70 }, { ...subject, id: 80, name: '无关' }, { ...subject, id: 81, name: '无关' }])
    const plan = await prepareSettingsJsonImport(backup, readApi)
    expect(plan.subjects).toEqual([{ source: subject, targetId: 70 }, { source: { ...subject, id: 8, name: '英语' } }])
    expect(plan.backup).toBe(backup)
    expect(readApi.subjectChapters.getBySubject).toHaveBeenCalledTimes(1)
    expect(readApi.subjectChapters.getBySubject).toHaveBeenCalledWith(70)
  })

  it('rejects ambiguity only for source names that match multiple destination subjects', async () => {
    const backup = parseSettingsJsonBackup(wrap({ subjects: [subject] }))
    const readApi = api([{ ...subject, id: 70 }, { ...subject, id: 71 }])
    await expect(prepareSettingsJsonImport(backup, readApi)).rejects.toThrow(/多个同名科目.*数学/)
    expect(readApi.subjectChapters.getBySubject).not.toHaveBeenCalled()
  })

  it.each([
    { chapters: [chapter(1, true), chapter(2, true)] },
    { chapters: [chapter(1, true), chapter(2, true), chapter(3, true), chapter(4, false)] },
  ])('rejects incompatible real detailed chapter totals or completed counts', async ({ chapters }) => {
    const backup = parseSettingsJsonBackup(wrap({ subjects: [subject] }))
    await expect(prepareSettingsJsonImport(backup, api([{ ...subject, id: 70 }], [], chapters))).rejects.toThrow(/数学.*详细章节不兼容/)
  })

  it('accepts matching detailed chapter counts even when cached target summaries are stale', async () => {
    const backup = parseSettingsJsonBackup(wrap({ subjects: [subject] }))
    const plan = await prepareSettingsJsonImport(backup, api([{ ...subject, id: 70, completed_chapters: 0 }], [],
      [chapter(1, true), chapter(2, false), chapter(3, true), chapter(4, false)]))
    expect(plan.subjects).toEqual([{ source: subject, targetId: 70 }])
  })

  it('skips existing names and later duplicates explicitly after normalization', async () => {
    const backup = parseSettingsJsonBackup(wrap({ tags: [{ name: '已有' }, { name: ' 新建 ' }, { name: '新建' }] }))
    const plan = await prepareSettingsJsonImport(backup, api([], [{ id: 1, name: '已有', color: '#123456' }]))
    expect(plan.tags).toEqual([backup.tags[1]])
    expect(plan.skippedTags).toBe(2)
  })

  it('propagates target read failures before producing a plan', async () => {
    const readApi = api()
    readApi.tags.getAll.mockRejectedValueOnce(new Error('读取失败'))
    await expect(prepareSettingsJsonImport(parseSettingsJsonBackup(wrap({})), readApi)).rejects.toThrow('读取失败')
  })
})
