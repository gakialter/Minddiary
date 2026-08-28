import type { AIMessage } from '../types'

const SUBJECT_REF_PATTERN = /^subject:[1-9][0-9]{0,15}$/
const DISALLOWED_CHAPTER_TITLE_CODE_POINTS = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200D\u2060\uFEFF]/gu

export const TODAY_ACTION_CHAPTER_TITLE_MAX_CODE_UNITS = 120
export const TODAY_ACTION_CHAPTER_WINDOW_SIZE = 3
export const TODAY_ACTION_CHAPTER_PROJECTION_MAX_ITEMS = 12
export const TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS = 4096
export const TODAY_ACTION_CHAPTER_CONTEXT_PROJECTION_VERSION = 'today-action.context-projection.v2'
export const TODAY_ACTION_PROMPT_VERSION = 'today-action.prompt.v4'
export const TODAY_ACTION_GENERATION_CONTEXT_VERSION = 'today-action.generation-context.v2'

export interface TodayActionProviderChapter {
  subject_ref: string
  title: string
  completed: boolean
}

export interface TodayActionProviderChapterProjection {
  chapter_progress: TodayActionProviderChapter[]
}

interface EligibleTodayActionChapter {
  chapterId: number
  sortOrder: number
  provider: TodayActionProviderChapter
}

interface ValidatedTodayActionChapterRow {
  chapterId: number
  sortOrder: number
  title: string
  completed: boolean
}

class TodayActionChapterDomainValidationError extends Error {}

function domainValidationError(message: string): TodayActionChapterDomainValidationError {
  return new TodayActionChapterDomainValidationError(message)
}

export interface PreparedTodayActionChapterSubject {
  readonly subjectId: number
  readonly anchor: TodayActionProviderChapter | null
  readonly before: ReadonlyArray<TodayActionProviderChapter | undefined>
  readonly after: ReadonlyArray<TodayActionProviderChapter | undefined>
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw domainValidationError(`${label} must be a positive safe integer`)
  }
  return value
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw domainValidationError(`${label} must be a non-negative safe integer`)
  }
  return value
}

export function buildTodayActionSubjectRef(subjectId: unknown): string {
  return `subject:${requirePositiveSafeInteger(subjectId, 'subject id')}`
}

export function parseTodayActionSubjectRef(value: unknown): number {
  if (typeof value !== 'string' || !SUBJECT_REF_PATTERN.test(value)) {
    throw new Error('subject_ref is invalid')
  }
  const subjectId = Number(value.slice('subject:'.length))
  return requirePositiveSafeInteger(subjectId, 'subject_ref id')
}

function repairLoneSurrogates(value: string): string {
  let repaired = ''
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xDC00 && next <= 0xDFFF) {
        repaired += value.slice(index, index + 2)
        index += 1
      } else {
        repaired += '\uFFFD'
      }
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      repaired += '\uFFFD'
    } else {
      repaired += value.charAt(index)
    }
  }
  return repaired
}

