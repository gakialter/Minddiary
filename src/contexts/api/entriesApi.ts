import { IS_ELECTRON } from '../../utils/apiAdapter'
import { STORAGE_KEYS } from '../../data/mockData'
import type { DiaryEntry, EntryFilters, NewEntry, SaveToLocalFn } from '../../types'
import type { EntriesContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

export const createEntriesApi = (
    entriesRef: MutableRefObject<DiaryEntry[]>,
    saveToLocal: SaveToLocalFn
): EntriesContextAPI => ({
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
    create: async (data: NewEntry) => {
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
    update: async (id: number, data: Partial<DiaryEntry>) => {
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
})
