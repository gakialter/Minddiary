import type { MoodId, NewEntry, Tag } from '../types'
import type { DiaryContextValue } from '../types/api'
import { validateMistakeWritePayload, type MistakeWritePayload } from './mistakePayload'
import { normalizeTag } from './tagStyle'

export type SettingsJsonSubject = {
  id: number
  name: string
  color: string
  total_chapters: number
  completed_chapters: number
}

export type SettingsJsonBackup = {
  version?: string
  entries: NewEntry[]
  tags: Tag[]
  subjects: SettingsJsonSubject[]
  mistakes: MistakeWritePayload[]
}

export type SettingsJsonImportPlan = {
  backup: SettingsJsonBackup
  subjects: Array<{ source: SettingsJsonSubject; targetId?: number }>
  tags: Tag[]
  skippedTags: number
}

type ImportReadAPI = {
  subjects: Pick<DiaryContextValue['subjects'], 'getAll'>
  subjectChapters: Pick<DiaryContextValue['subjectChapters'], 'getBySubject'>
  tags: Pick<DiaryContextValue['tags'], 'getAll'>
}

const MOODS: readonly MoodId[] = ['motivated', 'happy', 'calm', 'tired', 'anxious', 'sad']
const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label}超过 ${maxLength} 字符`)
  return value
}

function requireNonEmptyString(value: unknown, label: string): string {
  const text = requireString(value, label)
  if (!text.trim()) throw new Error(`${label}不能为空`)
  return text
}

function requireInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label}必须是${minimum === 1 ? '正' : '非负'}安全整数`)
  }
  return value
}

