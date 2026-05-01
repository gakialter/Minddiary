import { useEffect, useState } from 'react'
import { Coffee, Zap, X } from 'lucide-react'

interface PomodoroAlertProps {
  visible: boolean
  isWorkComplete: boolean   // true = work done (show break msg), false = break done
  duration: number          // in minutes
  todayTotal: number        // in minutes
  onClose: () => void
}

export default function PomodoroAlert({ visible, isWorkComplete, duration, todayTotal, onClose }: PomodoroAlertProps) {
  const [autoCloseTimer, setAutoCloseTimer] = useState(15)

  // Auto-close after 15 seconds
  useEffect(() => {
    if (!visible) return
    setAutoCloseTimer(15)
    const interval = setInterval(() => {
      setAutoCloseTimer(prev => prev - 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [visible])

  useEffect(() => {
    if (visible && autoCloseTimer <= 0) {
      onClose()
    }
  }, [autoCloseTimer, visible, onClose])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'page-fade-in 0.3s ease forwards',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-2xl)',
          textAlign: 'center',
          maxWidth: 400,
          width: '90%',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border)',
          animation: 'pomodoro-alert-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 12,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex', padding: 4,
          }}
        >
          <X size={16} />
        </button>

        {/* Icon */}
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: isWorkComplete
            ? 'var(--color-state-success)'
            : 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto var(--space-lg)',
          boxShadow: isWorkComplete
            ? '0 8px 24px rgba(47, 143, 107, 0.35)'
            : '0 8px 24px rgba(15, 118, 110, 0.35)',
          animation: 'pomodoro-pulse 2s ease-in-out infinite',
        }}>
          {isWorkComplete ? <Coffee size={32} color="white" /> : <Zap size={32} color="white" />}
        </div>

        {/* Title */}
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 'var(--space-sm)', color: 'var(--text-primary)' }}>
          {isWorkComplete ? '专注完成！' : '休息结束！'}
        </h2>

        {/* Subtitle */}
        <p className="text-sm text-secondary" style={{ marginBottom: 'var(--space-lg)', lineHeight: 1.6 }}>
          {isWorkComplete
            ? '干得漂亮，休息几分钟再继续吧～'
            : '精力充沛，继续加油！'
          }
        </p>

        {/* Stats */}
        <div className="flex gap-md" style={{ justifyContent: 'center', marginBottom: 'var(--space-lg)' }}>
          <div style={{
            background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-sm) var(--space-md)', minWidth: 90,
          }}>
            <div className="text-xs text-muted" style={{ marginBottom: 2 }}>本次专注</div>
            <div className="font-bold" style={{ fontSize: 18, color: 'var(--accent)' }}>{duration}min</div>
          </div>
          <div style={{
            background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-sm) var(--space-md)', minWidth: 90,
          }}>
            <div className="text-xs text-muted" style={{ marginBottom: 2 }}>今日累计</div>
            <div className="font-bold" style={{ fontSize: 18, color: 'var(--color-state-success)' }}>
              {Math.floor(todayTotal / 60)}h {todayTotal % 60}m
            </div>
          </div>
        </div>

        {/* Action button */}
        <button
          className="button button-primary w-full"
          onClick={onClose}
          style={{
            height: 44, borderRadius: 22, fontSize: 15, fontWeight: 600,
          }}
        >
          {isWorkComplete ? '开始休息' : '继续专注'} ({autoCloseTimer}s)
        </button>
      </div>

      <style>{`
        @keyframes pomodoro-alert-pop {
          0% { opacity: 0; transform: scale(0.85) translateY(20px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pomodoro-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  )
}
