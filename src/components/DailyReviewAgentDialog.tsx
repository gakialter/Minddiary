import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Sparkles, Trash2, X } from 'lucide-react'
import type { PomodoroStat, StudyTaskType } from '../types'
import type {
  AIContextAPI,
  EntriesContextAPI,
  MistakesContextAPI,
  PomodoroContextAPI,
  SubjectsContextAPI,
  TasksContextAPI,
} from '../types/api'
import {
  buildDailyReviewContextPreview,
  buildDailyReviewContextSignature,
  buildDailyReviewDeterministicSummary,
  buildDailyReviewRequest,
  buildDailyReviewSafeContext,
  clampDailyReviewAvailableMinutes,
  getNextLocalDateKey,
  parseDailyReviewOutput,
  toDailyReviewSafeTask,
  validateDailyReviewCandidateDrafts,
  type DailyReviewCandidateDraft,
  type DailyReviewContextPreviewItem,
  type DailyReviewDeterministicSummaryItem,
  type DailyReviewObservationDraft,
  type DailyReviewPriority,
  type DailyReviewSafeContext,
} from '../utils/dailyReviewAgent'
import {
  buildIdempotentAIStudyTaskCreateRequest,
  createConfirmedStudyTaskOperationId,
  createConfirmedStudyTaskAction,
  executeConfirmedStudyTaskAction,
  type StudyTaskActionConfirmationSnapshot,
} from '../utils/agentStudyTaskActions'
import {
  createAIStudyTaskGenerationProvenance,
  type AIStudyTaskGenerationProvenance,
} from '../utils/aiOperationContracts'
import {
  removePendingStudyTaskOperation,
  savePendingStudyTaskOperation,
} from '../utils/pendingStudyTaskOperations'
import {
  addPlanningSessionCandidate,
  applyPlanningCandidateObservedOutcome,
  CANDIDATE_ADMISSION_ORIGIN_LABELS,
  confirmPlanningCandidateRecord,
  CONTEXT_DISPOSITION_LABELS,
  CONTEXT_PREPARATION_LABELS,
  CONTEXT_REASON_LABELS,
  createPlanningSessionExplainability,
  observeStudyTaskActionExecutionResult,
  PROVIDER_USAGE_DISCLAIMER,
  removePlanningCandidateRecord,
  resetPlanningSessionExplainability,
  updatePlanningCandidateRecord,
  updatePlanningSessionCandidate,
  type CandidateDecision,
  type PlanningCandidateChangedField,
  type PlanningCandidateSnapshotInput,
  type PlanningContextDecision,
  type PlanningSessionExplainability,
  type PlanningStudyTaskActionExecutionObservation,
} from '../utils/planningSessionExplainability'
import PendingStudyTaskRecoveryPanel from './PendingStudyTaskRecoveryPanel'

const TASK_TYPES: StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']
const PRIORITIES: DailyReviewPriority[] = ['high', 'medium', 'low']
const PRIORITY_LABELS: Record<DailyReviewPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const CANDIDATE_FIELD_LABELS: Readonly<Record<PlanningCandidateChangedField, string>> = {
  title: '标题',
  description: '理由',
  type: '类型',
  estimateMinutes: '预计分钟',
  priority: '优先级',
  subjectId: '科目',
  relatedMistakeId: '到期错题',
  relatedEntryId: '今日日记',
}

const CANDIDATE_DECISION_LABELS: Readonly<Record<CandidateDecision, string>> = {
  generated: '首次纳入',
  retained_selected: '当前已选择',
  retained_unselected: '保留但未选择',
  removed: '已移除',
  confirmed: '已确认',
}

function toPlanningCandidateSnapshot(
  candidate: DailyReviewCandidateDraft,
): PlanningCandidateSnapshotInput {
  return {
    title: candidate.title,
    description: candidate.reason,
    type: candidate.type,
    estimateMinutes: candidate.estimate_minutes,
    priority: candidate.priority,
    subjectId: candidate.subject_id,
    relatedMistakeId: candidate.related_mistake_id,
    relatedEntryId: null,
  }
}

function getDailyReviewAdmissionSelectedIds(
  candidates: DailyReviewCandidateDraft[],
  clientId: string,
): ReadonlySet<string> | null {
  if (!candidates.some(candidate => candidate.clientId === clientId)) return null
  return new Set(candidates.flatMap(candidate => (
    candidate.clientId === clientId
    || candidate.selected
    || candidate.validationErrors.length > 0
      ? [candidate.clientId]
      : []
  )))
}

function validateDailyReviewAdmissionView(
  candidates: DailyReviewCandidateDraft[],
  context: DailyReviewSafeContext,
  selectedIds: ReadonlySet<string>,
): DailyReviewCandidateDraft[] {
  const admissionView = candidates.map(candidate => (
    { ...candidate, selected: selectedIds.has(candidate.clientId) }
  ))
  return validateDailyReviewCandidateDrafts(admissionView, context)
}

function formatCandidateSnapshotValue(value: string | number | null): string {
  return value === null || value === '' ? '无' : String(value)
}

function ContextDecisionList({
  decisions,
  testIdPrefix,
}: {
  decisions: readonly PlanningContextDecision[]
  testIdPrefix: string
}) {
  if (decisions.length === 0) {
    return <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>尚无可显示的请求依据。</p>
  }
  return (
    <ul className="mt-2 grid gap-2" style={{ marginBottom: 0, paddingLeft: 18, color: 'var(--text-secondary)' }}>
      {decisions.map(decision => {
        const isAvailabilityMarker = decision.reasonCode === 'source_unavailable'
          && decision.disposition === 'included'
        return (
          <li key={decision.category} data-testid={`${testIdPrefix}-${decision.category}`} className="text-xs">
            <strong>{decision.label}</strong>
            {' — '}准备：{CONTEXT_PREPARATION_LABELS[decision.preparation]}；
            {isAvailabilityMarker
              ? <>
                  已加入本次请求：来源不可用标记；
                  未发送专注记录或专注汇总；
                </>
              : <>请求处置：{CONTEXT_DISPOSITION_LABELS[decision.disposition]}；</>}
            原因：{CONTEXT_REASON_LABELS[decision.reasonCode]}；
            数量：本地准备 {decision.preparedCount} 项，请求加入 {decision.includedCount} 项；
            请求上限：{decision.limit ?? '未设置'}
          </li>
        )
      })}
    </ul>
  )
}

