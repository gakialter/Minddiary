const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function getLocalDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function getUtcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function getNextLocalDateKey(dateKey: string): string {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error('dateKey must be a YYYY-MM-DD local date key')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const localDate = new Date(year, month - 1, day + 1)
  if (Number.isNaN(localDate.getTime())) throw new Error('dateKey must be a valid local date key')
  return getLocalDateKey(localDate)
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && DATE_KEY_PATTERN.test(value)
}

export function toLocalDateTimeString(date: Date = new Date()): string {
  return [
    getLocalDateKey(date),
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
  ].join(' ')
}

export function getDelayUntilNextLocalDate(now: Date = new Date()): number {
  const nextDay = new Date(now)
  nextDay.setHours(24, 0, 0, 0)
  return Math.max(1000, nextDay.getTime() - now.getTime())
}
