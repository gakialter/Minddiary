import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { revokeAttachmentPreview, type AIComposerAttachment } from '../utils/aiAttachmentPolicy'
import { createReadingAIComposerAttachment, readAIComposerFile } from '../utils/aiAttachmentReader'

interface ComposerSession {
    attachments: AIComposerAttachment[]
    attachmentsRef: React.MutableRefObject<AIComposerAttachment[]>
    commitAttachments: (next: AIComposerAttachment[]) => void
    addFiles: (files: File[]) => Promise<void>
    clearAttachments: () => void
}

const ComposerSessionContext = createContext<ComposerSession | null>(null)

// Owned by one running app instance. No serialization or durable storage.
export function AIComposerSessionProvider({ children }: { children: ReactNode }) {
    const [attachments, setAttachments] = useState<AIComposerAttachment[]>([])
    const attachmentsRef = useRef<AIComposerAttachment[]>([])
    const disposedRef = useRef(false)
    const readEpochRef = useRef(0)
    const commitAttachments = (next: AIComposerAttachment[]) => {
        attachmentsRef.current = next
        setAttachments(next)
    }
    useEffect(() => {
        disposedRef.current = false
        return () => {
            disposedRef.current = true
            attachmentsRef.current.forEach(revokeAttachmentPreview)
            attachmentsRef.current = []
        }
    }, [])
    const addFiles = async (files: File[]) => {
        const epoch = readEpochRef.current
        for (const file of files) {
            if (disposedRef.current || epoch !== readEpochRef.current) return
            const pending = createReadingAIComposerAttachment(file)
            const before = attachmentsRef.current
            commitAttachments([...before, pending])
            const result = await readAIComposerFile(file, before, pending.id)
            if (disposedRef.current || epoch !== readEpochRef.current) {
                revokeAttachmentPreview(result)
                return
            }
            if (!attachmentsRef.current.some(item => item.id === pending.id)) {
                revokeAttachmentPreview(result)
                continue
            }
            commitAttachments(attachmentsRef.current.map(item => item.id === pending.id ? result : item))
        }
    }
    const clearAttachments = () => {
        readEpochRef.current++
        attachmentsRef.current.forEach(revokeAttachmentPreview)
        commitAttachments([])
    }
    return <ComposerSessionContext.Provider value={{ attachments, attachmentsRef, commitAttachments, addFiles, clearAttachments }}>
        {children}
    </ComposerSessionContext.Provider>
}

export const useAIComposerSession = () => useContext(ComposerSessionContext)