interface CreationSummary {
  created: number
  replayed: number
  failed: number
  uncertain: number
  refreshError?: string
  recoveryWarning?: string
}

interface DailyReviewAgentDialogProps {
  date: string
  aiAPI: Pick<AIContextAPI, 'chat'>
  tasksAPI: Pick<TasksContextAPI, 'getByDate' | 'createIdempotentAIStudyTaskForCurrentDate'>
  mistakesAPI: Pick<MistakesContextAPI, 'getAll' | 'getDueCount'>
  subjectsAPI: Pick<SubjectsContextAPI, 'getAll'>
  entriesAPI: Pick<EntriesContextAPI, 'getByDate'>
  pomodoroAPI: Pick<PomodoroContextAPI, 'getStats' | 'getDailyTotal'>
  onClose: () => void
  onCreated: () => void | Promise<void>
}

async function loadDailyReviewContext({
  reviewDate,
  availableMinutes,
  tasksAPI,
  mistakesAPI,
  subjectsAPI,
  entriesAPI,
  pomodoroAPI,
}: {
  reviewDate: string
  availableMinutes: number
  tasksAPI: Pick<TasksContextAPI, 'getByDate'>
  mistakesAPI: Pick<MistakesContextAPI, 'getAll' | 'getDueCount'>
  subjectsAPI: Pick<SubjectsContextAPI, 'getAll'>
  entriesAPI: Pick<EntriesContextAPI, 'getByDate'>
  pomodoroAPI: Pick<PomodoroContextAPI, 'getStats' | 'getDailyTotal'>
}): Promise<DailyReviewSafeContext> {
  const candidateDate = getNextLocalDateKey(reviewDate)
  const [
    todayTasks,
    candidateDateTasks,
    subjects,
    todayEntry,
    dueMistakesResponse,
    dueMistakeTotal,
    pomodoroStatsResult,
    pomodoroDailyTotalResult,
  ] = await Promise.all([
    tasksAPI.getByDate(reviewDate),
    tasksAPI.getByDate(candidateDate),
    subjectsAPI.getAll(),
    entriesAPI.getByDate(reviewDate),
    // A next-day candidate can only reference a mistake that is due by its planned date.
    mistakesAPI.getAll({ due: true, dueDate: candidateDate, limit: 12 }),
    mistakesAPI.getDueCount(candidateDate),
    pomodoroAPI.getStats(reviewDate)
      .then(value => ({ value, available: true }))
      .catch(() => ({ value: [] as PomodoroStat[], available: false })),
    pomodoroAPI.getDailyTotal(reviewDate)
      .then(value => ({ value, available: true }))
      .catch(() => ({ value: 0, available: false })),
  ])

  return buildDailyReviewSafeContext({
    reviewDate,
    candidateDate,
    availableMinutes,
    todayTasks,
    candidateDateTasks,
    subjects,
    todayEntry,
    pomodoroStats: pomodoroStatsResult.value,
    pomodoroTotalMinutes: pomodoroDailyTotalResult.value,
    pomodoroAvailable: pomodoroStatsResult.available && pomodoroDailyTotalResult.available,
    dueMistakes: dueMistakesResponse.data || [],
    dueMistakeTotal: Number.isFinite(dueMistakeTotal) ? dueMistakeTotal : dueMistakesResponse.total,
  })
}

function displayPreviewItem(item: DailyReviewContextPreviewItem): string {
  const count = typeof item.count === 'number' ? `（${item.count}）` : ''
  return `${item.included ? '本地已准备' : '本地未准备'}：${item.label}${count} — ${item.reason}`
}

function displaySummaryItem(item: DailyReviewDeterministicSummaryItem): string {
  return `${item.label}：${item.value}`
}

