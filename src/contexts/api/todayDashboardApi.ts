import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { DiaryEntry, Mistake } from '../../types'
import type { TodayDashboardContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

export const createTodayDashboardApi = (
    entriesRef: MutableRefObject<DiaryEntry[]>,
    mistakesRef: MutableRefObject<Mistake[]>
): TodayDashboardContextAPI => ({
    getData: async (date: string) => {
        if (IS_ELECTRON) return window.api.todayDashboard.getData(date)
        // Browser fallback: compute from local state
        const todayEntry = entriesRef.current.find(e => e.date === date)
        const dueCount = mistakesRef.current.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date)).length
        // Fallback mock metrics since SQL is not available in browser
        return {
            todayEntry: todayEntry ? {
                id: todayEntry.id,
                title: todayEntry.title,
                wordCount: todayEntry.word_count,
                mood: todayEntry.mood,
            } : null,
            pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
            commanderMetrics: {
                riskPoolCount: dueCount,
                lockedKnowledgeGrowth: 0,
                focusConversionRate: 0
            },
            streakDays: 0
        }
    }
})
