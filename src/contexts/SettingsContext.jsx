import { createContext, useContext, useState, useEffect } from 'react'
import { mockSettings, STORAGE_KEYS } from '../data/mockData'
import { IS_ELECTRON } from '../utils/apiAdapter'

const SettingsContext = createContext()

export const useSettings = () => {
    const context = useContext(SettingsContext)
    if (!context) throw new Error('useSettings must be used within SettingsProvider')
    return context
}

export const SettingsProvider = ({ children }) => {
    const [settings, setSettings] = useState(mockSettings)
    const [settingsInitialized, setSettingsInitialized] = useState(false)

    // ─── System dark mode detection ───────────────────────────────────────────
    const [systemDark, setSystemDark] = useState(
        () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    )
    useEffect(() => {
        const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
        if (!mq) return
        const handler = (e) => setSystemDark(e.matches)
        mq.addEventListener('change', handler)
        return () => mq.removeEventListener('change', handler)
    }, [])

    // ─── Initialization ───────────────────────────────────────────────────────
    useEffect(() => {
        if (IS_ELECTRON) {
            window.api.settings.getAll()
                .then(s => { if (s && Object.keys(s).length) setSettings(s) })
                .catch(err => console.error('[SettingsContext] Init failed:', err))
                .finally(() => setSettingsInitialized(true))
        } else {
            const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS)
            const val = raw ? JSON.parse(raw) : mockSettings
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
    const settingsAPI = {
        getAll: async () => {
            if (IS_ELECTRON) {
                const s = await window.api.settings.getAll()
                if (s) setSettings(s)
                return s
            }
            return settings
        },
        update: async (key, value) => {
            if (IS_ELECTRON) {
                await window.api.settings.set(key, String(value))
                setSettings(prev => ({ ...prev, [key]: value }))
                return true
            }
            setSettings(prev => ({ ...prev, [key]: value }))
            return { ...settings, [key]: value }
        },
    }

    // ─── Theme helpers ────────────────────────────────────────────────────────
    const currentTheme = settings?.theme === 'auto' ? 'system' : (settings?.theme || 'system')
    const isDarkMode = currentTheme === 'dark' || (currentTheme === 'system' && systemDark)
    const changeTheme = (newTheme) => settingsAPI.update('theme', newTheme)

    const value = {
        settingsData: settings,
        settingsReady: settingsInitialized,
        theme: currentTheme,
        isDarkMode,
        changeTheme,
        settings: {
            getAll: settingsAPI.getAll,
            update: settingsAPI.update,
        },
    }

    return (
        <SettingsContext.Provider value={value}>
            {children}
        </SettingsContext.Provider>
    )
}
