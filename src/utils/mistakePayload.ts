import type { Mistake } from '../types'

export type MistakeWritePayload = Partial<Pick<
  Mistake,
  | 'subject_id'
  | 'question'
  | 'answer'
  | 'notes'
  | 'mastered'
  | 'ease_factor'
  | 'review_interval'
  | 'next_review_date'
  | 'review_count'
  | 'image_path'
  | 'answer_image_path'
>>

const MAX_TEXT_LENGTH = 200_000
const MAX_IMAGE_PATH_LENGTH = 20_000

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function optionalString(
  record: Record<string, unknown>,
  key: 'question' | 'answer' | 'notes',
): string | undefined {
  if (!hasOwn(record, key) || record[key] === undefined) return undefined
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`mistake ${key} must be a string`)
  if (value.length > MAX_TEXT_LENGTH) throw new Error(`mistake ${key} is too long`)
  return value
}

function optionalImagePath(
  record: Record<string, unknown>,
  key: 'image_path' | 'answer_image_path',
): string | null | undefined {
  if (!hasOwn(record, key) || record[key] === undefined) return undefined
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`mistake ${key} must be a string or null`)
  if (value.length > MAX_IMAGE_PATH_LENGTH) throw new Error(`mistake ${key} is too long`)
  return value
}

function optionalFiniteNumber(
  record: Record<string, unknown>,
  key: 'ease_factor',
): number | undefined {
  if (!hasOwn(record, key) || record[key] === undefined) return undefined
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`mistake ${key} must be a positive finite number`)
  }
  return value
}

function optionalNonNegativeInteger(
  record: Record<string, unknown>,
  key: 'review_interval' | 'review_count',
): number | undefined {
  if (!hasOwn(record, key) || record[key] === undefined) return undefined
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`mistake ${key} must be a non-negative integer`)
  }
  return value
}

function optionalReviewDate(record: Record<string, unknown>): string | null | undefined {
  if (!hasOwn(record, 'next_review_date') || record.next_review_date === undefined) return undefined
  const value = record.next_review_date
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('mistake next_review_date must be a YYYY-MM-DD string or null')
  }
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('mistake next_review_date must be a valid calendar date or null')
  }
  return value
}

export function validateMistakeId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('mistake id must be a positive integer')
  }
  return value
}

export function validateMistakeWritePayload(value: unknown): MistakeWritePayload {
  const record = requireRecord(value, 'mistake payload')
  const result: MistakeWritePayload = {}

  if (hasOwn(record, 'subject_id') && record.subject_id !== undefined) {
    if (record.subject_id !== null
      && (typeof record.subject_id !== 'number'
        || !Number.isInteger(record.subject_id)
        || record.subject_id < 0)) {
      throw new Error('mistake subject_id must be a non-negative integer or null')
    }
    result.subject_id = record.subject_id === 0 ? null : record.subject_id as number | null
  }

  for (const key of ['question', 'answer', 'notes'] as const) {
    const field = optionalString(record, key)
    if (field !== undefined) result[key] = field
  }

  if (hasOwn(record, 'mastered') && record.mastered !== undefined) {
    if (typeof record.mastered === 'boolean') {
      result.mastered = record.mastered
    } else if (record.mastered === 0 || record.mastered === 1) {
      result.mastered = record.mastered === 1
    } else {
      throw new Error('mistake mastered must be a boolean or 0/1')
    }
  }

  const easeFactor = optionalFiniteNumber(record, 'ease_factor')
  if (easeFactor !== undefined) result.ease_factor = easeFactor

  for (const key of ['review_interval', 'review_count'] as const) {
    const field = optionalNonNegativeInteger(record, key)
    if (field !== undefined) result[key] = field
  }

  const nextReviewDate = optionalReviewDate(record)
  if (nextReviewDate !== undefined) result.next_review_date = nextReviewDate

  for (const key of ['image_path', 'answer_image_path'] as const) {
    const field = optionalImagePath(record, key)
    if (field !== undefined) result[key] = field
  }

  return result
}
