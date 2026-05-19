import { IS_ELECTRON } from '../../utils/apiAdapter'
import { STORAGE_KEYS } from '../../data/mockData'
import { mergeTagPatch, normalizeTag, normalizeTagList } from '../../utils/tagStyle'
import type { Tag, DiaryEntry, SaveToLocalFn } from '../../types'
import type { TagsContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

const normalizeEntryIds = (entryIds: number[]): number[] => (
    Array.from(new Set(
        (Array.isArray(entryIds) ? entryIds : []).filter(entryId => Number.isInteger(entryId) && entryId > 0),
    ))
)

const normalizeTagsByEntry = (tagsByEntry: Record<number, Tag[]>): Record<number, Tag[]> => {
    const normalized: Record<number, Tag[]> = {}
    for (const [entryId, tags] of Object.entries(tagsByEntry)) {
        normalized[Number(entryId)] = normalizeTagList(tags)
    }
    return normalized
}

export const createTagsApi = (
    tagsRef: MutableRefObject<Tag[]>,
    entriesRef: MutableRefObject<DiaryEntry[]>,
    saveToLocal: SaveToLocalFn
): TagsContextAPI => ({
    getAll: async () => {
        if (IS_ELECTRON) return normalizeTagList(await window.api.tags.getAll())
        return normalizeTagList(tagsRef.current).sort((a, b) => a.name.localeCompare(b.name))
    },
    create: async (data: Partial<Tag>) => {
        if (IS_ELECTRON) return normalizeTag(await window.api.tags.create(data))
        
        const newTag = normalizeTag({
            id: Math.max(0, ...tagsRef.current.map(t => t.id)) + 1,
            name: data.name,
            color: data.color,
            icon: data.icon,
            variant: data.variant,
            pattern: data.pattern,
        })
        if (!newTag.name) {
            throw new Error('Tag name is required')
        }
        tagsRef.current = [...tagsRef.current, newTag]
        saveToLocal(STORAGE_KEYS.TAGS, tagsRef.current)
        return newTag
    },
    update: async (id: number, data: Partial<Tag>) => {
        if (IS_ELECTRON) {
            return normalizeTag(await window.api.tags.update(id, data))
        }
        const existingTag = tagsRef.current.find(t => t.id === id)
        if (!existingTag) {
            throw new Error('Tag not found')
        }
        const updatedTag = mergeTagPatch(normalizeTag(existingTag), data)
        if (!updatedTag.name) {
            throw new Error('Tag name is required')
        }
        tagsRef.current = tagsRef.current.map(t => t.id === id ? updatedTag : t)
        saveToLocal(STORAGE_KEYS.TAGS, tagsRef.current)
        return updatedTag
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
        if (IS_ELECTRON) return normalizeTagList(await window.api.tags.getEntryTags(entryId))

        const entry = entriesRef.current.find(e => e.id === entryId)
        const tagIds = entry?.tags || []
        return normalizeTagList(tagsRef.current.filter(tag => tagIds.includes(tag.id)))
    },
    getEntryTagsBatch: async (entryIds: number[]) => {
        const validEntryIds = normalizeEntryIds(entryIds)
        if (validEntryIds.length === 0) return {}
        if (IS_ELECTRON) return normalizeTagsByEntry(await window.api.tags.getEntryTagsBatch(validEntryIds))

        const tagsById = new Map(normalizeTagList(tagsRef.current).map(tag => [tag.id, tag]))
        const result: Record<number, Tag[]> = {}
        for (const entryId of validEntryIds) {
            const entry = entriesRef.current.find(item => item.id === entryId)
            const tagIds = Array.isArray(entry?.tags) ? entry.tags : []
            result[entryId] = tagIds
                .map(tagId => tagsById.get(tagId))
                .filter((tag): tag is Tag => Boolean(tag))
        }
        return result
    },
})
