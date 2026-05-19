/**
 * DiaryContext.tsx — Backward-compatible aggregation layer.
 *
 * Settings and data concerns have been split into SettingsContext and DataContext
 * respectively.  This file combines them into a single `useDiary()` hook so that
 * existing consumer components need ZERO import changes.
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { DiaryContextValue } from '../types/api'
import { SettingsProvider, useSettings } from './SettingsContext'
import { DataProvider, useData } from './DataContext'

const DiaryContext = createContext<DiaryContextValue | null>(null)

export const useDiary = (): DiaryContextValue => {
    const context = useContext(DiaryContext)
    if (!context) throw new Error('useDiary must be used within DiaryProvider')
    return context
}

/**
 * Inner bridge — merges useSettings() + useData() into a single value object
 * that is identical in shape to the original DiaryContext.
 */
function DiaryBridge({ children }: { children: ReactNode }) {
    const settingsCtx = useSettings()
    const dataCtx = useData()

    const value: DiaryContextValue = {
        // Ready when BOTH sub-contexts are ready
        isReady: settingsCtx.settingsReady && dataCtx.dataReady,
        initErrors: dataCtx.initErrors,
        dataRefreshVersion: dataCtx.dataRefreshVersion,
        requestDataRefresh: dataCtx.requestDataRefresh,

        // Settings surface
        settingsData: settingsCtx.settingsData,
        theme: settingsCtx.theme,
        isDarkMode: settingsCtx.isDarkMode,
        changeTheme: settingsCtx.changeTheme,
        settings: settingsCtx.settings,

        // Data surface
        entries: dataCtx.entries,
        tags: dataCtx.tags,
        mistakes: dataCtx.mistakes,
        subjects: dataCtx.subjects,
        pomodoro: dataCtx.pomodoro,
        dashboard: dataCtx.dashboard,
        todayDashboard: dataCtx.todayDashboard,
        exportUtil: dataCtx.exportUtil,
        notification: dataCtx.notification,
        ai: dataCtx.ai,
        attachments: dataCtx.attachments,
        templates: dataCtx.templates,
    }

    return (
        <DiaryContext.Provider value={value}>
            {children}
        </DiaryContext.Provider>
    )
}

/**
 * DiaryProvider — drop-in replacement with identical API.
 * Internally wraps SettingsProvider → DataProvider → DiaryBridge.
 */
export const DiaryProvider = ({ children }: { children: ReactNode }) => (
    <SettingsProvider>
        <DataProvider>
            <DiaryBridge>
                {children}
            </DiaryBridge>
        </DataProvider>
    </SettingsProvider>
)
