import { IS_ELECTRON } from '../../utils/apiAdapter'
import {
    formatAiRequestValidationError,
    validateAiRequestMessages,
} from '../../utils/aiRequestPolicy'
import type { AIContextAPI } from '../../types/api'

export const createAiApi = (): AIContextAPI => ({
    chat: async (messages) => {
        if (IS_ELECTRON) {
            try {
                return window.api.ai.chat(validateAiRequestMessages(messages))
            } catch (error) {
                return { error: formatAiRequestValidationError(error) }
            }
        }
        return {
            error: '浏览器端目前不支持直接调用 AI 接口，请使用 Electron 客户端体验完整功能。',
            unsupported: true,
        }
    }
})
