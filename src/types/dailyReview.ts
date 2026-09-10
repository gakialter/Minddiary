import type { Mistake } from './index'

/** Queue and cursor are private persistence state, never accepted from the renderer. */
export interface DailyReviewState {
    subject_id: number
    daily_quota: number
    queue: number[]
    cursor: number
    daily_date: string
    daily_completed: number
    round_id: string | null
    round_started_date: string | null
}

export type DailyReviewCommand =
    | { kind: 'get'; subjectId: number; date: string }
    | { kind: 'configure'; subjectId: number; date: string; quota: number }
    | { kind: 'start'; subjectId: number; date: string; previousRoundId: string | null }
    | { kind: 'complete'; subjectId: number; date: string; roundId: string; mistakeId: number }

export interface DailyReviewSnapshot {
    subjectId: number
    quota: number | null
    date: string
    dailyCompleted: number
    roundId: string | null
    roundCompleted: number
    roundTotal: number
    remaining: number
    subjectTotal: number
    estimatedDays: number
    status: 'unconfigured' | 'ready' | 'active' | 'daily_done' | 'round_done'
    currentItem: Mistake | null
}

export interface DailyReviewAPI {
    execute: (command: DailyReviewCommand) => Promise<DailyReviewSnapshot>
}
