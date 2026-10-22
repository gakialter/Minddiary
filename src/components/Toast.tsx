import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface ToastData {
    id: number
    message: string
    type: ToastType
    duration: number
}

type ToastListener = (toast: ToastData) => void

// Toast context - simple global toast system
let toastListeners: ToastListener[] = []
let lastToastId = 0

export function showToast(message: string, type: ToastType = 'success', duration: number = 3000): number {
    const id = Math.max(Date.now(), lastToastId + 1)
    lastToastId = id
    const toast: ToastData = { id, message, type, duration }
    toastListeners.forEach(fn => fn(toast))
    return id
}

export function ToastContainer() {
    const [toasts, setToasts] = useState<ToastData[]>([])

    useEffect(() => {
        const listener: ToastListener = (toast) => {
            setToasts(prev => [...prev, toast])
        }
        toastListeners.push(listener)
        return () => {
            toastListeners = toastListeners.filter(l => l !== listener)
        }
    }, [])

    const dismiss = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    return createPortal(
        <>
            {/* Persistent regions announce additions once; exits and dismiss controls stay silent. */}
            <div data-toast-region="" className="sr-only" role="status" aria-atomic="false" aria-relevant="additions">
                {toasts.filter(toast => toast.type !== 'error').map(toast => <div key={toast.id}>{toast.message}</div>)}
            </div>
            <div data-toast-region="" className="sr-only" role="alert" aria-atomic="false" aria-relevant="additions">
                {toasts.filter(toast => toast.type === 'error').map(toast => <div key={toast.id}>{toast.message}</div>)}
            </div>
            <div data-toast-region="" className="toast-container" style={{
                position: 'fixed', bottom: 24, right: 24,
                display: 'flex', flexDirection: 'column', gap: 8,
                zIndex: 'var(--z-toast)', pointerEvents: 'none',
            }}>
                {toasts.map(toast => (
                    <ToastItem key={toast.id} toast={toast} dismiss={dismiss} />
                ))}
            </div>
        </>,
        document.body,
    )
}

interface ToastItemProps {
    toast: ToastData
    dismiss: (id: number) => void
}

function ToastItem({ toast, dismiss }: ToastItemProps) {
    const [isLeaving, setIsLeaving] = useState(false)
    const itemRef = useRef<HTMLDivElement>(null)
    const closingRef = useRef(false)
    const dismissedRef = useRef(false)

    const handleDismiss = useCallback(() => {
        if (closingRef.current) return
        closingRef.current = true
        setIsLeaving(true)
    }, [])

    const finishDismiss = useCallback(() => {
        if (dismissedRef.current) return
        dismissedRef.current = true
        dismiss(toast.id)
    }, [dismiss, toast.id])

    useEffect(() => {
        if (isLeaving) return
        const timer = setTimeout(handleDismiss, toast.duration)
        return () => clearTimeout(timer)
    }, [toast.duration, isLeaving, handleDismiss])

    useEffect(() => {
        if (!isLeaving || !itemRef.current) return
        // CSS is the timing authority, including the reduced-motion variant.
        // The fallback also removes items closed before an entrance could paint.
        const duration = getComputedStyle(itemRef.current).transitionDuration
        const milliseconds = (parseFloat(duration) || 0) * (duration.endsWith('ms') ? 1 : 1000)
        const timer = setTimeout(finishDismiss, milliseconds)
        return () => clearTimeout(timer)
    }, [isLeaving, finishDismiss])

    return (
        <div
            ref={itemRef}
            className={`toast toast--${toast.type}`}
            data-leaving={isLeaving}
            onClick={handleDismiss}
            onTransitionEnd={event => {
                if (isLeaving && event.target === event.currentTarget && event.propertyName === 'opacity') finishDismiss()
            }}
        >
            {toast.type === 'success' ? <CheckCircle size={18} aria-hidden="true" /> : toast.type === 'error' ? <XCircle size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}
            <span className="toast__message" aria-hidden="true">{toast.message}</span>
            <button type="button" className="toast__dismiss" aria-label={`关闭通知：${toast.message}`}>
                <X size={14} aria-hidden="true" />
            </button>
        </div>
    )
}
