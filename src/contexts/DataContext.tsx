import { createContext, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { mockEntries, mockTags, mockMistakes, mockSubjects, STORAGE_KEYS } from '../data/mockData'
import { IS_ELECTRON } from '../utils/apiAdapter'
import type { DiaryEntry, Tag, Mistake, Subject, EntryFilters, MistakeFilters, DateMood, DiaryTemplate } from '../types'
import type {
    EntriesContextAPI, TagsContextAPI, MistakesContextAPI,
    SubjectsContextAPI, PomodoroContextAPI, DashboardContextAPI,
    TodayDashboardContextAPI,
    ExportContextAPI, NotificationContextAPI, AIContextAPI, AttachmentsContextAPI,
    TemplatesContextAPI,
} from '../types/api'

interface DataContextValue {
    dataReady: boolean
    initErrors: string[]
    entries: EntriesContextAPI
    tags: TagsContextAPI
    mistakes: MistakesContextAPI
    subjects: SubjectsContextAPI
    pomodoro: PomodoroContextAPI
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
    const [initialized, setInitialized] = useState(false)
    const [initErrors, setInitErrors] = useState<string[]>([])

    const saveToLocal = (key: string, data: any) => {
        if (!IS_ELECTRON) localStorage.setItem(key, JSON.stringify(data))
    }

    // ─── Initialization ───────────────────────────────────────────────────────
    useEffect(() => {
        if (IS_ELECTRON) {
            // Fast boot in Electron mode. Data is fetched directly via IPC on demand.
            setInitialized(true)
        } else {
            const load = <T,>(key: string, fallback: T[], ref: React.MutableRefObject<T[]>) => {
                const raw = localStorage.getItem(key)
                const val: T[] = raw ? JSON.parse(raw) : fallback
                ref.current = val
                if (!raw) saveToLocal(key, fallback)
            }
            load(STORAGE_KEYS.ENTRIES, mockEntries, entriesRef)
            load(STORAGE_KEYS.TAGS, mockTags, tagsRef)
            load(STORAGE_KEYS.MISTAKES, mockMistakes, mistakesRef)
            load(STORAGE_KEYS.SUBJECTS, mockSubjects, subjectsRef)
            setInitialized(true)
        }
    }, [])

    // ─── Entries API ──────────────────────────────────────────────────────────
    const entriesAPI: EntriesContextAPI = {
        getAll: async (filters: EntryFilters = {}) => {
            if (IS_ELECTRON) return window.api.entries.getAll(filters)
            let result = [...entriesRef.current]
            if (filters.mood) result = result.filter(e => e.mood === filters.mood)
            if (filters.tagId) result = result.filter(e => e.tags && e.tags.includes(Number(filters.tagId)))
            if (filters.startDate) result = result.filter(e => e.date >= filters.startDate!)
            if (filters.endDate) result = result.filter(e => e.date <= filters.endDate!)
            if (filters.limit) result = result.slice(0, filters.limit)
            return result.sort((a, b) => b.date.localeCompare(a.date))
        },
        getByDate: async (date: string) => {
            if (IS_ELECTRON) return window.api.entries.getByDate(date)
            return entriesRef.current.find(e => e.date === date) || null
        },
        getById: async (id: number) => {
            if (IS_ELECTRON) return window.api.entries.getById(id)
            return entriesRef.current.find(e => e.id === id) || null
        },
        getDatesWithEntries: async (yearMonth: string) => {
            if (IS_ELECTRON) return window.api.entries.getDatesWithEntries(yearMonth)
            return entriesRef.current
                .filter(e => e.date.startsWith(yearMonth))
                .map(e => ({ date: e.date, mood: e.mood }))
        },
        search: async (query: string) => {
            if (IS_ELECTRON) return window.api.entries.search(query)
            const lowerQuery = query.toLowerCase()
            return entriesRef.current
                .filter(e => e.title?.toLowerCase().includes(lowerQuery) || e.content?.toLowerCase().includes(lowerQuery))
                .map(e => ({ ...e, content_snippet: e.content?.substring(0, 200) }))
                .sort((a, b) => b.date.localeCompare(a.date))
        },
        create: async (data) => {
            if (IS_ELECTRON) return window.api.entries.create(data)
            
            const newEntry: DiaryEntry = {
                ...data,
                id: Math.max(0, ...entriesRef.current.map(e => e.id)) + 1,
                word_count: data.content ? data.content.length : 0,
                images: data.images || [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }
            entriesRef.current = [...entriesRef.current, newEntry]
            saveToLocal(STORAGE_KEYS.ENTRIES, entriesRef.current)
            return newEntry
        },
        update: async (id: number, data) => {
            if (IS_ELECTRON) return window.api.entries.update(id, data)
            
            const updatedEntry: DiaryEntry = {
                ...(entriesRef.current.find(e => e.id === id)!),
                ...data,
                id,
                word_count: data.content ? data.content.length : 0,
                updated_at: new Date().toISOString(),
            }
            entriesRef.current = entriesRef.current.map(e => e.id === id ? updatedEntry : e)
            saveToLocal(STORAGE_KEYS.ENTRIES, entriesRef.current)
            return updatedEntry
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) {
                await window.api.entries.delete(id)
                return true
            }
            entriesRef.current = entriesRef.current.filter(e => e.id !== id)
            saveToLocal(STORAGE_KEYS.ENTRIES, entriesRef.current)
            return true
        },
    }

    // ─── Tags API ─────────────────────────────────────────────────────────────
    const tagsAPI: TagsContextAPI = {
        getAll: async () => {
            if (IS_ELECTRON) return window.api.tags.getAll()
            return tagsRef.current.sort((a, b) => a.name.localeCompare(b.name))
        },
        create: async (data) => {
            if (IS_ELECTRON) return window.api.tags.create(data)
            
            const newTag: Tag = { name: data.name || '', color: data.color || '#0F766E', id: Math.max(0, ...tagsRef.current.map(t => t.id)) + 1 }
            tagsRef.current = [...tagsRef.current, newTag]
            saveToLocal(STORAGE_KEYS.TAGS, tagsRef.current)
            return newTag
        },
        update: async (id: number, data) => {
            if (IS_ELECTRON) {
                await window.api.tags.update(id, data)
                return data
            }
            tagsRef.current = tagsRef.current.map(t => t.id === id ? { ...t, ...data } : t)
            saveToLocal(STORAGE_KEYS.TAGS, tagsRef.current)
            return data
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) {
                await window.api.tags.delete(id)
                return true
            }
            tagsRef.current = tagsRef.current.filter(t => t.id !== id)
            saveToLocal(STORAGE_KEYS.TAGS, tagsRef.current)
            entriesRef.current = entriesRef.current.map(e => ({ ...e, tags: e.tags ? e.tags.filter(tid => tid !== id) : [] }))
            saveToLocal(STORAGE_KEYS.ENTRIES, entriesRef.current)
            return true
        },
    }

    // ─── Mistakes API ─────────────────────────────────────────────────────────
    const mistakesAPI: MistakesContextAPI = {
        getAll: async (filters: MistakeFilters = {}) => {
            if (IS_ELECTRON) return window.api.mistakes.getAll(filters)
            let result = mistakesRef.current.map(m => {
                const subject = subjectsRef.current.find(s => s.id === m.subject_id)
                return { ...m, subject_name: subject?.name, subject_color: subject?.color }
            })
            if (filters.subject_id) result = result.filter(m => m.subject_id === filters.subject_id)
            if (filters.mastered !== undefined) result = result.filter(m => m.mastered === filters.mastered)
            if (filters.search) {
                const query = filters.search.toLowerCase()
                result = result.filter(m =>
                    m.question?.toLowerCase().includes(query) ||
                    m.answer?.toLowerCase().includes(query) ||
                    m.notes?.toLowerCase().includes(query)
                )
            }
            
            const total = result.length;
            const masteredTotal = result.filter(m => m.mastered).length;
            result = result.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            
            if (filters.limit) {
                const offset = filters.offset || 0;
                result = result.slice(offset, offset + filters.limit);
            }
            return { data: result, total, masteredTotal };
        },
        create: async (data) => {
            if (IS_ELECTRON) {
                const { id } = await window.api.mistakes.create(data)
                return { ...data, id, mastered: false } as Mistake
            }
            
            const newMistake: Mistake = {
                question: '', answer: '', notes: '', subject_id: null,
                ease_factor: 2.5, review_interval: 1, next_review_date: null, review_count: 0,
                ...data,
                id: Math.max(0, ...mistakesRef.current.map(m => m.id)) + 1,
                mastered: false,
                created_at: new Date().toISOString(),
            }
            mistakesRef.current = [...mistakesRef.current, newMistake]
            saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
            return newMistake
        },
        update: async (id: number, data) => {
            if (IS_ELECTRON) {
                await window.api.mistakes.update(id, data)
                return data
            }
            mistakesRef.current = mistakesRef.current.map(m => m.id === id ? { ...m, ...data } : m)
            saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
            return data
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) {
                await window.api.mistakes.delete(id)
                return true
            }
            mistakesRef.current = mistakesRef.current.filter(m => m.id !== id)
            saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
            return true
        },
        toggleMastered: async (id: number) => {
            if (IS_ELECTRON) {
                const res = await window.api.mistakes.toggleMastered(id);
                return { mastered: !!res.mastered };
            }
            
            mistakesRef.current = mistakesRef.current.map(m => m.id === id ? { ...m, mastered: !m.mastered } : m)
            saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
            return { mastered: true }
        },
        review: async (id: number, data) => {
            if (IS_ELECTRON) {
                await window.api.mistakes.review(id, data);
                return { success: true };
            }
            mistakesRef.current = mistakesRef.current.map(m => m.id === id ? { ...m, ...data } : m);
            saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
            return { success: true };
        },
        getDueCount: async (date: string) => {
            if (IS_ELECTRON) return window.api.mistakes.getDueCount(date);
            return mistakesRef.current.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date)).length;
        },
        getRandomDue: async (date: string, subjectId?: number) => {
            if (IS_ELECTRON) return window.api.mistakes.getRandomDue(date, subjectId);
            let due = mistakesRef.current.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date));
            if (subjectId) due = due.filter(m => m.subject_id === subjectId);
            if (due.length === 0) return null;
            return due[Math.floor(Math.random() * due.length)] || null;
        },
        saveImage: async (data) => {
            if (IS_ELECTRON && window.api.mistakes.saveImage) {
                return window.api.mistakes.saveImage(data);
            }
            return '';
        },
        getImagePath: async (filename) => {
            if (IS_ELECTRON && window.api.mistakes.getImagePath) {
                return window.api.mistakes.getImagePath(filename);
            }
            return filename;
        }
    }

    // ─── Subjects API ─────────────────────────────────────────────────────────
    const subjectsAPI: SubjectsContextAPI = {
        getAll: async () => {
            if (IS_ELECTRON) return window.api.subjects.getAll()
            return subjectsRef.current.sort((a, b) => (a.order || 0) - (b.order || 0))
        },
        create: async (data) => {
            if (IS_ELECTRON) return window.api.subjects.create(data)
            
            const newSubject: Subject = {
                name: '', color: '#0F766E',
                ...data,
                id: Math.max(0, ...subjectsRef.current.map(s => s.id)) + 1,
                order: subjectsRef.current.length + 1,
            }
            subjectsRef.current = [...subjectsRef.current, newSubject]
            saveToLocal(STORAGE_KEYS.SUBJECTS, subjectsRef.current)
            return newSubject
        },
        update: async (id: number, data) => {
            if (IS_ELECTRON) {
                await window.api.subjects.update(id, data)
                return data
            }
            subjectsRef.current = subjectsRef.current.map(s => s.id === id ? { ...s, ...data } : s)
            saveToLocal(STORAGE_KEYS.SUBJECTS, subjectsRef.current)
            return data
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) {
                await window.api.subjects.delete(id)
                return true
            }
            subjectsRef.current = subjectsRef.current.filter(s => s.id !== id)
            saveToLocal(STORAGE_KEYS.SUBJECTS, subjectsRef.current)
            return true
        },
    }

    // ─── Pomodoro API ─────────────────────────────────────────────────────────
    const pomodoroAPI: PomodoroContextAPI = {
        getStats: async (date: string) => {
            if (IS_ELECTRON) return window.api.pomodoro.getStats(date)
            return []
        },
        getRange: async (start: string, end: string) => {
            if (IS_ELECTRON) return window.api.pomodoro.getRange(start, end)
            return []
        },
        addSession: async (session) => {
            if (IS_ELECTRON) return window.api.pomodoro.addSession(session)
            return true
        },
        getDailyTotal: async (date: string) => {
            if (IS_ELECTRON) return window.api.pomodoro.getDailyTotal(date)
            return 0
        }
    }

    // ─── Dashboard API ────────────────────────────────────────────────────────
    const dashboardAPI: DashboardContextAPI = {
        streak: async () => {
            if (IS_ELECTRON) return window.api.dashboard.streak()
            return 0
        },
        entryDatesRange: async (start: string, end: string) => {
            if (IS_ELECTRON) return window.api.dashboard.entryDatesRange(start, end)
            return []
        }
    }

    // ─── Today Dashboard API ──────────────────────────────────────────────────
    const todayDashboardAPI: TodayDashboardContextAPI = {
        getData: async (date: string) => {
            if (IS_ELECTRON) return window.api.todayDashboard.getData(date)
            // Browser fallback: compute from local state
            const todayEntry = entriesRef.current.find(e => e.date === date)
            const dueCount = mistakesRef.current.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date)).length
            // Fallback mock metrics since SQL is not available in browser
            return {
                todayEntry: todayEntry ? {
                    id: todayEntry.id,
                    title: todayEntry.title,
                    wordCount: todayEntry.word_count,
                    mood: todayEntry.mood,
                } : null,
                pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
                commanderMetrics: {
                    riskPoolCount: dueCount,
                    lockedKnowledgeGrowth: 0,
                    focusConversionRate: 0
                },
                streakDays: 0
            }
        }
    }

    // ─── Export API ───────────────────────────────────────────────────────────
    const exportAPI: ExportContextAPI = {
        showSaveDialog: async (options) => {
            if (IS_ELECTRON) return window.api.export.showSaveDialog(options)
            return (options as Record<string, string>).defaultPath || 'minddiary_export.txt'
        },
        writeFile: async (path: string, content: string) => {
            if (IS_ELECTRON) return window.api.export.writeFile(path, content)
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = path
            a.click()
            URL.revokeObjectURL(url)
            return true
        },
        toPDF: async (html: string, path: string) => {
            if (IS_ELECTRON) return window.api.export.toPDF(html, path)
            window.print()
            return true
        }
    }

    // ─── Notification API ─────────────────────────────────────────────────────
    const notificationAPI: NotificationContextAPI = {
        show: async (title: string, body: string) => {
            if (IS_ELECTRON) return window.api.notification.show(title, body)
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(title, { body, icon: '/favicon.ico' })
            }
        }
    }

    // ─── AI API ───────────────────────────────────────────────────────────────
    const aiAPI: AIContextAPI = {
        chat: async (messages) => {
            if (IS_ELECTRON) return window.api.ai.chat(messages)
            return { content: '浏览器端目前不支持直接调用 AI 接口哦，请使用 Electron 客户端体验完整功能。' }
        }
    }

    // ─── Attachments API ──────────────────────────────────────────────────────
    const attachmentsAPI: AttachmentsContextAPI = {
        getByEntry: async (entryId: number) => {
            if (IS_ELECTRON) return window.api.attachments.getByEntry(entryId)
            return []
        },
        save: async (entryId: number, data) => {
            if (IS_ELECTRON) return window.api.attachments.save(entryId, data)
            return true
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) return window.api.attachments.delete(id)
            return true
        }
    }

    // ─── Templates API ────────────────────────────────────────────────────────
    const templatesAPI: TemplatesContextAPI = {
        getAll: async () => {
            if (IS_ELECTRON) return window.api.templates.getAll()
            // Browser fallback: use localStorage
            const raw = localStorage.getItem('minddiary-templates')
            return raw ? JSON.parse(raw) : []
        },
        create: async (data) => {
            if (IS_ELECTRON) return window.api.templates.create(data)
            const templates: DiaryTemplate[] = JSON.parse(localStorage.getItem('minddiary-templates') || '[]')
            const newTpl: DiaryTemplate = {
                id: Math.max(0, ...templates.map(t => t.id)) + 1,
                name: data.name || '',
                content: data.content || '',
                is_default: 0,
                sort_order: data.sort_order ?? 99,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }
            templates.push(newTpl)
            localStorage.setItem('minddiary-templates', JSON.stringify(templates))
            return newTpl
        },
        update: async (id, data) => {
            if (IS_ELECTRON) return window.api.templates.update(id, data)
            const templates: DiaryTemplate[] = JSON.parse(localStorage.getItem('minddiary-templates') || '[]')
            const idx = templates.findIndex(t => t.id === id)
            if (idx >= 0) {
                templates[idx] = { ...templates[idx]!, ...data, updated_at: new Date().toISOString() }
                localStorage.setItem('minddiary-templates', JSON.stringify(templates))
                return templates[idx]!
            }
            return {} as DiaryTemplate
        },
        delete: async (id) => {
            if (IS_ELECTRON) return window.api.templates.delete(id)
            const templates: DiaryTemplate[] = JSON.parse(localStorage.getItem('minddiary-templates') || '[]')
            const tpl = templates.find(t => t.id === id)
            if (tpl?.is_default) return { success: false, message: '默认模板不可删除' }
            localStorage.setItem('minddiary-templates', JSON.stringify(templates.filter(t => t.id !== id)))
            return { success: true }
        }
    }

    const value = useMemo((): DataContextValue => ({
        dataReady: initialized,
        initErrors,
        entries: entriesAPI,
        tags: tagsAPI,
        mistakes: mistakesAPI,
        subjects: subjectsAPI,
        pomodoro: pomodoroAPI,
        dashboard: dashboardAPI,
        todayDashboard: todayDashboardAPI,
        exportUtil: exportAPI,
        notification: notificationAPI,
        ai: aiAPI,
        attachments: attachmentsAPI,
        templates: templatesAPI,
    }), [initialized, initErrors])

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    )
}