function parseEntry(record: Record<string, unknown>, label: string): NewEntry {
  const date = requireString(record.date, `${label}日期`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label}日期必须为 YYYY-MM-DD`)
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const calendarDate = new Date(0)
  calendarDate.setUTCFullYear(year, month - 1, day)
  if (year < 1 || calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new Error(`${label}日期不是有效日历日期`)
  }
  const title = requireString(record.title, `${label}标题`, 500)
  const content = requireString(record.content, `${label}正文`, 200_000)
  const mood = record.mood
  if (mood !== null && (typeof mood !== 'string' || !MOODS.includes(mood as MoodId))) {
    throw new Error(`${label}心情无效`)
  }
  if (hasOwn(record, 'tags')) {
    if (!Array.isArray(record.tags)) throw new Error(`${label}标签必须是数组`)
    record.tags.forEach((id, index) => requireInteger(id, `${label}第 ${index + 1} 个标签 ID`, 1))
  }
  if (hasOwn(record, 'images')) {
    if (!Array.isArray(record.images)) throw new Error(`${label}图片必须是数组`)
    record.images.forEach((path, index) => requireString(path, `${label}第 ${index + 1} 个图片路径`, 2_000))
  }
  // Settings JSON restores text only; source IDs, relationships and media are not writes.
  return { date, title, content, mood: mood as MoodId | null }
}

function parseSubject(record: Record<string, unknown>, label: string): SettingsJsonSubject {
  const id = requireInteger(record.id, `${label}ID`, 1)
  const name = requireNonEmptyString(record.name, `${label}名称`)
  const color = requireNonEmptyString(record.color, `${label}颜色`)
  const total_chapters = requireInteger(record.total_chapters, `${label}总章节数`)
  const completed_chapters = requireInteger(record.completed_chapters, `${label}已完成章节数`)
  if (completed_chapters > total_chapters) throw new Error(`${label}已完成章节数不能超过总章节数`)
  return { id, name, color, total_chapters, completed_chapters }
}

function parseTag(record: Record<string, unknown>, label: string): Tag {
  const name = requireNonEmptyString(record.name, `${label}名称`)
  for (const key of ['color', 'icon', 'variant', 'pattern']) {
    if (hasOwn(record, key)) requireString(record[key], `${label}${key}`)
  }
  return normalizeTag({ id: 0, name, color: record.color as string | undefined,
    icon: record.icon as string | undefined, variant: record.variant as Tag['variant'],
    pattern: record.pattern as Tag['pattern'] })
}

function parseMistake(record: Record<string, unknown>, label: string): MistakeWritePayload {
  requireString(record.question, `${label}题目`, 200_000)
  for (const key of ['subject_id', 'review_interval', 'review_count']) {
    if (hasOwn(record, key) && record[key] !== undefined && record[key] !== null) {
      requireInteger(record[key], `${label}${key}`)
    }
  }
  try {
    return validateMistakeWritePayload(record)
  } catch (error: unknown) {
    throw new Error(`${label}字段无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseGroup<T>(data: Record<string, unknown>, key: string, label: string,
  parse: (record: Record<string, unknown>, label: string) => T): T[] {
  if (!hasOwn(data, key)) return []
  if (!Array.isArray(data[key])) throw new Error(`${label}必须是数组`)
  return data[key].map((value, index) => {
    const itemLabel = `${label}第 ${index + 1} 项：`
    return parse(requireRecord(value, itemLabel), itemLabel)
  })
}

export function parseSettingsJsonBackup(value: unknown): SettingsJsonBackup {
  const root = requireRecord(value, '备份文件')
  const data = requireRecord(root.data, '备份 data')
  if (!hasOwn(data, 'entries') && !hasOwn(data, 'mistakes')) throw new Error('备份缺少日记或错题数据')
  const version = hasOwn(root, 'version') ? requireString(root.version, '备份版本') : undefined
  const entries = parseGroup(data, 'entries', '日记', parseEntry)
  const tags = parseGroup(data, 'tags', '标签', parseTag)
  const subjects = parseGroup(data, 'subjects', '科目', parseSubject)
  const mistakes = parseGroup(data, 'mistakes', '错题', parseMistake)
  const ids = new Set<number>()
  const names = new Set<string>()
  for (const subject of subjects) {
    if (ids.has(subject.id)) throw new Error(`科目“${subject.name}”的来源 ID ${subject.id} 重复`)
    if (names.has(subject.name)) throw new Error(`来源科目名称“${subject.name}”重复`)
    ids.add(subject.id)
    names.add(subject.name)
  }
  mistakes.forEach((mistake, index) => {
    if (mistake.subject_id !== undefined && mistake.subject_id !== null && !ids.has(mistake.subject_id)) {
      throw new Error(`错题第 ${index + 1} 项引用的科目 ID ${mistake.subject_id} 不在本文件科目中`)
    }
  })
  return { ...(version === undefined ? {} : { version }), entries, tags, subjects, mistakes }
}

export async function prepareSettingsJsonImport(backup: SettingsJsonBackup, api: ImportReadAPI): Promise<SettingsJsonImportPlan> {
  const [existingSubjects, existingTags] = await Promise.all([api.subjects.getAll(), api.tags.getAll()])
  const subjects: SettingsJsonImportPlan['subjects'] = []
  for (const source of backup.subjects) {
    const matches = existingSubjects.filter(subject => subject.name === source.name)
    if (matches.length > 1) throw new Error(`目标中有多个同名科目“${source.name}”，无法确定合并对象`)
    const match = matches[0]
    if (match) {
      const chapters = await api.subjectChapters.getBySubject(match.id)
      const completed = chapters.filter(chapter => chapter.completed).length
      if (chapters.length > 0 && (source.total_chapters !== chapters.length || source.completed_chapters !== completed)) {
        throw new Error(`科目“${source.name}”的章节数与现有详细章节不兼容：现有 ${chapters.length} 章，已完成 ${completed} 章`)
      }
      subjects.push({ source, targetId: match.id })
    } else subjects.push({ source })
  }
  const tagNames = new Set(existingTags.map(tag => tag.name))
  const tags: Tag[] = []
  let skippedTags = 0
  for (const tag of backup.tags) {
    if (tagNames.has(tag.name)) skippedTags++
    else {
      tagNames.add(tag.name)
      tags.push(tag)
    }
  }
  return { backup, subjects, tags, skippedTags }
}
