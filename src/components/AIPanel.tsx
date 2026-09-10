import { useMemo, useRef, useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { Bot, Coffee, GraduationCap, PenLine, Search, Target, Trash2 } from 'lucide-react'
import AIComposer from './ai/AIComposer'
import AIMessageBubble, { type AIChatMessage } from './ai/AIMessageBubble'
import AIQuickPromptMenu from './ai/AIQuickPromptMenu'
import ImagePreviewModal, { type PreviewImage } from './ImagePreviewModal'
import { showToast } from './Toast'
import { useAIComposer } from '../hooks/useAIComposer'
import { useDiary } from '../contexts/DiaryContext'
import {
    AI_QUICK_PROMPT_TEMPLATES,
    type AIQuickPromptViewModel,
} from '../utils/aiQuickPrompts'
import { buildAIContextSections, type AIContextSection } from '../utils/aiContextBuilder'
import { attachmentToMeta, revokeAttachmentPreview, type AIComposerAttachment } from '../utils/aiAttachmentPolicy'
import { buildAIConversation } from '../utils/aiConversationBuilder'
import { resolveAIModelCapabilities } from '../data/aiProviders'
import type { AIMessage, DiaryEntry } from '../types'

interface AIPanelProps {
    entry: DiaryEntry | null
}

const AI_CHAT_HISTORY_STORAGE_KEY = 'minddiary.ai.chatHistory'

const isAttachmentMeta = (value: unknown) => {
    if (!value || typeof value !== 'object') return false
    const attachment = value as Record<string, unknown>
    return (
        (attachment.kind === 'image' || attachment.kind === 'text-file' || attachment.kind === 'pdf') &&
        typeof attachment.name === 'string' &&
        typeof attachment.mimeType === 'string' &&
        typeof attachment.size === 'number'
    )
}

const isChatMessage = (value: unknown): value is AIChatMessage => {
    if (!value || typeof value !== 'object') return false
    const message = value as Partial<AIChatMessage>
    return (
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        typeof message.id === 'number' &&
        Number.isFinite(message.id) &&
        (message.contextLabels === undefined || (
            Array.isArray(message.contextLabels) &&
            message.contextLabels.every(label => typeof label === 'string')
        )) &&
        (message.attachments === undefined || (
            Array.isArray(message.attachments) &&
            message.attachments.every(isAttachmentMeta)
        ))
    )
}

const loadCachedMessages = (): AIChatMessage[] => {
    try {
        const raw = localStorage.getItem(AI_CHAT_HISTORY_STORAGE_KEY)
        if (!raw) return []
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter(isChatMessage).map(message => ({
            ...message,
            attachments: message.attachments?.map(attachment => ({ ...attachment, reusable: false })),
        }))
    } catch {
        localStorage.removeItem(AI_CHAT_HISTORY_STORAGE_KEY)
        return []
    }
}

const saveCachedMessages = (messages: AIChatMessage[]) => {
    try {
        if (messages.length === 0) {
            localStorage.removeItem(AI_CHAT_HISTORY_STORAGE_KEY)
            return
        }
        const safeMessages = messages.map(message => ({
            role: message.role,
            content: message.content,
            id: message.id,
            ...(message.contextLabels?.length ? { contextLabels: message.contextLabels } : {}),
            ...(message.attachments?.length ? {
                attachments: message.attachments.map(attachment => ({
                    kind: attachment.kind,
                    name: attachment.name,
                    mimeType: attachment.mimeType,
                    size: attachment.size,
                    reusable: false,
                })),
            } : {}),
        }))
        localStorage.setItem(AI_CHAT_HISTORY_STORAGE_KEY, JSON.stringify(safeMessages))
    } catch {
        // Storage failures should not break the AI assistant UI.
    }
}

interface LastRequestSnapshot {
    requestMessages: AIMessage[]
    assistantMessageId: number
    attachments: AIComposerAttachment[]
}

interface EntryRequestContext {
    entryId: number | null
    entryDate: string
    entryContent: string
}

const getEntryRequestContext = (entry: DiaryEntry | null): EntryRequestContext => ({
    entryId: entry?.id ?? null,
    entryDate: entry?.date ?? '',
    entryContent: entry?.content ?? '',
})

const isSameEntryRequestContext = (a: EntryRequestContext, b: EntryRequestContext) => (
    a.entryId === b.entryId &&
    a.entryDate === b.entryDate &&
    a.entryContent === b.entryContent
)

const iconByPromptId: Record<string, ReactElement> = {
    'daily-summary': <PenLine size={18} />,
    'mistake-patterns': <Search size={18} />,
    'quiz-me': <GraduationCap size={18} />,
    'mental-massage': <Coffee size={18} />,
    'sprint-plan': <Target size={18} />,
}

export default function AIPanel({ entry }: AIPanelProps) {
    const {
        settingsData,
        ai: aiAPI,
        entries,
        mistakes,
        subjects,
        subjectChapters,
        tasks,
        pomodoro,
    } = useDiary()
    const composer = useAIComposer()
    const [messages, setMessages] = useState<AIChatMessage[]>(() => loadCachedMessages())
    const [loading, setLoading] = useState(false)
    const [preview, setPreview] = useState<PreviewImage | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const generationRef = useRef(0)
    const activeGenerationRef = useRef<number | null>(null)
    const entrySensitiveGenerationRef = useRef<number | null>(null)
    const lastRequestRef = useRef<LastRequestSnapshot | null>(null)
    const entryRequestContextRef = useRef(getEntryRequestContext(entry))

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, loading])

    useEffect(() => {
        saveCachedMessages(messages)
    }, [messages])

    useEffect(() => () => {
        lastRequestRef.current?.attachments.forEach(revokeAttachmentPreview)
    }, [])

    useEffect(() => {
        const nextContext = getEntryRequestContext(entry)
        if (!isSameEntryRequestContext(entryRequestContextRef.current, nextContext)) {
            entryRequestContextRef.current = nextContext
            if (
                activeGenerationRef.current !== null &&
                entrySensitiveGenerationRef.current === activeGenerationRef.current
            ) {
                invalidateRequest()
            }
        }
    }, [entry?.id, entry?.date, entry?.content])

    const modelCapabilities = useMemo(() => (
        resolveAIModelCapabilities(settingsData.aiModel, settingsData.aiVisionEnabled)
    ), [settingsData.aiModel, settingsData.aiVisionEnabled])

    const hasImageAttachment = composer.attachments.some(attachment => attachment.kind === 'image')
    const modelError = hasImageAttachment && !modelCapabilities.vision
        ? '当前模型未声明支持图片输入，请切换视觉模型或在自定义模型设置中确认图片能力。'
        : null
    const composerError = composer.error || modelError
    const canSend = composer.canSendContent && !loading && !composerError

    const quickPrompts: AIQuickPromptViewModel[] = useMemo(() => (
        AI_QUICK_PROMPT_TEMPLATES.map(template => ({
            ...template,
            icon: iconByPromptId[template.id],
            disabledReason: template.id === 'daily-summary' && !entry?.content?.trim()
                ? '当前日记为空，无法附加今日日记上下文。'
                : undefined,
        }))
    ), [entry?.content])

    const beginRequest = () => {
        const generation = ++generationRef.current
        activeGenerationRef.current = generation
        setLoading(true)
        return generation
    }

    const isCurrentRequest = (generation: number) => (
        generationRef.current === generation && activeGenerationRef.current === generation
    )

    const hasActiveRequest = () => (
        activeGenerationRef.current !== null && generationRef.current === activeGenerationRef.current
    )

    const invalidateRequest = (updateLoading = true) => {
        generationRef.current += 1
        activeGenerationRef.current = null
        entrySensitiveGenerationRef.current = null
        if (updateLoading) setLoading(false)
    }

    const clearMessages = () => {
        const confirmed = messages.length > 0
            ? window.confirm?.('确认清空 AI 聊天历史吗？附件内容不会保留，清空后无法恢复。')
            : true
        if (confirmed === false) return
        invalidateRequest()
        lastRequestRef.current?.attachments.forEach(revokeAttachmentPreview)
        lastRequestRef.current = null
        setMessages([])
    }

    const cancelRequest = () => {
        invalidateRequest()
    }

    const copyMessage = async (content: string) => {
        try {
            const writeText = window.api.clipboard?.writeText ?? navigator.clipboard.writeText.bind(navigator.clipboard)
            await writeText(content)
            showToast('已复制', 'success')
        } catch {
            showToast('复制失败', 'error')
        }
    }

    const sendMessage = async (inputOverride?: string) => {
        if (loading || hasActiveRequest()) return
        const readyAttachments = composer.attachments.filter(attachment => attachment.status === 'ready')
        const userInput = inputOverride ?? composer.input
        const hasSendableContent = (
            userInput.trim().length > 0 ||
            composer.contextKinds.length > 0 ||
            readyAttachments.length > 0
        )
        if (!hasSendableContent || composer.error) return
        if (modelError) {
            composer.setError(modelError)
            return
        }

        const generation = beginRequest()
        entrySensitiveGenerationRef.current = composer.contextKinds.includes('current-diary') ? generation : null
        try {
            const contextSections: AIContextSection[] = await buildAIContextSections(composer.contextKinds, {
                entry,
                settingsData,
                entries,
                mistakes,
                subjects,
                subjectChapters,
                tasks,
                pomodoro,
            })
            if (!isCurrentRequest(generation)) return

            const conversation = buildAIConversation({
                history: messages,
                userInput,
                selectedContextKinds: composer.contextKinds,
                contextSections,
                attachments: readyAttachments,
            })
            const result = await aiAPI.chat(conversation.messages)
            if (!isCurrentRequest(generation)) return
            if (result.error) {
                composer.setError(result.error)
                showToast(result.error.split('\n')[0]!, 'error')
                return
            }

            const userMessageId = Date.now() + Math.random()
            const assistantMessageId = Date.now() + Math.random() + 1
            const nextMessages: AIChatMessage[] = [
                ...messages,
                {
                    role: 'user',
                    content: conversation.visibleUserText,
                    id: userMessageId,
                    contextLabels: conversation.contextLabels,
                    attachments: readyAttachments.map(attachmentToMeta),
                },
                {
                    role: 'assistant',
                    content: result.content || '',
                    id: assistantMessageId,
                },
            ]
            lastRequestRef.current?.attachments.forEach(revokeAttachmentPreview)
            lastRequestRef.current = {
                requestMessages: conversation.messages,
                assistantMessageId,
                attachments: readyAttachments,
            }
            setMessages(nextMessages)
            composer.clearComposer()
        } catch (error) {
            if (!isCurrentRequest(generation)) return
            const message = error instanceof Error ? error.message : String(error)
            composer.setError(message)
            showToast(message.split('\n')[0] || 'AI 请求失败', 'error')
        } finally {
            if (isCurrentRequest(generation)) {
                activeGenerationRef.current = null
                entrySensitiveGenerationRef.current = null
                setLoading(false)
            }
        }
    }

    const regenerateLastAnswer = async () => {
        const snapshot = lastRequestRef.current
        if (!snapshot || loading || hasActiveRequest()) return
        const hasLostAttachment = snapshot.attachments.some(attachment => (
            attachment.kind === 'image' ? !attachment.dataUrl : !attachment.extractedText
        ))
        if (hasLostAttachment) {
            showToast('附件内容未持久化，无法重新生成带附件的回复。', 'error')
            return
        }

        const generation = beginRequest()
        try {
            const result = await aiAPI.chat(snapshot.requestMessages)
            if (!isCurrentRequest(generation)) return
            if (result.error) {
                showToast(result.error.split('\n')[0]!, 'error')
                return
            }
            setMessages(current => current.map(message => (
                message.id === snapshot.assistantMessageId
                    ? { ...message, content: result.content || '' }
                    : message
            )))
        } finally {
            if (isCurrentRequest(generation)) {
                activeGenerationRef.current = null
                setLoading(false)
            }
        }
    }

    return (
        <div className="ai-workspace">
            <div className="ai-workspace__header">
                <div className="flex items-center gap-sm">
                    <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-control)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', color: 'var(--accent)' }}>
                        <Bot size={20} />
                    </div>
                    <div>
                        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>小研</h2>
                        <span className="workspace-help" role="status">{loading ? '正在生成回复…' : 'AI 学习助手'}</span>
                    </div>
                </div>
                <button className="button button-secondary" style={{ padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }} onClick={clearMessages}>
                    <Trash2 size={14} /> 清空历史
                </button>
            </div>

            <div className="ai-workspace__messages" role="region" aria-label="对话消息" tabIndex={0}>
                {messages.length === 0 && (
                    <div className="workspace-empty ai-workspace__empty">
                        <div className="workspace-empty__icon">
                            <Bot size={28} />
                        </div>
                        <h3>我是你的专属考研智囊</h3>
                        <p className="text-muted">
                            快捷提示会先进入草稿，你可以编辑请求、移除上下文，再主动发送给 AI。
                        </p>
                        <AIQuickPromptMenu prompts={quickPrompts} onSelect={composer.applyQuickPrompt} />
                    </div>
                )}

                {messages.map(message => (
                    <AIMessageBubble
                        key={message.id}
                        message={message}
                        onCopy={copyMessage}
                        onRegenerate={
                            message.role === 'assistant' && lastRequestRef.current?.assistantMessageId === message.id
                                ? regenerateLastAnswer
                                : undefined
                        }
                    />
                ))}

                {loading && (
                    <div className="ai-workspace__loading" aria-hidden="true">
                        <span>小研正在生成回复…</span>
                        <div style={{
                            padding: '16px 20px',
                            borderRadius: 'var(--radius-object)',
                            borderTopLeftRadius: 4,
                            background: 'var(--bg-tertiary)',
                            display: 'flex',
                            gap: 6,
                            alignItems: 'center',
                        }}>
                            <div className="typing-dot" aria-hidden="true" style={{ animationDelay: '0s' }}></div>
                            <div className="typing-dot" aria-hidden="true" style={{ animationDelay: '0.2s' }}></div>
                            <div className="typing-dot" aria-hidden="true" style={{ animationDelay: '0.4s' }}></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} style={{ height: 1 }} />
            </div>

            <AIComposer
                input={composer.input}
                onInputChange={composer.setInput}
                contextKinds={composer.contextKinds}
                attachments={composer.attachments}
                prompts={messages.length > 0 ? quickPrompts : []}
                loading={loading}
                error={composerError}
                canSend={Boolean(canSend)}
                onPromptSelect={composer.applyQuickPrompt}
                onRemoveContext={composer.removeContextKind}
                onAddFiles={files => { void composer.addFiles(files) }}
                onRemoveAttachment={composer.removeAttachment}
                onPreviewAttachment={setPreview}
                onSend={sendMessage}
                onCancel={cancelRequest}
            />

            <ImagePreviewModal image={preview} onClose={() => setPreview(null)} />

            <style>{`
                .typing-dot {
                    width: 6px; height: 6px; background-color: var(--text-muted); border-radius: 50%;
                    animation: typingPulse 1.4s infinite ease-in-out both;
                }
                @keyframes typingPulse {
                    0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
                    40% { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    )
}
