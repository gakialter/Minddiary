import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDailyReviewApi, dailyReviewStorageKey } from '../src/contexts/api/dailyReviewApi'
import { createMistakesApi } from '../src/contexts/api/mistakesApi'
import { createSubjectsApi } from '../src/contexts/api/subjectsApi'
import type { Mistake, Subject, StudyTask } from '../src/types'

const environment = vi.hoisted(() => ({ electron: false }))
vi.mock('../src/utils/apiAdapter', () => ({ get IS_ELECTRON() { return environment.electron } }))

describe('daily review context adapters', () => {
    const date = '2026-09-10'
    const subjects = { current: [{ id: 1, name: '数学' }] as Subject[] }
    let mistakes: { current: Mistake[] }
    const tasks = { current: [] as StudyTask[] }
    const save = <T,>(key: string, value: T) => localStorage.setItem(key, JSON.stringify(value))
    beforeEach(() => {
        localStorage.clear()
        environment.electron = false
        subjects.current = [{ id: 1, name: '数学' }] as Subject[]
        mistakes = { current: [1, 2, 3].map(id => ({ id, subject_id: 1, question: `${id}`, mastered: true, ease_factor: 2.7, review_interval: 60, next_review_date: '2027-01-01', review_count: 5 })) as Mistake[] }
    })

    it('persists quota, deduplicates concurrent calls, restores after recreation and continues next day without SM-2 mutation', async () => {
        let api = createDailyReviewApi(mistakes, subjects)
        const before = structuredClone(mistakes.current)
        await api.execute({ kind: 'configure', subjectId: 1, date, quota: 1 })
        const first = await api.execute({ kind: 'start', subjectId: 1, date, previousRoundId: null })
        const command = { kind: 'complete' as const, subjectId: 1, date, roundId: first.roundId!, mistakeId: first.currentItem!.id }
        const [done, duplicate] = await Promise.all([api.execute(command), api.execute(command)])
        expect(duplicate).toEqual(done)
        expect(done).toMatchObject({ dailyCompleted: 1, roundCompleted: 1, status: 'daily_done' })
        api = createDailyReviewApi(mistakes, subjects)
        expect(await api.execute({ kind: 'get', subjectId: 1, date })).toEqual(done)
        const next = await api.execute({ kind: 'get', subjectId: 1, date: '2026-09-11' })
        expect(next).toMatchObject({ dailyCompleted: 0, roundCompleted: 1, roundId: first.roundId })
        expect(mistakes.current).toEqual(before)
    })

    it('does not reuse IDs of deleted queued mistakes for new individual or batch mistakes', async () => {
        const api = createDailyReviewApi(mistakes, subjects)
        await api.execute({ kind: 'configure', subjectId: 1, date, quota: 10 })
        await api.execute({ kind: 'start', subjectId: 1, date, previousRoundId: null })
        const mistakesApi = createMistakesApi(mistakes, subjects, tasks, save)
        await mistakesApi.delete(3)
        const created = await mistakesApi.create({ subject_id: 1, question: '新增' })
        expect(created.id).toBe(4)
        await mistakesApi.delete(4)
        const batch = await mistakesApi.createBatch([{ subject_id: 1, question: '批量' }])
        expect(batch[0]!.id).toBe(4)
        expect(JSON.parse(localStorage.getItem(dailyReviewStorageKey(1))!).queue.sort()).toEqual([1, 2, 3])
        const subjectsApi = createSubjectsApi(subjects, save, { mistakesRef: mistakes })
        await subjectsApi.delete(1)
        expect(localStorage.getItem(dailyReviewStorageKey(1))).toBeNull()
        await expect(api.execute({ kind: 'get', subjectId: 1, date })).rejects.toThrow('科目不存在')
    })

    it('creates individual and batch mistakes despite corrupt review states while protecting recoverable queue IDs', async () => {
        const stored = [
            '{broken', 'null', '42', '[]', '{"queue":"wrong shape"}',
            JSON.stringify({ queue: [40, -1, 0, 2.5, '90', null, {}, Number.MAX_SAFE_INTEGER + 1], daily_quota: 'invalid' }),
        ]
        stored.forEach((value, index) => localStorage.setItem(dailyReviewStorageKey(index + 1), value))
        const api = createMistakesApi(mistakes, subjects, tasks, save)
        const individual = await api.create({ subject_id: 1, question: '新增' })
        const batch = await api.createBatch([{ subject_id: 1, question: '批量' }])
        expect(individual.id).toBe(41)
        expect(batch[0]!.id).toBe(42)
        expect(mistakes.current.map(mistake => mistake.id)).toEqual([1, 2, 3, 41, 42])
        stored.forEach((value, index) => expect(localStorage.getItem(dailyReviewStorageKey(index + 1))).toBe(value))
        await expect(createDailyReviewApi(mistakes, subjects).execute({ kind: 'get', subjectId: 1, date })).rejects.toThrow()
    })

    it('delegates Electron calls only to the typed daily API, never to browser state or SM-2', async () => {
        environment.electron = true
        const execute = vi.fn().mockResolvedValue({ status: 'ready' })
        window.api.dailyReview = { execute }
        const readStorage = vi.spyOn(Storage.prototype, 'getItem')
        const writeStorage = vi.spyOn(Storage.prototype, 'setItem')
        const api = createDailyReviewApi(mistakes, subjects)
        const command = { kind: 'get' as const, subjectId: 1, date }
        expect(await api.execute(command)).toEqual({ status: 'ready' })
        expect(execute).toHaveBeenCalledExactlyOnceWith(command)
        expect(readStorage).not.toHaveBeenCalled()
        expect(writeStorage).not.toHaveBeenCalled()
        readStorage.mockRestore(); writeStorage.mockRestore()
    })
})
