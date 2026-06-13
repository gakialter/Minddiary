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
    }, [attachments])

    const commitAttachments = useCallback((next: AIComposerAttachment[]) => {
        attachmentsRef.current = next
        setAttachments(next)
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
        for (const file of files) {
            const pending = createReadingAIComposerAttachment(file)
            const existingBeforeFile = attachmentsRef.current
            commitAttachments([...existingBeforeFile, pending])

            const result = await readAIComposerFile(file, existingBeforeFile, pending.id)
            const currentAttachments = attachmentsRef.current
            const stillExists = currentAttachments.some(attachment => attachment.id === pending.id)
            if (!stillExists) {
                revokeAttachmentPreview(result)
                continue
            }

            const nextAttachments = currentAttachments.map(attachment => (
                attachment.id === pending.id ? result : attachment
            ))
            commitAttachments(nextAttachments)
            if (result.status === 'error') setError(result.error || '附件读取失败。')
        }
    }, [commitAttachments])

    const removeAttachment = useCallback((id: string) => {
        const currentAttachments = attachmentsRef.current
        const target = currentAttachments.find(attachment => attachment.id === id)
        if (target) revokeAttachmentPreview(target)
        commitAttachments(currentAttachments.filter(attachment => attachment.id !== id))
    }, [commitAttachments])

    const clearComposer = useCallback(() => {
        attachmentsRef.current.forEach(revokeAttachmentPreview)
        setInput('')
        setContextKinds([])
        commitAttachments([])
        setError(null)
    }, [commitAttachments])

    const validationError = useMemo(() => getReadyAttachmentError(attachments), [attachments])
    const hasReadyAttachment = attachments.some(attachment => attachment.status === 'ready')
    const canSendContent = input.trim().length > 0 || contextKinds.length > 0 || hasReadyAttachment

    return {
        input,
        setInput,
        contextKinds,
        setContextKinds,
        attachments,
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
