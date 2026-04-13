const AI_TIMEOUT_MS = 30_000

export interface AISettings {
    endpoint?: string;
    apiKey?: string;
    model?: string;
}

export interface ChatMessage {
    role: string;
    content: string;
}

async function chat(messages: ChatMessage[], settings: AISettings = {}) {
    const { endpoint, apiKey, model } = settings;

    if (!endpoint || !apiKey) {
        return { error: '请先在设置中配置 AI API 地址和密钥' };
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
                model: model || 'gpt-3.5-turbo',
                messages,
                temperature: 0.7,
                max_tokens: 2000
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const err = await response.text();
            const statusHints: Record<number, string> = {
                401: '密钥无效或已过期，请在设置中更新 API Key。',
                403: 'API 访问被拒绝，请检查权限。',
                429: '请求频率超出限制，请稍后再试。',
                500: 'AI 服务器内部错误，请稍后再试。',
            };
            const hint = statusHints[response.status] || '';
            return { error: `API 请求失败 (${response.status})${hint ? '\n' + hint : ''}` };
        }

        const data = await response.json();
        return { content: data.choices[0].message.content };
    } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            return { error: '⏱️ 请求超时（30秒），请检查网络连接或 API 服务是否正常。' };
        }
        return { error: `🔌 连接失败: ${err.message}` };
    }
}

async function summarize(content: string, settings: AISettings = {}) {
    const messages: ChatMessage[] = [
        {
            role: 'system',
            content: '你是一位考研学习助手。请用简洁的中文回答，帮助学生总结学习内容、分析学习状态。'
        },
        {
            role: 'user',
            content: `请帮我总结以下学习日记的要点，并给出改进建议：\n\n${content}`
        }
    ];
    return chat(messages, settings);
}

module.exports = { chat, summarize };
