/**
 * DiaryContext.jsx — Backward-compatible aggregation layer.
 *
 * Settings and data concerns have been split into SettingsContext and DataContext
 * respectively.  This file combines them into a single `useDiary()` hook so that
 * existing consumer components need ZERO import changes.
 */
import { createContext, useContext } from 'react'
import { SettingsProvider, useSettings } from './SettingsContext'
import { DataProvider, useData } from './DataContext'

const DiaryContext = createContext()

export const useDiary = () => {
    const context = useContext(DiaryContext)
    if (!context) throw new Error('useDiary must be used within DiaryProvider')
    return context
}

/**
 * Inner bridge — merges useSettings() + useData() into a single value object
 * that is identical in shape to the original DiaryContext.
 */
function DiaryBridge({ children }) {
    const settingsCtx = useSettings()
    const dataCtx = useData()

    const value = {
        // Ready when BOTH sub-contexts are ready
        isReady: settingsCtx.settingsReady && dataCtx.dataReady,
        initErrors: dataCtx.initErrors,

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
        exportUtil: dataCtx.exportUtil,
        notification: dataCtx.notification,
        ai: dataCtx.ai,
        attachments: dataCtx.attachments,
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
export const DiaryProvider = ({ children }) => (
    <SettingsProvider>
        <DataProvider>
            <DiaryBridge>
                {children}
            </DiaryBridge>
        </DataProvider>
    </SettingsProvider>
)
