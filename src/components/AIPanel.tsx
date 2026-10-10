import { useMemo, useRef, useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { Bot, Coffee, GraduationCap, PenLine, Search, Target, Trash2 } from 'lucide-react'
import AIComposer from './ai/AIComposer'
import AIMessageBubble, { type AIChatMessage } from './ai/AIMessageBubble'
import AIQuickPromptMenu from './ai/AIQuickPromptMenu'
import ImagePreviewModal, { type PreviewImage } from './ImagePreviewModal'
import { showToast } from './Toast'
import { useAIComposer, type AITextDraftBinding } from '../hooks/useAIComposer'
import { useDiary } from '../contexts/DiaryContext'
import {
    AI_QUICK_PROMPT_TEMPLATES,
    type AIQuickPromptViewModel,
} from '../utils/aiQuickPrompts'
import { resolveAIModelCapabilities } from '../data/aiProviders'
import type { DiaryEntry } from '../types'
import type { EvidenceRequest, FirstSliceSendInput, FirstSliceSendResult, SubjectIdentity } from '../types/api'
import { classifyFirstSlice, formatFirstSliceAnswer, formatSuppliedFocusAnswer, type FocusSlots } from '../utils/aiFirstSlice'

interface AIPanelProps {
    entry: DiaryEntry | null
    textDraft?: AITextDraftBinding
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

type Replay = { requestHandle: string; assistantMessageId: number }
type SubmittedDraft = { input: string; attachmentIds: string[]; revision: number }
type Selection = { requestHandle: string; request: EvidenceRequest; candidates: SubjectIdentity[]; draft?: SubmittedDraft }
type Explanation = { requestHandle: string; partial: boolean }
const unavailableText = '上下文范围已变化或当前功能不可用，请重新发送问题。'

const iconByPromptId: Record<string, ReactElement> = {
    'daily-summary': <PenLine size={18} />,
    'mistake-patterns': <Search size={18} />,
    'quiz-me': <GraduationCap size={18} />,
    'mental-massage': <Coffee size={18} />,
    'sprint-plan': <Target size={18} />,
}

export default function AIPanel({ entry, textDraft }: AIPanelProps) {
    const { settingsData, ai: aiAPI } = useDiary()
    const api = useRef(aiAPI.firstSlice).current
    const composer = useAIComposer(textDraft)
    const [messages, setMessages] = useState<AIChatMessage[]>(() => loadCachedMessages())
    const [loading, setLoading] = useState(false)
    const [preview, setPreview] = useState<PreviewImage | null>(null)
    const [notice, setNotice] = useState('')
    const [selection, setSelection] = useState<Selection | null>(null)
    const [explanation, setExplanation] = useState<Explanation | null>(null)
    const [acceptLimited, setAcceptLimited] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const generationRef = useRef(0)
    const activeGenerationRef = useRef<number | null>(null)
    const lastRequestRef = useRef<Replay | null>(null)
    const replaySettingsRef = useRef(settingsData)
    // Object replacement also catches key changes with identical sanitized values.
    if (replaySettingsRef.current !== settingsData) {
        replaySettingsRef.current = settingsData
        lastRequestRef.current = null
    }
    const clarificationRef = useRef<FocusSlots | undefined>(undefined)
    const sessionRef = useRef<Promise<string | null>>(Promise.resolve(null))

    const openSession = () => api?.openSession({}).then(result => result.kind === 'opened' ? result.session : null).catch(() => null) ?? Promise.resolve(null)
    const closeSession = (session: Promise<string | null>) => {
        void session.then(async token => { if (token) await api?.closeSession({ session: token }) }).catch(() => {})
    }
    useEffect(() => {
        const session = openSession()
        sessionRef.current = session
        return () => { generationRef.current += 1; activeGenerationRef.current = null; closeSession(sessionRef.current) }
    }, [])
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
    useEffect(() => { saveCachedMessages(messages) }, [messages])

    const modelCapabilities = useMemo(() => (
        resolveAIModelCapabilities(settingsData.aiModel, settingsData.aiVisionEnabled, settingsData.aiEndpoint)
    ), [settingsData.aiModel, settingsData.aiVisionEnabled, settingsData.aiEndpoint])

    const hasImageAttachment = composer.attachments.some(attachment => attachment.kind === 'image')
    const modelError = hasImageAttachment && !modelCapabilities.vision
        ? '当前模型不支持图片，请切换支持图片的模型或移除图片。'
        : null
    const composerError = composer.error || modelError
    const canSend = composer.canSendContent && !loading && !composerError

    const quickPrompts: AIQuickPromptViewModel[] = useMemo(() => (
        AI_QUICK_PROMPT_TEMPLATES.map(template => ({
            ...template,
            icon: iconByPromptId[template.id],
            disabledReason: template.id === 'daily-summary' && !entry
                ? '当前日记为空，无法添加到本次问题。'
                : undefined,
        }))
    ), [entry?.id])

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
        if (updateLoading) setLoading(false)
    }

    const clearInteraction = () => {
        lastRequestRef.current = null
        clarificationRef.current = undefined
        setSelection(null)
        setExplanation(null)
        setAcceptLimited(false)
    }
    const clearMessages = () => {
        if (messages.length && window.confirm?.('确认清空 AI 聊天历史和当前草稿吗？清空后无法恢复。') === false) return
        invalidateRequest()
        clearInteraction()
        closeSession(sessionRef.current)
        sessionRef.current = openSession()
        setMessages([])
        composer.clearComposer()
        setNotice('')
    }
    const cancelRequest = async () => {
        const pending = sessionRef.current
        invalidateRequest()
        clearInteraction()
        const generation = generationRef.current
        try {
            const session = await pending
            const result = session && await api?.cancel({ session })
            if (generation !== generationRef.current) return
            setNotice(result && result.kind === 'cancelled'
                ? result.possiblySent ? '已停止采用回复；请求可能已经发送，无法撤回。' : '已取消，尚未发给当前AI服务。'
                : unavailableText)
        } catch { if (generation === generationRef.current) setNotice(unavailableText) }
    }
    const append = (userInput: string, content: string) => {
        const id = Date.now() + Math.random()
        setMessages(current => [...current, { role: 'user', content: userInput, id }, { role: 'assistant', content, id: id + 1 }])
        return id + 1
    }
    const finish = (generation: number) => {
        if (isCurrentRequest(generation)) { activeGenerationRef.current = null; setLoading(false) }
    }
    const resultNotice = (result: FirstSliceSendResult) => result.kind === 'failed' || result.kind === 'discarded'
        ? result.possiblySent ? '回复未采用；请求可能已经发送，无法撤回。' : '请求未发出，请重新发送问题。'
        : unavailableText
    const provider = async (input: FirstSliceSendInput, generation: number, draft?: SubmittedDraft) => {
        const requestSettings = settingsData
        const result = await api!.send(input)
        if (!isCurrentRequest(generation)) return
        if (result.kind !== 'answer') { lastRequestRef.current = null; setNotice(resultNotice(result)); return }
        const assistantMessageId = append(input.userInput, result.content)
        lastRequestRef.current = input.kind === 'chat' && !input.imageDataUrls?.length && !input.textAttachments?.length && requestSettings === replaySettingsRef.current
            ? { requestHandle: result.requestHandle, assistantMessageId } : null
        if (input.kind === 'chat' && draft) composer.clearSentDraft(draft.input, draft.attachmentIds, draft.revision)
    }
    const resolveEvidence = async (session: string, userInput: string, request: EvidenceRequest, generation: number, requestHandle?: string, draft?: SubmittedDraft) => {
        const response = await api!.resolveEvidence(requestHandle ? { session, requestHandle, request } : { session, userInput, request })
        if (!isCurrentRequest(generation)) return
        if (!('result' in response)) { setNotice(unavailableText); return }
        if (response.result.kind === 'ask_user') {
            setSelection({ requestHandle: response.requestHandle, request, candidates: response.result.candidates, draft })
            setNotice('请选择科目。')
        } else if (response.result.kind === 'resolved') {
            const envelope = response.result.envelope
            setSelection(null)
            append(userInput, formatFirstSliceAnswer(envelope))
            if (envelope.sourceCategory === 'focus_comparison' && ['ok', 'empty', 'partial'].includes(envelope.status)) {
                setExplanation({ requestHandle: response.requestHandle, partial: envelope.status === 'partial' })
            }
            if (draft) composer.clearSentDraft(draft.input, draft.attachmentIds, draft.revision)
        } else { setSelection(null); setNotice(unavailableText) }
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
        const draftInput = inputOverride ?? composer.input
        const readyAttachments = composer.attachments.filter(attachment => attachment.status === 'ready')
        const submittedDraft: SubmittedDraft = { input: draftInput, attachmentIds: readyAttachments.map(attachment => attachment.id), revision: composer.inputRevision }
        const hasAttachment = composer.attachments.length > 0
        const userInput = draftInput.trim() || (readyAttachments.some(attachment => attachment.kind !== 'image')
            ? '请根据我附加的文件文字概括主要内容。'
            : hasImageAttachment ? '请分析我附加的图片。' : '')
        const classified = classifyFirstSlice(userInput, clarificationRef.current)
        // Explicit draft images are user-supplied material, never a local-record lookup.
        // Restriction intent still takes precedence over any attachments.
        const gate = hasAttachment && classified.kind !== 'restriction' && classified.kind !== 'blocked'
            ? { kind: 'chat' as const } : classified
        // Refusal always reaches main, including while a Provider response is pending.
        if (gate.kind === 'restriction' || gate.kind === 'blocked') {
            invalidateRequest()
            clearInteraction()
            const generation = beginRequest()
            try {
                const session = await sessionRef.current
                if (!isCurrentRequest(generation)) return
                if (!session || !api) { setNotice(unavailableText); return }
                if (gate.kind === 'blocked') {
                    // Ambiguous refusals cannot leave an older request eligible for adoption.
                    await api.cancel({ session })
                    if (isCurrentRequest(generation)) setNotice('请说明限制范围；本次没有继续发送。')
                    return
                }
                const result = await api.restrict({ session, userInput, intent: gate.intent })
                if (!isCurrentRequest(generation)) return
                setNotice(result.kind === 'restricted' && result.applied
                    ? gate.intent.lifetime === 'durable_preference' && !result.durableSaved
                        ? '当前限制已生效；长期偏好未保存。'
                        : '限制生效；旧回复作废，已发请求无法撤回。'
                    : '限制未能确认；本次未继续发送，请明确范围后重试。')
                if (result.kind === 'restricted' && result.applied) composer.clearSentDraft(draftInput, [], submittedDraft.revision)
            } catch { if (isCurrentRequest(generation)) setNotice(unavailableText) }
            finally { finish(generation) }
            return
        }
        if (loading || hasActiveRequest()) return
        setNotice('')
        if (composer.contextKinds.length) {
            setExplanation(null)
            setNotice('当前受控对话暂不支持所选上下文或附件，请移除后再发送；这些材料尚未发送。')
            return
        }
        if (!userInput.trim() || composer.error || modelError) return
        const imageDataUrls = readyAttachments.filter(attachment => attachment.kind === 'image').map(attachment => attachment.dataUrl!)
        const textAttachments = readyAttachments.filter(attachment => attachment.kind !== 'image').map(attachment => ({
            kind: attachment.kind as 'pdf' | 'text-file', name: attachment.name, text: attachment.extractedText!,
        }))
        clearInteraction()
        if (gate.kind === 'clarify') {
            clarificationRef.current = gate.slots
            const prompts = { meaning: '请先确认含义：记录学习时间', subject: '请填写科目，例如：科目：数学', periodA: '请填写 A 的绝对日期，例如 A：2026-09-07..2026-09-13', periodB: '请填写 B 的绝对日期，例如 B：2026-09-14..2026-09-20' }
            append(userInput, gate.missing.map(key => prompts[key]).join('；'))
            composer.clearComposer()
            return
        }
        if (gate.kind === 'supplied') { append(userInput, formatSuppliedFocusAnswer(gate.evidence)); composer.clearComposer(); return }
        if (gate.kind === 'unsupported') { setNotice('当前无法按此问题核对本机记录。请明确科目及两段绝对日期，或到对应页面查看。'); return }
        const generation = beginRequest()
        try {
            const session = await sessionRef.current
            if (!isCurrentRequest(generation)) return
            if (!session || !api) { setNotice(unavailableText); return }
            if (!composer.isAttachmentSnapshotCurrent(readyAttachments)) {
                setNotice('附件已变化；请检查草稿后重新发送。')
                return
            }
            if (gate.kind === 'evidence') await resolveEvidence(session, userInput, gate.request, generation, undefined, submittedDraft)
            else await provider({ session, kind: 'chat', userInput,
                ...(imageDataUrls.length ? { imageDataUrls } : {}),
                ...(textAttachments.length ? { textAttachments } : {}),
            }, generation, submittedDraft)
        } catch { if (isCurrentRequest(generation)) setNotice(unavailableText) }
        finally { finish(generation) }
    }
    const chooseSubject = async (id: number) => {
        const pending = selection
        if (!pending || hasActiveRequest()) return
        const generation = beginRequest()
        setSelection(null)
        try {
            const session = await sessionRef.current
            if (!isCurrentRequest(generation)) return
            if (!session || !api) { setNotice(unavailableText); return }
            await resolveEvidence(session, '核对所选科目的记录', { ...pending.request, subject: { by: 'id', id } }, generation, pending.requestHandle, pending.draft)
        } catch { if (isCurrentRequest(generation)) setNotice(unavailableText) }
        finally { finish(generation) }
    }
    const explain = async () => {
        const pending = explanation
        if (!pending || hasActiveRequest() || (pending.partial && !acceptLimited)) return
        setExplanation(null)
        const generation = beginRequest()
        try {
            const session = await sessionRef.current
            if (!isCurrentRequest(generation)) return
            if (!session || !api) { setNotice(unavailableText); return }
            await provider({ session, kind: 'focus_explanation', requestHandle: pending.requestHandle, userInput: '请根据这份有限的记录学习时间摘要解释，保留未知与局限。', share: true, acceptLimited }, generation)
        } catch { if (isCurrentRequest(generation)) setNotice(unavailableText) }
        finally { finish(generation) }
    }
    const regenerateLastAnswer = async () => {
        const snapshot = lastRequestRef.current
        if (!snapshot || loading || hasActiveRequest()) return
        const generation = beginRequest()
        try {
            const session = await sessionRef.current
            if (!isCurrentRequest(generation)) return
            if (!session || !api) { lastRequestRef.current = null; setNotice(unavailableText); return }
            const result = await api.regenerate({ session, requestHandle: snapshot.requestHandle })
            if (!isCurrentRequest(generation)) return
            if (result.kind !== 'answer') { lastRequestRef.current = null; setNotice(resultNotice(result)); return }
            setMessages(current => current.map(message => message.id === snapshot.assistantMessageId ? { ...message, content: result.content } : message))
        } catch { if (isCurrentRequest(generation)) { lastRequestRef.current = null; setNotice(unavailableText) } }
        finally { finish(generation) }
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
                        <span className="workspace-help" role="status">{loading ? '正在生成回复…' : '学习助手'}</span>
                    </div>
                </div>
                <button className="button button-secondary" style={{ padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }} onClick={clearMessages}>
                    <Trash2 size={14} /> 清空历史和草稿
                </button>
            </div>

            <div className="ai-workspace__messages" role="region" aria-label="对话记录" tabIndex={0}>
                {messages.length === 0 && (
                    <div className="workspace-empty ai-workspace__empty">
                        <div className="workspace-empty__icon">
                            <Bot size={28} />
                        </div>
                        <h3>学习上有问题，随时问小研。</h3>
                        <p className="text-muted">
                            选后先编辑问题和资料，再自行发送。
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

            {notice && <p role="status" className="workspace-help">{notice}</p>}
            {selection && <div role="group" aria-label="选择科目">
                {selection.candidates.map(candidate => <button className="button button-secondary" key={candidate.id} onClick={() => void chooseSubject(candidate.id)}>{candidate.name}（{candidate.id}）</button>)}
            </div>}
            {explanation && <div role="group" aria-label="发送摘要给学习助手解释">
                <p className="workspace-help">可发送上方摘要给当前AI；也可只看本机。</p>
                {explanation.partial && <label><input type="checkbox" checked={acceptLimited} onChange={event => setAcceptLimited(event.target.checked)} />部分记录不可用；我同意发送有限摘要</label>}
                <button className="button button-secondary" disabled={loading || (explanation.partial && !acceptLimited)} onClick={() => void explain()}>发送摘要给 AI</button>
                <button className="button button-secondary" onClick={() => setExplanation(null)}>仅看本机结果</button>
            </div>}
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
