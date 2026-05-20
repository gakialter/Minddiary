import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { Attachment, AttachmentData } from '../../types'
import type { AttachmentsContextAPI } from '../../types/api'

const ATTACHMENTS_UNSUPPORTED_MESSAGE = '浏览器端目前不支持附件存储，请使用 Electron 客户端体验完整功能。'

export class UnsupportedError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'UnsupportedError'
    }
}

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
        throw new UnsupportedError(ATTACHMENTS_UNSUPPORTED_MESSAGE)
    },
    delete: async (id: number) => {
        if (IS_ELECTRON) return window.api.attachments.delete(id)
        throw new UnsupportedError(ATTACHMENTS_UNSUPPORTED_MESSAGE)
    }
})
