import { IS_ELECTRON } from '../../utils/apiAdapter'
import { STORAGE_KEYS } from '../../data/mockData'
import type { Tag, DiaryEntry, SaveToLocalFn } from '../../types'
import type { TagsContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

export const createTagsApi = (
    tagsRef: MutableRefObject<Tag[]>,
    entriesRef: MutableRefObject<DiaryEntry[]>,
    saveToLocal: SaveToLocalFn
): TagsContextAPI => ({
    getAll: async () => {
        if (IS_ELECTRON) return window.api.tags.getAll()
        return tagsRef.current.sort((a, b) => a.name.localeCompare(b.name))
    },
    create: async (data: Partial<Tag>) => {
        if (IS_ELECTRON) return window.api.tags.create(data)
        
        const newTag: Tag = { name: data.name || '', color: data.color || '#0F766E', id: Math.max(0, ...tagsRef.current.map(t => t.id)) + 1 }
        tagsRef.current = [...tagsRef.current, newTag]
        saveToLocal(STORAGE_KEYS.TAGS, tagsRef.current)
        return newTag
    },
    update: async (id: number, data: Partial<Tag>) => {
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
    setEntryTags: async (entryId: number, tagIds: number[]) => {
        if (IS_ELECTRON) return window.api.tags.setEntryTags(entryId, tagIds)

        // Defensive: deduplicate and coerce to number in case upstream passes
        // string ids (e.g. from DOM attributes). Safe to remove once all
        // callers are fully typed.
        const normalizedTagIds = Array.from(new Set(tagIds.map(Number)))
        entriesRef.current = entriesRef.current.map(entry =>
            entry.id === entryId ? { ...entry, tags: normalizedTagIds } : entry
        )
        saveToLocal(STORAGE_KEYS.ENTRIES, entriesRef.current)
    },
    getEntryTags: async (entryId: number) => {
        if (IS_ELECTRON) return window.api.tags.getEntryTags(entryId)

        const entry = entriesRef.current.find(e => e.id === entryId)
        const tagIds = entry?.tags || []
        return tagsRef.current.filter(tag => tagIds.includes(tag.id))
    },
})
