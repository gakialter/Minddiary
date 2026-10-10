import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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

// Only plain text belongs to the app session. Attachments, context and request
// authorization remain owned by the mounted composer/panel.
export interface AITextDraft { text: string; revision: number }
export interface AITextDraftBinding {
    draft: AITextDraft
    setDraft: Dispatch<SetStateAction<AITextDraft>>
}

export function useAIComposer(draftBinding?: AITextDraftBinding) {
    const [localDraft, setLocalDraft] = useState<AITextDraft>({ text: '', revision: 0 })
    const draft = draftBinding?.draft ?? localDraft
    const setDraft = draftBinding?.setDraft ?? setLocalDraft
    const input = draft.text
    const setInput = useCallback((value: SetStateAction<string>) => {
        setDraft(current => ({
            text: typeof value === 'function' ? value(current.text) : value,
            revision: current.revision + 1,
        }))
    }, [setDraft])
    const [contextKinds, setContextKinds] = useState<AIContextKind[]>([])
    const [attachments, setAttachments] = useState<AIComposerAttachment[]>([])
    const [error, setError] = useState<string | null>(null)
    const attachmentsRef = useRef<AIComposerAttachment[]>([])
    const disposedRef = useRef(false)

    useEffect(() => {
        attachmentsRef.current = attachments
    }, [attachments])

    const commitAttachments = useCallback((next: AIComposerAttachment[]) => {
        attachmentsRef.current = next
        setAttachments(next)
    }, [])

    useEffect(() => {
        disposedRef.current = false
        return () => {
            disposedRef.current = true
            attachmentsRef.current.forEach(revokeAttachmentPreview)
            attachmentsRef.current = []
        }
    }, [])

    const applyQuickPrompt = useCallback((template: AIQuickPromptTemplate) => {
        setInput(current => appendQuickPromptDraft(current, template.draft))
        setContextKinds(current => mergeContextKinds(current, template.contextKinds))
        setError(null)
    }, [setInput])

    const removeContextKind = useCallback((kind: AIContextKind) => {
        setContextKinds(current => current.filter(item => item !== kind))
    }, [])

    const addFiles = useCallback(async (files: File[]) => {
        for (const file of files) {
            if (disposedRef.current) return
            const pending = createReadingAIComposerAttachment(file)
            const existingBeforeFile = attachmentsRef.current
            commitAttachments([...existingBeforeFile, pending])

            const result = await readAIComposerFile(file, existingBeforeFile, pending.id)
            const currentAttachments = attachmentsRef.current
            const stillExists = currentAttachments.some(attachment => attachment.id === pending.id)
            if (disposedRef.current || !stillExists) {
                revokeAttachmentPreview(result)
                continue
            }

            const nextAttachments = currentAttachments.map(attachment => (
                attachment.id === pending.id ? result : attachment
            ))
            commitAttachments(nextAttachments)
            // Reader errors belong to the attachment; derive them from the current list.
            // Removing one file must not leave a stale composer-wide error behind.
        }
    }, [commitAttachments])

    const removeAttachment = useCallback((id: string) => {
        const currentAttachments = attachmentsRef.current
        const target = currentAttachments.find(attachment => attachment.id === id)
        if (target) revokeAttachmentPreview(target)
        commitAttachments(currentAttachments.filter(attachment => attachment.id !== id))
    }, [commitAttachments])

    const isAttachmentSnapshotCurrent = useCallback((snapshot: AIComposerAttachment[]) => (
        snapshot.every(item => attachmentsRef.current.includes(item))
    ), [])

    const clearComposer = useCallback(() => {
        attachmentsRef.current.forEach(revokeAttachmentPreview)
        setInput('')
        setContextKinds([])
        commitAttachments([])
        setError(null)
    }, [commitAttachments, setInput])

    // A response may arrive after the user has started another draft.
    const clearSentDraft = useCallback((sentInput: string, attachmentIds: string[], sentRevision?: number) => {
        const sentIds = new Set(attachmentIds)
        attachmentsRef.current.filter(item => sentIds.has(item.id)).forEach(revokeAttachmentPreview)
        commitAttachments(attachmentsRef.current.filter(item => !sentIds.has(item.id)))
        setDraft(current => current.text === sentInput && (sentRevision === undefined || current.revision === sentRevision)
            ? { text: '', revision: current.revision + 1 } : current)
        setError(null)
    }, [commitAttachments, setDraft])

    const validationError = useMemo(() => getReadyAttachmentError(attachments), [attachments])
    const hasReadyAttachment = attachments.some(attachment => attachment.status === 'ready')
    const canSendContent = input.trim().length > 0 || contextKinds.length > 0 || hasReadyAttachment

    return {
        input,
        inputRevision: draft.revision,
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
        isAttachmentSnapshotCurrent,
        clearComposer,
        clearSentDraft,
        canSendContent,
    }
}
