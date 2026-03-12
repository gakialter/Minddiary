// Mock API for browser development (when Electron APIs are not available)
const mockEntries = {}

const noop = async () => ({})
const noopArr = async () => ([])

const mockApi = {
    window: {
        minimize: noop,
        maximize: async () => false,
        close: noop,
        isMaximized: async () => false,
    },
    entries: {
        create: async (entry) => ({ id: Date.now(), ...entry, word_count: (entry.content || '').replace(/\s/g, '').length }),
        update: async (id, entry) => ({ id, ...entry, word_count: (entry.content || '').replace(/\s/g, '').length }),
        delete: noop,
        getByDate: async (date) => mockEntries[date] || null,
        getById: async (id) => null,
        getAll: noopArr,
        search: noopArr,
        getDatesWithEntries: noopArr,
    },
    tags: {
        getAll: noopArr,
        create: async (tag) => ({ id: Date.now(), ...tag }),
        update: noop,
        delete: noop,
        setEntryTags: noop,
        getEntryTags: noopArr,
    },
    settings: {
        get: async () => null,
        set: noop,
        getAll: async () => ({}),
    },
    attachments: {
        save: noop,
        getByEntry: noopArr,
        delete: noop,
        getPath: async () => '',
    },
    subjects: {
        getAll: noopArr,
        create: async (s) => ({ id: Date.now(), ...s, completed_chapters: 0 }),
        update: noop,
        delete: noop,
    },
    pomodoro: {
        addSession: noop,
        getStats: noopArr,
        getDailyTotal: async () => 0,
        getRange: noopArr,
    },
    mistakes: {
        getAll: noopArr,
        create: async () => ({ id: Date.now() }),
        update: noop,
        delete: noop,
        toggleMastered: async () => ({ mastered: 1 }),
    },
    ai: {
        chat: async () => ({ content: '请在 Electron 环境中使用 AI 功能' }),
        summarize: async () => ({ content: '请在 Electron 环境中使用 AI 功能' }),
    },
    notification: {
        show: async (title, body) => { console.log(`[通知] ${title}: ${body}`) },
    },
    dashboard: {
        entryDatesRange: noopArr,
        streak: async () => 0,
    },
    export: {
        showSaveDialog: async () => null,
        writeFile: noop,
        toPDF: noop,
    },
}

// Install mock API if running outside Electron
if (!window.api) {
    console.warn('[MindDiary] Electron API not available, using mock API for development')
    window.api = mockApi
}
