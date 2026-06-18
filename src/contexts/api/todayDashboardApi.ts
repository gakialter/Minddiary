import { IS_ELECTRON } from '../../utils/apiAdapter'
import { calculateTaskFocusMetrics } from '../../utils/taskFocusMetrics'
import type { DiaryEntry, Mistake, PomodoroSession, StudyTask } from '../../types'
import type { TodayDashboardContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

export const createTodayDashboardApi = (
    entriesRef: MutableRefObject<DiaryEntry[]>,
    mistakesRef: MutableRefObject<Mistake[]>,
    tasksRef?: MutableRefObject<StudyTask[]>,
    pomodoroSessionsRef?: MutableRefObject<PomodoroSession[]>
): TodayDashboardContextAPI => ({
    getData: async (date: string) => {
        if (IS_ELECTRON) return window.api.todayDashboard.getData(date)
        // Browser fallback: compute from local state
        const todayEntry = entriesRef.current.find(e => e.date === date)
        const dueCount = mistakesRef.current.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date)).length
        const todayPomodoroSessions = (pomodoroSessionsRef?.current ?? []).filter(session => session.date_key === date)
        const actionCount = entriesRef.current.filter(entry => entry.date === date && entry.word_count > 20).length
            + mistakesRef.current.filter(mistake => mistake.updated_at?.slice(0, 10) === date).length
        const focusConversionRate = todayPomodoroSessions.length > 0
            ? Math.min(100, Math.round((actionCount / todayPomodoroSessions.length) * 100 * 1.2))
            : actionCount > 0 ? 100 : 0
        const taskRows = (tasksRef?.current ?? []).filter(task => task.planned_date === date)
        const taskFocusRows = todayPomodoroSessions
            .filter((session): session is PomodoroSession & { task_id: number } => (
                typeof session.task_id === 'number'
                && Number.isInteger(session.task_id)
                && taskRows.some(task => task.id === session.task_id)
            ))
        const focusedMinutesByTask = new Map<number, number>()
        for (const session of taskFocusRows) {
            focusedMinutesByTask.set(
                session.task_id,
                (focusedMinutesByTask.get(session.task_id) ?? 0) + (Number(session.duration) || 0),
            )
        }
        const taskFocusToday = calculateTaskFocusMetrics(
            taskRows,
            Array.from(focusedMinutesByTask.entries()).map(([task_id, total_minutes]) => ({ task_id, total_minutes })),
        )
        return {
            todayEntry: todayEntry ? {
                id: todayEntry.id,
                title: todayEntry.title,
                wordCount: todayEntry.word_count,
                mood: todayEntry.mood,
            } : null,
            pomodoroToday: {
                totalMinutes: todayPomodoroSessions.reduce((total, session) => total + (Number(session.duration) || 0), 0),
                sessionCount: todayPomodoroSessions.length,
            },
            commanderMetrics: {
                riskPoolCount: dueCount,
                lockedKnowledgeGrowth: 0,
                focusConversionRate
            },
            taskFocusToday,
            streakDays: 0
        }
    }
})
