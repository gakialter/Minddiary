import { useCallback, useEffect, useRef, useState } from 'react'
import type { IdempotentAIStudyTaskOperationKind, TasksContextAPI } from '../types/api'
import {
  executeIdempotentAIStudyTaskCreateRequest,
} from '../utils/agentStudyTaskActions'
import {
  observeStudyTaskActionExecutionResult,
  type PlanningStudyTaskActionExecutionObservation,
} from '../utils/planningSessionExplainability'
import {
  getPendingStudyTaskCreateRequest,
  getPendingTodayActionCommittedStatusRequest,
  isPendingTodayActionStudyTaskOperationV2,
  loadPendingStudyTaskOperations,
  observePendingTodayActionCommittedStatus,
  removePendingStudyTaskOperation,
  type PendingStudyTaskOperation,
} from '../utils/pendingStudyTaskOperations'

interface PendingStudyTaskRecoveryPanelProps {
  operationKind: IdempotentAIStudyTaskOperationKind
  tasksAPI: Pick<TasksContextAPI, 'createIdempotentAIStudyTaskForCurrentDate'>
    & Partial<Pick<TasksContextAPI, 'getCommittedAIStudyTaskOperationStatus'>>
  revision: number
  canRecoverOperation?: (operationId: string) => boolean
  onRecoveringChange?: (recovering: boolean) => void
  onTodayActionNotCommitted?: (
    operationId: string,
  ) => boolean | void | Promise<boolean | void>
  onOutcome: (
    observation: PlanningStudyTaskActionExecutionObservation,
  ) => boolean | void | Promise<boolean | void>
}

export default function PendingStudyTaskRecoveryPanel({
  operationKind,
  tasksAPI,
  revision,
  canRecoverOperation,
  onRecoveringChange,
  onTodayActionNotCommitted,
  onOutcome,
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
    if (recoveringOperationId !== null || canRecoverOperation?.(operation.operationId) === false) return
    setRecoveringOperationId(operation.operationId)
    onRecoveringChange?.(true)
    setOutcome(null)
    try {
      let observation: PlanningStudyTaskActionExecutionObservation
      let terminalTodayV2Status = false
      if (isPendingTodayActionStudyTaskOperationV2(operation)) {
        try {
          const getCommittedStatus = tasksAPI.getCommittedAIStudyTaskOperationStatus
          if (typeof getCommittedStatus !== 'function') {
            throw new Error('Committed operation status is unsupported')
          }
          const status = await getCommittedStatus(
            getPendingTodayActionCommittedStatusRequest(operation),
          )
          const resolution = observePendingTodayActionCommittedStatus(operation, status)
          if (resolution.kind === 'not_committed') {
            if (!mountedRef.current) return
            if (typeof onTodayActionNotCommitted !== 'function') {
              setWarning('未证明任务已提交，但当前界面无法安全退役原候选；恢复记录仍保留。')
              return
            }
            let accepted: boolean | void
            try {
              accepted = await onTodayActionNotCommitted(resolution.operationId)
            } catch {
              if (mountedRef.current) {
                setWarning('检查结果已返回，但界面更新失败；恢复记录仍保留，可重新打开页面后检查。')
              }
              return
            }
            if (!mountedRef.current || accepted === false) return
            const cleared = clearOperation(operation.operationId)
            if (cleared) {
              setOperations(current => current.filter(item => item.operationId !== operation.operationId))
            }
            setOutcome(cleared
              ? '未证明任务已提交；原候选已退役，需要新候选。恢复记录已结束。'
              : '未证明任务已提交；原候选已退役，需要新候选。恢复记录尚未清除。')
            return
          }
          observation = resolution.observation
          terminalTodayV2Status = resolution.terminal
        } catch {
          observation = observeStudyTaskActionExecutionResult({
            operationId: operation.operationId,
            status: 'uncertain',
            error: 'Committed operation status is unavailable',
          }, operation.operationId)
        }
      } else {
        const result = await executeIdempotentAIStudyTaskCreateRequest(
          getPendingStudyTaskCreateRequest(operation),
          tasksAPI,
        )
        observation = observeStudyTaskActionExecutionResult(result, operation.operationId)
      }
      if (!mountedRef.current) return

      let accepted: boolean | void
      try {
        accepted = await onOutcome(observation)
      } catch {
        if (mountedRef.current) {
          setWarning('检查结果已返回，但界面更新失败；恢复记录仍保留，可重新打开页面后检查。')
        }
        return
      }
      if (!mountedRef.current || accepted === false) return

      if (isPendingTodayActionStudyTaskOperationV2(operation) && terminalTodayV2Status) {
        const cleared = clearOperation(operation.operationId)
        if (cleared) {
          setOperations(current => current.filter(item => item.operationId !== operation.operationId))
        }
        const terminalMessage = observation.outcome.message.replace(/[。；]+$/, '')
        setOutcome(cleared
          ? `${terminalMessage}；恢复记录已结束。`
          : `${terminalMessage}；恢复记录尚未清除。`)
      } else if (observation.status === 'succeeded') {
        const cleared = clearOperation(operation.operationId)
        if (cleared) {
          setOperations(current => current.filter(item => item.operationId !== operation.operationId))
        }
        setOutcome(observation.outcome.message)
      } else if (observation.status === 'uncertain') {
        setOutcome(observation.outcome.message)
      } else if (observation.code === 'IDEMPOTENCY_CONFLICT') {
        setOutcome(observation.outcome.message)
      } else {
        const cleared = clearOperation(operation.operationId)
        if (cleared) {
          setOperations(current => current.filter(item => item.operationId !== operation.operationId))
        }
        const terminalMessage = observation.outcome.message.replace(/[。；]+$/, '')
        setOutcome(cleared
          ? `${terminalMessage}；恢复记录已结束。`
          : `${terminalMessage}；恢复记录尚未清除。`)
      }
    } finally {
      if (mountedRef.current) {
        onRecoveringChange?.(false)
        setRecoveringOperationId(null)
      }
    }
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
        MindDiary 不会自动重试。Daily Review 可复用原确认请求；Today Action 重启后只读检查已提交结果，不会重建或重发任务。
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
            {isPendingTodayActionStudyTaskOperationV2(operation)
              ? `Today Action · ${operation.plannedDate}`
              : `${operation.payload.title} · ${operation.payload.planned_date}`}
            <span style={{ display: 'block', color: 'var(--text-muted)' }}>操作 ID：{operation.operationId}</span>
          </span>
          <button
            type="button"
            className="button button-secondary"
            data-testid={`recover-pending-study-task-${operation.operationId}`}
            disabled={
              recoveringOperationId !== null
              || canRecoverOperation?.(operation.operationId) === false
            }
            onClick={() => { void recover(operation) }}
          >
            {recoveringOperationId === operation.operationId ? '检查中...' : '检查并恢复'}
          </button>
        </div>
      ))}
    </section>
  )
}
