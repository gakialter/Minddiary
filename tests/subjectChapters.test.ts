// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { SubjectChapter } from '../src/types'
import {
  calculateChapterStats,
  filterChapters,
  normalizeChapterDrafts,
  normalizeChapterNotes,
  normalizeChapterTitle,
  parseChapterLines,
  SUBJECT_CHAPTER_LIMITS,
} from '../src/utils/subjectChapters'

const makeChapter = (overrides: Partial<SubjectChapter>): SubjectChapter => ({
  id: overrides.id ?? 1,
  subject_id: overrides.subject_id ?? 1,
  title: overrides.title ?? 'Chapter',
  notes: overrides.notes ?? '',
  completed: overrides.completed ?? false,
  sort_order: overrides.sort_order ?? 0,
  created_at: overrides.created_at ?? '2026-06-01T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-06-01T00:00:00.000Z',
})

describe('subject chapter utilities', () => {
  it('normalizes titles and notes with length limits', () => {
    expect(normalizeChapterTitle('  第一章   函数  ')).toBe('第一章 函数')
    expect(normalizeChapterNotes('  key points  ')).toBe('key points')
    expect(normalizeChapterNotes(undefined)).toBe('')

    expect(() => normalizeChapterTitle('   ')).toThrow('Chapter title is required')
    expect(() => normalizeChapterTitle('x'.repeat(SUBJECT_CHAPTER_LIMITS.title + 1))).toThrow('at most')
    expect(() => normalizeChapterNotes('x'.repeat(SUBJECT_CHAPTER_LIMITS.notes + 1))).toThrow('at most')
  })

  it('parses pasted lines, removes blanks, and reports duplicate lines', () => {
    const parsed = parseChapterLines([
      '第一章 函数、极限与连续',
      '',
      '第二章 一元函数微分学',
      '  第二章 一元函数微分学  ',
      '第三章 一元函数积分学',
    ].join('\n'))

    expect(parsed.drafts).toEqual([
      { title: '第一章 函数、极限与连续' },
      { title: '第二章 一元函数微分学' },
      { title: '第三章 一元函数积分学' },
    ])
    expect(parsed.duplicateTitles).toEqual(['第二章 一元函数微分学'])
    expect(parsed.emptyLineCount).toBe(1)
  })

  it('normalizes chapter drafts without forcing unique titles across the database', () => {
    expect(normalizeChapterDrafts([
      { title: '  Chapter 1  ', notes: '  note  ', completed: 1 as never },
      { title: 'Chapter 1', notes: 'duplicate in same paste' },
      { title: 'Chapter 2', completed: false },
    ])).toEqual([
      { title: 'Chapter 1', notes: 'note', completed: true },
      { title: 'Chapter 2', notes: '', completed: false },
    ])

    expect(() => normalizeChapterDrafts([])).toThrow('At least one chapter is required')
    expect(() => normalizeChapterDrafts(new Array(SUBJECT_CHAPTER_LIMITS.batch + 1).fill({ title: 'x' }))).toThrow('Cannot add more than')
  })

  it('calculates stats, next unfinished chapter, and filters', () => {
    const chapters = [
      makeChapter({ id: 2, title: 'Second', completed: false, sort_order: 2 }),
      makeChapter({ id: 1, title: 'First', completed: true, sort_order: 1 }),
      makeChapter({ id: 3, title: 'Third', completed: false, sort_order: 3 }),
    ]

    expect(calculateChapterStats(chapters)).toEqual({
      total: 3,
      completed: 1,
      percent: 33,
      nextIncomplete: chapters[0],
      open: 2,
    })
    expect(filterChapters(chapters, 'all').map(chapter => chapter.title)).toEqual(['First', 'Second', 'Third'])
    expect(filterChapters(chapters, 'open').map(chapter => chapter.title)).toEqual(['Second', 'Third'])
    expect(filterChapters(chapters, 'done').map(chapter => chapter.title)).toEqual(['First'])
  })
})
