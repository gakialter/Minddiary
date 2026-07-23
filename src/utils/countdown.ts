import type { CountdownEvent, CountdownEventType } from '../types'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const VALID_EVENT_TYPES: readonly CountdownEventType[] = ['exam', 'holiday', 'deadline', 'custom']

export const DEFAULT_EXAM_EVENT_ID = 'default-exam'
export const DEFAULT_EXAM_TITLE = '考研初试'
export const PRIMARY_COUNTDOWN_TITLE_MAX_LENGTH = 40

export interface NormalizedCountdownSettings {
  examDate: string
  countdownEvents: CountdownEvent[]
}

export function parseLocalDate(dateStr: string): Date | null {
  const match = DATE_PATTERN.exec(dateStr)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  return date
}

export function isValidCountdownDate(dateStr: string): boolean {
  return parseLocalDate(dateStr) !== null
}

export function getDaysLeft(targetDate: string, now = new Date()): number {
  const target = parseLocalDate(targetDate)
  if (!target) return Number.NaN

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY)
}

export function parseCountdownEvents(rawEvents: unknown): CountdownEvent[] {
  if (Array.isArray(rawEvents)) return rawEvents.flatMap(coerceCountdownEvent)
  if (typeof rawEvents !== 'string' || rawEvents.trim() === '') return []

  try {
    const parsed: unknown = JSON.parse(rawEvents)
    return Array.isArray(parsed) ? parsed.flatMap(coerceCountdownEvent) : []
  } catch {
    return []
  }
}

export function normalizeCountdownEvents(
  rawEvents: unknown,
  examDate?: unknown,
): CountdownEvent[] {
  const events = dedupeEvents(parseCountdownEvents(rawEvents))
  const examDateStr = typeof examDate === 'string' && isValidCountdownDate(examDate)
    ? examDate
    : ''

  const examIndex = events.findIndex(event => event.id === DEFAULT_EXAM_EVENT_ID)
  const existingExamEvent = examIndex >= 0 ? events[examIndex] : undefined
  const primaryDate = examDateStr || existingExamEvent?.date || ''
  if (!primaryDate) return events

  const examEvent: CountdownEvent = {
    ...existingExamEvent,
    id: DEFAULT_EXAM_EVENT_ID,
    title: normalizePrimaryCountdownTitle(existingExamEvent?.title),
    date: primaryDate,
    type: 'exam',
  }

  if (examIndex >= 0) {
    return events.map((event, index) => (index === examIndex ? examEvent : event))
  }

  return [examEvent, ...events]
}

export function normalizeCountdownSettings(
  rawEvents: unknown,
  examDate?: unknown,
): NormalizedCountdownSettings {
  const countdownEvents = normalizeCountdownEvents(rawEvents, examDate)
  const primaryEvent = getPrimaryCountdownEvent(countdownEvents)
  return {
    examDate: primaryEvent?.date || (
      typeof examDate === 'string' && isValidCountdownDate(examDate) ? examDate : ''
    ),
    countdownEvents,
  }
}

export function getPrimaryCountdownEvent(events: CountdownEvent[]): CountdownEvent | undefined {
  return events.find(event => event.id === DEFAULT_EXAM_EVENT_ID)
}

export function normalizePrimaryCountdownTitle(title: unknown): string {
  if (typeof title !== 'string') return DEFAULT_EXAM_TITLE
  const trimmed = title.trim()
  return trimmed ? trimmed.slice(0, PRIMARY_COUNTDOWN_TITLE_MAX_LENGTH) : DEFAULT_EXAM_TITLE
}

export function getPrimaryCountdownTitleError(title: string): string | null {
  const trimmed = title.trim()
  if (!trimmed) return '主目标名称不能为空'
  if (trimmed.length > PRIMARY_COUNTDOWN_TITLE_MAX_LENGTH) {
    return `主目标名称不能超过 ${PRIMARY_COUNTDOWN_TITLE_MAX_LENGTH} 个字符`
  }
  return null
}

export function sortUpcomingEvents(
  events: CountdownEvent[],
  now = new Date(),
): CountdownEvent[] {
  return events
    .filter(event => !event.archived && Number.isFinite(getDaysLeft(event.date, now)) && getDaysLeft(event.date, now) >= 0)
    .sort((a, b) => {
      const daysDiff = getDaysLeft(a.date, now) - getDaysLeft(b.date, now)
      if (daysDiff !== 0) return daysDiff
      return a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
    })
}

export function getFeaturedCountdownEvent(
  events: CountdownEvent[],
  now = new Date(),
): CountdownEvent | null {
  const pinnedUpcoming = sortUpcomingEvents(events.filter(event => event.pinned), now)
  if (pinnedUpcoming.length > 0) return pinnedUpcoming[0]!

  const upcoming = sortUpcomingEvents(events, now)
  if (upcoming.length > 0) return upcoming[0]!

  const ended = events
    .filter(event => !event.archived && Number.isFinite(getDaysLeft(event.date, now)) && getDaysLeft(event.date, now) < 0)
    .sort((a, b) => getDaysLeft(b.date, now) - getDaysLeft(a.date, now))

  return ended[0] || null
}

export function formatCountdownLabel(event: CountdownEvent | null, now = new Date()): string {
  if (!event) return '暂无关键日期'

  const daysLeft = getDaysLeft(event.date, now)
  if (!Number.isFinite(daysLeft)) return '暂无关键日期'
  if (daysLeft === 0) return `今天：${event.title}`
  if (daysLeft < 0) return `${event.title}已结束`
  return `距${event.title} ${daysLeft} 天`
}

export function formatDaysLeft(daysLeft: number): string {
  if (daysLeft === 0) return '今天'
  if (daysLeft < 0) return '已结束'
  return `${daysLeft} 天`
}

function coerceCountdownEvent(rawEvent: unknown): CountdownEvent[] {
  if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) return []

  const event = rawEvent as Record<string, unknown>
  const id = typeof event.id === 'string' ? event.id.trim() : ''
  const rawTitle = typeof event.title === 'string' ? event.title : ''
  const title = id === DEFAULT_EXAM_EVENT_ID
    ? normalizePrimaryCountdownTitle(rawTitle)
    : rawTitle.trim()
  const date = typeof event.date === 'string' ? event.date.trim() : ''
  if (!id || !title || !isValidCountdownDate(date)) return []

  const type = typeof event.type === 'string' && VALID_EVENT_TYPES.includes(event.type as CountdownEventType)
    ? event.type as CountdownEventType
    : 'custom'

  return [{
    id,
    title,
    date,
    type,
    ...(typeof event.pinned === 'boolean' ? { pinned: event.pinned } : {}),
    ...(typeof event.archived === 'boolean' ? { archived: event.archived } : {}),
  }]
}

function dedupeEvents(events: CountdownEvent[]): CountdownEvent[] {
  const seen = new Set<string>()
  const unique: CountdownEvent[] = []

  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    unique.push(event)
  }

  return unique
}
