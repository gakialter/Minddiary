import { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
    SYSTEM_PROMPT,
    sanitizeUserInput,
    buildDiarySummaryPrompt,
    buildMistakeAnalysisPrompt,
    buildMentalMassagePrompt,
    buildSprintPlanPrompt,
} from '../utils/promptTemplates'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'

export default function AIPanel({ entry }) {
    const { settingsData, ai: aiAPI, mistakes: mistakesAPI } = useDiary()
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const messagesEndRef = useRef(null)
    // Generation counter: incremented on each new request or cancel.
    // sendMessage captures its value at call time; if it changes before the
    // response arrives, the response is discarded (soft cancellation).
    const generationRef = useRef(0)
    const settings = {
        endpoint: settingsData?.aiEndpoint || '',
        apiKey: settingsData?.aiApiKey || '',
        model: settingsData?.aiModel || 'gpt-3.5-turbo'
    }

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, loading])

    const appendMessage = (role, content) => {
        setMessages(prev => [...prev, { role, content, id: Date.now() + Math.random() }])
    }

    const cancelRequest = () => {
        generationRef.current++  // invalidate any in-flight request
        setLoading(false)
    }

    const sendMessage = async (textOverride = null) => {
        const raw = textOverride || input
        if (!raw.trim() || loading) return

        const textToUse = sanitizeUserInput(raw)

        if (!settings.endpoint || !settings.apiKey) {
            appendMessage('assistant', '⚠️ 请先在「设置」中配置有效的 AI API 地址和密钥。')
            if (!textOverride) setInput('')
            return
        }

        appendMessage('user', raw)
        if (!textOverride) setInput('')
        setLoading(true)
        const gen = ++generationRef.current

        try {
            const chatMessages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: textToUse }
            ]
            const result = await aiAPI.chat(chatMessages, settings)
            if (generationRef.current !== gen) return  // cancelled
            if (result.error) {
                appendMessage('assistant', `❌ ${result.error}`)
                showToast(result.error.split('\n')[0], 'error')
            } else {
                appendMessage('assistant', result.content)
            }
        } catch (e) {
            if (generationRef.current !== gen) return
            const msg = `🔌 网络异常: ${e.message}`
            appendMessage('assistant', msg)
            showToast('AI 请求失败，请检查网络', 'error')
        } finally {
            if (generationRef.current === gen) setLoading(false)
        }
    }

    const summarizeEntry = async () => {
        if (!entry?.content) {
            appendMessage('assistant', '📝 左侧编辑器还没有内容哦，今天写点什么再让我总结吧！')
            return
        }
        sendMessage(buildDiarySummaryPrompt(entry.content, entry.date))
    }

    const analyzeMistakes = async () => {
        try {
            const mistakesList = await mistakesAPI.getAll({})
            sendMessage(buildMistakeAnalysisPrompt(mistakesList || []))
        } catch {
            sendMessage(buildMistakeAnalysisPrompt([]))
        }
    }

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    const quickPrompts = [
        { icon: '📝', label: '总结今日日记', action: summarizeEntry },
        { icon: '🔍', label: '错题规律分析', action: analyzeMistakes },
        { icon: '☕', label: '心理按摩', action: () => sendMessage(buildMentalMassagePrompt()) },
        { icon: '🎯', label: '制定复习冲刺', action: () => sendMessage(buildSprintPlanPrompt(30)) },
    ]

    const createMarkup = (text) => {
        try {
            return { __html: DOMPurify.sanitize(marked(text, { breaks: true })) }
        } catch {
            return { __html: DOMPurify.sanitize(text) }
        }
    }

    return (
        <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            maxWidth: 800, margin: '0 auto', width: '100%',
            position: 'relative'
        }}>
            {/* Header */}
            <div className="flex items-center justify-between" style={{ padding: 'var(--space-md) var(--space-xl)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-secondary)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 10 }}>
                <div className="flex items-center gap-sm">
                    <div style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg, var(--accent), var(--accent-light))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                        🤖
                    </div>
                    <div>
                        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>小研</h2>
                        <span style={{ fontSize: 12, color: 'var(--success)' }}>● 在线待命</span>
                    </div>
                </div>
                <button className="button button-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setMessages([])}>
                    🗑️ 清空历史
                </button>
            </div>

            {/* Chat Area */}
            <div style={{
                flex: 1, padding: 'var(--space-lg) var(--space-xl)', overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)'
            }}>
                {messages.length === 0 && (
                    <div className="empty-state" style={{ height: '100%', animation: 'page-fade-in 0.5s ease-out' }}>
                        <div style={{
                            width: 80, height: 80, borderRadius: 24, background: 'var(--bg-tertiary)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, marginBottom: 'var(--space-md)'
                        }}>✨</div>
                        <h3 style={{ fontSize: 20, marginBottom: 'var(--space-sm)' }}>我是你的专属考研智囊</h3>
                        <p className="text-muted" style={{ maxWidth: 300, textAlign: 'center', lineHeight: 1.6, marginBottom: 'var(--space-2xl)' }}>
                            我可以直接读取你的日记、错题与学习进度，为你提供定制化的复习策略和情绪价值。
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', width: '100%', maxWidth: 500 }}>
                            {quickPrompts.map((p, i) => (
                                <button key={i} className="card flex items-center gap-sm cursor-pointer"
                                    style={{ padding: 'var(--space-md)', border: '1px solid var(--border)', background: 'var(--bg-secondary)', textAlign: 'left', transition: 'all 0.2s' }}
                                    onClick={p.action}
                                    onMouseEnter={e => Object.assign(e.currentTarget.style, { transform: 'translateY(-2px)', borderColor: 'var(--accent)', boxShadow: 'var(--shadow-sm)' })}
                                    onMouseLeave={e => Object.assign(e.currentTarget.style, { transform: 'translateY(0)', borderColor: 'var(--border)', boxShadow: 'none' })}
                                >
                                    <span style={{ fontSize: 20 }}>{p.icon}</span>
                                    <span style={{ fontSize: 14, fontWeight: 500 }}>{p.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Message Bubbles */}
                {messages.map((msg) => (
                    <div key={msg.id} style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        animation: 'page-fade-in 0.3s cubic-bezier(0.2, 0, 0, 1)'
                    }}>
                        <div style={{
                            maxWidth: '85%',
                            padding: '12px 16px',
                            borderRadius: 16,
                            borderTopRightRadius: msg.role === 'user' ? 4 : 16,
                            borderTopLeftRadius: msg.role === 'assistant' ? 4 : 16,
                            background: msg.role === 'user' ? 'linear-gradient(135deg, var(--accent), var(--accent-light))' : 'var(--bg-tertiary)',
                            color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
                            boxShadow: msg.role === 'user' ? '0 4px 12px rgba(139, 92, 246, 0.2)' : 'none',
                            fontSize: 15, lineHeight: 1.6
                        }}>
                            {msg.role === 'user' ? (
                                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                            ) : (
                                <div className="markdown-body" style={{ background: 'transparent', color: 'inherit', fontSize: 'inherit' }}
                                    dangerouslySetInnerHTML={createMarkup(msg.content)}
                                />
                            )}
                        </div>
                        <span className="text-muted" style={{ fontSize: 11, marginTop: 4, margin: '4px 8px 0 8px' }}>
                            {msg.role === 'user' ? '我' : '小研 AI'}
                        </span>
                    </div>
                ))}

                {/* Loading State */}
                {loading && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-sm)', animation: 'page-fade-in 0.3s ease-in' }}>
                        <div style={{
                            padding: '16px 20px', borderRadius: 16, borderTopLeftRadius: 4,
                            background: 'var(--bg-tertiary)',
                            display: 'flex', gap: 6, alignItems: 'center'
                        }}>
                            <div className="typing-dot" style={{ animationDelay: '0s' }}></div>
                            <div className="typing-dot" style={{ animationDelay: '0.2s' }}></div>
                            <div className="typing-dot" style={{ animationDelay: '0.4s' }}></div>
                        </div>
                        <button
                            className="button button-secondary"
                            style={{ padding: '4px 12px', fontSize: 12 }}
                            onClick={cancelRequest}
                        >
                            ✕ 取消请求
                        </button>
                    </div>
                )}
                <div ref={messagesEndRef} style={{ height: 1 }} />
            </div>

            {/* Input Footer */}
            <div style={{
                padding: 'var(--space-md) var(--space-xl)',
                background: 'var(--bg-secondary)',
                borderTop: '1px solid var(--border)',
                zIndex: 10
            }}>
                <div style={{
                    display: 'flex', alignItems: 'flex-end', gap: 'var(--space-sm)',
                    background: 'var(--bg-primary)', padding: '8px',
                    borderRadius: 24, border: '1px solid var(--border-light)',
                    boxShadow: 'var(--shadow-sm)'
                }}>
                    <textarea
                        className="input"
                        style={{
                            flex: 1, resize: 'none', border: 'none', background: 'transparent',
                            boxShadow: 'none', padding: '8px 12px', minHeight: 40, maxHeight: 120,
                            lineHeight: 1.5
                        }}
                        placeholder="向小研提问... (Enter 发送)"
                        value={input} onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown} rows={1}
                    />
                    <button
                        className="button button-primary"
                        style={{
                            width: 40, height: 40, borderRadius: 20, padding: 0, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: (!input.trim() || loading) ? 0.5 : 1
                        }}
                        onClick={() => sendMessage()}
                        disabled={loading || !input.trim()}
                    >
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
                <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    AI 可能会产生不准确的学习建议，请结合自身实际情况采纳。
                </div>
            </div>

            <style>{`
                .typing-dot {
                    width: 6px; height: 6px; background-color: var(--text-muted); border-radius: 50%;
                    animation: typingPulse 1.4s infinite ease-in-out both;
                }
                @keyframes typingPulse {
                    0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
                    40% { transform: scale(1); opacity: 1; }
                }
                .markdown-body p { margin-bottom: 0.8em; }
                .markdown-body p:last-child { margin-bottom: 0; }
                .markdown-body strong { color: var(--accent); }
                .markdown-body code { background: rgba(0,0,0,0.05); padding: 2px 4px; border-radius: 4px; font-family: monospace; }
                .markdown-body pre { background: var(--bg-primary); padding: 12px; border-radius: 8px; overflow-x: auto; margin: 12px 0; border: 1px solid var(--border); }
            `}</style>
        </div>
    )
}
