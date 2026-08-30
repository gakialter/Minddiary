import type { SubjectChapter, SubjectChapterDraft } from '../types'

export const SUBJECT_CHAPTER_LIMITS = {
  title: 120,
  notes: 1000,
  batch: 200,
} as const

export type ChapterFilter = 'all' | 'open' | 'done'

export interface ParsedChapterLines {
  drafts: SubjectChapterDraft[]
  duplicateTitles: string[]
  emptyLineCount: number
}

export interface ChapterStats {
  total: number
  completed: number
  percent: number
  nextIncomplete: SubjectChapter | null
  open: number
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeChapterTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Chapter title must be a string')
  }
  const title = normalizeWhitespace(value)
  if (!title) {
    throw new Error('Chapter title is required')
  }
  if (title.length > SUBJECT_CHAPTER_LIMITS.title) {
    throw new Error(`Chapter title must be at most ${SUBJECT_CHAPTER_LIMITS.title} characters`)
  }
  return title
}

export function normalizeChapterNotes(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw new Error('Chapter notes must be a string')
  }
  const notes = value.trim()
  if (notes.length > SUBJECT_CHAPTER_LIMITS.notes) {
    throw new Error(`Chapter notes must be at most ${SUBJECT_CHAPTER_LIMITS.notes} characters`)
  }
  return notes
}

export function normalizeCompleted(value: unknown): boolean {
  return value === true || value === 1
}

export function parseChapterLines(text: string): ParsedChapterLines {
  const seen = new Set<string>()
  const duplicateSet = new Set<string>()
  let emptyLineCount = 0
  const drafts: SubjectChapterDraft[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const title = normalizeWhitespace(rawLine)
    if (!title) {
      emptyLineCount += 1
      continue
    }
    if (seen.has(title)) {
      duplicateSet.add(title)
      continue
    }
    seen.add(title)
    drafts.push({ title })
  }

  return {
    drafts,
    duplicateTitles: Array.from(duplicateSet),
    emptyLineCount,
  }
}

export function normalizeChapterDrafts(drafts: SubjectChapterDraft[]): SubjectChapterDraft[] {
  if (!Array.isArray(drafts)) {
    throw new Error('Chapters must be an array')
  }
  if (drafts.length === 0) {
    throw new Error('At least one chapter is required')
  }
  if (drafts.length > SUBJECT_CHAPTER_LIMITS.batch) {
    throw new Error(`Cannot add more than ${SUBJECT_CHAPTER_LIMITS.batch} chapters at once`)
  }

  const seen = new Set<string>()
  const normalized: SubjectChapterDraft[] = []
  for (const draft of drafts) {
    const title = normalizeChapterTitle(draft.title)
    if (seen.has(title)) continue
    seen.add(title)
    normalized.push({
      title,
      notes: normalizeChapterNotes(draft.notes),
      completed: normalizeCompleted(draft.completed),
    })
  }

  if (normalized.length === 0) {
    throw new Error('At least one chapter is required')
  }
  return normalized
}

export function calculateChapterStats(chapters: SubjectChapter[]): ChapterStats {
  const ordered = [...chapters].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  const total = ordered.length
  const completed = ordered.filter(chapter => chapter.completed).length
  return {
    total,
    completed,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    nextIncomplete: ordered.find(chapter => !chapter.completed) ?? null,
    open: total - completed,
  }
}

export function filterChapters(chapters: SubjectChapter[], filter: ChapterFilter): SubjectChapter[] {
  const ordered = [...chapters].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  if (filter === 'open') return ordered.filter(chapter => !chapter.completed)
  if (filter === 'done') return ordered.filter(chapter => chapter.completed)
  return ordered
}
