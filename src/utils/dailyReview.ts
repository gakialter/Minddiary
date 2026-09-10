import type { Mistake } from '../types'
import type { DailyReviewCommand, DailyReviewSnapshot, DailyReviewState } from '../types/dailyReview'

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const validDate = (value: unknown): value is string => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value)

export function validateDailyReviewCommand(value: unknown): DailyReviewCommand {
    if (!value || typeof value !== 'object') throw new Error('Invalid daily review command')
    const input = value as Record<string, unknown>
    if (!positiveInteger(input.subjectId) || !validDate(input.date)) throw new Error('Invalid daily review subject or date')
    const base = { subjectId: input.subjectId, date: input.date }
    switch (input.kind) {
        case 'get': return { ...base, kind: 'get' }
        case 'configure':
            if (!positiveInteger(input.quota)) throw new Error('每日题量必须为正整数')
            return { ...base, kind: 'configure', quota: input.quota }
        case 'start':
            if (input.previousRoundId !== null && !validToken(input.previousRoundId)) throw new Error('Invalid round token')
            return { ...base, kind: 'start', previousRoundId: input.previousRoundId }
        case 'complete':
            if (!validToken(input.roundId) || !positiveInteger(input.mistakeId)) throw new Error('Invalid daily review item')
            return { ...base, kind: 'complete', roundId: input.roundId, mistakeId: input.mistakeId }
        default: throw new Error('Unknown daily review command')
    }
}

export function validateDailyReviewState(value: DailyReviewState): DailyReviewState {
    if (!positiveInteger(value.subject_id) || !positiveInteger(value.daily_quota)
        || !Array.isArray(value.queue) || !value.queue.every(positiveInteger)
        || new Set(value.queue).size !== value.queue.length
        || !Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > value.queue.length
        || !Number.isSafeInteger(value.daily_completed) || value.daily_completed < 0
        || !validDate(value.daily_date)
        || (value.round_id === null
            ? value.queue.length !== 0 || value.cursor !== 0 || value.round_started_date !== null
            : !validToken(value.round_id) || !validDate(value.round_started_date))) {
        throw new Error('Invalid daily review state')
    }
    return value
}

/** Shared deterministic transitions. Adapters supply atomic read/transition/write ownership. */
export function transitionDailyReview(
    stored: DailyReviewState | null,
    command: DailyReviewCommand,
    items: Mistake[],
    newRoundId: () => string,
    random: () => number = Math.random,
): { state: DailyReviewState | null; snapshot: DailyReviewSnapshot } {
    let state = stored ? { ...validateDailyReviewState(stored), queue: [...stored.queue] } : null
    const pool = items.filter(item => item.subject_id === command.subjectId)
    const byId = new Map(pool.map(item => [item.id, item]))
    // Late requests from yesterday cannot roll the counter backwards or consume today's item.
    const staleDate = state !== null && command.date < state.daily_date
    const changedDate = state !== null && command.date !== state.daily_date
    if (state && command.date > state.daily_date) {
        state.daily_date = command.date
        state.daily_completed = 0
    }
    if (command.kind === 'configure' && !staleDate) {
        state = state ? { ...state, daily_quota: command.quota } : {
            subject_id: command.subjectId, daily_quota: command.quota,
            queue: [], cursor: 0, daily_date: command.date, daily_completed: 0,
            round_id: null, round_started_date: null,
        }
    }
    const skipInvalid = () => {
        if (state) while (state.cursor < state.queue.length && !byId.has(state.queue[state.cursor]!)) state.cursor++
    }
    skipInvalid()
    if (state && !staleDate) {
        if (command.kind === 'start' && command.previousRoundId === state.round_id
            && state.cursor === state.queue.length && state.daily_completed < state.daily_quota && pool.length > 0) {
            const queue = [...byId.keys()]
            for (let i = queue.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1))
                ;[queue[i], queue[j]] = [queue[j]!, queue[i]!]
            }
            state.queue = queue
            state.cursor = 0
            state.round_id = newRoundId()
            state.round_started_date = command.date
        } else if (command.kind === 'complete' && !changedDate && command.roundId === state.round_id
            && state.daily_completed < state.daily_quota && state.queue[state.cursor] === command.mistakeId) {
            state.cursor++
            state.daily_completed++
            skipInvalid()
        }
    }
    const roundDone = !!state?.round_id && state.cursor === state.queue.length
    const dailyDone = !!state && state.daily_completed >= state.daily_quota
    const status = !state ? 'unconfigured' : roundDone ? 'round_done' : dailyDone ? 'daily_done' : !state.round_id ? 'ready' : 'active'
    return { state, snapshot: {
        subjectId: command.subjectId, quota: state?.daily_quota ?? null,
        date: state?.daily_date ?? command.date, dailyCompleted: state?.daily_completed ?? 0,
        roundId: state?.round_id ?? null, roundCompleted: state?.cursor ?? 0,
        roundTotal: state?.queue.length ?? 0, remaining: state ? state.queue.length - state.cursor : 0,
        subjectTotal: pool.length, estimatedDays: state ? Math.ceil((state.round_id ? state.queue.length : pool.length) / state.daily_quota) : 0,
        status, currentItem: status === 'active' && state ? byId.get(state.queue[state.cursor]!) ?? null : null,
    } }
}
