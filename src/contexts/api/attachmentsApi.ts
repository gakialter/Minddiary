import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { AttachmentsContextAPI } from '../../types/api'

export const createAttachmentsApi = (): AttachmentsContextAPI => ({
    getByEntry: async (entryId: number) => {
        if (IS_ELECTRON) return window.api.attachments.getByEntry(entryId)
        return []
    },
    save: async (entryId: number, data: any) => {
        if (IS_ELECTRON) return window.api.attachments.save(entryId, data)
        return true
    },
    delete: async (id: number) => {
        if (IS_ELECTRON) return window.api.attachments.delete(id)
        return true
    }
})
