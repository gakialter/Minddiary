import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    appendQuickPromptDraft,
    mergeContextKinds,
    type AIContextKind,
    type AIQuickPromptTemplate,
} from '../utils/aiQuickPrompts'
import {
    getReadyAttachmentError,
    revokeAttachmentPreview,
    type AIComposerAttachment,
} from '../utils/aiAttachmentPolicy'
import {
    createReadingAIComposerAttachment,
    readAIComposerFile,
} from '../utils/aiAttachmentReader'

export function useAIComposer() {
    const [input, setInput] = useState('')
    const [contextKinds, setContextKinds] = useState<AIContextKind[]>([])
    const [attachments, setAttachments] = useState<AIComposerAttachment[]>([])
    const [error, setError] = useState<string | null>(null)
    const attachmentsRef = useRef<AIComposerAttachment[]>([])

    useEffect(() => {
        attachmentsRef.current = attachments
    }, [])

    useEffect(() => () => {
        attachmentsRef.current.forEach(revokeAttachmentPreview)
    }, [])

    const applyQuickPrompt = useCallback((template: AIQuickPromptTemplate) => {
        setInput(current => appendQuickPromptDraft(current, template.draft))
        setContextKinds(current => mergeContextKinds(current, template.contextKinds))
        setError(null)
    }, [])

    const removeContextKind = useCallback((kind: AIContextKind) => {
        setContextKinds(current => current.filter(item => item !== kind))
    }, [])

    const addFiles = useCallback(async (files: File[]) => {
        let currentAttachments = attachmentsRef.current
        for (const file of files) {
            const pending = createReadingAIComposerAttachment(file)
            const existingBeforeFile = currentAttachments
            currentAttachments = [...currentAttachments, pending]
            attachmentsRef.current = currentAttachments
            setAttachments(currentAttachments)

            const result = await readAIComposerFile(file, existingBeforeFile, pending.id)
            currentAttachments = currentAttachments.map(attachment => (
                attachment.id === pending.id ? result : attachment
            ))
            attachmentsRef.current = currentAttachments
            setAttachments(currentAttachments)
            if (result.status === 'error') setError(result.error || '附件读取失败。')
        }
    }, [attachments])

    const removeAttachment = useCallback((id: string) => {
        setAttachments(current => {
            const target = current.find(attachment => attachment.id === id)
            if (target) revokeAttachmentPreview(target)
            return current.filter(attachment => attachment.id !== id)
        })
    }, [])

    const clearComposer = useCallback(() => {
        attachments.forEach(revokeAttachmentPreview)
        setInput('')
        setContextKinds([])
        setAttachments([])
        setError(null)
    }, [attachments])

    const validationError = useMemo(() => getReadyAttachmentError(attachments), [attachments])
    const hasReadyAttachment = attachments.some(attachment => attachment.status === 'ready')
    const canSendContent = input.trim().length > 0 || contextKinds.length > 0 || hasReadyAttachment

    return {
        input,
        setInput,
        contextKinds,
        setContextKinds,
        attachments,
        setAttachments,
        error: error || validationError,
        setError,
        applyQuickPrompt,
        removeContextKind,
        addFiles,
        removeAttachment,
        clearComposer,
        canSendContent,
    }
}
