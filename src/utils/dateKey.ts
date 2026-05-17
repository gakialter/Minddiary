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
