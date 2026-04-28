/**
 * spacedRepetition.ts — SM-2 Spaced Repetition Algorithm
 *
 * Implements the SuperMemo-2 algorithm to schedule mistake reviews.
 * All functions are pure — no side effects, no database calls.
 *
 * Quality scale (mapped to UI buttons):
 *   0 = Again  (完全不会 — 重来)
 *   2 = Hard   (困难 — 勉强想起)
 *   4 = Good   (良好 — 有些犹豫但正确)
 *   5 = Easy   (简单 — 秒答)
 */

export interface ReviewResult {
  ease_factor: number
  review_interval: number   // days until next review
  next_review_date: string  // 'YYYY-MM-DD'
  review_count: number
}

/**
 * Calculate the next review schedule based on the SM-2 algorithm.
 *
 * @param quality - 0 | 2 | 4 | 5 (mapped from UI buttons)
 * @param currentEase - current ease factor (default 2.5 for new cards)
 * @param currentInterval - current interval in days
 * @param reviewCount - number of times this card has been reviewed
 * @returns ReviewResult with updated scheduling parameters
 */
export function calculateNextReview(
  quality: number,
  currentEase: number = 2.5,
  currentInterval: number = 1,
  reviewCount: number = 0
): ReviewResult {
  // Clamp quality to valid range
  const q = Math.max(0, Math.min(5, quality))

  let newEase = currentEase
  let newInterval: number
  let newCount = reviewCount + 1

  if (q < 3) {
    // Failed review — reset interval, keep ease (with penalty)
    newInterval = 1
    newCount = 0 // reset streak
    newEase = Math.max(1.3, currentEase - 0.2)
  } else {
    // Successful review — calculate new ease factor
    // SM-2 ease formula: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    newEase = currentEase + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    newEase = Math.max(1.3, newEase) // floor at 1.3

    if (reviewCount === 0) {
      newInterval = 1
    } else if (reviewCount === 1) {
      newInterval = 6
    } else {
      newInterval = Math.round(currentInterval * newEase)
    }
  }

  // Cap interval at 365 days
  newInterval = Math.min(365, newInterval)

  const nextDate = addDays(new Date(), newInterval)

  return {
    ease_factor: Math.round(newEase * 100) / 100, // 2 decimal places
    review_interval: newInterval,
    next_review_date: formatDate(nextDate),
    review_count: newCount,
  }
}

/**
 * Get the count of mistakes due for review on a given date.
 * This is a helper for filtering — actual DB query happens in database.js.
 */
export function isDueForReview(nextReviewDate: string | null, today?: string): boolean {
  if (!nextReviewDate) return true // never reviewed = due now
  const todayStr = today || formatDate(new Date())
  return nextReviewDate <= todayStr
}

/**
 * Map UI button labels to quality values.
 */
export const REVIEW_QUALITIES = [
  { quality: 0, label: '重来', color: 'var(--danger)',   icon: 'RotateCcw' },
  { quality: 2, label: '困难', color: 'var(--warning)', icon: 'AlertTriangle' },
  { quality: 4, label: '良好', color: 'var(--success)', icon: 'Check' },
  { quality: 5, label: '简单', color: 'var(--accent)',  icon: 'Zap' },
] as const

// ─── Date Helpers (pure, no external deps) ───

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
