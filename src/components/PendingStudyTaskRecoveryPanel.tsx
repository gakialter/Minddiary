import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudyTask } from '../types'
import type { IdempotentAIStudyTaskOperationKind, TasksContextAPI } from '../types/api'
import { executeIdempotentAIStudyTaskCreateRequest } from '../utils/agentStudyTaskActions'
import {
  getPendingStudyTaskCreateRequest,
  loadPendingStudyTaskOperations,
  removePendingStudyTaskOperation,
  type PendingStudyTaskOperation,
} from '../utils/pendingStudyTaskOperations'

interface PendingStudyTaskRecoveryPanelProps {
  operationKind: IdempotentAIStudyTaskOperationKind
  tasksAPI: Pick<TasksContextAPI, 'createIdempotentAIStudyTaskForCurrentDate'>
  revision: number
  onRecovered: (result: {
    operationId: string
    task: StudyTask
    replayed: boolean
  }) => void | Promise<void>
}

export default function PendingStudyTaskRecoveryPanel({
  operationKind,
  tasksAPI,
  revision,
  onRecovered,
}: PendingStudyTaskRecoveryPanelProps) {
  const [operations, setOperations] = useState<PendingStudyTaskOperation[]>([])
  const [recoveringOperationId, setRecoveringOperationId] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const reload = useCallback(() => {
    try {
      const loaded = loadPendingStudyTaskOperations()
      setOperations(loaded.operations.filter(operation => operation.operationKind === operationKind))
      setWarning(loaded.corrupted
        ? `已忽略 ${loaded.removedCount} 条损坏、重复或过期的恢复记录。`
        : null)
    } catch {
      setOperations([])
      setWarning('无法读取本地任务恢复记录；在恢复存储可用前不会重试创建。')
    }
  }, [operationKind])

  useEffect(() => {
    mountedRef.current = true
    reload()
    return () => {
      mountedRef.current = false
    }
  }, [reload, revision])

  const clearOperation = (operationId: string): boolean => {
    try {
      removePendingStudyTaskOperation(operationId)
      return true
    } catch {
      setWarning('任务结果已确定，但本地恢复记录暂时无法清除；稍后可再次检查。')
      return false
    }
  }

  const recover = async (operation: PendingStudyTaskOperation) => {
    if (recoveringOperationId !== null) return
    setRecoveringOperationId(operation.operationId)
    setOutcome(null)
    const result = await executeIdempotentAIStudyTaskCreateRequest(
      getPendingStudyTaskCreateRequest(operation),
      tasksAPI,
    )
    if (!mountedRef.current) return

    if (result.status === 'succeeded') {
      const cleared = clearOperation(operation.operationId)
      if (cleared) {
        setOperations(current => current.filter(item => item.operationId !== operation.operationId))
      }
      setOutcome(result.replayed
        ? '已重放原操作，并恢复此前创建的同一任务。'
        : '原操作已安全完成，任务已恢复。')
      try {
        await onRecovered({
          operationId: result.operationId,
          task: result.task,
          replayed: result.replayed,
        })
      } catch {
        if (mountedRef.current) setWarning('任务已恢复，但界面刷新失败；重新打开页面即可查看。')
      }
    } else if (result.status === 'uncertain') {
      setOutcome(result.error)
    } else if (result.code === 'IDEMPOTENCY_CONFLICT') {
      setOutcome(`操作 ID 冲突，已保留恢复记录且未创建新任务：${result.error}`)
    } else {
      const cleared = clearOperation(operation.operationId)
      if (cleared) {
        setOperations(current => current.filter(item => item.operationId !== operation.operationId))
      }
      setOutcome(cleared
        ? `任务未创建，恢复记录已结束：${result.error}`
        : `任务未创建，结果已确定，但恢复记录尚未清除：${result.error}`)
    }

    if (mountedRef.current) setRecoveringOperationId(null)
  }

  if (operations.length === 0 && warning === null && outcome === null) return null

  return (
    <section
      className="mt-3"
      aria-label="待恢复的 AI 学习任务"
      data-testid={`pending-study-task-recovery-${operationKind}`}
      style={{
        border: '1px solid var(--warning, var(--border))',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-sm)',
        background: 'var(--bg-tertiary)',
      }}
    >
      <strong className="text-sm" style={{ color: 'var(--text-primary)' }}>待检查的任务创建结果</strong>
      <p className="text-xs" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
        MindDiary 不会自动重试。请手动检查；恢复始终复用原操作 ID 和已确认内容。
      </p>
      {warning && <p className="text-xs" role="alert" data-testid="pending-study-task-warning" style={{ color: 'var(--warning)' }}>{warning}</p>}
      {outcome && <p className="text-xs" role="status" data-testid="pending-study-task-outcome" style={{ color: 'var(--text-secondary)' }}>{outcome}</p>}
      {operations.map(operation => (
        <div
          key={operation.operationId}
          className="mt-2 flex flex-wrap items-center justify-between gap-sm"
          data-testid={`pending-study-task-operation-${operation.operationId}`}
        >
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {operation.payload.title} · {operation.payload.planned_date}
            <span style={{ display: 'block', color: 'var(--text-muted)' }}>操作 ID：{operation.operationId}</span>
          </span>
          <button
            type="button"
            className="button button-secondary"
            data-testid={`recover-pending-study-task-${operation.operationId}`}
            disabled={recoveringOperationId !== null}
            onClick={() => { void recover(operation) }}
          >
            {recoveringOperationId === operation.operationId ? '检查中...' : '检查并恢复'}
          </button>
        </div>
      ))}
    </section>
  )
}
