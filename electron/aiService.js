async function chat(messages, settings = {}) {
    const { endpoint, apiKey, model } = settings;

    if (!endpoint || !apiKey) {
        return { error: '请先在设置中配置 AI API 地址和密钥' };
    }

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
            })
        });

        if (!response.ok) {
            const err = await response.text();
            return { error: `API 请求失败: ${response.status} - ${err}` };
        }

        const data = await response.json();
        return { content: data.choices[0].message.content };
    } catch (err) {
        return { error: `连接失败: ${err.message}` };
    }
}

async function summarize(content, settings = {}) {
    const messages = [
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