export default function DailyReviewAgentDialog({
  date,
  aiAPI,
  tasksAPI,
  mistakesAPI,
  subjectsAPI,
  entriesAPI,
  pomodoroAPI,
  onClose,
  onCreated,
}: DailyReviewAgentDialogProps) {
  const [availableMinutes, setAvailableMinutes] = useState(90)
  const [reviewContext, setReviewContext] = useState<DailyReviewSafeContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const [observations, setObservations] = useState<DailyReviewObservationDraft[]>([])
  const [candidates, setCandidates] = useState<DailyReviewCandidateDraft[]>([])
  const [generationErrors, setGenerationErrors] = useState<string[]>([])
  const [creationError, setCreationError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [generationProvenance, setGenerationProvenance] = useState<AIStudyTaskGenerationProvenance | null>(null)
  const [reviewedConfirmationContextSignature, setReviewedConfirmationContextSignature] = useState<string | null>(null)
  const [staleContextNotice, setStaleContextNotice] = useState<string | null>(null)
  const [creationSummary, setCreationSummary] = useState<CreationSummary | null>(null)
  const [recoveryRevision, setRecoveryRevision] = useState(0)
  const [planningSession, setPlanningSession] = useState<PlanningSessionExplainability | null>(null)
  const generationRef = useRef(0)
  const contextRequestRef = useRef(0)
  const currentDateRef = useRef(date)
  const mountedRef = useRef(true)
  const dialogInstanceId = useId()

  const closeDialog = useCallback(() => {
    generationRef.current += 1
    contextRequestRef.current += 1
    setObservations([])
    setCandidates([])
    setGenerationErrors([])
    setCreationError(null)
    setGenerationProvenance(null)
    setReviewedConfirmationContextSignature(null)
    setStaleContextNotice(null)
    setCreationSummary(null)
    setPlanningSession(resetPlanningSessionExplainability())
    onClose()
  }, [onClose])

  const refreshReviewContext = useCallback(async (): Promise<DailyReviewSafeContext | null> => {
    const request = ++contextRequestRef.current
    setContextLoading(true)
    setContextError(null)
    try {
      const context = await loadDailyReviewContext({
        reviewDate: date,
        availableMinutes,
        tasksAPI,
        mistakesAPI,
        subjectsAPI,
        entriesAPI,
        pomodoroAPI,
      })
      if (contextRequestRef.current !== request || currentDateRef.current !== date) return null
      setReviewContext(context)
      setCandidates(current => current.length > 0 ? validateDailyReviewCandidateDrafts(current, context) : current)
      return context
    } catch (error) {
      if (contextRequestRef.current === request && currentDateRef.current === date) {
        setReviewContext(null)
        setContextError(error instanceof Error ? error.message : String(error))
      }
      return null
    } finally {
      if (contextRequestRef.current === request && currentDateRef.current === date) setContextLoading(false)
    }
  }, [availableMinutes, date, entriesAPI, mistakesAPI, pomodoroAPI, subjectsAPI, tasksAPI])

  useEffect(() => {
    currentDateRef.current = date
    generationRef.current += 1
    contextRequestRef.current += 1
    setReviewContext(null)
    setObservations([])
    setCandidates([])
    setGenerationErrors([])
    setCreationError(null)
    setGenerating(false)
    setCreating(false)
    setGenerationProvenance(null)
    setReviewedConfirmationContextSignature(null)
    setStaleContextNotice(null)
    setCreationSummary(null)
    setPlanningSession(resetPlanningSessionExplainability())
  }, [date])

  useEffect(() => {
    void refreshReviewContext()
  }, [refreshReviewContext])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !generating && !creating) closeDialog()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDialog, creating, generating])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      contextRequestRef.current += 1
    }
  }, [])

  const revalidateCandidates = (nextCandidates: DailyReviewCandidateDraft[], context = reviewContext) => (
    context ? validateDailyReviewCandidateDrafts(nextCandidates, context) : nextCandidates
  )

  useEffect(() => {
    setPlanningSession(current => {
      if (current === null) return current
      return candidates.reduce((session, candidate) => {
        const record = session.candidates.find(item => item.clientId === candidate.clientId)
        if (record === undefined) return session
        return updatePlanningSessionCandidate(session, candidate.clientId, currentRecord => (
          updatePlanningCandidateRecord(
            currentRecord,
            toPlanningCandidateSnapshot(candidate),
            candidate.selected,
          )
        ))
      }, current)
    })
  }, [candidates])

  const updateCandidate = (
    clientId: string,
    patch: Partial<DailyReviewCandidateDraft>,
    updateKind: 'edit' | 'selection',
  ) => {
    const beforeCandidates = candidates
    const nextCandidates = revalidateCandidates(beforeCandidates.map(candidate => {
      if (candidate.clientId !== clientId) return candidate
      const next = { ...candidate, ...patch }
      if (patch.type && patch.type !== 'review') next.related_mistake_id = null
      if (candidate.creationState === 'failed') {
        next.creationState = 'draft'
        next.creationError = undefined
      }
      return next
    }))
    const admissionContext = reviewContext?.reviewDate === date
      && reviewContext.availableMinutes === availableMinutes
      ? reviewContext
      : null
    const existingRecord = planningSession?.candidates.some(candidate => candidate.clientId === clientId) === true
    if (updateKind !== 'edit' || existingRecord) {
      setCandidates(nextCandidates)
      return
    }
    const admissionSelectedIds = getDailyReviewAdmissionSelectedIds(beforeCandidates, clientId)
    const beforeCandidate = beforeCandidates.find(candidate => candidate.clientId === clientId)
    const repairedCandidate = nextCandidates.find(candidate => candidate.clientId === clientId)
    if (
      admissionSelectedIds === null
      || beforeCandidate === undefined
      || repairedCandidate === undefined
    ) {
      setCandidates(nextCandidates)
      return
    }
    const beforeSnapshotInput = toPlanningCandidateSnapshot(beforeCandidate)
    const afterSnapshotInput = toPlanningCandidateSnapshot(repairedCandidate)
    const snapshotInputKeys = Object.keys(beforeSnapshotInput) as (keyof PlanningCandidateSnapshotInput)[]
    if (snapshotInputKeys.every(key => beforeSnapshotInput[key] === afterSnapshotInput[key])) {
      setCandidates(beforeCandidates)
      return
    }
    if (admissionContext === null) {
      const previousErrors = new Map(beforeCandidates.map(candidate => (
        [candidate.clientId, candidate.validationErrors] as const
      )))
      setCandidates(nextCandidates.map(candidate => (
        admissionSelectedIds.has(candidate.clientId)
          ? { ...candidate, validationErrors: previousErrors.get(candidate.clientId) ?? candidate.validationErrors }
          : candidate
      )))
      return
    }
    const beforeAdmissionView = validateDailyReviewAdmissionView(
      beforeCandidates,
      admissionContext,
      admissionSelectedIds,
    )
    const afterAdmissionView = validateDailyReviewAdmissionView(
      nextCandidates,
      admissionContext,
      admissionSelectedIds,
    )
    const beforeErrors = beforeAdmissionView.find(candidate => (
      candidate.clientId === clientId
    ))?.validationErrors ?? null
    const afterErrors = afterAdmissionView.find(candidate => (
      candidate.clientId === clientId
    ))?.validationErrors ?? null
    const admissionErrors = new Map(afterAdmissionView.map(candidate => (
      [candidate.clientId, candidate.validationErrors] as const
    )))
    setCandidates(nextCandidates.map(candidate => (
      admissionSelectedIds.has(candidate.clientId)
        ? { ...candidate, validationErrors: admissionErrors.get(candidate.clientId) ?? candidate.validationErrors }
        : candidate
    )))
    if (
      beforeErrors === null
      || beforeErrors.length === 0
      || afterErrors === null
      || afterErrors.length > 0
    ) return
    setPlanningSession(current => current
      ? addPlanningSessionCandidate(current, {
          clientId,
          snapshot: toPlanningCandidateSnapshot(repairedCandidate),
          selected: repairedCandidate.selected,
        })
      : current)
  }

  const removeCandidate = (clientId: string) => {
    setPlanningSession(current => current
      ? updatePlanningSessionCandidate(current, clientId, removePlanningCandidateRecord)
      : current)
    setCandidates(current => revalidateCandidates(current.filter(candidate => candidate.clientId !== clientId)))
  }

  const generateReview = async () => {
    if (generating || creating) return
    const generation = ++generationRef.current
    const generationId = `daily-review${dialogInstanceId}-generation-${generation}`
    setGenerating(true)
    setGenerationErrors([])
    setCreationError(null)
    setObservations([])
    setCandidates([])
    setGenerationProvenance(null)
    setReviewedConfirmationContextSignature(null)
    setStaleContextNotice(null)
    setCreationSummary(null)
    setPlanningSession(createPlanningSessionExplainability({
      generationId,
      contextDecisions: [],
      candidates: [],
    }))
    try {
      const context = await refreshReviewContext()
      if (!context || generationRef.current !== generation) return

      const request = buildDailyReviewRequest(context)
      setPlanningSession(createPlanningSessionExplainability({
        generationId,
        contextDecisions: request.contextDecisions,
        candidates: [],
      }))
      const result = await aiAPI.chat(request.messages)
      if (generationRef.current !== generation) return
      if (result.unsupported || result.error) {
        setGenerationErrors([result.error || 'AI provider is not supported in this environment'])
        return
      }

      const parsed = parseDailyReviewOutput(result.content, context)
      setGenerationErrors(parsed.errors)
      setObservations(parsed.observations)
      setCandidates(parsed.candidates)
      if (parsed.errors.length === 0) {
        setPlanningSession(createPlanningSessionExplainability({
          generationId,
          contextDecisions: request.contextDecisions,
          candidates: parsed.candidates
            .filter(candidate => candidate.validationErrors.length === 0)
            .map(candidate => ({
              clientId: candidate.clientId,
              snapshot: toPlanningCandidateSnapshot(candidate),
              selected: candidate.selected,
            })),
        }))
        const generationContextSignature = buildDailyReviewContextSignature(context)
        setGenerationProvenance(createAIStudyTaskGenerationProvenance(
          'daily_review',
          generationContextSignature,
        ))
        setReviewedConfirmationContextSignature(generationContextSignature)
      }
    } catch (error) {
      if (generationRef.current === generation) {
        setGenerationErrors([error instanceof Error ? error.message : String(error)])
      }
    } finally {
      if (generationRef.current === generation) setGenerating(false)
    }
  }

  const createSelectedCandidates = async () => {
    if (creating || !reviewContext || generationErrors.length > 0) return
    const createDate = date
    setCreating(true)
    setCreationError(null)
    setCreationSummary(null)
    try {
      const latestContext = await loadDailyReviewContext({
        reviewDate: createDate,
        availableMinutes,
        tasksAPI,
        mistakesAPI,
        subjectsAPI,
        entriesAPI,
        pomodoroAPI,
      })
      if (!mountedRef.current || currentDateRef.current !== createDate) return
      const latestSignature = buildDailyReviewContextSignature(latestContext)
      setReviewContext(latestContext)
      let currentCandidates = validateDailyReviewCandidateDrafts(candidates, latestContext)
      setCandidates(currentCandidates)

      if (generationProvenance === null) return
      if (
        reviewedConfirmationContextSignature === null
        || reviewedConfirmationContextSignature !== latestSignature
      ) {
        setReviewedConfirmationContextSignature(latestSignature)
        setStaleContextNotice('复盘依据已更新，候选已按最新本地数据重新校验。请查看结果后再次确认创建。')
        return
      }

      setStaleContextNotice(null)
      const confirmationSnapshot: StudyTaskActionConfirmationSnapshot = {
        mode: 'daily_review',
        generation: generationProvenance,
        confirmationContextSignature: latestSignature,
        expectedCurrentDate: createDate,
        plannedDate: latestContext.candidateDate,
      }
      let currentContext = latestContext
      let createdCount = 0
      let replayedCount = 0
      let failedCount = 0
      let uncertainCount = 0
      let recoveryWarning: string | undefined
      const candidateIds = currentCandidates.map(candidate => candidate.clientId)

      for (const clientId of candidateIds) {
        if (!mountedRef.current || currentDateRef.current !== createDate) return
        currentCandidates = validateDailyReviewCandidateDrafts(currentCandidates, currentContext)
        setCandidates(currentCandidates)
        const candidate = currentCandidates.find(item => item.clientId === clientId)
        if (
          !candidate
          || !candidate.selected
          || !planningSession?.candidates.some(record => record.clientId === candidate.clientId)
          || candidate.creationState === 'created'
          || candidate.creationState === 'creating'
          || candidate.creationState === 'uncertain'
          || candidate.operationId
          || candidate.validationErrors.length > 0
        ) continue

        try {
          const operationId = createConfirmedStudyTaskOperationId()
          const action = createConfirmedStudyTaskAction({
            operationId,
            confirmationSnapshot,
            draft: {
              title: candidate.title,
              description: candidate.reason,
              type: candidate.type,
              subject_id: candidate.subject_id,
              related_mistake_id: candidate.related_mistake_id,
              related_entry_id: null,
              related_chapter_id: null,
              estimate_minutes: candidate.estimate_minutes,
            },
          })
          const request = buildIdempotentAIStudyTaskCreateRequest(action)
          try {
            savePendingStudyTaskOperation(request)
            setRecoveryRevision(current => current + 1)
          } catch {
            failedCount += 1
            currentCandidates = currentCandidates.map(item => (
              item.clientId === clientId
                ? {
                    ...item,
                    creationState: 'failed',
                    creationError: '无法先保存本地恢复记录，因此没有创建任务。请检查本地存储后重试。',
                  }
                : item
            ))
            setCandidates(currentCandidates)
            continue
          }
          setPlanningSession(current => current
            ? updatePlanningSessionCandidate(current, clientId, record => (
                confirmPlanningCandidateRecord(record, operationId)
              ))
            : current)
          currentCandidates = currentCandidates.map(item => (
            item.clientId === clientId
              ? { ...item, operationId, creationState: 'creating', creationError: undefined }
              : item
          ))
          setCandidates(currentCandidates)
          const result = await executeConfirmedStudyTaskAction(action, confirmationSnapshot, tasksAPI)
          if (!mountedRef.current || currentDateRef.current !== createDate) return
          const observation = observeStudyTaskActionExecutionResult(result, operationId)
          setPlanningSession(current => current
            ? updatePlanningSessionCandidate(current, clientId, record => (
                applyPlanningCandidateObservedOutcome(record, observation, operationId)
              ))
            : current)
          if (observation.status === 'failed') {
            failedCount += 1
            const retainForConflict = observation.code === 'IDEMPOTENCY_CONFLICT'
            if (!retainForConflict) {
              try {
                removePendingStudyTaskOperation(operationId)
                setRecoveryRevision(current => current + 1)
              } catch {
                recoveryWarning = '部分已确定结果的恢复记录暂时无法清除。'
              }
            }
            currentCandidates = currentCandidates.map(item => (
              item.clientId === clientId
                ? {
                    ...item,
                    operationId: retainForConflict ? operationId : undefined,
                    creationState: 'failed',
                    creationError: observation.outcome.message,
                    selected: retainForConflict ? false : item.selected,
                  }
                : item
            ))
            setCandidates(currentCandidates)
            continue
          }
          if (observation.status === 'uncertain') {
            uncertainCount += 1
            currentCandidates = currentCandidates.map(item => (
              item.clientId === clientId
                ? {
                  ...item,
                  operationId,
                  creationState: 'uncertain',
                  creationError: observation.outcome.message,
                    selected: false,
                  }
                : item
            ))
            setCandidates(currentCandidates)
            continue
          }
          const task = observation.task
          try {
            removePendingStudyTaskOperation(operationId)
            setRecoveryRevision(current => current + 1)
          } catch {
            recoveryWarning = '任务已创建，但本地恢复记录暂时无法清除；可稍后检查并恢复。'
          }
          createdCount += 1
          if (observation.replayed) replayedCount += 1
          currentContext = {
            ...currentContext,
            candidateDateTasks: [...currentContext.candidateDateTasks, toDailyReviewSafeTask(task)],
          }
          currentCandidates = currentCandidates.map(item => (
            item.clientId === clientId
              ? {
                  ...item,
                  operationId,
                  replayed: observation.replayed,
                  creationState: 'created',
                  createdTaskId: task.id,
                  selected: false,
                }
              : item
          ))
          setCandidates(currentCandidates)
        } catch (error) {
          if (!mountedRef.current || currentDateRef.current !== createDate) return
          failedCount += 1
          const creationError = error instanceof Error ? error.message : String(error)
          currentCandidates = currentCandidates.map(item => (
            item.clientId === clientId
              ? { ...item, creationState: 'failed', creationError }
              : item
          ))
          setCandidates(currentCandidates)
        }
      }

      if (!mountedRef.current || currentDateRef.current !== createDate) return
      setReviewContext(currentContext)
      setReviewedConfirmationContextSignature(buildDailyReviewContextSignature(currentContext))
      setCandidates(currentCandidates)
      if (createdCount > 0 || failedCount > 0 || uncertainCount > 0) {
        setCreationSummary({ created: createdCount, replayed: replayedCount, failed: failedCount, uncertain: uncertainCount, recoveryWarning })
      }
      if (createdCount > 0) {
        try {
          await onCreated()
          if (!mountedRef.current || currentDateRef.current !== createDate) return
        } catch (error) {
          if (!mountedRef.current || currentDateRef.current !== createDate) return
          setCreationSummary({
            created: createdCount,
            replayed: replayedCount,
            failed: failedCount,
            uncertain: uncertainCount,
            recoveryWarning,
            refreshError: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } catch (error) {
      if (mountedRef.current && currentDateRef.current === createDate) {
        setCreationError(`创建前无法刷新复盘依据：${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      if (mountedRef.current && currentDateRef.current === createDate) setCreating(false)
    }
  }

  const visibleContext = reviewContext?.reviewDate === date && reviewContext.availableMinutes === availableMinutes
    ? reviewContext
    : null
  const contextPreview = useMemo(() => visibleContext ? buildDailyReviewContextPreview(visibleContext) : [], [visibleContext])
  const deterministicSummary = useMemo(() => visibleContext ? buildDailyReviewDeterministicSummary(visibleContext) : [], [visibleContext])
  const currentRequestDecisions = useMemo(() => (
    visibleContext ? buildDailyReviewRequest(visibleContext).contextDecisions : []
  ), [visibleContext])
  const selectedValidCount = candidates.filter(candidate => (
    candidate.selected &&
    (candidate.creationState === 'draft' || (candidate.creationState === 'failed' && !candidate.operationId)) &&
    candidate.validationErrors.length === 0 &&
    planningSession?.candidates.some(record => record.clientId === candidate.clientId) === true
  )).length
  const isEmptyDay = visibleContext
    && visibleContext.todayTasks.length === 0
    && !visibleContext.todayEntry
    && visibleContext.pomodoro.total_minutes === 0
    && visibleContext.dueMistakes.length === 0
  const sessionCandidates = planningSession?.candidates ?? []
  const explainabilitySummary = {
    providerValidated: sessionCandidates.filter(candidate => (
      candidate.admissionOrigin === 'provider_validated'
    )).length,
    userRepaired: sessionCandidates.filter(candidate => (
      candidate.admissionOrigin === 'provider_suggested_user_repaired'
    )).length,
    edited: sessionCandidates.filter(candidate => candidate.changedFields.length > 0).length,
    removed: sessionCandidates.filter(candidate => candidate.decision === 'removed').length,
    retainedUnselected: sessionCandidates.filter(candidate => candidate.decision === 'retained_unselected').length,
    selected: sessionCandidates.filter(candidate => (
      candidate.selected && candidate.decision !== 'removed'
    )).length,
    confirmed: sessionCandidates.filter(candidate => (
      candidate.decision === 'confirmed' || candidate.outcome !== null
    )).length,
  }
  const confirmedCandidateRecords = sessionCandidates.filter(candidate => (
    candidate.decision === 'confirmed' || candidate.outcome !== null
  ))

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-review-agent-title"
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
          width: 'min(800px, 100%)',
          maxHeight: 'min(800px, calc(100vh - 48px))',
          overflow: 'hidden',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div className="flex items-start justify-between gap-sm" style={{ padding: 'var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 id="daily-review-agent-title" style={{ margin: 0, color: 'var(--text-primary)' }}>每日复盘</h3>
            <p className="text-sm" style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
              AI 只生成复盘建议和次日候选；创建任务前始终需要你的确认。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭每日复盘"
            className="button button-secondary"
            disabled={generating || creating}
            onClick={closeDialog}
            style={{ padding: 6 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-lg)', overflowY: 'auto', maxHeight: 'min(600px, calc(100vh - 220px))' }}>
          <div className="flex flex-wrap items-center gap-sm">
            <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              次日可用时间
              <input
                data-testid="daily-review-available-minutes"
                className="input"
                type="number"
                min={5}
                max={720}
                value={availableMinutes}
                disabled={generating || creating}
                onChange={event => setAvailableMinutes(clampDailyReviewAvailableMinutes(event.target.value))}
                style={{ width: 96, marginLeft: 8, minHeight: 36 }}
              />
              分钟
            </label>
            <button
              type="button"
              className="button button-primary"
              data-testid="daily-review-generate"
              disabled={generating || creating || contextLoading}
              onClick={generateReview}
            >
              {generating
                ? <><Loader2 size={14} className="animate-spin" /> 生成中...</>
                : <><Sparkles size={14} /> {generationErrors.length > 0 ? '重新生成复盘建议' : '生成复盘建议'}</>}
            </button>
          </div>

          <section className="mt-4" aria-label="每日复盘依据" data-testid="daily-review-context-preview">
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <div>
                <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>复盘依据（仅本地读取）</h4>
                <p className="text-xs" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                  打开或刷新只读取本地安全摘要，不请求 AI，也不会创建或修改任务。
                </p>
                <p className="text-xs" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                  本功能不会把日记正文、错题答案或图片发送给 AI。
                </p>
              </div>
              <button
                type="button"
                className="button button-secondary"
                data-testid="daily-review-refresh-context"
                disabled={contextLoading || generating || creating}
                onClick={() => { void refreshReviewContext() }}
              >
                {contextLoading ? '加载中...' : '刷新复盘依据'}
              </button>
            </div>

            {contextLoading && <p className="mt-2 text-sm" data-testid="daily-review-context-loading" style={{ color: 'var(--text-muted)' }}>正在加载本地复盘依据…</p>}
            {contextError && <p className="mt-2 text-sm" data-testid="daily-review-context-error" role="alert" style={{ color: 'var(--danger)' }}>无法加载本地复盘依据：{contextError}</p>}
            {visibleContext && (
              <>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {contextPreview.map((item, index) => {
                    const source = item && typeof item === 'object' && 'source' in item && typeof item.source === 'string'
                      ? item.source
                      : `item-${index}`
                    return (
                      <div key={`${source}-${index}`} data-testid={`daily-review-context-${source}`} className="rounded-lg p-3 text-sm" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                        {displayPreviewItem(item)}
                        {item.warnings?.map(warning => (
                          <div key={warning} className="mt-1 text-xs" style={{ color: 'var(--warning, var(--text-muted))' }}>风险提示：{warning}</div>
                        ))}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 rounded-lg p-3" data-testid="daily-review-deterministic-summary" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                  <h5 className="text-sm font-medium" style={{ margin: 0, color: 'var(--text-primary)' }}>本地确定性摘要</h5>
                  <ul className="mt-2 text-sm" style={{ marginBottom: 0, paddingLeft: 18, color: 'var(--text-secondary)' }}>
                    {deterministicSummary.map(item => <li key={item.label}>{displaySummaryItem(item)}</li>)}
                  </ul>
                </div>
                {isEmptyDay && <p className="mt-2 text-sm" data-testid="daily-review-empty-day" style={{ color: 'var(--text-muted)' }}>今天尚无足够本地复盘数据；你仍可手动生成建议或稍后再试。</p>}
              </>
            )}
          </section>

          <details className="mt-4 rounded-lg p-3" data-testid="daily-review-request-explainability" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
            <summary className="text-sm font-medium" style={{ cursor: 'pointer', color: 'var(--text-primary)' }}>本次请求依据</summary>
            <div className="mt-3" data-testid="daily-review-current-request-preview">
              <strong className="text-sm" style={{ color: 'var(--text-primary)' }}>当前本地预览（刷新会更新）</strong>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>表示若现在生成，本地应用会如何准备并加入各类信息。</p>
              <ContextDecisionList decisions={currentRequestDecisions} testIdPrefix="daily-review-current-request-context" />
            </div>
            <div className="mt-3" data-testid="daily-review-generation-request-snapshot">
              <strong className="text-sm" style={{ color: 'var(--text-primary)' }}>本代请求快照（刷新不会覆盖）</strong>
              {planningSession ? (
                <>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>本代标识：{planningSession.generationId}</p>
                  <ContextDecisionList decisions={planningSession.contextDecisions} testIdPrefix="daily-review-generation-request-context" />
                </>
              ) : (
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>尚未生成请求；这里不会把当前预览误写成历史快照。</p>
              )}
            </div>
            <p className="mt-3 text-xs" data-testid="daily-review-provider-usage-disclaimer" style={{ color: 'var(--text-muted)' }}>{PROVIDER_USAGE_DISCLAIMER}</p>
          </details>

          {generationErrors.length > 0 && (
            <div className="mt-4 rounded-lg p-3 text-sm" role="alert" data-testid="daily-review-errors" style={{ background: 'var(--danger-bg, rgba(220, 38, 38, 0.1))', color: 'var(--danger)' }}>
              {generationErrors.map(error => <p key={error} style={{ margin: 0 }}>{error}</p>)}
              <p style={{ margin: '6px 0 0' }}>AI 返回格式无效；不会创建任务。请重新生成。</p>
            </div>
          )}
          {creationError && <p className="mt-4 text-sm" role="alert" data-testid="daily-review-creation-error" style={{ color: 'var(--danger)' }}>{creationError}</p>}
          {staleContextNotice && <p className="mt-4 text-sm" role="status" data-testid="daily-review-stale-context" style={{ color: 'var(--warning, #b45309)' }}>{staleContextNotice}</p>}
          <PendingStudyTaskRecoveryPanel
            operationKind="daily_review"
            tasksAPI={tasksAPI}
            revision={recoveryRevision}
            onOutcome={async (observation: PlanningStudyTaskActionExecutionObservation) => {
              setCreationSummary(null)
              setPlanningSession(current => {
                if (current === null) return current
                const record = current.candidates.find(candidate => candidate.operationId === observation.operationId)
                return record
                  ? updatePlanningSessionCandidate(current, record.clientId, candidate => (
                      applyPlanningCandidateObservedOutcome(candidate, observation, record.operationId!)
                    ))
                  : current
              })

              if (observation.status !== 'succeeded') {
                setCandidates(current => current.map(candidate => {
                  if (candidate.operationId !== observation.operationId) return candidate
                  if (observation.status === 'uncertain') {
                    return {
                      ...candidate,
                      creationState: 'uncertain',
                      creationError: observation.outcome.message,
                      selected: false,
                    }
                  }
                  const retainForConflict = observation.code === 'IDEMPOTENCY_CONFLICT'
                  return {
                    ...candidate,
                    operationId: retainForConflict ? observation.operationId : undefined,
                    creationState: 'failed',
                    creationError: observation.outcome.message,
                    selected: retainForConflict ? false : candidate.selected,
                  }
                }))
                return
              }

              setCandidates(current => current.map(candidate => (
                candidate.operationId === observation.operationId
                  ? {
                      ...candidate,
                      creationState: 'created',
                      createdTaskId: observation.task.id,
                      replayed: observation.replayed,
                      creationError: undefined,
                      selected: false,
                    }
                  : candidate
              )))
              setReviewContext(current => {
                if (!current || current.candidateDateTasks.some(task => task.id === observation.task.id)) return current
                return {
                  ...current,
                  candidateDateTasks: [...current.candidateDateTasks, toDailyReviewSafeTask(observation.task)],
                }
              })
              await onCreated()
            }}
          />
          {creationSummary && (
            <div className="mt-4 text-sm" data-testid="daily-review-creation-summary" style={{ color: 'var(--text-secondary)' }}>
              本次新创建 {creationSummary.created - creationSummary.replayed} 项，重放确认 {creationSummary.replayed} 项，未新建 {creationSummary.failed} 项，结果待检查 {creationSummary.uncertain} 项
              {creationSummary.failed > 0 && <p style={{ margin: '4px 0 0' }}>请以每项确认结果为准；可修改已解锁候选后重试。</p>}
              {creationSummary.uncertain > 0 && <p style={{ margin: '4px 0 0' }}>结果不确定的候选已锁定，请使用恢复区检查。</p>}
              {creationSummary.recoveryWarning && <p role="alert" style={{ margin: '4px 0 0', color: 'var(--warning)' }}>{creationSummary.recoveryWarning}</p>}
              {creationSummary.refreshError && <p role="alert" style={{ margin: '4px 0 0', color: 'var(--danger)' }}>列表刷新失败：{creationSummary.refreshError}</p>}
            </div>
          )}

          <details className="mt-4 rounded-lg p-3" data-testid="daily-review-candidate-decision-summary" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
            <summary className="text-sm font-medium" style={{ cursor: 'pointer', color: 'var(--text-primary)' }}>候选决策摘要</summary>
            <p className="mt-2 text-xs" data-testid="daily-review-candidate-decision-counts" style={{ color: 'var(--text-secondary)' }}>
              初始通过验证 {explainabilitySummary.providerValidated} 项 · 用户修复后纳入 {explainabilitySummary.userRepaired} 项 · 已编辑 {explainabilitySummary.edited} 项 · 已移除 {explainabilitySummary.removed} 项 · 保留但未选择 {explainabilitySummary.retainedUnselected} 项 · 当前已选择 {explainabilitySummary.selected} 项 · 已确认 {explainabilitySummary.confirmed} 项
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>“未选择”只表示当前没有勾选，不代表候选被否定。</p>
            {planningSession === null && <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>尚无本代候选记录。</p>}
            {sessionCandidates.map(record => (
              <div key={record.candidateId} className="mt-2 rounded-lg p-2" data-testid={`daily-review-candidate-decision-${record.clientId}`} style={{ border: '1px solid var(--border)' }}>
                <strong className="text-xs" style={{ color: 'var(--text-primary)' }}>{record.current.title || record.clientId}</strong>
                <span className="text-xs" style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>{CANDIDATE_ADMISSION_ORIGIN_LABELS[record.admissionOrigin]}</span>
                <span className="text-xs" style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>{CANDIDATE_DECISION_LABELS[record.decision]}</span>
                {record.changedFields.length > 0 && (
                  <ul className="mt-1 text-xs" data-testid={`daily-review-candidate-changes-${record.clientId}`} style={{ marginBottom: 0, paddingLeft: 18, color: 'var(--text-secondary)' }}>
                    {record.changedFields.map(field => (
                      <li key={field}>
                        {CANDIDATE_FIELD_LABELS[field]}：{formatCandidateSnapshotValue(record.initial[field])} → {formatCandidateSnapshotValue(record.current[field])}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </details>

          <details className="mt-4 rounded-lg p-3" data-testid="daily-review-confirmation-outcomes" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
            <summary className="text-sm font-medium" style={{ cursor: 'pointer', color: 'var(--text-primary)' }}>确认结果</summary>
            {confirmedCandidateRecords.length === 0 && <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>尚无已确认候选。</p>}
            {confirmedCandidateRecords.map(record => (
              <div
                key={record.candidateId}
                className="mt-2 rounded-lg p-2 text-xs"
                data-testid={`daily-review-confirmation-outcome-${record.clientId}`}
                data-outcome-kind={record.outcome?.kind ?? 'pending'}
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                <strong style={{ color: 'var(--text-primary)' }}>{record.current.title || record.clientId}</strong>
                <p style={{ margin: '4px 0 0' }}>结果：{record.outcome?.message ?? '已确认，正在等待本地执行结果。'}</p>
                <p style={{ margin: '4px 0 0' }}>操作 ID：{record.operationId ?? '无'}</p>
                {record.outcome?.taskId !== undefined && <p style={{ margin: '4px 0 0' }}>任务 ID：{record.outcome.taskId}</p>}
              </div>
            ))}
          </details>

          {observations.length > 0 && (
            <section className="mt-5" aria-label="AI 复盘建议" data-testid="daily-review-observations">
              <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>AI 复盘建议</h4>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>以下内容是 AI 对本地安全摘要的建议，不是已发生事实。</p>
              <div className="mt-3 grid gap-2">
                {observations.map((observation, index) => (
                  <div key={`${observation.summary}-${index}`} className="rounded-lg p-3" style={{ border: '1px solid var(--border)' }}>
                    <strong className="text-sm" style={{ color: 'var(--text-primary)' }}>{observation.summary}</strong>
                    <p className="mt-1 text-sm" style={{ marginBottom: 0, color: 'var(--text-secondary)' }}>{observation.reason}</p>
                    {observation.sourceRefs.length > 0 && (
                      <p className="mt-2 text-xs" style={{ marginBottom: 0, color: 'var(--text-muted)' }}>本地来源：{observation.sourceRefs.join('、')}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {candidates.length > 0 && (
            <section className="mt-5" aria-label="次日任务候选" data-testid="daily-review-candidates">
              <div className="flex flex-wrap items-baseline justify-between gap-sm">
                <div>
                  <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>次日任务候选</h4>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>候选仅保存在当前窗口。编辑、取消选择或删除后，再由你明确确认创建。</p>
                </div>
                {visibleContext && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>计划日期：{visibleContext.candidateDate}</span>}
              </div>
              <div className="mt-3 grid gap-3">
                {candidates.map((candidate, index) => {
                  const isCreated = candidate.creationState === 'created'
                  const isLocked = generating
                    || creating
                    || isCreated
                    || candidate.creationState === 'creating'
                    || candidate.creationState === 'uncertain'
                    || Boolean(candidate.operationId)
                  const isKnownSubject = candidate.subject_id === null || visibleContext?.subjects.some(subject => subject.id === candidate.subject_id)
                  const isKnownMistake = candidate.related_mistake_id === null || visibleContext?.dueMistakes.some(mistake => mistake.id === candidate.related_mistake_id)
                  return (
                    <div key={candidate.clientId} className="rounded-lg p-3" data-testid={`daily-review-candidate-${candidate.clientId}`} style={{ border: '1px solid var(--border)', opacity: isCreated ? 0.72 : 1 }}>
                      <div className="flex flex-wrap items-center justify-between gap-sm">
                        <label className="flex items-center gap-sm text-sm" style={{ color: 'var(--text-primary)' }}>
                          <input
                            type="checkbox"
                            aria-label={`选择候选任务：${candidate.title || index + 1}`}
                            checked={candidate.selected}
                            disabled={isLocked}
                            onChange={event => updateCandidate(
                              candidate.clientId,
                              { selected: event.target.checked },
                              'selection',
                            )}
                          />
                          创建此候选
                        </label>
                        <button
                          type="button"
                          className="button button-secondary"
                          aria-label={`删除候选任务：${candidate.title || index + 1}`}
                          disabled={isLocked}
                          onClick={() => removeCandidate(candidate.clientId)}
                          style={{ padding: 6 }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          任务标题
                          <input
                            className="input"
                            aria-label="候选任务标题"
                            value={candidate.title}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { title: event.target.value }, 'edit')}
                            style={{ width: '100%', marginTop: 4, minHeight: 32 }}
                          />
                        </label>
                        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          类型
                          <select
                            className="input"
                            aria-label="候选任务类型"
                            value={candidate.type}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { type: event.target.value as StudyTaskType }, 'edit')}
                            style={{ width: '100%', marginTop: 4, minHeight: 32 }}
                          >
                            {TASK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </label>
                        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          预计分钟数
                          <input
                            className="input"
                            type="number"
                            min={5}
                            max={180}
                            aria-label="候选预计分钟数"
                            value={candidate.estimate_minutes}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { estimate_minutes: Number(event.target.value) }, 'edit')}
                            style={{ width: '100%', marginTop: 4, minHeight: 32 }}
                          />
                        </label>
                        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          关联科目
                          <select
                            className="input"
                            aria-label="候选关联科目"
                            value={candidate.subject_id ?? ''}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { subject_id: event.target.value ? Number(event.target.value) : null }, 'edit')}
                            style={{ width: '100%', marginTop: 4, minHeight: 32 }}
                          >
                            {!isKnownSubject && <option value={candidate.subject_id ?? ''} disabled>请选择有效科目</option>}
                            <option value="">不关联科目</option>
                            {visibleContext?.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                          </select>
                        </label>
                        {candidate.type === 'review' && (
                          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            关联截至次日到期错题
                            <select
                              className="input"
                              aria-label="关联截至次日到期错题"
                              value={candidate.related_mistake_id ?? ''}
                              disabled={isLocked}
                              onChange={event => {
                                const relatedMistakeId = event.target.value ? Number(event.target.value) : null
                                const selectedMistake = visibleContext?.dueMistakes.find(mistake => mistake.id === relatedMistakeId)
                                updateCandidate(candidate.clientId, {
                                  related_mistake_id: relatedMistakeId,
                                  ...(selectedMistake ? { subject_id: selectedMistake.subject_id } : {}),
                                }, 'edit')
                              }}
                              style={{ width: '100%', marginTop: 4, minHeight: 32 }}
                            >
                              {!isKnownMistake && <option value={candidate.related_mistake_id ?? ''} disabled>请选择有效错题</option>}
                              <option value="">选择到期错题</option>
                              {visibleContext?.dueMistakes.map(mistake => <option key={mistake.id} value={mistake.id}>#{mistake.id} {mistake.question_snippet || '（无题目）'}</option>)}
                            </select>
                          </label>
                        )}
                        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          建议优先级（不写入任务）
                          <select
                            className="input"
                            aria-label="候选建议优先级"
                            value={candidate.priority}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { priority: event.target.value as DailyReviewPriority }, 'edit')}
                            style={{ width: '100%', marginTop: 4, minHeight: 32 }}
                          >
                            {PRIORITIES.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className="mt-2 block text-xs" style={{ color: 'var(--text-secondary)' }}>
                        候选理由
                        <textarea
                          className="input"
                          aria-label="候选理由"
                          value={candidate.reason}
                          disabled={isLocked}
                          onChange={event => updateCandidate(candidate.clientId, { reason: event.target.value }, 'edit')}
                          style={{ width: '100%', minHeight: 58, marginTop: 4 }}
                        />
                      </label>
                      <div className="mt-2 flex flex-wrap items-center gap-sm text-xs" style={{ color: 'var(--text-muted)' }}>
                        {candidate.creationState === 'created' && <span style={{ color: 'var(--success)' }}>{candidate.replayed ? '已重放并恢复' : '已创建'} #{candidate.createdTaskId}</span>}
                        {candidate.creationState === 'failed' && <span style={{ color: 'var(--danger)' }}>{candidate.creationError}</span>}
                        {candidate.creationState === 'uncertain' && <span style={{ color: 'var(--warning)' }}>{candidate.creationError}</span>}
                      </div>
                      {candidate.validationErrors.length > 0 && (
                        <ul className="mt-2 text-xs" role="alert" style={{ color: 'var(--danger)', paddingLeft: 18 }}>
                          {candidate.validationErrors.map(error => <li key={error}>{error}</li>)}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm" style={{ padding: 'var(--space-md) var(--space-lg)', borderTop: '1px solid var(--border)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>可创建 {selectedValidCount} 项</span>
          <div className="flex items-center gap-sm">
            <button type="button" className="button button-secondary" disabled={generating || creating} onClick={closeDialog}>关闭</button>
            <button
              type="button"
              className="button button-primary"
              data-testid="daily-review-create-selected"
              disabled={generating || creating || contextLoading || !visibleContext || selectedValidCount === 0 || generationErrors.length > 0}
              onClick={createSelectedCandidates}
            >
              {creating ? '创建中...' : '创建选中任务'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
