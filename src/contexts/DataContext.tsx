import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
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
    const [entries, setEntries] = useState<DiaryEntry[]>([])
    const [tags, setTags] = useState<Tag[]>([])
    const [mistakes, setMistakes] = useState<Mistake[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [initialized, setInitialized] = useState(false)
    const [initErrors, setInitErrors] = useState<string[]>([])

    // ─── Initialization ───────────────────────────────────────────────────────
    useEffect(() => {
        if (IS_ELECTRON) {
            Promise.allSettled([
                window.api.entries.getAll({}),
                window.api.tags.getAll(),
                window.api.mistakes.getAll({}),
                window.api.subjects.getAll(),
            ]).then(results => {
                const errors: string[] = []

                if (results[0]!.status === 'fulfilled') setEntries((results[0] as PromiseFulfilledResult<DiaryEntry[]>).value || [])
                else errors.push(`加载日记失败: ${(results[0] as PromiseRejectedResult).reason}`)

                if (results[1]!.status === 'fulfilled') setTags((results[1] as PromiseFulfilledResult<Tag[]>).value || [])
                else errors.push(`加载标签失败: ${(results[1] as PromiseRejectedResult).reason}`)

                if (results[2]!.status === 'fulfilled') setMistakes((results[2] as PromiseFulfilledResult<Mistake[]>).value || [])
                else errors.push(`加载错题失败: ${(results[2] as PromiseRejectedResult).reason}`)

                if (results[3]!.status === 'fulfilled') setSubjects((results[3] as PromiseFulfilledResult<Subject[]>).value || [])
                else errors.push(`加载科目失败: ${(results[3] as PromiseRejectedResult).reason}`)

                if (errors.length > 0) {
                    console.error('[DataContext] Partial init failed:', errors)
                    setInitErrors(errors)
                }
            }).finally(() => setInitialized(true))
        } else {
            const load = <T,>(key: string, fallback: T[], setter: React.Dispatch<React.SetStateAction<T[]>>) => {
                const raw = localStorage.getItem(key)
                const val: T[] = raw ? JSON.parse(raw) : fallback
                setter(val)
                if (!raw) localStorage.setItem(key, JSON.stringify(fallback))
            }
            load(STORAGE_KEYS.ENTRIES, mockEntries, setEntries)
            load(STORAGE_KEYS.TAGS, mockTags, setTags)
            load(STORAGE_KEYS.MISTAKES, mockMistakes, setMistakes)
            load(STORAGE_KEYS.SUBJECTS, mockSubjects, setSubjects)
            setInitialized(true)
        }
    }, [])

    // ─── Browser-only localStorage persistence ────────────────────────────────
    useEffect(() => {
        if (initialized && !IS_ELECTRON)
            localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify(entries))
    }, [entries, initialized])

    useEffect(() => {
        if (initialized && !IS_ELECTRON)
            localStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify(tags))
    }, [tags, initialized])

    useEffect(() => {
        if (initialized && !IS_ELECTRON)
            localStorage.setItem(STORAGE_KEYS.MISTAKES, JSON.stringify(mistakes))
    }, [mistakes, initialized])

    useEffect(() => {
        if (initialized && !IS_ELECTRON)
            localStorage.setItem(STORAGE_KEYS.SUBJECTS, JSON.stringify(subjects))
    }, [subjects, initialized])

    // ─── Entries API ──────────────────────────────────────────────────────────
    const entriesAPI: EntriesContextAPI = {
        getAll: async (filters: EntryFilters = {}) => {
            if (IS_ELECTRON) return window.api.entries.getAll(filters)
            let result = [...entries]
            if (filters.mood) result = result.filter(e => e.mood === filters.mood)
            if (filters.tagId) result = result.filter(e => e.tags && e.tags.includes(Number(filters.tagId)))
            if (filters.startDate) result = result.filter(e => e.date >= filters.startDate!)
            if (filters.endDate) result = result.filter(e => e.date <= filters.endDate!)
            if (filters.limit) result = result.slice(0, filters.limit)
            return result.sort((a, b) => b.date.localeCompare(a.date))
        },
        getByDate: async (date: string) => {
            if (IS_ELECTRON) return window.api.entries.getByDate(date)
            return entries.find(e => e.date === date) || null
        },
        getById: async (id: number) => {
            if (IS_ELECTRON) return window.api.entries.getById(id)
            return entries.find(e => e.id === id) || null
        },
        getDatesWithEntries: async (yearMonth: string) => {
            if (IS_ELECTRON) return window.api.entries.getDatesWithEntries(yearMonth)
            return entries
                .filter(e => e.date.startsWith(yearMonth))
                .map(e => ({ date: e.date, mood: e.mood }))
        },
        search: async (query: string) => {
            if (IS_ELECTRON) return window.api.entries.search(query)
            const lowerQuery = query.toLowerCase()
            return entries
                .filter(e => e.title?.toLowerCase().includes(lowerQuery) || e.content?.toLowerCase().includes(lowerQuery))
                .map(e => ({ ...e, content_snippet: e.content?.substring(0, 200) }))
                .sort((a, b) => b.date.localeCompare(a.date))
        },
        create: async (data) => {
            if (IS_ELECTRON) {
                const newEntry = await window.api.entries.create(data)
                setEntries(prev => [newEntry, ...prev])
                return newEntry
            }
            const newEntry: DiaryEntry = {
                ...data,
                id: Math.max(0, ...entries.map(e => e.id)) + 1,
                word_count: data.content ? data.content.length : 0,
                images: data.images || [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }
            setEntries(prev => [...prev, newEntry])
            return newEntry
        },
        update: async (id: number, data) => {
            if (IS_ELECTRON) {
                const updated = await window.api.entries.update(id, data)
                setEntries(prev => prev.map(e => e.id === id ? updated : e))
                return updated
            }
            const updatedEntry: DiaryEntry = {
                ...(entries.find(e => e.id === id)!),
                ...data,
                id,
                word_count: data.content ? data.content.length : 0,
                updated_at: new Date().toISOString(),
            }
            setEntries(prev => prev.map(e => e.id === id ? updatedEntry : e))
            return updatedEntry
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) {
                await window.api.entries.delete(id)
                setEntries(prev => prev.filter(e => e.id !== id))
                return true
            }
            setEntries(prev => prev.filter(e => e.id !== id))
            return true
        },
    }

    // ─── Tags API ─────────────────────────────────────────────────────────────
    const tagsAPI: TagsContextAPI = {
        getAll: async () => {
            if (IS_ELECTRON) return window.api.tags.getAll()
            return tags.sort((a, b) => a.name.localeCompare(b.name))
        },
        create: async (data) => {
            if (IS_ELECTRON) {
                const newTag = await window.api.tags.create(data)
                setTags(prev => [...prev, newTag])
                return newTag
            }
            const newTag: Tag = { name: data.name || '', color: data.color || '#6366f1', id: Math.max(0, ...tags.map(t => t.id)) + 1 }
            setTags(prev => [...prev, newTag])
            return newTag
        },
        update: async (id: number, data) => {
            if (IS_ELECTRON) {
                await window.api.tags.update(id, data)
                setTags(prev => prev.map(t => t.id === id ? { ...t, ...data } : t))
                return data
            }
            setTags(prev => prev.map(t => t.id === id ? { ...t, ...data } : t))
            return data
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) {
                await window.api.tags.delete(id)
                setTags(prev => prev.filter(t => t.id !== id))
                return true
            }
            setTags(prev => prev.filter(t => t.id !== id))
            setEntries(prev => prev.map(e => ({ ...e, tags: e.tags ? e.tags.filter(tid => tid !== id) : [] })))
            return true
        },
    }

    // ─── Mistakes API ─────────────────────────────────────────────────────────
    const mistakesAPI: MistakesContextAPI = {
        getAll: async (filters: MistakeFilters = {}) => {
            if (IS_ELECTRON) return window.api.mistakes.getAll(filters)
            let result = mistakes.map(m => {
                const subject = subjects.find(s => s.id === m.subject_id)
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
            return result.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        },
        create: async (data) => {
            if (IS_ELECTRON) {
                const { id } = await window.api.mistakes.create(data)
                const newMistake: Mistake = { 
                    question: '', answer: '', notes: '', subject_id: null, 
                    ease_factor: 2.5, review_interval: 1, next_review_date: null, review_count: 0,
                    ...data, id, mastered: 0, created_at: new Date().toISOString() 
                }
                setMistakes(prev => [newMistake, ...prev])
                return newMistake
            }
            const newMistake: Mistake = {
                question: '', answer: '', notes: '', subject_id: null,
                ease_factor: 2.5, review_interval: 1, next_review_date: null, review_count: 0,
                ...data,
                id: Math.max(0, ...mistakes.map(m => m.id)) + 1,
                mastered: false,
                created_at: new Date().toISOString(),
            }
            setMistakes(prev => [...prev, newMistake])
            return newMistake
        },
        update: async (id: number, data) => {
            if (IS_ELECTRON) {
                await window.api.mistakes.update(id, data)
                setMistakes(prev => prev.map(m => m.id === id ? { ...m, ...data } : m))
                return data
            }
            setMistakes(prev => prev.map(m => m.id === id ? { ...m, ...data } : m))
            return data
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) {
                await window.api.mistakes.delete(id)
                setMistakes(prev => prev.filter(m => m.id !== id))
                return true
            }
            setMistakes(prev => prev.filter(m => m.id !== id))
            return true
        },
        toggleMastered: async (id: number) => {
            if (IS_ELECTRON) {
                const { mastered } = await window.api.mistakes.toggleMastered(id)
                setMistakes(prev => prev.map(m => m.id === id ? { ...m, mastered } : m))
                return { mastered }
            }
            setMistakes(prev => prev.map(m => m.id === id ? { ...m, mastered: !m.mastered } : m))
            return { mastered: true }
        },
        review: async (id: number, data) => {
            if (IS_ELECTRON) {
                await window.api.mistakes.review(id, data);
                setMistakes(prev => prev.map(m => m.id === id ? { ...m, ...data } : m));
                return { success: true };
            }
            setMistakes(prev => prev.map(m => m.id === id ? { ...m, ...data } : m));
            return { success: true };
        },
        getDueCount: async (date: string) => {
            if (IS_ELECTRON) return window.api.mistakes.getDueCount(date);
            return mistakes.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date)).length;
        },
        getRandomDue: async (date: string, subjectId?: number) => {
            if (IS_ELECTRON) return window.api.mistakes.getRandomDue(date, subjectId);
            let due = mistakes.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date));
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
            return subjects.sort((a, b) => (a.order || 0) - (b.order || 0))
        },
        create: async (data) => {
            if (IS_ELECTRON) {
                const newSubject = await window.api.subjects.create(data)
                setSubjects(prev => [...prev, newSubject])
                return newSubject
            }
            const newSubject: Subject = {
                name: '', color: '#8b5cf6',
                ...data,
                id: Math.max(0, ...subjects.map(s => s.id)) + 1,
                order: subjects.length + 1,
            }
            setSubjects(prev => [...prev, newSubject])
            return newSubject
        },
        update: async (id: number, data) => {
            if (IS_ELECTRON) {
                await window.api.subjects.update(id, data)
                setSubjects(prev => prev.map(s => s.id === id ? { ...s, ...data } : s))
                return data
            }
            setSubjects(prev => prev.map(s => s.id === id ? { ...s, ...data } : s))
            return data
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) {
                await window.api.subjects.delete(id)
                setSubjects(prev => prev.filter(s => s.id !== id))
                return true
            }
            setSubjects(prev => prev.filter(s => s.id !== id))
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
            const todayEntry = entries.find(e => e.date === date)
            const dueCount = mistakes.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date)).length
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
        chat: async (messages, settings) => {
            if (IS_ELECTRON) return window.api.ai.chat(messages, settings)
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

    const value: DataContextValue = {
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
    }

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    )
}
