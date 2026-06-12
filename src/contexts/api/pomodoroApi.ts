import { IS_ELECTRON } from '../../utils/apiAdapter'
import { getLocalDateKey, isDateKey, toLocalDateTimeString } from '../../utils/dateKey'
import { STORAGE_KEYS } from '../../data/mockData'
import type { PomodoroRangeEntry, PomodoroSession, PomodoroStat, SaveToLocalFn, StudyTask, Subject } from '../../types'
import type { PomodoroContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

function normalizeSubjectId(value: number | null): number | null {
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null
}

function normalizeTaskIdForSession(value: number | null | undefined, tasks: StudyTask[]): number | null {
    if (value === undefined || value === null) return null
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error('pomodoro task_id must be a positive integer or null')
    }
    const task = tasks.find(item => item.id === value)
    if (!task) throw new Error('Task not found')
    return value
}

function normalizeDateTime(value: string | undefined): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getSubjectMeta(subjects: Subject[], subjectId: number | null): Pick<PomodoroStat, 'subject_name' | 'color'> {
    const subject = subjectId === null ? null : subjects.find(item => item.id === subjectId)
    return {
        subject_name: subject?.name ?? null,
        color: subject?.color ?? null,
    }
}

function aggregateStats(
    sessions: PomodoroSession[],
    subjects: Subject[],
    predicate: (session: PomodoroSession) => boolean,
): PomodoroStat[] {
    const bySubject = new Map<number | null, { total_minutes: number; session_count: number }>()
    for (const session of sessions.filter(predicate)) {
        const subjectId = session.subject_id ?? null
        const current = bySubject.get(subjectId) ?? { total_minutes: 0, session_count: 0 }
        current.total_minutes += Number(session.duration) || 0
        current.session_count += 1
        bySubject.set(subjectId, current)
    }
    return Array.from(bySubject.entries()).map(([subjectId, value]) => ({
        ...getSubjectMeta(subjects, subjectId),
        ...value,
    })).sort((a, b) => b.total_minutes - a.total_minutes)
}

export const createPomodoroApi = (
    subjectsRef?: MutableRefObject<Subject[]>,
    tasksRef?: MutableRefObject<StudyTask[]>,
    pomodoroSessionsRef?: MutableRefObject<PomodoroSession[]>,
    saveToLocal?: SaveToLocalFn
): PomodoroContextAPI => ({
    getStats: async (date: string) => {
        if (IS_ELECTRON) return window.api.pomodoro.getStats(date)
        return aggregateStats(
            pomodoroSessionsRef?.current ?? [],
            subjectsRef?.current ?? [],
            session => session.date_key === date,
        )
    },
    getStatsRange: async (start: string, end: string) => {
        if (IS_ELECTRON) return window.api.pomodoro.getStatsRange(start, end)
        return aggregateStats(
            pomodoroSessionsRef?.current ?? [],
            subjectsRef?.current ?? [],
            session => !!session.date_key && session.date_key >= start && session.date_key <= end,
        )
    },
    getRange: async (start: string, end: string) => {
        if (IS_ELECTRON) return window.api.pomodoro.getRange(start, end)
        const byDate = new Map<string, Omit<PomodoroRangeEntry, 'date'>>()
        for (const session of pomodoroSessionsRef?.current ?? []) {
            if (!session.date_key || session.date_key < start || session.date_key > end) continue
            const current = byDate.get(session.date_key) ?? { total_minutes: 0, session_count: 0 }
            current.total_minutes += Number(session.duration) || 0
            current.session_count += 1
            byDate.set(session.date_key, current)
        }
        return Array.from(byDate.entries())
            .map(([date, value]) => ({ date, ...value }))
            .sort((a, b) => a.date.localeCompare(b.date))
    },
    addSession: async (session: Pick<PomodoroSession, 'subject_id' | 'task_id' | 'duration' | 'date_key' | 'started_at' | 'completed_at'>) => {
        if (IS_ELECTRON) return window.api.pomodoro.addSession(session)
        if (!pomodoroSessionsRef || !saveToLocal) return true
        if (typeof session.duration !== 'number' || !Number.isFinite(session.duration) || session.duration <= 0) {
            throw new Error('pomodoro duration must be a positive number')
        }
        const startedAt = normalizeDateTime(session.started_at)
        const completedAt = normalizeDateTime(session.completed_at) ?? toLocalDateTimeString()
        const dateKey = isDateKey(session.date_key)
            ? session.date_key
            : getLocalDateKey(startedAt ? new Date(startedAt) : new Date())
        const newSession: PomodoroSession = {
            id: Math.max(0, ...pomodoroSessionsRef.current.map(item => item.id ?? 0)) + 1,
            subject_id: normalizeSubjectId(session.subject_id),
            task_id: normalizeTaskIdForSession(session.task_id, tasksRef?.current ?? []),
            duration: session.duration,
            date_key: dateKey,
            started_at: startedAt ?? undefined,
            completed_at: completedAt,
        }
        pomodoroSessionsRef.current = [...pomodoroSessionsRef.current, newSession]
        saveToLocal(STORAGE_KEYS.POMODORO_SESSIONS, pomodoroSessionsRef.current)
        return { id: newSession.id!, date_key: dateKey, started_at: startedAt, completed_at: completedAt }
    },
    getDailyTotal: async (date: string) => {
        if (IS_ELECTRON) return window.api.pomodoro.getDailyTotal(date)
        return (pomodoroSessionsRef?.current ?? [])
            .filter(session => session.date_key === date)
            .reduce((total, session) => total + (Number(session.duration) || 0), 0)
    }
})
