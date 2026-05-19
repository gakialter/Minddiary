import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { Attachment, AttachmentData } from '../../types'
import type { AttachmentsContextAPI } from '../../types/api'

const normalizeEntryIds = (entryIds: number[]): number[] => (
    Array.from(new Set(
        (Array.isArray(entryIds) ? entryIds : []).filter(entryId => Number.isInteger(entryId) && entryId > 0),
    ))
)

export const createAttachmentsApi = (): AttachmentsContextAPI => ({
    getByEntry: async (entryId: number) => {
        if (IS_ELECTRON) return window.api.attachments.getByEntry(entryId)
        return []
    },
    getByEntries: async (entryIds: number[]) => {
        const validEntryIds = normalizeEntryIds(entryIds)
        if (validEntryIds.length === 0) return {}
        if (IS_ELECTRON) return window.api.attachments.getByEntries(validEntryIds)

        const result: Record<number, Attachment[]> = {}
        for (const entryId of validEntryIds) {
            result[entryId] = []
        }
        return result
    },
    save: async (entryId: number, data: AttachmentData) => {
        if (IS_ELECTRON) return window.api.attachments.save(entryId, data)
        return true
    },
    delete: async (id: number) => {
        if (IS_ELECTRON) return window.api.attachments.delete(id)
        return true
    }
})
