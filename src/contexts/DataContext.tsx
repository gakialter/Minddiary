import { createContext, useContext, useState, useMemo, useCallback, useRef, type MutableRefObject, type ReactNode } from 'react'
import { mockEntries, mockTags, mockMistakes, mockSubjects, STORAGE_KEYS } from '../data/mockData'
import { IS_ELECTRON } from '../utils/apiAdapter'
import type { DiaryEntry, Tag, Mistake, Subject, StudyTask, PomodoroSession, EntryFilters, MistakeFilters, DateMood, DiaryTemplate } from '../types'
import type {
    EntriesContextAPI, TagsContextAPI, MistakesContextAPI,
    SubjectsContextAPI, PomodoroContextAPI, TasksContextAPI, DashboardContextAPI,
    TodayDashboardContextAPI,
    ExportContextAPI, NotificationContextAPI, AIContextAPI, AttachmentsContextAPI,
    TemplatesContextAPI,
} from '../types/api'

import { createEntriesApi } from './api/entriesApi'
import { createTagsApi } from './api/tagsApi'
import { createMistakesApi } from './api/mistakesApi'
import { createSubjectsApi } from './api/subjectsApi'
import { createPomodoroApi } from './api/pomodoroApi'
import { createTasksApi } from './api/tasksApi'
import { createDashboardApi } from './api/dashboardApi'
import { createTodayDashboardApi } from './api/todayDashboardApi'
import { createExportApi } from './api/exportApi'
import { createNotificationApi } from './api/notificationApi'
import { createAiApi } from './api/aiApi'
import { createAttachmentsApi } from './api/attachmentsApi'
import { createTemplatesApi } from './api/templatesApi'

interface DataContextValue {
    dataReady: boolean
    initErrors: string[]
    dataRefreshVersion: number
    requestDataRefresh: () => void
    entries: EntriesContextAPI
    tags: TagsContextAPI
    mistakes: MistakesContextAPI
    subjects: SubjectsContextAPI
    pomodoro: PomodoroContextAPI
    tasks: TasksContextAPI
    dashboard: DashboardContextAPI
    todayDashboard: TodayDashboardContextAPI
    exportUtil: ExportContextAPI
    notification: NotificationContextAPI
    ai: AIContextAPI
    attachments: AttachmentsContextAPI
    templates: TemplatesContextAPI
}

const DataContext = createContext<DataContextValue | null>(null)

export const useData = (): DataContextValue => {
    const context = useContext(DataContext)
    if (!context) throw new Error('useData must be used within DataProvider')
    return context
}

export const DataProvider = ({ children }: { children: ReactNode }) => {
    const entriesRef = useRef<DiaryEntry[]>([])
    const tagsRef = useRef<Tag[]>([])
    const mistakesRef = useRef<Mistake[]>([])
    const subjectsRef = useRef<Subject[]>([])
    const tasksRef = useRef<StudyTask[]>([])
    const pomodoroSessionsRef = useRef<PomodoroSession[]>([])
    const [dataRefreshVersion, setDataRefreshVersion] = useState(0)
    const requestDataRefresh = useCallback(() => {
        setDataRefreshVersion(version => version + 1)
    }, [])

    // ─── Initialization ───────────────────────────────────────────────────────
    const [initState] = useState(() => {
        const initErrors: string[] = []
        if (IS_ELECTRON) {
            // Fast boot in Electron mode. Data is fetched directly via IPC on demand.
            return { initialized: true, initErrors }
        }

        const load = <T,>(key: string, fallback: T[], ref: MutableRefObject<T[]>) => {
            const raw = localStorage.getItem(key)
            if (!raw) {
                ref.current = fallback
                localStorage.setItem(key, JSON.stringify(fallback))
                return
            }

            try {
                const parsed = JSON.parse(raw)
                if (!Array.isArray(parsed)) {
                    throw new Error('expected array')
                }
                ref.current = parsed as T[]
            } catch {
                initErrors.push(`Invalid localStorage data for ${key}; using fallback data.`)
                ref.current = fallback
                localStorage.setItem(key, JSON.stringify(fallback))
            }
        }
        load(STORAGE_KEYS.ENTRIES, mockEntries, entriesRef)
        load(STORAGE_KEYS.TAGS, mockTags, tagsRef)
        load(STORAGE_KEYS.MISTAKES, mockMistakes, mistakesRef)
        load(STORAGE_KEYS.SUBJECTS, mockSubjects, subjectsRef)
        load(STORAGE_KEYS.TASKS, [], tasksRef)
        load(STORAGE_KEYS.POMODORO_SESSIONS, [], pomodoroSessionsRef)
        return { initialized: true, initErrors }
    })
    const { initialized, initErrors } = initState

    const saveToLocal = useCallback(<T,>(key: string, data: T) => {
        if (!IS_ELECTRON) localStorage.setItem(key, JSON.stringify(data))
    }, [])

    const apis = useMemo(() => ({
        entries: createEntriesApi(entriesRef, saveToLocal),
        tags: createTagsApi(tagsRef, entriesRef, saveToLocal),
        mistakes: createMistakesApi(mistakesRef, subjectsRef, saveToLocal),
        subjects: createSubjectsApi(subjectsRef, saveToLocal),
        pomodoro: createPomodoroApi(subjectsRef, tasksRef, pomodoroSessionsRef, saveToLocal),
        tasks: createTasksApi(tasksRef, saveToLocal, pomodoroSessionsRef),
        dashboard: createDashboardApi(),
        todayDashboard: createTodayDashboardApi(entriesRef, mistakesRef, tasksRef, pomodoroSessionsRef),
        exportUtil: createExportApi(),
        notification: createNotificationApi(),
        ai: createAiApi(),
        attachments: createAttachmentsApi(),
        templates: createTemplatesApi(),
    }), [saveToLocal])

    const value = useMemo((): DataContextValue => ({
        dataReady: initialized,
        initErrors,
        dataRefreshVersion,
        requestDataRefresh,
        ...apis
    }), [initialized, initErrors, dataRefreshVersion, requestDataRefresh, apis])

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    )
}
