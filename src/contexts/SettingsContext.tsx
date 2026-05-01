import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react'
import { mockSettings, STORAGE_KEYS } from '../data/mockData'
import { IS_ELECTRON } from '../utils/apiAdapter'
import { logger } from '../utils/logger'
import type { AppSettings } from '../types'
import type { SettingsContextAPI, SanitizedSettings } from '../types/api'

interface SettingsContextValue {
    settingsData: AppSettings
    settingsReady: boolean
    theme: string
    isDarkMode: boolean
    changeTheme: (theme: string) => Promise<unknown>
    settings: SettingsContextAPI
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export const useSettings = (): SettingsContextValue => {
    const context = useContext(SettingsContext)
    if (!context) throw new Error('useSettings must be used within SettingsProvider')
    return context
}

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
    const [settings, setSettings] = useState<AppSettings>(mockSettings)
    const [settingsInitialized, setSettingsInitialized] = useState(false)

    // ─── System dark mode detection ───────────────────────────────────────────
    const [systemDark, setSystemDark] = useState(
        () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    )
    useEffect(() => {
        const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
        if (!mq) return
        const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
        mq.addEventListener('change', handler)
        return () => mq.removeEventListener('change', handler)
    }, [])

    // ─── Initialization ───────────────────────────────────────────────────────
    useEffect(() => {
        if (IS_ELECTRON) {
            window.api.settings.getAll()
                .then(s => { if (s && Object.keys(s).length) setSettings(s as unknown as AppSettings) })
                .catch(err => logger.error('[SettingsContext] Init failed:', err))
                .finally(() => setSettingsInitialized(true))
        } else {
            const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS)
            const val: AppSettings = raw ? JSON.parse(raw) : mockSettings
            setSettings(val)
            if (!raw) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(mockSettings))
            setSettingsInitialized(true)
        }
    }, [])

    // ─── Browser-only localStorage persistence ────────────────────────────────
    useEffect(() => {
        if (settingsInitialized && !IS_ELECTRON)
            localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings))
    }, [settings, settingsInitialized])

    // ─── Settings API ─────────────────────────────────────────────────────────
    const settingsAPI: SettingsContextAPI = {
        getAll: async () => {
            if (IS_ELECTRON) {
                const s = await window.api.settings.getAll()
                if (s) setSettings(s as unknown as AppSettings)
                return s
            }
            return { ...settings, aiApiKeyMasked: null, aiApiKeyPresent: false } as unknown as SanitizedSettings
        },
        updateGeneral: async (patch) => {
            if (IS_ELECTRON) {
                await window.api.settings.updateGeneral(patch)
            }
            setSettings(prev => ({ ...prev, ...patch }))
            return { success: true }
        },
        updateAI: async (patch) => {
            if (IS_ELECTRON) {
                await window.api.settings.updateAI(patch)
            }
            setSettings(prev => {
                const next = { ...prev }
                if (patch.aiEndpoint !== undefined) next.aiEndpoint = patch.aiEndpoint
                if (patch.aiModel !== undefined) next.aiModel = patch.aiModel
                if (patch.aiApiKey !== undefined) {
                    next.aiApiKeyPresent = true
                    next.aiApiKeyMasked = '********'
                }
                if (patch.clearAiApiKey) {
                    next.aiApiKeyPresent = false
                    next.aiApiKeyMasked = null
                }
                return next
            })
            return { success: true }
        },
        updateBackup: async (patch) => {
            if (IS_ELECTRON) {
                await window.api.settings.updateBackup(patch)
            }
            setSettings(prev => ({ ...prev, ...patch }))
            return { success: true }
        },
        selectBackupFolder: async () => {
            if (IS_ELECTRON) {
                return window.api.settings.selectBackupFolder()
            }
            return null
        },
    }

    // ─── Theme helpers ────────────────────────────────────────────────────────
    const currentTheme = settings?.theme === 'auto' ? 'system' : (settings?.theme || 'system')
    const isDarkMode = currentTheme === 'dark' || (currentTheme === 'system' && systemDark)
    const changeTheme = (newTheme: string) => settingsAPI.updateGeneral({ theme: newTheme })

    const value = useMemo((): SettingsContextValue => ({
        settingsData: settings,
        settingsReady: settingsInitialized,
        theme: currentTheme,
        isDarkMode,
        changeTheme,
        settings: {
            getAll: settingsAPI.getAll,
            updateGeneral: settingsAPI.updateGeneral,
            updateAI: settingsAPI.updateAI,
            updateBackup: settingsAPI.updateBackup,
            selectBackupFolder: settingsAPI.selectBackupFolder,
        },
    }), [settings, settingsInitialized, currentTheme, isDarkMode, changeTheme])

    return (
        <SettingsContext.Provider value={value}>
            {children}
        </SettingsContext.Provider>
    )
}
