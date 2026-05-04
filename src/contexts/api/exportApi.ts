import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { ExportContextAPI } from '../../types/api'

export const createExportApi = (): ExportContextAPI => ({
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
})
