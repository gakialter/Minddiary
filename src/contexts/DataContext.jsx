import { createContext, useContext, useState, useEffect } from 'react'
import { mockEntries, mockTags, mockMistakes, mockSubjects, STORAGE_KEYS } from '../data/mockData'
import { IS_ELECTRON } from '../utils/apiAdapter'

const DataContext = createContext()

export const useData = () => {
    const context = useContext(DataContext)
    if (!context) throw new Error('useData must be used within DataProvider')
    return context
}

export const DataProvider = ({ children }) => {
    const [entries, setEntries] = useState([])
    const [tags, setTags] = useState([])
    const [mistakes, setMistakes] = useState([])
    const [subjects, setSubjects] = useState([])
    const [initialized, setInitialized] = useState(false)
    const [initErrors, setInitErrors] = useState([])

    // ─── Initialization ───────────────────────────────────────────────────────
    useEffect(() => {
        if (IS_ELECTRON) {
            Promise.allSettled([
                window.api.entries.getAll({}),
                window.api.tags.getAll(),
                window.api.mistakes.getAll({}),
                window.api.subjects.getAll(),
            ]).then(results => {
                const errors = []

                if (results[0].status === 'fulfilled') setEntries(results[0].value || [])
                else errors.push(`加载日记失败: ${results[0].reason}`)

                if (results[1].status === 'fulfilled') setTags(results[1].value || [])
                else errors.push(`加载标签失败: ${results[1].reason}`)

                if (results[2].status === 'fulfilled') setMistakes(results[2].value || [])
                else errors.push(`加载错题失败: ${results[2].reason}`)

                if (results[3].status === 'fulfilled') setSubjects(results[3].value || [])
                else errors.push(`加载科目失败: ${results[3].reason}`)

                if (errors.length > 0) {
                    console.error('[DataContext] Partial init failed:', errors)
                    setInitErrors(errors)
                }
            }).finally(() => setInitialized(true))
        } else {
            const load = (key, fallback, setter) => {
                const raw = localStorage.getItem(key)
                const val = raw ? JSON.parse(raw) : fallback
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
    const entriesAPI = {
        getAll: async (filters = {}) => {
            if (IS_ELECTRON) return window.api.entries.getAll(filters)
            let result = [...entries]
            if (filters.mood) result = result.filter(e => e.mood === filters.mood)
            if (filters.tagId) result = result.filter(e => e.tags && e.tags.includes(Number(filters.tagId)))
            if (filters.startDate) result = result.filter(e => e.date >= filters.startDate)
            if (filters.endDate) result = result.filter(e => e.date <= filters.endDate)
            if (filters.limit) result = result.slice(0, filters.limit)
            return result.sort((a, b) => b.date.localeCompare(a.date))
        },
        getByDate: async (date) => {
            if (IS_ELECTRON) return window.api.entries.getByDate(date)
            return entries.find(e => e.date === date) || null
        },
        getById: async (id) => {
            if (IS_ELECTRON) return window.api.entries.getById(id)
            return entries.find(e => e.id === id) || null
        },
        getDatesWithEntries: async (yearMonth) => {
            if (IS_ELECTRON) return window.api.entries.getDatesWithEntries(yearMonth)
            return entries
                .filter(e => e.date.startsWith(yearMonth))
                .map(e => ({ date: e.date, mood: e.mood }))
        },
        search: async (query) => {
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
            const newEntry = {
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
        update: async (id, data) => {
            if (IS_ELECTRON) {
                const updated = await window.api.entries.update(id, data)
                setEntries(prev => prev.map(e => e.id === id ? updated : e))
                return updated
            }
            const updatedEntry = {
                ...data, id,
                word_count: data.content ? data.content.length : 0,
                updated_at: new Date().toISOString(),
            }
            setEntries(prev => prev.map(e => e.id === id ? { ...e, ...updatedEntry } : e))
            return updatedEntry
        },
        delete: async (id) => {
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
    const tagsAPI = {
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
            const newTag = { ...data, id: Math.max(0, ...tags.map(t => t.id)) + 1 }
            setTags(prev => [...prev, newTag])
            return newTag
        },
        update: async (id, data) => {
            if (IS_ELECTRON) {
                await window.api.tags.update(id, data)
                setTags(prev => prev.map(t => t.id === id ? { ...t, ...data } : t))
                return data
            }
            setTags(prev => prev.map(t => t.id === id ? { ...t, ...data } : t))
            return data
        },
        delete: async (id) => {
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
    const mistakesAPI = {
        getAll: async (filters = {}) => {
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
                const newMistake = { ...data, id, mastered: 0, created_at: new Date().toISOString() }
                setMistakes(prev => [newMistake, ...prev])
                return newMistake
            }
            const newMistake = {
                ...data,
                id: Math.max(0, ...mistakes.map(m => m.id)) + 1,
                mastered: false,
                created_at: new Date().toISOString(),
            }
            setMistakes(prev => [...prev, newMistake])
            return newMistake
        },
        update: async (id, data) => {
            if (IS_ELECTRON) {
                await window.api.mistakes.update(id, data)
                setMistakes(prev => prev.map(m => m.id === id ? { ...m, ...data } : m))
                return data
            }
            setMistakes(prev => prev.map(m => m.id === id ? { ...m, ...data } : m))
            return data
        },
        delete: async (id) => {
            if (IS_ELECTRON) {
                await window.api.mistakes.delete(id)
                setMistakes(prev => prev.filter(m => m.id !== id))
                return true
            }
            setMistakes(prev => prev.filter(m => m.id !== id))
            return true
        },
        toggleMastered: async (id) => {
            if (IS_ELECTRON) {
                const { mastered } = await window.api.mistakes.toggleMastered(id)
                setMistakes(prev => prev.map(m => m.id === id ? { ...m, mastered } : m))
                return { mastered }
            }
            setMistakes(prev => prev.map(m => m.id === id ? { ...m, mastered: !m.mastered } : m))
            return true
        },
    }

    // ─── Subjects API ─────────────────────────────────────────────────────────
    const subjectsAPI = {
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
            const newSubject = {
                ...data,
                id: Math.max(0, ...subjects.map(s => s.id)) + 1,
                order: subjects.length + 1,
            }
            setSubjects(prev => [...prev, newSubject])
            return newSubject
        },
        update: async (id, data) => {
            if (IS_ELECTRON) {
                await window.api.subjects.update(id, data)
                setSubjects(prev => prev.map(s => s.id === id ? { ...s, ...data } : s))
                return data
            }
            setSubjects(prev => prev.map(s => s.id === id ? { ...s, ...data } : s))
            return data
        },
        delete: async (id) => {
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
    const pomodoroAPI = {
        getStats: async (date) => {
            if (IS_ELECTRON) return window.api.pomodoro.getStats(date)
            return []
        },
        getRange: async (start, end) => {
            if (IS_ELECTRON) return window.api.pomodoro.getRange(start, end)
            return []
        },
        addSession: async (session) => {
            if (IS_ELECTRON) return window.api.pomodoro.addSession(session)
            return true
        },
        getDailyTotal: async (date) => {
            if (IS_ELECTRON) return window.api.pomodoro.getDailyTotal(date)
            return 0
        }
    }

    // ─── Dashboard API ────────────────────────────────────────────────────────
    const dashboardAPI = {
        streak: async () => {
            if (IS_ELECTRON) return window.api.dashboard.streak()
            return 0
        },
        entryDatesRange: async (start, end) => {
            if (IS_ELECTRON) return window.api.dashboard.entryDatesRange(start, end)
            return []
        }
    }

    // ─── Export API ───────────────────────────────────────────────────────────
    const exportAPI = {
        showSaveDialog: async (options) => {
            if (IS_ELECTRON) return window.api.export.showSaveDialog(options)
            return options.defaultPath || 'minddiary_export.txt'
        },
        writeFile: async (path, content) => {
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
        toPDF: async (html, path) => {
            if (IS_ELECTRON) return window.api.export.toPDF(html, path)
            window.print()
            return true
        }
    }

    // ─── Notification API ─────────────────────────────────────────────────────
    const notificationAPI = {
        show: async (title, body) => {
            if (IS_ELECTRON) return window.api.notification.show(title, body)
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(title, { body, icon: '/favicon.ico' })
            }
        }
    }

    // ─── AI API ───────────────────────────────────────────────────────────────
    const aiAPI = {
        chat: async (messages, settings) => {
            if (IS_ELECTRON) return window.api.ai.chat(messages, settings)
            return { content: '浏览器端目前不支持直接调用 AI 接口哦，请使用 Electron 客户端体验完整功能。' }
        }
    }

    // ─── Attachments API ──────────────────────────────────────────────────────
    const attachmentsAPI = {
        getByEntry: async (entryId) => {
            if (IS_ELECTRON) return window.api.attachments.getByEntry(entryId)
            return []
        },
        save: async (entryId, data) => {
            if (IS_ELECTRON) return window.api.attachments.save(entryId, data)
            return true
        },
        delete: async (id) => {
            if (IS_ELECTRON) return window.api.attachments.delete(id)
            return true
        }
    }

    const value = {
        dataReady: initialized,
        initErrors,
        entries: {
            getAll: entriesAPI.getAll,
            getByDate: entriesAPI.getByDate,
            getById: entriesAPI.getById,
            getDatesWithEntries: entriesAPI.getDatesWithEntries,
            search: entriesAPI.search,
            create: entriesAPI.create,
            update: entriesAPI.update,
            delete: entriesAPI.delete,
        },
        tags: {
            getAll: tagsAPI.getAll,
            create: tagsAPI.create,
            update: tagsAPI.update,
            delete: tagsAPI.delete,
        },
        mistakes: {
            getAll: mistakesAPI.getAll,
            create: mistakesAPI.create,
            update: mistakesAPI.update,
            delete: mistakesAPI.delete,
            toggleMastered: mistakesAPI.toggleMastered,
        },
        subjects: {
            getAll: subjectsAPI.getAll,
            create: subjectsAPI.create,
            update: subjectsAPI.update,
            delete: subjectsAPI.delete,
        },
        pomodoro: pomodoroAPI,
        dashboard: dashboardAPI,
        exportUtil: exportAPI,
        notification: notificationAPI,
        ai: aiAPI,
        attachments: attachmentsAPI,
    }

    return (
        <DataContext.Provider value={value}>
            {children}
        </DataContext.Provider>
    )
}
