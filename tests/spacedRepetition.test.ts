import { describe, it, expect } from 'vitest'
import { calculateNextReview, isDueForReview, REVIEW_QUALITIES } from '../src/utils/spacedRepetition'

describe('calculateNextReview (SM-2)', () => {
  // ─── First review (reviewCount = 0) ───

  it('should set interval to 1 day on first successful review', () => {
    const result = calculateNextReview(4, 2.5, 1, 0)
    expect(result.review_interval).toBe(1)
    expect(result.review_count).toBe(1)
  })

  it('should set interval to 1 day on first failed review and reset count', () => {
    const result = calculateNextReview(0, 2.5, 1, 0)
    expect(result.review_interval).toBe(1)
    expect(result.review_count).toBe(0)
  })

  // ─── Second review (reviewCount = 1) ───

  it('should set interval to 6 days on second successful review', () => {
    const result = calculateNextReview(4, 2.5, 1, 1)
    expect(result.review_interval).toBe(6)
    expect(result.review_count).toBe(2)
  })

  // ─── Subsequent reviews ───

  it('should multiply interval by ease factor on subsequent reviews', () => {
    // reviewCount=2, interval=6, ease=2.5, quality=4
    const result = calculateNextReview(4, 2.5, 6, 2)
    // new ease = 2.5 + (0.1 - (5-4)*(0.08 + (5-4)*0.02)) = 2.5 + 0.0 = 2.5
    // new interval = round(6 * 2.5) = 15
    expect(result.review_interval).toBe(15)
    expect(result.ease_factor).toBe(2.5)
    expect(result.review_count).toBe(3)
  })

  it('should increase ease factor when quality is 5 (Easy)', () => {
    const result = calculateNextReview(5, 2.5, 6, 2)
    // new ease = 2.5 + (0.1 - 0*(0.08 + 0*0.02)) = 2.5 + 0.1 = 2.6
    expect(result.ease_factor).toBe(2.6)
  })

  it('should decrease ease factor when quality is 3 (borderline pass)', () => {
    const result = calculateNextReview(3, 2.5, 6, 2)
    // new ease = 2.5 + (0.1 - 2*(0.08 + 2*0.02)) = 2.5 + (0.1 - 0.24) = 2.36
    expect(result.ease_factor).toBe(2.36)
  })

  // ─── Failed reviews ───

  it('should reset interval to 1 on failed review (quality < 3)', () => {
    const result = calculateNextReview(2, 2.5, 15, 3)
    expect(result.review_interval).toBe(1)
    expect(result.review_count).toBe(0)
  })

  it('should penalize ease by -0.2 on failed review', () => {
    const result = calculateNextReview(0, 2.5, 15, 3)
    expect(result.ease_factor).toBe(2.3)
  })

  // ─── Floor and ceiling ───

  it('should not let ease factor drop below 1.3', () => {
    const result = calculateNextReview(0, 1.3, 1, 0)
    expect(result.ease_factor).toBe(1.3) // can't go below 1.3 even with penalty
  })

  it('should cap interval at 365 days', () => {
    const result = calculateNextReview(5, 2.6, 300, 10)
    expect(result.review_interval).toBeLessThanOrEqual(365)
  })

  // ─── next_review_date format ───

  it('should return a valid YYYY-MM-DD date string', () => {
    const result = calculateNextReview(4, 2.5, 1, 0)
    expect(result.next_review_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // ─── Quality clamping ───

  it('should clamp quality values above 5 to 5', () => {
    const result = calculateNextReview(10, 2.5, 1, 0)
    expect(result.review_count).toBe(1) // treated as successful
  })

  it('should clamp quality values below 0 to 0', () => {
    const result = calculateNextReview(-1, 2.5, 1, 0)
    expect(result.review_count).toBe(0) // treated as failed
  })
})

describe('isDueForReview', () => {
  it('should return true if next_review_date is null (never reviewed)', () => {
    expect(isDueForReview(null)).toBe(true)
  })

  it('should return true if next_review_date is today or earlier', () => {
    expect(isDueForReview('2020-01-01', '2025-01-01')).toBe(true)
    expect(isDueForReview('2025-01-01', '2025-01-01')).toBe(true)
  })

  it('should return false if next_review_date is in the future', () => {
    expect(isDueForReview('2099-12-31', '2025-01-01')).toBe(false)
  })
})

describe('REVIEW_QUALITIES', () => {
  it('should have exactly 4 quality levels', () => {
    expect(REVIEW_QUALITIES).toHaveLength(4)
  })

  it('should include qualities 0, 2, 4, 5', () => {
    const qualities = REVIEW_QUALITIES.map(q => q.quality)
    expect(qualities).toEqual([0, 2, 4, 5])
  })
})
