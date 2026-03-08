import { useState, useEffect, useCallback } from 'react'

// Toast context - simple global toast system
let toastListeners = []

export function showToast(message, type = 'success', duration = 3000) {
    const id = Date.now()
    const toast = { id, message, type, duration }
    toastListeners.forEach(fn => fn(toast))
    return id
}

export function ToastContainer() {
    const [toasts, setToasts] = useState([])

    useEffect(() => {
        const listener = (toast) => {
            setToasts(prev => [...prev, toast])
        }
        toastListeners.push(listener)
        return () => {
            toastListeners = toastListeners.filter(l => l !== listener)
        }
    }, [])

    const dismiss = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    if (toasts.length === 0) return null

    return (
        <div style={{
            position: 'fixed', bottom: 24, right: 24,
            display: 'flex', flexDirection: 'column', gap: 8,
            zIndex: 10000, pointerEvents: 'none',
        }}>
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} dismiss={dismiss} />
            ))}
        </div>
    )
}

function ToastItem({ toast, dismiss }) {
    const [isLeaving, setIsLeaving] = useState(false)

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsLeaving(true)
            setTimeout(() => dismiss(toast.id), 300) // Match CSS animation duration
        }, toast.duration)
        return () => clearTimeout(timer)
    }, [toast, dismiss])

    const handleDismiss = () => {
        setIsLeaving(true)
        setTimeout(() => dismiss(toast.id), 300)
    }

    return (
        <div
            onClick={handleDismiss}
            style={{
                pointerEvents: 'auto',
                padding: '14px 24px',
                borderRadius: 'var(--radius)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 12,
                fontSize: 15, fontWeight: 500,
                animation: isLeaving
                    ? 'toast-out 0.3s cubic-bezier(0.4, 0, 1, 1) forwards'
                    : 'toast-in 0.4s cubic-bezier(0.2, 0, 0, 1) forwards',
                ...(toast.type === 'success' ? {
                    background: 'rgba(52, 199, 89, 0.15)',
                    border: '1px solid rgba(52, 199, 89, 0.3)',
                    color: 'var(--text-primary)',
                } : toast.type === 'error' ? {
                    background: 'rgba(255, 59, 48, 0.15)',
                    border: '1px solid rgba(255, 59, 48, 0.3)',
                    color: 'var(--text-primary)',
                } : {
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                }),
            }}
        >
            <span style={{ fontSize: 18 }}>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}</span>
            <span>{toast.message}</span>
        </div>
    )
}
