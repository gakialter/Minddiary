import { useEffect, useState } from 'react'
import { CheckCircle, Loader2, X } from 'lucide-react'
import type { DiaryEntry } from '../types'
import type { TasksContextAPI } from '../types/api'
import {
  settleDiaryTask,
  type DiaryTaskSettlementCandidates,
  type DiaryTaskSettlementResult,
} from '../utils/diaryTaskSettlement'

interface DiaryTaskSettlementPromptProps {
  entry: DiaryEntry
  candidates: DiaryTaskSettlementCandidates
  tasksAPI: Pick<TasksContextAPI, 'find' | 'update'>
  onClose: () => void
  onSettled: (result: DiaryTaskSettlementResult) => void | Promise<void>
}

export default function DiaryTaskSettlementPrompt({
  entry,
  candidates,
  tasksAPI,
  onClose,
  onSettled,
}: DiaryTaskSettlementPromptProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(candidates.tasks[0]?.id ?? null)
  const [settling, setSettling] = useState(false)
  const [result, setResult] = useState<DiaryTaskSettlementResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !settling) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, settling])

  const confirmSettlement = async () => {
    if (settling || selectedTaskId === null) return
    setSettling(true)
    setError(null)
    try {
      const nextResult = await settleDiaryTask({
        entry,
        tasksAPI,
        taskId: selectedTaskId,
      })
      setResult(nextResult)
      if (nextResult.taskSettlementStatus === 'completed') {
        await onSettled(nextResult)
      } else if (nextResult.taskSettlementStatus === 'failed') {
        setError(nextResult.settlementError || '任务更新失败')
      } else if (nextResult.taskSettlementStatus === 'none') {
        setError('可结算的日记任务已不存在或已被处理。')
      }
    } finally {
      setSettling(false)
    }
  }

  const completed = result?.taskSettlementStatus === 'completed'
  const hasMultipleCandidates = candidates.tasks.length > 1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diary-task-settlement-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-modal)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-lg)',
        background: 'rgba(0,0,0,0.42)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        <div className="flex items-start justify-between gap-sm" style={{ padding: 'var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 id="diary-task-settlement-title" style={{ margin: 0, color: 'var(--text-primary)' }}>
              日记已保存
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)', marginTop: 6 }}>
              {completed
                ? '已关联并完成对应的日记任务。'
                : hasMultipleCandidates
                  ? '请选择一个日记任务关联到这篇日记并完成。'
                  : '是否关联并完成这个日记任务？'}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭日记任务结算"
            className="button button-secondary"
            disabled={settling}
            onClick={onClose}
            style={{ padding: 6 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-lg)' }}>
          {completed ? (
            <div className="flex items-center gap-sm" style={{ color: 'var(--success)' }}>
              <CheckCircle size={18} />
              <span>日记已保存，任务已完成</span>
            </div>
          ) : (
            <div className="flex flex-col gap-sm">
              {candidates.tasks.map(task => (
                <label
                  key={task.id}
                  className="flex items-start gap-sm"
                  style={{
                    padding: 'var(--space-sm)',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    background: selectedTaskId === task.id ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-secondary))' : 'var(--bg-secondary)',
                  }}
                >
                  <input
                    type="radio"
                    name="diary-task-settlement"
                    checked={selectedTaskId === task.id}
                    disabled={settling}
                    onChange={() => setSelectedTaskId(task.id)}
                    style={{ marginTop: 4 }}
                  />
                  <span className="min-w-0">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{task.title}</span>
                    <span className="block text-xs" style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                      {task.planned_date} · {task.estimate_minutes}m · {task.status}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 'var(--space-sm)' }}>
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-sm" style={{ padding: 'var(--space-md) var(--space-lg)', borderTop: '1px solid var(--border)' }}>
          {completed ? (
            <button type="button" className="button button-primary" onClick={onClose}>
              完成
            </button>
          ) : (
            <>
              <button type="button" className="button button-secondary" disabled={settling} onClick={onClose}>
                暂不结算
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={settling || selectedTaskId === null}
                onClick={confirmSettlement}
              >
                {settling ? <><Loader2 size={14} className="animate-spin" /> 结算中...</> : '关联并完成'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
