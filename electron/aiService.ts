const db = require('./database');

import type { AIMessage, AIResponse } from '../src/types/index';
import {
    buildAiSummaryMessages,
    validateAiRequestMessages,
} from '../src/utils/aiRequestPolicy';

const AI_TIMEOUT_MS = 30_000;

async function chat(messages: AIMessage[]): Promise<AIResponse> {
    const safeMessages = validateAiRequestMessages(messages);
    const endpoint = db.getSetting('aiEndpoint');
    const apiKey = db.getAiApiKey();
    const model = db.getSetting('aiModel') || 'gpt-3.5-turbo';

    if (!endpoint || !apiKey) {
        return { content: '', error: '请先在设置中配置 AI API 地址和密钥' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
        const response = await fetch(`${endpoint}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: safeMessages,
                temperature: 0.7,
                max_tokens: 2000
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            await response.text();
            const statusHints: Record<number, string> = {
                401: '密钥无效或已过期，请在设置中更新 API Key。',
                403: 'API 访问被拒绝，请检查权限。',
                429: '请求频率超出限制，请稍后再试。',
                500: 'AI 服务器内部错误，请稍后再试。',
            };
            const hint = statusHints[response.status] || '';
            return { content: '', error: `API 请求失败 (${response.status})${hint ? '\n' + hint : ''}` };
        }

        const data = await response.json();
        return { content: data.choices[0].message.content };
    } catch (err: unknown) {
        clearTimeout(timeoutId);
        const error = err as Error;
        if (error.name === 'AbortError') {
            return { content: '', error: '请求超时（30秒），请检查网络连接或 API 服务是否正常。' };
        }
        return { content: '', error: `连接失败: ${error.message}` };
    }
}

async function summarize(content: string): Promise<AIResponse> {
    return chat(buildAiSummaryMessages(content));
}

module.exports = { chat, summarize };
