import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { PomodoroContextAPI } from '../../types/api'

export const createPomodoroApi = (): PomodoroContextAPI => ({
    getStats: async (date: string) => {
        if (IS_ELECTRON) return window.api.pomodoro.getStats(date)
        return []
    },
    getRange: async (start: string, end: string) => {
        if (IS_ELECTRON) return window.api.pomodoro.getRange(start, end)
        return []
    },
    addSession: async (session: any) => {
        if (IS_ELECTRON) return window.api.pomodoro.addSession(session)
        return true
    },
    getDailyTotal: async (date: string) => {
        if (IS_ELECTRON) return window.api.pomodoro.getDailyTotal(date)
        return 0
    }
})
