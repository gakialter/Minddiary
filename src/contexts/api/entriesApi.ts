import { IS_ELECTRON } from '../../utils/apiAdapter'
import { STORAGE_KEYS } from '../../data/mockData'
import { calculateWordCount } from '../../utils/helpers'
import type { DiaryEntry, EntryFilters, NewEntry, SaveToLocalFn, StudyTask } from '../../types'
import type { EntriesContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

export const createEntriesApi = (
    entriesRef: MutableRefObject<DiaryEntry[]>,
    saveToLocal: SaveToLocalFn,
    tasksRef?: MutableRefObject<StudyTask[]>
): EntriesContextAPI => ({
    getAll: async (filters: EntryFilters = {}) => {
        if (IS_ELECTRON) return window.api.entries.getAll(filters)
        let result = [...entriesRef.current]
        if (filters.mood) result = result.filter(e => e.mood === filters.mood)
        if (filters.tagId) result = result.filter(e => e.tags && e.tags.includes(Number(filters.tagId)))
        if (filters.startDate) result = result.filter(e => e.date >= filters.startDate!)
        if (filters.endDate) result = result.filter(e => e.date <= filters.endDate!)
        result.sort((a, b) => b.date.localeCompare(a.date))
        if (filters.limit) result = result.slice(0, filters.limit)
        return result
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
    create: async (data: NewEntry) => {
        if (IS_ELECTRON) return window.api.entries.create(data)
        
        const newEntry: DiaryEntry = {
            ...data,
            id: Math.max(0, ...entriesRef.current.map(e => e.id)) + 1,
            word_count: calculateWordCount(data.content),
            images: data.images || [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }
        entriesRef.current = [...entriesRef.current, newEntry]
        saveToLocal(STORAGE_KEYS.ENTRIES, entriesRef.current)
        return newEntry
    },
    update: async (id: number, data: Partial<DiaryEntry>) => {
        if (IS_ELECTRON) return window.api.entries.update(id, data)
        
        const existing = entriesRef.current.find(e => e.id === id)
        if (!existing) {
            throw new Error('Entry not found')
        }
        const updatedEntry: DiaryEntry = {
            ...existing,
            ...data,
            id,
            word_count: data.content !== undefined ? calculateWordCount(data.content) : existing.word_count,
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
        if (tasksRef) {
            tasksRef.current = tasksRef.current.map(task => (
                task.related_entry_id === id ? { ...task, related_entry_id: null } : task
            ))
            saveToLocal(STORAGE_KEYS.TASKS, tasksRef.current)
        }
        return true
    },
})