export function canonicalizeTodayActionChapterTitle(value: string): string | null {
  let normalized = repairLoneSurrogates(value)
    .normalize('NFKC')
    .replace(DISALLOWED_CHAPTER_TITLE_CODE_POINTS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) return null

  let clamped = ''
  for (const scalar of normalized) {
    if (clamped.length + scalar.length > TODAY_ACTION_CHAPTER_TITLE_MAX_CODE_UNITS) break
    clamped += scalar
  }
  normalized = clamped.replace(/ +$/u, '')
  return normalized || null
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw domainValidationError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export function prepareTodayActionChapterSubject(
  subjectIdValue: unknown,
  chapterRows: unknown,
): PreparedTodayActionChapterSubject {
  const subjectId = requirePositiveSafeInteger(subjectIdValue, 'subject id')
  if (!Array.isArray(chapterRows)) throw domainValidationError('chapter rows must be an array')

  const validatedRows = chapterRows.map((value, index): ValidatedTodayActionChapterRow => {
    try {
      const row = requireRecord(value, `chapter row ${index}`)
      const chapterId = requirePositiveSafeInteger(row.id, `chapter row ${index} id`)
      const owningSubjectId = requirePositiveSafeInteger(
        row.subject_id,
        `chapter row ${index} subject_id`,
      )
      if (owningSubjectId !== subjectId) {
        throw domainValidationError(
          `chapter row ${index} subject_id does not match its owning subject`,
        )
      }
      const sortOrder = requireNonNegativeSafeInteger(
        row.sort_order,
        `chapter row ${index} sort_order`,
      )
      if (typeof row.title !== 'string') {
        throw domainValidationError(`chapter row ${index} title must be a string`)
      }
      if (typeof row.completed !== 'boolean') {
        throw domainValidationError(`chapter row ${index} completed must be a boolean`)
      }
      return { chapterId, sortOrder, title: row.title, completed: row.completed }
    } catch (error) {
      if (error instanceof TodayActionChapterDomainValidationError) throw error
      throw domainValidationError(`chapter row ${index} is malformed`)
    }
  })

  const eligible = validatedRows.map((row): EligibleTodayActionChapter | null => {
    const title = canonicalizeTodayActionChapterTitle(row.title)
    if (title === null) return null
    return {
      chapterId: row.chapterId,
      sortOrder: row.sortOrder,
      provider: {
        subject_ref: buildTodayActionSubjectRef(subjectId),
        title,
        completed: row.completed,
      },
    }
  }).filter((item): item is EligibleTodayActionChapter => item !== null)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.chapterId - right.chapterId)

  if (eligible.length === 0) {
    return { subjectId, anchor: null, before: [], after: [] }
  }

  const firstIncompleteIndex = eligible.findIndex(item => !item.provider.completed)
  const anchorIndex = firstIncompleteIndex === -1 ? eligible.length - 1 : firstIncompleteIndex
  const start = Math.max(
    0,
    Math.min(anchorIndex - 1, eligible.length - TODAY_ACTION_CHAPTER_WINDOW_SIZE),
  )
  const window = eligible.slice(
    start,
    Math.min(eligible.length, start + TODAY_ACTION_CHAPTER_WINDOW_SIZE),
  )
  const before: Array<TodayActionProviderChapter | undefined> = []
  const after: Array<TodayActionProviderChapter | undefined> = []
  for (let index = start; index < start + window.length; index += 1) {
    if (index < anchorIndex) before[anchorIndex - index] = eligible[index]!.provider
    if (index > anchorIndex) after[index - anchorIndex] = eligible[index]!.provider
  }
  return {
    subjectId,
    anchor: eligible[anchorIndex]!.provider,
    before,
    after,
  }
}

export function allocateTodayActionChapterProjection(
  preparedSubjects: readonly PreparedTodayActionChapterSubject[],
): TodayActionProviderChapterProjection {
  const subjects = [...preparedSubjects]
    .filter(subject => subject.anchor !== null)
    .sort((left, right) => left.subjectId - right.subjectId)
  if (new Set(subjects.map(subject => subject.subjectId)).size !== subjects.length) {
    throw new Error('chapter subject ids must be unique')
  }

  const chapterProgress: TodayActionProviderChapter[] = []
  const emit = (item: TodayActionProviderChapter | null | undefined): boolean => {
    if (item) chapterProgress.push({
      subject_ref: item.subject_ref,
      title: item.title,
      completed: item.completed,
    })
    return chapterProgress.length === TODAY_ACTION_CHAPTER_PROJECTION_MAX_ITEMS
  }

  for (const subject of subjects) {
    if (emit(subject.anchor)) return { chapter_progress: chapterProgress }
  }
  for (let distance = 1; distance < TODAY_ACTION_CHAPTER_WINDOW_SIZE; distance += 1) {
    for (const subject of subjects) {
      if (emit(subject.before[distance])) return { chapter_progress: chapterProgress }
    }
    for (const subject of subjects) {
      if (emit(subject.after[distance])) return { chapter_progress: chapterProgress }
    }
  }
  return { chapter_progress: chapterProgress }
}

