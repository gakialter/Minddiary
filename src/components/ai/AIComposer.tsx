import { useRef, useState } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import AIContextChips from './AIContextChips'
import AIAttachmentList from './AIAttachmentList'
import AIQuickPromptMenu from './AIQuickPromptMenu'
import type { PreviewImage } from '../ImagePreviewModal'
import type { AIComposerAttachment } from '../../utils/aiAttachmentPolicy'
import type { AIContextKind, AIQuickPromptViewModel } from '../../utils/aiQuickPrompts'

interface AIComposerProps {
    input: string
    onInputChange: (value: string) => void
    contextKinds: AIContextKind[]
    attachments: AIComposerAttachment[]
    prompts: AIQuickPromptViewModel[]
    loading: boolean
    error: string | null
    canSend: boolean
    onPromptSelect: (prompt: AIQuickPromptViewModel) => void
    onRemoveContext: (kind: AIContextKind) => void
    onAddFiles: (files: File[]) => void
    onRemoveAttachment: (id: string) => void
    onPreviewAttachment: (image: PreviewImage) => void
    onSend: (currentInput?: string) => void
    onCancel: () => void
}

function getClipboardFiles(event: React.ClipboardEvent<HTMLTextAreaElement>): File[] {
    const files: File[] = []
    Array.from(event.clipboardData.items || []).forEach(item => {
        if (item.kind === 'file') {
            const file = item.getAsFile()
            if (file) files.push(file)
        }
    })
    return files
}

export default function AIComposer({
    input,
    onInputChange,
    contextKinds,
    attachments,
    prompts,
    loading,
    error,
    canSend,
    onPromptSelect,
    onRemoveContext,
    onAddFiles,
    onRemoveAttachment,
    onPreviewAttachment,
    onSend,
    onCancel,
}: AIComposerProps) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const composingRef = useRef(false)
    const [dragging, setDragging] = useState(false)

    const handleFiles = (fileList: FileList | File[]) => {
        const files = Array.from(fileList)
        if (files.length > 0) onAddFiles(files)
    }

    return (
        <div style={{ padding: 'var(--space-md) var(--space-xl)', background: 'transparent', zIndex: 10 }}>
            {prompts.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                    <AIQuickPromptMenu prompts={prompts} onSelect={onPromptSelect} compact />
                </div>
            )}
            <div
                onDragEnter={event => {
                    if (Array.from(event.dataTransfer.types).includes('Files')) setDragging(true)
                }}
                onDragOver={event => {
                    if (Array.from(event.dataTransfer.types).includes('Files')) {
                        event.preventDefault()
                        setDragging(true)
                    }
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={event => {
                    if (!Array.from(event.dataTransfer.types).includes('Files')) return
                    event.preventDefault()
                    setDragging(false)
                    handleFiles(event.dataTransfer.files)
                }}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    background: 'var(--bg-secondary)',
                    padding: 8,
                    borderRadius: 18,
                    border: `1px solid ${dragging ? 'var(--accent)' : 'var(--border-light)'}`,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
                }}
            >
                <AIContextChips contextKinds={contextKinds} onRemove={onRemoveContext} />
                <AIAttachmentList attachments={attachments} onRemove={onRemoveAttachment} onPreview={onPreviewAttachment} />
                {dragging && (
                    <div className="text-xs text-muted" style={{
                        padding: 8,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-tertiary)',
                        textAlign: 'center',
                    }}>
                        松开后添加到本次 AI 请求，不会自动发送。
                    </div>
                )}
                {error && (
                    <div role="alert" style={{ fontSize: 12, color: 'var(--danger, #C65A3A)' }}>
                        {error}
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-sm)' }}>
                    <button
                        type="button"
                        className="button button-secondary"
                        aria-label="添加 AI 附件"
                        title="添加附件"
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <Paperclip size={18} aria-hidden />
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,text/plain,.txt,.md,.csv,.json,.log,application/pdf,.pdf"
                        multiple
                        onChange={event => {
                            handleFiles(event.target.files || [])
                            event.target.value = ''
                        }}
                        style={{ display: 'none' }}
                    />
                    <textarea
                        className="input"
                        style={{
                            flex: 1,
                            resize: 'none',
                            border: 'none',
                            background: 'transparent',
                            boxShadow: 'none',
                            padding: '8px 12px',
                            minHeight: 40,
                            maxHeight: 140,
                            lineHeight: 1.5,
                        }}
                        placeholder="向小研提问... (Enter 发送，Shift+Enter 换行)"
                        value={input}
                        onChange={event => onInputChange(event.target.value)}
                        onCompositionStart={() => { composingRef.current = true }}
                        onCompositionEnd={() => { composingRef.current = false }}
                        onPaste={event => {
                            const files = getClipboardFiles(event)
                            if (files.length > 0) onAddFiles(files)
                        }}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey && !composingRef.current) {
                                event.preventDefault()
                                onSend(event.currentTarget.value)
                            }
                        }}
                        rows={1}
                    />
                    {loading ? (
                        <button
                            type="button"
                            className="button button-secondary"
                            style={{ width: 40, height: 40, borderRadius: 20, padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={onCancel}
                            aria-label="取消 AI 请求"
                            title="取消请求"
                        >
                            <X size={18} aria-hidden />
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="button button-primary"
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 20,
                                padding: 0,
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: canSend ? 1 : 0.5,
                            }}
                            onClick={() => onSend(input)}
                            disabled={!canSend}
                            aria-label="发送 AI 请求"
                            title="发送"
                        >
                            <Send size={18} aria-hidden />
                        </button>
                    )}
                </div>
            </div>
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                附件仅在你点击发送后传给当前配置的 AI 服务商；MindDiary 不会把附件写入数据库或聊天历史。
            </div>
        </div>
    )
}
