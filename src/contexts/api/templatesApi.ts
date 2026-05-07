import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { DiaryTemplate } from '../../types'
import type { TemplatesContextAPI } from '../../types/api'

export const createTemplatesApi = (): TemplatesContextAPI => ({
    getAll: async () => {
        if (IS_ELECTRON) return window.api.templates.getAll()
        // Browser fallback: use localStorage
        const raw = localStorage.getItem('minddiary-templates')
        return raw ? JSON.parse(raw) : []
    },
    create: async (data: Partial<DiaryTemplate>) => {
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
    update: async (id: number, data: Partial<DiaryTemplate>) => {
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
    delete: async (id: number) => {
        if (IS_ELECTRON) return window.api.templates.delete(id)
        const templates: DiaryTemplate[] = JSON.parse(localStorage.getItem('minddiary-templates') || '[]')
        const tpl = templates.find(t => t.id === id)
        if (tpl?.is_default) return { success: false, message: '默认模板不可删除' }
        localStorage.setItem('minddiary-templates', JSON.stringify(templates.filter(t => t.id !== id)))
        return { success: true }
    }
})
