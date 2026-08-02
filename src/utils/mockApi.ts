// Mock API for browser development (when Electron APIs are not available)
import type { ElectronAPI } from '../types/api'
import { logger } from './logger'
import { calculateWordCount } from './helpers'
import { normalizeTag } from './tagStyle'
import { getLocalDateKey } from './dateKey'
import { assertTaskCreationDateIsCurrent } from './dateBoundTaskGuard'

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
        install: async () => ({ success: false, message: 'Mock environment' }),
        getStatus: async () => ({ status: 'idle' } as any),
        onStatusChange: () => () => {},
    },
    entries: {
        create: async (entry) => ({ id: Date.now(), date: entry.date, title: entry.title || '', content: entry.content || '', mood: entry.mood || null, word_count: calculateWordCount(entry.content), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
        update: async (id, entry) => ({ id, date: entry.date || '', title: entry.title || '', content: entry.content || '', mood: entry.mood || null, word_count: entry.content !== undefined ? calculateWordCount(entry.content) : 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
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
        selectBackupFile: async () => null,
        restoreBackupFromZip: async () => ({
            success: false,
            message: 'Automatic ZIP restore is only supported in the desktop app.',
        }),
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
    subjectChapters: {
        getBySubject: async () => [],
        create: async (chapter) => ({
            id: Date.now(),
            subject_id: chapter.subject_id,
            title: chapter.title,
            notes: chapter.notes || '',
            completed: !!chapter.completed,
            sort_order: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }),
        bulkCreate: async () => [],
        convertFromSummary: async () => [],
        patch: async (id, patch) => ({
            id,
            subject_id: 1,
            title: patch.title || '',
            notes: patch.notes || '',
            completed: !!patch.completed,
            sort_order: 0,
            created_at: '',
            updated_at: new Date().toISOString(),
        }),
        toggleCompleted: async (id, completed) => ({
            id,
            subject_id: 1,
            title: '',
            notes: '',
            completed: completed ?? true,
            sort_order: 0,
            created_at: '',
            updated_at: new Date().toISOString(),
        }),
        reorder: async () => [],
        delete: async () => ({ success: true }),
        clearDetailedChapters: async (subjectId) => ({
            id: subjectId,
            name: '',
            color: '#0F766E',
            total_chapters: 0,
            completed_chapters: 0,
        }),
    },
    pomodoro: {
        addSession: async () => ({ id: Date.now() }),
        getStats: async () => [],
        getStatsRange: async () => [],
        getDailyTotal: async () => 0,
        getRange: async () => [],
    },
    tasks: {
        getByDate: async () => [],
        find: async () => [],
        create: async (task) => {
            const now = new Date().toISOString()
            return {
                id: Date.now(),
                title: task.title,
                description: task.description || '',
                type: task.type || 'custom',
                subject_id: task.subject_id ?? null,
                related_mistake_id: task.related_mistake_id ?? null,
                related_entry_id: task.related_entry_id ?? null,
                related_chapter_id: task.related_chapter_id ?? null,
                planned_date: task.planned_date,
                estimate_minutes: task.estimate_minutes || 25,
                status: task.status || 'todo',
                source: task.source || 'manual',
                created_at: now,
                updated_at: now,
            }
        },
        createForCurrentDate: async (task, expectedCurrentDate) => {
            assertTaskCreationDateIsCurrent(expectedCurrentDate, getLocalDateKey())
            const createdTask = await mockApi.tasks.create(task)
            assertTaskCreationDateIsCurrent(expectedCurrentDate, getLocalDateKey())
            return createdTask
        },
        createIdempotentAIStudyTaskForCurrentDate: async request => ({
            ok: false,
            operationId: request.operationId,
            code: 'INVALID_REQUEST',
            message: 'AI 学习任务的幂等创建仅支持 MindDiary 桌面版',
        }),
        update: async (id, patch) => ({
            id,
            title: patch.title || '',
            description: patch.description || '',
            type: patch.type || 'custom',
            subject_id: patch.subject_id ?? null,
            related_mistake_id: patch.related_mistake_id ?? null,
            related_entry_id: patch.related_entry_id ?? null,
            related_chapter_id: patch.related_chapter_id ?? null,
            planned_date: patch.planned_date || '',
            estimate_minutes: patch.estimate_minutes || 25,
            status: patch.status || 'todo',
            source: patch.source || 'manual',
            created_at: '',
            updated_at: new Date().toISOString(),
        }),
        delete: async () => true,
        complete: async (id) => ({
            id,
            title: '',
            description: '',
            type: 'custom',
            subject_id: null,
            related_mistake_id: null,
            related_entry_id: null,
            related_chapter_id: null,
            planned_date: '',
            estimate_minutes: 25,
            status: 'done',
            source: 'manual',
            created_at: '',
            updated_at: new Date().toISOString(),
        }),
        skip: async (id) => ({
            id,
            title: '',
            description: '',
            type: 'custom',
            subject_id: null,
            related_mistake_id: null,
            related_entry_id: null,
            related_chapter_id: null,
            planned_date: '',
            estimate_minutes: 25,
            status: 'skipped',
            source: 'manual',
            created_at: '',
            updated_at: new Date().toISOString(),
        }),
        startFocus: async (id, date) => ({
            id,
            title: '',
            description: '',
            type: 'custom',
            subject_id: null,
            related_mistake_id: null,
            related_entry_id: null,
            related_chapter_id: null,
            planned_date: date,
            estimate_minutes: 25,
            status: 'doing',
            source: 'manual',
            created_at: '',
            updated_at: new Date().toISOString(),
        }),
    },
    mistakes: {
        getAll: async () => ({ data: [], total: 0, masteredTotal: 0 }),
        create: async () => ({ id: Math.floor(Math.random() * 1000) }),
        createBatch: async mistakes => ({ ids: mistakes.map((_, index) => index + 1) }),
        update: async () => {},
        delete: async () => {},
        toggleMastered: async () => ({ mastered: 1 }),
        review: async (id, data) => ({
            success: true,
            mistake: {
                id,
                subject_id: null,
                question: '',
                answer: '',
                notes: '',
                mastered: false,
                ease_factor: data.ease_factor,
                review_interval: data.review_interval,
                next_review_date: data.next_review_date,
                review_count: data.review_count,
                image_path: null,
                answer_image_path: null,
                created_at: '',
                updated_at: new Date().toISOString(),
            },
        }),
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
            taskFocusToday: {
                effectiveTaskCount: 0,
                completedTaskCount: 0,
                completionRate: 0,
                focusedTaskCount: 0,
                focusCoverageRate: 0,
                focusedMinutes: 0,
                skippedTaskCount: 0,
                openWithoutFocusCount: 0,
                focusedOpenTaskCount: 0,
                unclosedTaskTitles: [],
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
