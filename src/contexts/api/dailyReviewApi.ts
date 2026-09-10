import type { MutableRefObject } from 'react'
import type { Mistake, Subject } from '../../types'
import type { DailyReviewAPI, DailyReviewState } from '../../types/dailyReview'
import { IS_ELECTRON } from '../../utils/apiAdapter'
import { transitionDailyReview, validateDailyReviewCommand } from '../../utils/dailyReview'

export const dailyReviewStorageKey = (subjectId: number) => `minddiary_daily_review_${subjectId}`

/** Browser IDs must not reuse deleted IDs still referenced by a frozen round. */
export function dailyReviewMistakeHighWater(): number {
    let highWater = 0
    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)
        if (!key?.startsWith('minddiary_daily_review_')) continue
        try {
            const state: unknown = JSON.parse(localStorage.getItem(key)!)
            if (!state || typeof state !== 'object' || !('queue' in state) || !Array.isArray(state.queue)) continue
            for (const id of state.queue) {
                if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) highWater = Math.max(highWater, id)
            }
        } catch {
            // Recover queue IDs where possible without letting corrupt review data block mistake CRUD.
        }
    }
    return highWater
}

export function createDailyReviewApi(mistakes: MutableRefObject<Mistake[]>, subjects: MutableRefObject<Subject[]>): DailyReviewAPI {
    return { execute: async input => {
        const command = validateDailyReviewCommand(input)
        if (IS_ELECTRON) return window.api.dailyReview.execute(command)
        // No await between read and write: one browser event loop owns each transition.
        const key = dailyReviewStorageKey(command.subjectId)
        if (!subjects.current.some(subject => subject.id === command.subjectId)) {
            localStorage.removeItem(key)
            throw new Error('科目不存在')
        }
        const raw = localStorage.getItem(key)
        const stored: DailyReviewState | null = raw ? JSON.parse(raw) : null
        const result = transitionDailyReview(stored, command, mistakes.current, () => crypto.randomUUID())
        if (result.state) localStorage.setItem(key, JSON.stringify(result.state))
        return result.snapshot
    } }
}
