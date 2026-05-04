import { IS_ELECTRON } from '../../utils/apiAdapter'
import type { AIContextAPI } from '../../types/api'

export const createAiApi = (): AIContextAPI => ({
    chat: async (messages) => {
        if (IS_ELECTRON) return window.api.ai.chat(messages)
        return { content: '浏览器端目前不支持直接调用 AI 接口哦，请使用 Electron 客户端体验完整功能。' }
    }
})
