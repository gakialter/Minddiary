// Mock API for browser development (when Electron APIs are not available)
import type { ElectronAPI } from '../types/api'
import { logger } from './logger'
import { normalizeTag } from './tagStyle'

const mockEntries: Record<string, unknown> = {}

const noop = async (): Promise<Record<string, never>> => ({})
const noopArr = async (): Promise<never[]> => ([])

const mockApi: ElectronAPI = {
    window: {
        platform: navigator.userAgent.includes('Mac') ? 'darwin' : 'browser',
        titlebarMode: navigator.userAgent.includes('Mac') ? 'native' : 'custom',
        minimize: async () => {},
        maximize: async () => false,
        close: async () => {},
        isMaximized: async () => false,
        setFullScreen: async () => false,
        isFullScreen: async () => false,
        onFullScreenChange: () => () => {},
    },
    updater: {
        check: async () => ({ success: false, message: 'Mock environment' }),
        install: async () => {},
        getStatus: async () => ({ status: 'idle' } as any),
        onStatusChange: () => () => {},
    },
    entries: {
        create: async (entry) => ({ id: Date.now(), date: entry.date, title: entry.title || '', content: entry.content || '', mood: entry.mood || null, word_count: (entry.content || '').replace(/\s/g, '').length, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
        update: async (id, entry) => ({ id, date: entry.date || '', title: entry.title || '', content: entry.content || '', mood: entry.mood || null, word_count: (entry.content || '').replace(/\s/g, '').length, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
        delete: async () => {},
        getByDate: async (date) => (mockEntries[date] as ReturnType<ElectronAPI['entries']['getByDate']> extends Promise<infer T> ? T : never) || null,
        getById: async () => null,
        getAll: async () => [],
        search: async () => [],
        getDatesWithEntries: async () => [],
    },
    tags: {
        getAll: async () => [],
        create: async (tag) => normalizeTag({ id: Date.now(), ...tag }),
        update: async (id, tag) => normalizeTag({ id, ...tag }),
        delete: async () => {},
        setEntryTags: async () => {},
        getEntryTags: async () => [],
        getEntryTagsBatch: async () => ({}),
    },
    settings: {
        getAll: async () => ({ aiApiKeyMasked: null, aiApiKeyPresent: false }),
        updateGeneral: async () => ({ success: true }),
        updateAI: async () => ({ success: true }),
        updateBackup: async () => ({ success: true }),
        selectBackupFolder: async () => null,
    },
    attachments: {
        save: async () => ({ id: 0, entry_id: 0, filename: '', filepath: '', mimetype: '', created_at: '' }),
        getByEntry: async () => [],
        getByEntries: async () => ({}),
        delete: async () => {},
        getPath: async () => '',
    },
    subjects: {
        getAll: async () => [],
        create: async (s) => ({ id: Date.now(), name: s.name || '', color: s.color || '#0F766E', completed_chapters: 0 }),
        update: async (id, s) => ({ id, name: s.name || '', color: s.color || '#0F766E' }),
        delete: async () => {},
    },
    pomodoro: {
        addSession: async () => ({ id: Date.now() }),
        getStats: async () => [],
        getDailyTotal: async () => 0,
        getRange: async () => [],
    },
    mistakes: {
        getAll: async () => ({ data: [], total: 0, masteredTotal: 0 }),
        create: async () => ({ id: Math.floor(Math.random() * 1000) }),
        update: async () => {},
        delete: async () => {},
        toggleMastered: async () => ({ mastered: 1 }),
        review: async () => ({ success: true }),
        getDueCount: async () => 0,
        getRandomDue: async () => null,
    },
    ai: {
        chat: async () => ({ content: '请在 Electron 环境中使用 AI 功能' }),
        summarize: async () => ({ content: '请在 Electron 环境中使用 AI 功能' }),
    },
    notification: {
        show: async (title, body) => { logger.log(`[通知] ${title}: ${body}`) },
    },
    dashboard: {
        entryDatesRange: async () => [],
        streak: async () => 0,
    },
    todayDashboard: {
        getData: async () => ({
            todayEntry: null,
            pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
            commanderMetrics: {
                riskPoolCount: 0,
                lockedKnowledgeGrowth: 0,
                focusConversionRate: 0,
            },
            streakDays: 0,
        }),
    },
    export: {
        showSaveDialog: async () => null,
        writeFile: async () => {},
        toPDF: async () => {},
    },
    focusGuard: {
        getActiveApp: async () => null,
    },
    templates: {
        getAll: async () => [],
        create: async (t) => ({ id: Date.now(), name: t.name || '', content: t.content || '', is_default: 0, sort_order: 99, created_at: '', updated_at: '' }),
        update: async (_id, t) => ({ id: _id, name: t.name || '', content: t.content || '', is_default: 0, sort_order: 99, created_at: '', updated_at: '' }),
        delete: async () => ({ success: true }),
    },
}

// Install mock API if running outside Electron
if (!window.api) {
    logger.warn('[MindDiary] Electron API not available, using mock API for development')
    window.api = mockApi
}