export function buildTodayActionChapterProjection(value: unknown): TodayActionProviderChapterProjection {
  if (!Array.isArray(value)) throw new Error('chapter subjects must be an array')
  return allocateTodayActionChapterProjection(value.map((candidate, index) => {
    const subject = requireRecord(candidate, `chapter subject ${index}`)
    return prepareTodayActionChapterSubject(subject.id, subject.chapters)
  }))
}

export function assertTodayActionChapterProjectionWithinBound(
  projection: TodayActionProviderChapterProjection,
): string {
  const serialized = JSON.stringify(projection)
  if (serialized.length > TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS) {
    throw new Error(
      `Today Action chapter projection must be ${TODAY_ACTION_CHAPTER_PROJECTION_MAX_CODE_UNITS} UTF-16 code units or fewer`,
    )
  }
  return serialized
}

export function serializeTodayActionChapterProjection(
  projection: TodayActionProviderChapterProjection,
): string {
  return assertTodayActionChapterProjectionWithinBound(projection)
}

export function buildTodayActionChapterSignatureInput(
  projection: TodayActionProviderChapterProjection,
): string {
  return `${TODAY_ACTION_CHAPTER_CONTEXT_PROJECTION_VERSION}\u0000${serializeTodayActionChapterProjection(projection)}`
}

export function createEmptyTodayActionChapterProjection(): TodayActionProviderChapterProjection {
  return { chapter_progress: [] }
}

export async function loadTodayActionChapterProjectionForGeneration({
  loadSubjects,
  loadChapters,
}: {
  loadSubjects: () => Promise<unknown>
  loadChapters: (subjectId: number) => Promise<unknown>
}): Promise<TodayActionProviderChapterProjection> {
  let subjectRows: unknown
  try {
    subjectRows = await loadSubjects()
  } catch {
    return createEmptyTodayActionChapterProjection()
  }
  try {
    if (!Array.isArray(subjectRows)) return createEmptyTodayActionChapterProjection()

    const prepared: PreparedTodayActionChapterSubject[] = []
    for (const candidate of subjectRows) {
      let subjectId: number
      try {
        const subject = requireRecord(candidate, 'chapter subject')
        subjectId = requirePositiveSafeInteger(subject.id, 'subject id')
      } catch {
        continue
      }
      let chapters: unknown
      try {
        chapters = await loadChapters(subjectId)
      } catch {
        continue
      }
      try {
        prepared.push(prepareTodayActionChapterSubject(subjectId, chapters))
      } catch (error) {
        if (!(error instanceof TodayActionChapterDomainValidationError)) throw error
        // A failed or malformed subject is omitted from this generation read-set.
      }
    }
    const projection = allocateTodayActionChapterProjection(prepared)
    assertTodayActionChapterProjectionWithinBound(projection)
    return projection
  } catch {
    return createEmptyTodayActionChapterProjection()
  }
}

async function sha256Utf8(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function computeTodayActionChapterSignature(
  projection: TodayActionProviderChapterProjection,
): Promise<string> {
  return sha256Utf8(buildTodayActionChapterSignatureInput(projection))
}

export function buildTodayActionGenerationContextSignatureInput(
  messages: readonly AIMessage[],
): string {
  const requestJson = JSON.stringify({
    promptVersion: TODAY_ACTION_PROMPT_VERSION,
    messages,
  })
  return `${TODAY_ACTION_GENERATION_CONTEXT_VERSION}\u0000${requestJson}`
}

export async function computeTodayActionGenerationContextSignature(
  messages: readonly AIMessage[],
): Promise<string> {
  return sha256Utf8(buildTodayActionGenerationContextSignatureInput(messages))
}
