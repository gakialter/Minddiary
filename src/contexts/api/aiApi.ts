import { IS_ELECTRON } from '../../utils/apiAdapter'
import {
    formatAiRequestValidationError,
    validateAiRequestMessages,
} from '../../utils/aiRequestPolicy'
import type { AIContextAPI, FirstSliceAPI } from '../../types/api'

export const createAiApi = (): AIContextAPI & { firstSlice: FirstSliceAPI } => ({
    firstSlice: {
        openSession: async input => IS_ELECTRON && window.api.ai.firstSlice ? window.api.ai.firstSlice.openSession(input) : { kind: 'unavailable', reason: 'unsupported' },
        resolveEvidence: async input => IS_ELECTRON && window.api.ai.firstSlice ? window.api.ai.firstSlice.resolveEvidence(input) : { kind: 'unavailable', reason: 'unsupported' },
        send: async input => IS_ELECTRON && window.api.ai.firstSlice ? window.api.ai.firstSlice.send(input) : { kind: 'unavailable', reason: 'unsupported' },
        restrict: async input => IS_ELECTRON && window.api.ai.firstSlice ? window.api.ai.firstSlice.restrict(input) : { kind: 'unavailable', reason: 'unsupported' },
        cancel: async input => IS_ELECTRON && window.api.ai.firstSlice ? window.api.ai.firstSlice.cancel(input) : { kind: 'unavailable', reason: 'unsupported' },
        regenerate: async input => IS_ELECTRON && window.api.ai.firstSlice ? window.api.ai.firstSlice.regenerate(input) : { kind: 'unavailable', reason: 'unsupported' },
        closeSession: async input => IS_ELECTRON && window.api.ai.firstSlice ? window.api.ai.firstSlice.closeSession(input) : { kind: 'unavailable', reason: 'unsupported' },
    },
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
