import { describe, expect, it } from 'vitest'
import { isBlankDiaryEntry } from '../src/utils/diaryEntry'
import type { DiaryEntry } from '../src/types'

const makeEntry = (overrides: Partial<DiaryEntry>): DiaryEntry => ({
  id: 1,
  date: '2026-05-18',
  title: '',
  content: '',
  mood: null,
  word_count: 0,
  tags: [],
  images: [],
  created_at: '2026-05-18T00:00:00.000Z',
  updated_at: '2026-05-18T00:00:00.000Z',
  ...overrides,
})

describe('isBlankDiaryEntry', () => {
  it('treats markup-only and whitespace-only entries as blank', () => {
    const entry = makeEntry({
      title: ' \t',
      content: '<p>&nbsp;</p>\n### ** __ `  ',
    })

    expect(isBlankDiaryEntry(entry)).toBe(true)
  })

  it('keeps entries with body text, tags, or images', () => {
    expect(isBlankDiaryEntry(makeEntry({ content: '有效内容' }))).toBe(false)
    expect(isBlankDiaryEntry(makeEntry({ tags: [1] }))).toBe(false)
    expect(isBlankDiaryEntry(makeEntry({ images: ['local://attachments/a.png'] }))).toBe(false)
  })
})
