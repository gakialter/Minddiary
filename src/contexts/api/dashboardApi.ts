import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { DashboardContextAPI } from '../../types/api'

export const createDashboardApi = (): DashboardContextAPI => ({
    streak: async () => {
        if (IS_ELECTRON) return window.api.dashboard.streak()
        return 0
    },
    entryDatesRange: async (start: string, end: string) => {
        if (IS_ELECTRON) return window.api.dashboard.entryDatesRange(start, end)
        return []
    }
})
