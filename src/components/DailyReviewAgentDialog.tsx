import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
import { formatCandidateValidationMessage } from '../utils/candidateValidationMessages'
import PendingStudyTaskRecoveryPanel from './PendingStudyTaskRecoveryPanel'
import type { PlanningRunRecord, PlanningRunTransitionRequest } from '../types/planningHistory'
import {
  DEFAULT_PLANNING_STRATEGY_ID,
  PLANNING_STRATEGIES,
  buildDailyReviewGenerationContextSignature,
  getPlanningStrategyMetadata,
  type PlanningStrategyId,
} from '../utils/planningStrategies'
import {
  buildDailyReviewCandidateSnapshot,
  buildDailyReviewPlanningRunRequest,
  createPlanningRunId,
  getDurablePlanningCandidateId,
  getPlanningCandidateOrdinal,
  getPlanningRunsAPI,
  PLANNING_HISTORY_SAVE_WARNING,
} from '../utils/planningHistoryClient'

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
    return <p className="daily-review__details-empty">尚无可显示的请求依据。</p>
  }
  return (
    <ul className="daily-review__decision-list">
      {decisions.map(decision => {
        const isAvailabilityMarker = decision.reasonCode === 'source_unavailable'
          && decision.disposition === 'included'
        return (
          <li key={decision.category} data-testid={`${testIdPrefix}-${decision.category}`}>
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
  const [planningHistoryWarning, setPlanningHistoryWarning] = useState<string | null>(null)
  const [selectedStrategy, setSelectedStrategy] = useState<PlanningStrategyId>(DEFAULT_PLANNING_STRATEGY_ID)
  const [generatedStrategy, setGeneratedStrategy] = useState<PlanningStrategyId | null>(null)
  const selectedStrategyRef = useRef<PlanningStrategyId>(DEFAULT_PLANNING_STRATEGY_ID)
  selectedStrategyRef.current = selectedStrategy
  const durablePlanningRunRef = useRef<PlanningRunRecord | null>(null)
  const planningTransitionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingGenerationCloseReasonsRef = useRef(new Map<number, 'dialog_closed' | 'regenerated' | 'date_rollover'>())
  const generationRef = useRef(0)
  const contextRequestRef = useRef(0)
  const currentDateRef = useRef(date)
  const mountedRef = useRef(true)
  const dialogInstanceId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const transitionPlanningRun = useCallback(async (request: PlanningRunTransitionRequest) => {
    const api = getPlanningRunsAPI()
    if (!api) return null
    let result: PlanningRunRecord | null = null
    let failed = false
    planningTransitionQueueRef.current = planningTransitionQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          result = await api.transition(request)
          if (durablePlanningRunRef.current?.id === request.runId) {
            durablePlanningRunRef.current = result
          }
        } catch {
          failed = true
        }
      })
    await planningTransitionQueueRef.current
    if (failed) setPlanningHistoryWarning(PLANNING_HISTORY_SAVE_WARNING)
    return result
  }, [])

  const closePlanningRun = useCallback(async (reason: 'dialog_closed' | 'regenerated' | 'date_rollover') => {
    const run = durablePlanningRunRef.current
    if (run === null || run.closedAt !== null) return
    await transitionPlanningRun({ kind: 'close_run', runId: run.id, reason })
    if (durablePlanningRunRef.current?.id === run.id) durablePlanningRunRef.current = null
  }, [transitionPlanningRun])

  const persistCandidateSnapshot = useCallback(async (
    candidate: DailyReviewCandidateDraft,
    allowAdmission: boolean,
  ) => {
    const run = durablePlanningRunRef.current
    const ordinal = getPlanningCandidateOrdinal('daily_review', candidate.clientId)
    if (!run || ordinal === null || candidate.validationErrors.length > 0) return
    if (getDurablePlanningCandidateId(run, 'daily_review', candidate.clientId) !== undefined) {
      await transitionPlanningRun({
        kind: 'commit_candidate',
        runId: run.id,
        ordinal,
        candidate: buildDailyReviewCandidateSnapshot(candidate),
      })
    } else if (allowAdmission) {
      await transitionPlanningRun({
        kind: 'admit_repaired_candidate',
        runId: run.id,
        candidate: {
          ordinal,
          userDisposition: candidate.selected ? 'selected_unconfirmed' : 'unselected',
          ...buildDailyReviewCandidateSnapshot(candidate),
        },
      })
    }
  }, [transitionPlanningRun])

  const flushPlanningCandidates = useCallback(async (
    finalCandidates: readonly DailyReviewCandidateDraft[],
    session: PlanningSessionExplainability | null,
  ) => {
    for (const candidate of finalCandidates) {
      const record = session?.candidates.find(item => item.clientId === candidate.clientId)
      const mutable = record !== undefined
        && record.decision !== 'confirmed'
        && record.outcome === null
        && !candidate.operationId
      if (mutable) await persistCandidateSnapshot(candidate, true)
    }
  }, [persistCandidateSnapshot])

  const closeDialog = useCallback(() => {
    pendingGenerationCloseReasonsRef.current.set(generationRef.current, 'dialog_closed')
    generationRef.current += 1
    contextRequestRef.current += 1
    const finalCandidates = candidates
    const finalSession = planningSession
    void (async () => {
      await flushPlanningCandidates(finalCandidates, finalSession)
      await closePlanningRun('dialog_closed')
    })()
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
  }, [candidates, closePlanningRun, flushPlanningCandidates, onClose, planningSession])

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
    const previousDate = currentDateRef.current
    if (previousDate !== date) {
      pendingGenerationCloseReasonsRef.current.set(generationRef.current, 'date_rollover')
      const finalCandidates = candidates
      const finalSession = planningSession
      void (async () => {
        await flushPlanningCandidates(finalCandidates, finalSession)
        await closePlanningRun('date_rollover')
      })()
    }
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
    setSelectedStrategy(DEFAULT_PLANNING_STRATEGY_ID)
    setGeneratedStrategy(null)
    setPlanningSession(resetPlanningSessionExplainability())
  }, [closePlanningRun, date, flushPlanningCandidates])

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
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousBodyOverflow = document.body.style.overflow

    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousBodyOverflow
      previouslyFocused?.focus()
    }
  }, [])

  const handleDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return

    const dialog = dialogRef.current
    if (!dialog) return

    const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getAttribute('aria-hidden') !== 'true')

    if (focusableElements.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const firstFocusable = focusableElements[0]!
    const lastFocusable = focusableElements[focusableElements.length - 1]!
    const activeElement = document.activeElement
    const focusIsOutsideDialog = !dialog.contains(activeElement)

    if (event.shiftKey && (activeElement === firstFocusable || focusIsOutsideDialog)) {
      event.preventDefault()
      lastFocusable.focus()
    } else if (!event.shiftKey && (activeElement === lastFocusable || focusIsOutsideDialog)) {
      event.preventDefault()
      firstFocusable.focus()
    }
  }, [])

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
    commitImmediately = false,
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
      const nextCandidate = nextCandidates.find(candidate => candidate.clientId === clientId)
      const run = durablePlanningRunRef.current
      const ordinal = getPlanningCandidateOrdinal('daily_review', clientId)
      if (updateKind === 'selection' && run && ordinal !== null && getDurablePlanningCandidateId(run, 'daily_review', clientId) !== undefined) {
        void transitionPlanningRun({
          kind: 'set_selection',
          runId: run.id,
          ordinal,
          selected: Boolean(nextCandidate?.selected),
        })
      } else if (updateKind === 'edit' && commitImmediately && nextCandidate) {
        void persistCandidateSnapshot(nextCandidate, true)
      }
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
    setCandidates(nextCandidates.map(candidate => (
      candidate.clientId === clientId
        ? { ...candidate, validationErrors: afterErrors ?? candidate.validationErrors }
        : candidate
    )))
    if (
      beforeErrors === null
      || beforeErrors.length === 0
      || afterErrors === null
      || afterErrors.length > 0
    ) return
    if (commitImmediately) void persistCandidateSnapshot(repairedCandidate, true)
    setPlanningSession(current => current
      ? addPlanningSessionCandidate(current, {
          clientId,
          snapshot: toPlanningCandidateSnapshot(repairedCandidate),
          selected: repairedCandidate.selected,
        })
      : current)
  }

  const removeCandidate = (clientId: string) => {
    const run = durablePlanningRunRef.current
    const ordinal = getPlanningCandidateOrdinal('daily_review', clientId)
    if (run && ordinal !== null && getDurablePlanningCandidateId(run, 'daily_review', clientId) !== undefined) {
      void transitionPlanningRun({ kind: 'remove_candidate', runId: run.id, ordinal })
    }
    setPlanningSession(current => current
      ? updatePlanningSessionCandidate(current, clientId, removePlanningCandidateRecord)
      : current)
    setCandidates(current => revalidateCandidates(current.filter(candidate => candidate.clientId !== clientId)))
  }

  const commitCandidate = (candidate: DailyReviewCandidateDraft) => {
    const admitted = planningSession?.candidates.some(record => record.clientId === candidate.clientId) === true
    if (admitted) void persistCandidateSnapshot(candidate, true)
  }

  const generateReview = async () => {
    if (generating || creating) return
    if (durablePlanningRunRef.current !== null) {
      await flushPlanningCandidates(candidates, planningSession)
      await closePlanningRun('regenerated')
    }
    const generation = ++generationRef.current
    const generationId = `daily-review${dialogInstanceId}-generation-${generation}`
    const strategyToUse = selectedStrategyRef.current
    setGenerating(true)
    setGenerationErrors([])
    setCreationError(null)
    setObservations([])
    setCandidates([])
    setGenerationProvenance(null)
    setReviewedConfirmationContextSignature(null)
    setStaleContextNotice(null)
    setCreationSummary(null)
    setGeneratedStrategy(null)
    setPlanningSession(createPlanningSessionExplainability({
      generationId,
      contextDecisions: [],
      candidates: [],
    }))
    try {
      const context = await refreshReviewContext()
      if (!context || generationRef.current !== generation) return

      const request = buildDailyReviewRequest(context, strategyToUse)
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
        const baseContextSignature = buildDailyReviewContextSignature(context)
        const generationContextSignature = buildDailyReviewGenerationContextSignature({
          baseDomainContextSignature: baseContextSignature,
          strategyId: strategyToUse,
        })
        setGenerationProvenance(createAIStudyTaskGenerationProvenance(
          'daily_review',
          generationContextSignature,
        ))
        setReviewedConfirmationContextSignature(baseContextSignature)
        setGeneratedStrategy(strategyToUse)
        const planningRunsAPI = getPlanningRunsAPI()
        if (planningRunsAPI) {
          try {
            const durableRun = await planningRunsAPI.create(buildDailyReviewPlanningRunRequest({
              id: createPlanningRunId(),
              planningDate: context.reviewDate,
              targetDate: context.candidateDate,
              contextDecisions: request.contextDecisions,
              candidates: parsed.candidates,
            }))
            const pendingCloseReason = pendingGenerationCloseReasonsRef.current.get(generation)
            pendingGenerationCloseReasonsRef.current.delete(generation)
            if (pendingCloseReason) {
              try {
                await planningRunsAPI.transition({
                  kind: 'close_run',
                  runId: durableRun.id,
                  reason: pendingCloseReason,
                })
              } catch {
                if (mountedRef.current) setPlanningHistoryWarning(PLANNING_HISTORY_SAVE_WARNING)
              }
            } else if (generationRef.current === generation && currentDateRef.current === date) {
              durablePlanningRunRef.current = durableRun
            } else {
              try {
                await planningRunsAPI.transition({
                  kind: 'close_run',
                  runId: durableRun.id,
                  reason: currentDateRef.current === date ? 'dialog_closed' : 'date_rollover',
                })
              } catch {
                if (mountedRef.current) setPlanningHistoryWarning(PLANNING_HISTORY_SAVE_WARNING)
              }
            }
          } catch {
            if (generationRef.current === generation) setPlanningHistoryWarning(PLANNING_HISTORY_SAVE_WARNING)
          }
        }
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
      await flushPlanningCandidates(currentCandidates, planningSession)
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
          const result = await executeConfirmedStudyTaskAction(
            action,
            confirmationSnapshot,
            tasksAPI,
            getDurablePlanningCandidateId(durablePlanningRunRef.current, 'daily_review', candidate.clientId),
          )
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
      ref={dialogRef}
      className="daily-review"
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-review-agent-title"
      aria-describedby="daily-review-agent-description"
      aria-busy={generating || creating}
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
      }}
    >
      <div className="daily-review__workspace">
        <header className="daily-review__header">
          <div className="daily-review__heading">
            <span className="daily-review__eyebrow">学习复盘 · {date}</span>
            <h3 id="daily-review-agent-title">每日复盘</h3>
            <p id="daily-review-agent-description">
              先核对本地证据，再理解建议并决定是否创建次日任务。
            </p>
          </div>
          <div className="daily-review__trust" aria-label="复盘信任边界">
            <span>本地证据优先</span>
            <span>AI 仅作建议</span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="关闭每日复盘"
            title="关闭每日复盘"
            className="button button-secondary daily-review__close"
            disabled={generating || creating}
            onClick={closeDialog}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="daily-review__content" data-testid="daily-review-dialog-content">
          <section className="daily-review__section daily-review__evidence" aria-labelledby="daily-review-evidence-title" data-testid="daily-review-context-preview">
            <div className="daily-review__section-header">
              <div>
                <span className="daily-review__section-kicker">本地证据</span>
                <h4 id="daily-review-evidence-title">复盘依据（仅本地读取）</h4>
                <p className="daily-review__section-description">
                  打开或刷新只读取本地安全摘要，不请求 AI，也不会创建或修改任务。
                </p>
                <p className="daily-review__privacy-note">
                  本功能不会把日记正文、错题答案或图片发送给 AI。
                </p>
              </div>
              <button
                type="button"
                className="button button-secondary daily-review__quiet-action"
                data-testid="daily-review-refresh-context"
                disabled={contextLoading || generating || creating}
                onClick={() => { void refreshReviewContext() }}
              >
                {contextLoading ? '加载中...' : '刷新复盘依据'}
              </button>
            </div>

            {contextLoading && <p className="daily-review__inline-status" data-testid="daily-review-context-loading" role="status">正在加载本地复盘依据…</p>}
            {contextError && <p className="daily-review__notice daily-review__notice--danger" data-testid="daily-review-context-error" role="alert">无法加载本地复盘依据：{contextError}</p>}
            {visibleContext && (
              <>
                <div className="daily-review__evidence-grid">
                  {contextPreview.map((item, index) => {
                    const source = item && typeof item === 'object' && 'source' in item && typeof item.source === 'string'
                      ? item.source
                      : `item-${index}`
                    return (
                      <article
                        key={`${source}-${index}`}
                        data-testid={`daily-review-context-${source}`}
                        data-included={item.included}
                        className="daily-review__evidence-item"
                      >
                        {displayPreviewItem(item)}
                        {item.warnings?.map(warning => (
                          <div key={warning} className="daily-review__evidence-warning">风险提示：{warning}</div>
                        ))}
                      </article>
                    )
                  })}
                </div>
                <section className="daily-review__deterministic" data-testid="daily-review-deterministic-summary" aria-labelledby="daily-review-deterministic-title">
                  <div>
                    <span className="daily-review__section-kicker">确定性总结</span>
                    <h5 id="daily-review-deterministic-title">本地确定性摘要</h5>
                  </div>
                  <ul>
                    {deterministicSummary.map(item => <li key={item.label}>{displaySummaryItem(item)}</li>)}
                  </ul>
                </section>
                {isEmptyDay && <p className="daily-review__notice daily-review__notice--neutral" data-testid="daily-review-empty-day" role="status">今天尚无足够本地复盘数据；你仍可手动生成建议或稍后再试。</p>}
              </>
            )}
          </section>

          <details className="daily-review__details" data-testid="daily-review-request-explainability">
            <summary>本次请求依据</summary>
            <div className="daily-review__details-group" data-testid="daily-review-current-request-preview">
              <strong>当前本地预览（刷新会更新）</strong>
              <p>表示若现在生成，本地应用会如何准备并加入各类信息。</p>
              <ContextDecisionList decisions={currentRequestDecisions} testIdPrefix="daily-review-current-request-context" />
            </div>
            <div className="daily-review__details-group" data-testid="daily-review-generation-request-snapshot">
              <strong>本代请求快照（刷新不会覆盖）</strong>
              {planningSession ? (
                <>
                  <p>本代标识：{planningSession.generationId}</p>
                  <ContextDecisionList decisions={planningSession.contextDecisions} testIdPrefix="daily-review-generation-request-context" />
                </>
              ) : (
                <p>尚未生成请求；这里不会把当前预览误写成历史快照。</p>
              )}
            </div>
            <p className="daily-review__provider-disclaimer" data-testid="daily-review-provider-usage-disclaimer">{PROVIDER_USAGE_DISCLAIMER}</p>
          </details>

          <section className="daily-review__section daily-review__ai-request" aria-labelledby="daily-review-ai-request-title" aria-busy={generating}>
            <div className="daily-review__section-header">
              <div>
                <span className="daily-review__section-kicker daily-review__section-kicker--ai">AI 建议 · 仅供参考</span>
                <h4 id="daily-review-ai-request-title">生成次日建议</h4>
                <p className="daily-review__section-description">AI 只读取上方安全摘要；输出须经本地验证并由你明确确认。</p>
              </div>
            </div>

            <div className="daily-review__planner-controls">
              <label className="daily-review__field daily-review__field--minutes">
                <span>次日可用时间</span>
                <span className="daily-review__field-control">
                  <input
                    data-testid="daily-review-available-minutes"
                    className="input"
                    type="number"
                    min={5}
                    max={720}
                    value={availableMinutes}
                    disabled={generating || creating}
                    onChange={event => setAvailableMinutes(clampDailyReviewAvailableMinutes(event.target.value))}
                  />
                  <span>分钟</span>
                </span>
              </label>
              <label className="daily-review__field">
                <span>次日规划策略</span>
                <select
                  data-testid="daily-review-strategy-selector"
                  aria-label="次日规划策略"
                  className="input"
                  value={selectedStrategy}
                  disabled={creating}
                  onChange={event => setSelectedStrategy(event.target.value as PlanningStrategyId)}
                >
                  {PLANNING_STRATEGIES.map(strategy => (
                    <option key={strategy.id} value={strategy.id} title={strategy.description}>
                      {strategy.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button button-secondary daily-review__generate"
                data-testid="daily-review-generate"
                aria-busy={generating}
                disabled={generating || creating || contextLoading}
                onClick={generateReview}
              >
                {generating
                  ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> 生成中...</>
                  : <><Sparkles size={14} aria-hidden="true" /> {generationErrors.length > 0 ? '重新生成复盘建议' : '生成复盘建议'}</>}
              </button>
            </div>

            {generatedStrategy !== null && candidates.length > 0 && (
              <div className="daily-review__provenance-row">
                <span data-testid="daily-review-generated-strategy-badge" className="daily-review__provenance-badge">
                  AI 建议来源 · 次日候选基于「{getPlanningStrategyMetadata(generatedStrategy).label}」策略生成
                </span>
                {selectedStrategy !== generatedStrategy && (
                  <span data-testid="daily-review-strategy-mismatch-notice" className="daily-review__notice-inline daily-review__notice-inline--warning">
                    （当前显示基于「{getPlanningStrategyMetadata(generatedStrategy).label}」；切换为「{getPlanningStrategyMetadata(selectedStrategy).label}」将在重新生成时生效）
                  </span>
                )}
              </div>
            )}

            {generating && <p className="daily-review__inline-status" role="status">正在请求并验证 AI 建议…</p>}
            {!generating && generationErrors.length === 0 && observations.length === 0 && candidates.length === 0 && (
              <p className="daily-review__ai-empty">尚未生成 AI 建议。你可以先阅读本地证据，再决定是否发起请求。</p>
            )}
            {generationErrors.length > 0 && (
              <div className="daily-review__notice daily-review__notice--danger" role="alert" data-testid="daily-review-errors">
                {generationErrors.map(error => <p key={error}>{error}</p>)}
                <p>AI 返回格式无效；不会创建任务。请重新生成。</p>
              </div>
            )}
            {planningHistoryWarning && (
              <p className="daily-review__notice daily-review__notice--warning" role="status" data-testid="planning-history-save-warning">
                {planningHistoryWarning}
              </p>
            )}
            {creationError && <p className="daily-review__notice daily-review__notice--danger" role="alert" data-testid="daily-review-creation-error">{creationError}</p>}
            {staleContextNotice && <p className="daily-review__notice daily-review__notice--warning" role="status" data-testid="daily-review-stale-context">{staleContextNotice}</p>}
          </section>
          {observations.length > 0 && (
            <section className="daily-review__section daily-review__ai-observations" aria-labelledby="daily-review-observations-title" data-testid="daily-review-observations">
              <div className="daily-review__section-heading">
                <span className="daily-review__section-kicker">AI 建议 · 参考信息</span>
                <h4 id="daily-review-observations-title">AI 复盘建议</h4>
                <p>以下内容是 AI 对本地安全摘要的建议，不是已发生事实。</p>
              </div>
              <div className="daily-review__observation-list">
                {observations.map((observation, index) => (
                  <article key={`${observation.summary}-${index}`} className="daily-review__observation">
                    <strong>{observation.summary}</strong>
                    <p>{observation.reason}</p>
                    {observation.sourceRefs.length > 0 && (
                      <p className="daily-review__source-ref">本地来源：{observation.sourceRefs.join('、')}</p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {candidates.length > 0 && (
            <section className="daily-review__section daily-review__candidates" aria-labelledby="daily-review-candidates-title" data-testid="daily-review-candidates">
              <div className="daily-review__candidate-heading">
                <div className="daily-review__section-heading">
                  <span className="daily-review__section-kicker">已验证候选 · 等待你的决定</span>
                  <h4 id="daily-review-candidates-title">候选与确认</h4>
                  <p>候选仅保存在当前窗口。编辑、取消选择或删除后，再由你明确确认创建。</p>
                </div>
                {visibleContext && <span className="daily-review__candidate-date">计划日期：{visibleContext.candidateDate}</span>}
              </div>
              <div className="daily-review__candidate-list">
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
                  const presentationState = candidate.creationState === 'created'
                    ? (candidate.replayed ? 'replayed' : 'created')
                    : candidate.creationState === 'creating'
                      ? 'creating'
                      : candidate.creationState === 'uncertain'
                        ? 'uncertain'
                        : candidate.creationState === 'failed'
                          ? 'failed'
                          : candidate.validationErrors.length > 0
                            ? 'invalid'
                            : candidate.selected
                              ? 'selected'
                              : 'unselected'
                  const presentationLabel = presentationState === 'replayed'
                    ? '已重放并恢复'
                    : presentationState === 'created'
                      ? '已创建'
                      : presentationState === 'creating'
                        ? '创建中'
                        : presentationState === 'uncertain'
                          ? '结果不确定'
                          : presentationState === 'failed'
                            ? '创建失败'
                            : presentationState === 'invalid'
                              ? '本地校验未通过'
                              : presentationState === 'selected'
                                ? '已选择 · 可编辑'
                                : '未选择 · 可编辑'
                  return (
                    <article
                      key={candidate.clientId}
                      className="daily-review__candidate"
                      data-testid={`daily-review-candidate-${candidate.clientId}`}
                      data-selected={candidate.selected ? 'true' : 'false'}
                      data-state={presentationState}
                    >
                      <div className="daily-review__candidate-toolbar">
                        <label className="daily-review__candidate-selection">
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
                        <span className="daily-review__candidate-state" data-state={presentationState}>
                          {presentationLabel}
                        </span>
                        <button
                          type="button"
                          className="button button-secondary daily-review__icon-button"
                          aria-label={`删除候选任务：${candidate.title || index + 1}`}
                          disabled={isLocked}
                          onClick={() => removeCandidate(candidate.clientId)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="daily-review__candidate-fields">
                        <label className="daily-review__field-label">
                          任务标题
                          <input
                            className="input daily-review__candidate-field"
                            aria-label="候选任务标题"
                            value={candidate.title}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { title: event.target.value }, 'edit')}
                            onBlur={() => commitCandidate(candidate)}
                          />
                        </label>
                        <label className="daily-review__field-label">
                          类型
                          <select
                            className="input daily-review__candidate-field"
                            aria-label="候选任务类型"
                            value={candidate.type}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { type: event.target.value as StudyTaskType }, 'edit', true)}
                          >
                            {TASK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </label>
                        <label className="daily-review__field-label">
                          预计分钟数
                          <input
                            className="input daily-review__candidate-field"
                            type="number"
                            min={5}
                            max={180}
                            aria-label="候选预计分钟数"
                            value={candidate.estimate_minutes}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { estimate_minutes: Number(event.target.value) }, 'edit', true)}
                          />
                        </label>
                        <label className="daily-review__field-label">
                          关联科目
                          <select
                            className="input daily-review__candidate-field"
                            aria-label="候选关联科目"
                            value={candidate.subject_id ?? ''}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { subject_id: event.target.value ? Number(event.target.value) : null }, 'edit', true)}
                          >
                            {!isKnownSubject && <option value={candidate.subject_id ?? ''} disabled>请选择有效科目</option>}
                            <option value="">不关联科目</option>
                            {visibleContext?.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                          </select>
                        </label>
                        {candidate.type === 'review' && (
                          <label className="daily-review__field-label">
                            关联截至次日到期错题
                            <select
                              className="input daily-review__candidate-field"
                              aria-label="关联截至次日到期错题"
                              value={candidate.related_mistake_id ?? ''}
                              disabled={isLocked}
                              onChange={event => {
                                const relatedMistakeId = event.target.value ? Number(event.target.value) : null
                                const selectedMistake = visibleContext?.dueMistakes.find(mistake => mistake.id === relatedMistakeId)
                                updateCandidate(candidate.clientId, {
                                  related_mistake_id: relatedMistakeId,
                                  ...(selectedMistake ? { subject_id: selectedMistake.subject_id } : {}),
                                }, 'edit', true)
                              }}
                            >
                              {!isKnownMistake && <option value={candidate.related_mistake_id ?? ''} disabled>请选择有效错题</option>}
                              <option value="">选择到期错题</option>
                              {visibleContext?.dueMistakes.map(mistake => <option key={mistake.id} value={mistake.id}>#{mistake.id} {mistake.question_snippet || '（无题目）'}</option>)}
                            </select>
                          </label>
                        )}
                        <label className="daily-review__field-label">
                          建议优先级（不写入任务）
                          <select
                            className="input daily-review__candidate-field"
                            aria-label="候选建议优先级"
                            value={candidate.priority}
                            disabled={isLocked}
                            onChange={event => updateCandidate(candidate.clientId, { priority: event.target.value as DailyReviewPriority }, 'edit', true)}
                          >
                            {PRIORITIES.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className="daily-review__field-label daily-review__candidate-reason">
                        候选理由
                        <textarea
                          className="input daily-review__candidate-field daily-review__candidate-textarea"
                          aria-label="候选理由"
                          value={candidate.reason}
                          disabled={isLocked}
                          onChange={event => updateCandidate(candidate.clientId, { reason: event.target.value }, 'edit')}
                          onBlur={() => commitCandidate(candidate)}
                        />
                      </label>
                      <div className="daily-review__candidate-outcome" role="status">
                        {candidate.creationState === 'created' && <span className="daily-review__status-text daily-review__status-text--success">{candidate.replayed ? '已重放并恢复' : '已创建'} #{candidate.createdTaskId}</span>}
                        {candidate.creationState === 'failed' && <span className="daily-review__status-text daily-review__status-text--danger">{candidate.creationError}</span>}
                        {candidate.creationState === 'uncertain' && <span className="daily-review__status-text daily-review__status-text--warning">{candidate.creationError}</span>}
                      </div>
                      {candidate.validationErrors.length > 0 && (
                        <ul className="daily-review__validation-errors" role="alert">
                          {candidate.validationErrors.map(error => (
                            <li key={error}>{formatCandidateValidationMessage(error)}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          )}

          <section className="daily-review__section daily-review__decision-zone" aria-labelledby="daily-review-decision-title">
            <div className="daily-review__section-heading">
              <span className="daily-review__section-kicker">确认与恢复</span>
              <h4 id="daily-review-decision-title">确认前检查</h4>
              <p>选择只代表纳入本次确认；任务仅会在你点击底部确认按钮后创建。</p>
            </div>

            <div className="daily-review__recovery-slot">
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
            </div>

            {creationSummary && (
              <div className="daily-review__creation-summary" role="status" data-testid="daily-review-creation-summary">
                <strong>本次确认结果</strong>
                <p>本次新创建 {creationSummary.created - creationSummary.replayed} 项，重放确认 {creationSummary.replayed} 项，未新建 {creationSummary.failed} 项，结果待检查 {creationSummary.uncertain} 项</p>
                {creationSummary.failed > 0 && <p>请以每项确认结果为准；可修改已解锁候选后重试。</p>}
                {creationSummary.uncertain > 0 && <p>结果不确定的候选已锁定，请使用恢复区检查。</p>}
                {creationSummary.recoveryWarning && <p className="daily-review__status-text daily-review__status-text--warning" role="alert">{creationSummary.recoveryWarning}</p>}
                {creationSummary.refreshError && <p className="daily-review__status-text daily-review__status-text--danger" role="alert">列表刷新失败：{creationSummary.refreshError}</p>}
              </div>
            )}

            <details className="daily-review__details" data-testid="daily-review-candidate-decision-summary">
              <summary>候选决策摘要</summary>
              <p data-testid="daily-review-candidate-decision-counts">
                初始通过验证 {explainabilitySummary.providerValidated} 项 · 用户修复后纳入 {explainabilitySummary.userRepaired} 项 · 已编辑 {explainabilitySummary.edited} 项 · 已移除 {explainabilitySummary.removed} 项 · 保留但未选择 {explainabilitySummary.retainedUnselected} 项 · 当前已选择 {explainabilitySummary.selected} 项 · 已确认 {explainabilitySummary.confirmed} 项
              </p>
              <p className="daily-review__details-note">“未选择”只表示当前没有勾选，不代表候选被否定。</p>
              {planningSession === null && <p className="daily-review__details-note">尚无本代候选记录。</p>}
              {sessionCandidates.map(record => (
                <div key={record.candidateId} className="daily-review__record" data-testid={`daily-review-candidate-decision-${record.clientId}`}>
                  <strong>{record.current.title || record.clientId}</strong>
                  <span>{CANDIDATE_ADMISSION_ORIGIN_LABELS[record.admissionOrigin]}</span>
                  <span>{CANDIDATE_DECISION_LABELS[record.decision]}</span>
                  {record.changedFields.length > 0 && (
                    <ul data-testid={`daily-review-candidate-changes-${record.clientId}`}>
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

            <details className="daily-review__details" data-testid="daily-review-confirmation-outcomes">
              <summary>确认结果</summary>
              {confirmedCandidateRecords.length === 0 && <p className="daily-review__details-note">尚无已确认候选。</p>}
              {confirmedCandidateRecords.map(record => (
                <div
                  key={record.candidateId}
                  className="daily-review__record daily-review__outcome-record"
                  data-testid={`daily-review-confirmation-outcome-${record.clientId}`}
                  data-outcome-kind={record.outcome?.kind ?? 'pending'}
                >
                  <strong>{record.current.title || record.clientId}</strong>
                  <p>结果：{record.outcome?.message ?? '已确认，正在等待本地执行结果。'}</p>
                  <p>操作 ID：{record.operationId ?? '无'}</p>
                  {record.outcome?.taskId !== undefined && <p>任务 ID：{record.outcome.taskId}</p>}
                </div>
              ))}
            </details>
          </section>
        </div>

        <footer className="daily-review__footer">
          <div className="daily-review__confirmation-copy">
            <strong>可创建 {selectedValidCount} 项</strong>
            <span>只有点击“创建选中任务”后才会发起创建。</span>
          </div>
          <div className="daily-review__footer-actions">
            <button type="button" className="button button-secondary" disabled={generating || creating} onClick={closeDialog}>关闭</button>
            <button
              type="button"
              className="button button-primary"
              data-testid="daily-review-create-selected"
              aria-busy={creating}
              disabled={generating || creating || contextLoading || !visibleContext || selectedValidCount === 0 || generationErrors.length > 0}
              onClick={createSelectedCandidates}
            >
              {creating ? '创建中...' : '创建选中任务'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
