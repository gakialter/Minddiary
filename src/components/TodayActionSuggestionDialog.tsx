import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Sparkles, Trash2, X } from 'lucide-react'
import type { DiaryEntry, Mistake, StudyTask, StudyTaskType, Subject } from '../types'
import type { AIContextAPI, EntriesContextAPI, MistakesContextAPI, SubjectsContextAPI, TasksContextAPI } from '../types/api'
import {
  buildTodayActionPlanningContextSignature,
  buildTodayActionSuggestionRequest,
  buildTodayActionSuggestionLocalEvidence,
  buildTodayActionPlanningContextPreview,
  clampTodayActionAvailableMinutes,
  parseTodayActionSuggestions,
  validateTodayActionDrafts,
  type TodayActionPlanningContext,
  type TodayActionPriority,
  type TodayActionSuggestionDraft,
} from '../utils/todayActionSuggestions'
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
  type PlanningCandidateChangedField,
  type PlanningCandidateSnapshotInput,
  type PlanningStudyTaskActionExecutionObservation,
  type PlanningSessionExplainability,
} from '../utils/planningSessionExplainability'
import { formatCandidateValidationMessage } from '../utils/candidateValidationMessages'
import PendingStudyTaskRecoveryPanel from './PendingStudyTaskRecoveryPanel'
import type { PlanningRunRecord, PlanningRunTransitionRequest } from '../types/planningHistory'
import {
  buildCombinedGenerationContextSignature,
  deriveTodayActionFeedbackCandidates,
  revalidatePlanningFeedbackSelection,
  type PlanningFeedbackCandidateItem,
  type PlanningFeedbackPayload,
  type PlanningFeedbackSourceKey,
} from '../utils/planningFeedback'
import {
  buildTodayActionCandidateSnapshot,
  buildTodayActionPlanningRunRequest,
  createPlanningRunId,
  getDurablePlanningCandidateId,
  getPlanningCandidateOrdinal,
  getPlanningRunsAPI,
  PLANNING_HISTORY_SAVE_WARNING,
} from '../utils/planningHistoryClient'

const TASK_TYPES: StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']
const PRIORITIES: TodayActionPriority[] = ['high', 'medium', 'low']
const PRIORITY_LABELS: Record<TodayActionPriority, string> = {
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

function toPlanningCandidateSnapshot(
  suggestion: TodayActionSuggestionDraft,
): PlanningCandidateSnapshotInput {
  return {
    title: suggestion.title,
    description: suggestion.reason,
    type: suggestion.type,
    estimateMinutes: suggestion.estimate_minutes,
    priority: suggestion.priority,
    subjectId: suggestion.subject_id,
    relatedMistakeId: suggestion.related_mistake_id,
    relatedEntryId: suggestion.related_entry_id,
  }
}

function getTodayActionAdmissionSelectedIds(
  suggestions: TodayActionSuggestionDraft[],
  clientId: string,
): ReadonlySet<string> | null {
  if (!suggestions.some(suggestion => suggestion.clientId === clientId)) return null
  return new Set(suggestions.flatMap(suggestion => (
    suggestion.clientId === clientId
    || suggestion.selected
      ? [suggestion.clientId]
      : []
  )))
}

function validateTodayActionAdmissionView(
  suggestions: TodayActionSuggestionDraft[],
  context: TodayActionPlanningContext,
  selectedIds: ReadonlySet<string>,
): TodayActionSuggestionDraft[] {
  const admissionView = suggestions.map(suggestion => (
    { ...suggestion, selected: selectedIds.has(suggestion.clientId) }
  ))
  return validateTodayActionDrafts(admissionView, context)
}

function formatCandidateSnapshotValue(value: string | number | null): string {
  return value === null || value === '' ? '无' : String(value)
}

interface CreationSummary {
  created: number
  replayed: number
  failed: number
  uncertain: number
  refreshError?: string
  recoveryWarning?: string
}

interface TodayActionSuggestionDialogProps {
  date: string
  aiAPI: Pick<AIContextAPI, 'chat'>
  tasksAPI: Pick<TasksContextAPI, 'getByDate' | 'createIdempotentAIStudyTaskForCurrentDate'>
  mistakesAPI: Pick<MistakesContextAPI, 'getAll'>
  subjectsAPI: Pick<SubjectsContextAPI, 'getAll'>
  entriesAPI: Pick<EntriesContextAPI, 'getByDate'>
  onClose: () => void
  onCreated: () => void | Promise<void>
}

async function loadPlanningContext({
  date,
  availableMinutes,
  tasksAPI,
  mistakesAPI,
  subjectsAPI,
  entriesAPI,
}: {
  date: string
  availableMinutes: number
  tasksAPI: Pick<TasksContextAPI, 'getByDate'>
  mistakesAPI: Pick<MistakesContextAPI, 'getAll'>
  subjectsAPI: Pick<SubjectsContextAPI, 'getAll'>
  entriesAPI: Pick<EntriesContextAPI, 'getByDate'>
}): Promise<TodayActionPlanningContext> {
  const [todayTasks, mistakesResponse, subjects, todayEntry] = await Promise.all([
    tasksAPI.getByDate(date),
    mistakesAPI.getAll({ due: true, dueDate: date, limit: 12 }),
    subjectsAPI.getAll(),
    entriesAPI.getByDate(date),
  ])
  return {
    date,
    availableMinutes,
    todayTasks,
    dueMistakes: mistakesResponse.data || [],
    dueMistakeTotal: mistakesResponse.total,
    subjects,
    todayEntry,
  }
}

export default function TodayActionSuggestionDialog({
  date,
  aiAPI,
  tasksAPI,
  mistakesAPI,
  subjectsAPI,
  entriesAPI,
  onClose,
  onCreated,
}: TodayActionSuggestionDialogProps) {
  const [availableMinutes, setAvailableMinutes] = useState(90)
  const [planningContext, setPlanningContext] = useState<TodayActionPlanningContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<TodayActionSuggestionDraft[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [generationProvenance, setGenerationProvenance] = useState<AIStudyTaskGenerationProvenance | null>(null)
  const [reviewedConfirmationContextSignature, setReviewedConfirmationContextSignature] = useState<string | null>(null)
  const [staleContextNotice, setStaleContextNotice] = useState<string | null>(null)
  const [creationSummary, setCreationSummary] = useState<CreationSummary | null>(null)
  const [recoveryRevision, setRecoveryRevision] = useState(0)
  const [planningSession, setPlanningSession] = useState<PlanningSessionExplainability | null>(null)
  const [planningHistoryWarning, setPlanningHistoryWarning] = useState<string | null>(null)
  const [feedbackPreviewCandidates, setFeedbackPreviewCandidates] = useState<readonly PlanningFeedbackCandidateItem[]>([])
  const [selectedFeedbackKeys, setSelectedFeedbackKeys] = useState<Set<string>>(new Set())
  const [showFeedbackPreview, setShowFeedbackPreview] = useState(false)
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [feedbackWarning, setFeedbackWarning] = useState<string | null>(null)
  const [feedbackStaleNotice, setFeedbackStaleNotice] = useState<string | null>(null)
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

  const persistSuggestionSnapshot = useCallback(async (
    suggestion: TodayActionSuggestionDraft,
    allowAdmission: boolean,
  ) => {
    const run = durablePlanningRunRef.current
    const ordinal = getPlanningCandidateOrdinal('today_action', suggestion.clientId)
    if (!run || ordinal === null || suggestion.validationErrors.length > 0) return
    if (getDurablePlanningCandidateId(run, 'today_action', suggestion.clientId) !== undefined) {
      await transitionPlanningRun({
        kind: 'commit_candidate',
        runId: run.id,
        ordinal,
        candidate: buildTodayActionCandidateSnapshot(suggestion),
      })
    } else if (allowAdmission) {
      await transitionPlanningRun({
        kind: 'admit_repaired_candidate',
        runId: run.id,
        candidate: {
          ordinal,
          userDisposition: suggestion.selected ? 'selected_unconfirmed' : 'unselected',
          ...buildTodayActionCandidateSnapshot(suggestion),
        },
      })
    }
  }, [transitionPlanningRun])

  const flushPlanningCandidates = useCallback(async (
    finalSuggestions: readonly TodayActionSuggestionDraft[],
    session: PlanningSessionExplainability | null,
  ) => {
    for (const suggestion of finalSuggestions) {
      const record = session?.candidates.find(candidate => candidate.clientId === suggestion.clientId)
      const mutable = record !== undefined
        && record.decision !== 'confirmed'
        && record.outcome === null
        && !suggestion.operationId
      if (mutable) await persistSuggestionSnapshot(suggestion, true)
    }
  }, [persistSuggestionSnapshot])

  const closeDialog = useCallback(() => {
    pendingGenerationCloseReasonsRef.current.set(generationRef.current, 'dialog_closed')
    generationRef.current += 1
    contextRequestRef.current += 1
    const finalSuggestions = suggestions
    const finalSession = planningSession
    void (async () => {
      await flushPlanningCandidates(finalSuggestions, finalSession)
      await closePlanningRun('dialog_closed')
    })()
    setShowFeedbackPreview(false)
    setFeedbackPreviewCandidates([])
    setSelectedFeedbackKeys(new Set())
    setFeedbackWarning(null)
    setFeedbackStaleNotice(null)
    setFeedbackLoading(false)
    setSuggestions([])
    setErrors([])
    setGenerationProvenance(null)
    setReviewedConfirmationContextSignature(null)
    setStaleContextNotice(null)
    setCreationSummary(null)
    setPlanningSession(resetPlanningSessionExplainability())
    onClose()
  }, [closePlanningRun, flushPlanningCandidates, onClose, planningSession, suggestions])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !generating && !creating && !feedbackLoading) closeDialog()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeDialog, creating, feedbackLoading, generating])

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
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
    const previousDate = currentDateRef.current
    if (previousDate !== date) {
      pendingGenerationCloseReasonsRef.current.set(generationRef.current, 'date_rollover')
      const finalSuggestions = suggestions
      const finalSession = planningSession
      void (async () => {
        await flushPlanningCandidates(finalSuggestions, finalSession)
        await closePlanningRun('date_rollover')
      })()
    }
    currentDateRef.current = date
    generationRef.current += 1
    contextRequestRef.current += 1
    setShowFeedbackPreview(false)
    setFeedbackPreviewCandidates([])
    setSelectedFeedbackKeys(new Set())
    setFeedbackWarning(null)
    setFeedbackStaleNotice(null)
    setFeedbackLoading(false)
    setPlanningContext(null)
    setSuggestions([])
    setErrors([])
    setGenerating(false)
    setCreating(false)
    setGenerationProvenance(null)
    setReviewedConfirmationContextSignature(null)
    setStaleContextNotice(null)
    setCreationSummary(null)
    setPlanningSession(resetPlanningSessionExplainability())
  }, [closePlanningRun, date, flushPlanningCandidates])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      contextRequestRef.current += 1
    }
  }, [])

  const refreshPlanningContext = useCallback(async (): Promise<TodayActionPlanningContext | null> => {
    const request = ++contextRequestRef.current
    setContextLoading(true)
    setContextError(null)
    try {
      const context = await loadPlanningContext({
        date,
        availableMinutes,
        tasksAPI,
        mistakesAPI,
        subjectsAPI,
        entriesAPI,
      })
      if (contextRequestRef.current !== request) return null
      setPlanningContext(context)
      setSuggestions(current => current.length > 0 ? validateTodayActionDrafts(current, context) : current)
      return context
    } catch (error) {
      if (contextRequestRef.current === request) {
        setPlanningContext(null)
        setContextError(error instanceof Error ? error.message : String(error))
      }
      return null
    } finally {
      if (contextRequestRef.current === request) setContextLoading(false)
    }
  }, [availableMinutes, date, entriesAPI, mistakesAPI, subjectsAPI, tasksAPI])

  useEffect(() => {
    void refreshPlanningContext()
  }, [refreshPlanningContext])

  const revalidate = (nextSuggestions: TodayActionSuggestionDraft[], context = planningContext) => (
    context ? validateTodayActionDrafts(nextSuggestions, context) : nextSuggestions
  )

  useEffect(() => {
    setPlanningSession(current => {
      if (current === null) return current
      return suggestions.reduce((session, suggestion) => {
        const record = session.candidates.find(candidate => candidate.clientId === suggestion.clientId)
        if (!record) return session
        return updatePlanningSessionCandidate(session, suggestion.clientId, candidate => (
          updatePlanningCandidateRecord(
            candidate,
            toPlanningCandidateSnapshot(suggestion),
            suggestion.selected,
          )
        ))
      }, current)
    })
  }, [suggestions])

  const updateSuggestion = (
    clientId: string,
    patch: Partial<TodayActionSuggestionDraft>,
    updateKind: 'edit' | 'selection',
    commitImmediately = false,
  ) => {
    const beforeSuggestions = suggestions
    const nextSuggestions = revalidate(beforeSuggestions.map(suggestion => {
      if (suggestion.clientId !== clientId) return suggestion
      const next = { ...suggestion, ...patch }
      if (patch.type && patch.type !== 'review') next.related_mistake_id = null
      return next
    }))
    const admissionContext = planningContext?.date === date
      && planningContext.availableMinutes === availableMinutes
      ? planningContext
      : null
    const existingRecord = planningSession?.candidates.some(candidate => candidate.clientId === clientId) === true
    if (updateKind !== 'edit' || existingRecord) {
      setSuggestions(nextSuggestions)
      const nextCandidate = nextSuggestions.find(suggestion => suggestion.clientId === clientId)
      const run = durablePlanningRunRef.current
      const ordinal = getPlanningCandidateOrdinal('today_action', clientId)
      if (updateKind === 'selection' && run && ordinal !== null && getDurablePlanningCandidateId(run, 'today_action', clientId) !== undefined) {
        void transitionPlanningRun({
          kind: 'set_selection',
          runId: run.id,
          ordinal,
          selected: Boolean(nextCandidate?.selected),
        })
      } else if (updateKind === 'edit' && commitImmediately && nextCandidate) {
        void persistSuggestionSnapshot(nextCandidate, true)
      }
      return
    }
    const admissionSelectedIds = getTodayActionAdmissionSelectedIds(beforeSuggestions, clientId)
    const beforeCandidate = beforeSuggestions.find(suggestion => suggestion.clientId === clientId)
    const repairedCandidate = nextSuggestions.find(suggestion => suggestion.clientId === clientId)
    if (
      admissionSelectedIds === null
      || beforeCandidate === undefined
      || repairedCandidate === undefined
    ) {
      setSuggestions(nextSuggestions)
      return
    }
    const beforeSnapshotInput = toPlanningCandidateSnapshot(beforeCandidate)
    const afterSnapshotInput = toPlanningCandidateSnapshot(repairedCandidate)
    const snapshotInputKeys = Object.keys(beforeSnapshotInput) as (keyof PlanningCandidateSnapshotInput)[]
    if (snapshotInputKeys.every(key => beforeSnapshotInput[key] === afterSnapshotInput[key])) {
      setSuggestions(beforeSuggestions)
      return
    }
    if (admissionContext === null) {
      const previousErrors = new Map(beforeSuggestions.map(suggestion => (
        [suggestion.clientId, suggestion.validationErrors] as const
      )))
      setSuggestions(nextSuggestions.map(suggestion => (
        admissionSelectedIds.has(suggestion.clientId)
          ? { ...suggestion, validationErrors: previousErrors.get(suggestion.clientId) ?? suggestion.validationErrors }
          : suggestion
      )))
      return
    }
    const beforeAdmissionView = validateTodayActionAdmissionView(
      beforeSuggestions,
      admissionContext,
      admissionSelectedIds,
    )
    const afterAdmissionView = validateTodayActionAdmissionView(
      nextSuggestions,
      admissionContext,
      admissionSelectedIds,
    )
    const beforeErrors = beforeAdmissionView.find(suggestion => (
      suggestion.clientId === clientId
    ))?.validationErrors ?? null
    const afterErrors = afterAdmissionView.find(suggestion => (
      suggestion.clientId === clientId
    ))?.validationErrors ?? null
    setSuggestions(nextSuggestions.map(suggestion => (
      suggestion.clientId === clientId
        ? { ...suggestion, validationErrors: afterErrors ?? suggestion.validationErrors }
        : suggestion
    )))
    if (
      beforeErrors === null
      || beforeErrors.length === 0
      || afterErrors === null
      || afterErrors.length > 0
    ) return
    if (commitImmediately) void persistSuggestionSnapshot(repairedCandidate, true)
    setPlanningSession(current => current
      ? addPlanningSessionCandidate(current, {
          clientId,
          snapshot: toPlanningCandidateSnapshot(repairedCandidate),
          selected: repairedCandidate.selected,
        })
      : current)
  }

  const removeSuggestion = (clientId: string) => {
    const run = durablePlanningRunRef.current
    const ordinal = getPlanningCandidateOrdinal('today_action', clientId)
    if (run && ordinal !== null && getDurablePlanningCandidateId(run, 'today_action', clientId) !== undefined) {
      void transitionPlanningRun({ kind: 'remove_candidate', runId: run.id, ordinal })
    }
    setPlanningSession(current => current
      ? updatePlanningSessionCandidate(current, clientId, removePlanningCandidateRecord)
      : current)
    setSuggestions(current => revalidate(current.filter(suggestion => suggestion.clientId !== clientId)))
  }

  const commitSuggestion = (suggestion: TodayActionSuggestionDraft) => {
    const admitted = planningSession?.candidates.some(candidate => candidate.clientId === suggestion.clientId) === true
    if (admitted) void persistSuggestionSnapshot(suggestion, true)
  }

  const cancelFeedbackPreview = useCallback(() => {
    setShowFeedbackPreview(false)
    setFeedbackPreviewCandidates([])
    setSelectedFeedbackKeys(new Set())
    setFeedbackWarning(null)
    setFeedbackStaleNotice(null)
  }, [])

  const toggleFeedbackSelectAll = useCallback(() => {
    if (selectedFeedbackKeys.size === feedbackPreviewCandidates.length) {
      setSelectedFeedbackKeys(new Set())
    } else {
      setSelectedFeedbackKeys(new Set(feedbackPreviewCandidates.map(c => `${c.key.runId}:${c.key.candidateId}`)))
    }
  }, [feedbackPreviewCandidates, selectedFeedbackKeys.size])

  const toggleFeedbackKey = useCallback((keyStr: string) => {
    setSelectedFeedbackKeys(current => {
      const next = new Set(current)
      if (next.has(keyStr)) {
        next.delete(keyStr)
      } else {
        next.add(keyStr)
      }
      return next
    })
  }, [])

  const startActualGeneration = async (feedbackPayload: PlanningFeedbackPayload | null) => {
    if (generating || creating) return
    if (durablePlanningRunRef.current !== null) {
      await flushPlanningCandidates(suggestions, planningSession)
      await closePlanningRun('regenerated')
    }
    const generation = ++generationRef.current
    const generationId = `today-action${dialogInstanceId}-generation-${generation}`
    setGenerating(true)
    setErrors([])
    setSuggestions([])
    setShowFeedbackPreview(false)
    setFeedbackPreviewCandidates([])
    setSelectedFeedbackKeys(new Set())
    setFeedbackWarning(null)
    setFeedbackStaleNotice(null)
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
      const context = await refreshPlanningContext()
      if (!context) return
      if (generationRef.current !== generation) return
      setPlanningContext(context)

      const request = buildTodayActionSuggestionRequest(context, feedbackPayload)
      setPlanningSession(createPlanningSessionExplainability({
        generationId,
        contextDecisions: request.contextDecisions,
        candidates: [],
      }))
      const result = await aiAPI.chat(request.messages)
      if (generationRef.current !== generation) return
      if (result.unsupported || result.error) {
        setErrors([result.error || 'AI provider is not supported in this environment'])
        return
      }

      const parsed = parseTodayActionSuggestions(result.content, context)
      setErrors(parsed.errors)
      setSuggestions(parsed.suggestions)
      if (parsed.errors.length === 0) {
        setPlanningSession(createPlanningSessionExplainability({
          generationId,
          contextDecisions: request.contextDecisions,
          candidates: parsed.suggestions
            .filter(suggestion => suggestion.validationErrors.length === 0)
            .map(suggestion => ({
              clientId: suggestion.clientId,
              snapshot: toPlanningCandidateSnapshot(suggestion),
              selected: suggestion.selected,
            })),
        }))
        const baseContextSignature = buildTodayActionPlanningContextSignature(context)
        const generationContextSignature = buildCombinedGenerationContextSignature(
          baseContextSignature,
          feedbackPayload,
        )
        setGenerationProvenance(createAIStudyTaskGenerationProvenance(
          'today_action',
          generationContextSignature,
        ))
        setReviewedConfirmationContextSignature(baseContextSignature)
        const planningRunsAPI = getPlanningRunsAPI()
        if (planningRunsAPI) {
          try {
            const durableRun = await planningRunsAPI.create(buildTodayActionPlanningRunRequest({
              id: createPlanningRunId(),
              date,
              contextDecisions: request.contextDecisions,
              suggestions: parsed.suggestions,
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
        setErrors([error instanceof Error ? error.message : String(error)])
      }
    } finally {
      if (generationRef.current === generation) setGenerating(false)
    }
  }

  const requestGeneration = async () => {
    if (generating || creating || feedbackLoading) return
    const planningRunsAPI = getPlanningRunsAPI()
    if (!planningRunsAPI) {
      await startActualGeneration(null)
      return
    }

    const currentGeneration = generationRef.current
    const currentDate = date
    setFeedbackLoading(true)
    setFeedbackWarning(null)
    setFeedbackStaleNotice(null)
    try {
      const recentResult = await planningRunsAPI.listRecent({ limit: 20 })
      if (
        !mountedRef.current
        || generationRef.current !== currentGeneration
        || currentDateRef.current !== currentDate
      ) {
        return
      }
      const runs = recentResult && Array.isArray(recentResult.items)
        ? recentResult.items
        : null
      if (!runs) {
        setFeedbackWarning('读取历史规划记录失败。你可以重试，或直接选择“不使用历史反馈生成”。')
        setFeedbackPreviewCandidates([])
        setSelectedFeedbackKeys(new Set())
        setShowFeedbackPreview(true)
        return
      }
      const eligibleCandidates = deriveTodayActionFeedbackCandidates(runs)
      if (eligibleCandidates.length === 0) {
        setFeedbackLoading(false)
        await startActualGeneration(null)
        return
      }
      setFeedbackPreviewCandidates(eligibleCandidates)
      setSelectedFeedbackKeys(new Set(eligibleCandidates.map(c => `${c.key.runId}:${c.key.candidateId}`)))
      setShowFeedbackPreview(true)
    } catch {
      if (
        !mountedRef.current
        || generationRef.current !== currentGeneration
        || currentDateRef.current !== currentDate
      ) {
        return
      }
      setFeedbackWarning('读取历史规划记录失败。你可以重试，或直接选择“不使用历史反馈生成”。')
      setFeedbackPreviewCandidates([])
      setSelectedFeedbackKeys(new Set())
      setShowFeedbackPreview(true)
    } finally {
      if (mountedRef.current && generationRef.current === currentGeneration && currentDateRef.current === currentDate) {
        setFeedbackLoading(false)
      }
    }
  }

  const confirmFeedbackGeneration = async () => {
    if (generating || creating || feedbackLoading) return
    const planningRunsAPI = getPlanningRunsAPI()
    if (!planningRunsAPI) {
      await startActualGeneration(null)
      return
    }

    const currentGeneration = generationRef.current
    const currentDate = date
    const selectedItems = feedbackPreviewCandidates.filter(c => (
      selectedFeedbackKeys.has(`${c.key.runId}:${c.key.candidateId}`)
    ))

    if (selectedItems.length === 0) return

    setFeedbackLoading(true)
    setFeedbackStaleNotice(null)
    try {
      const freshResult = await planningRunsAPI.listRecent({ limit: 20 })
      if (
        !mountedRef.current
        || generationRef.current !== currentGeneration
        || currentDateRef.current !== currentDate
      ) {
        return
      }

      const freshRuns = freshResult && Array.isArray(freshResult.items)
        ? freshResult.items
        : null
      if (!freshRuns) {
        setFeedbackWarning('读取历史规划记录失败。你可以重试，或直接选择“不使用历史反馈生成”。')
        return
      }

      const selectedKeys: PlanningFeedbackSourceKey[] = selectedItems.map(c => c.key)
      const expectedItems = selectedItems.map(c => c.payloadItem)
      const reval = revalidatePlanningFeedbackSelection(selectedKeys, expectedItems, freshRuns)

      if (!reval.valid) {
        setFeedbackPreviewCandidates(reval.freshCandidates)
        setSelectedFeedbackKeys(new Set(reval.freshCandidates.map(c => `${c.key.runId}:${c.key.candidateId}`)))
        setFeedbackStaleNotice('历史参考信息已发生变化，已刷新列表。请重新检查并确认。')
        return
      }

      setShowFeedbackPreview(false)
      setFeedbackLoading(false)
      await startActualGeneration(reval.payload)
    } catch {
      if (
        !mountedRef.current
        || generationRef.current !== currentGeneration
        || currentDateRef.current !== currentDate
      ) {
        return
      }
      setFeedbackWarning('读取历史规划记录失败。你可以重试，或直接选择“不使用历史反馈生成”。')
    } finally {
      if (mountedRef.current && generationRef.current === currentGeneration && currentDateRef.current === currentDate) {
        setFeedbackLoading(false)
      }
    }
  }

  const generateSuggestions = requestGeneration

  const createSelectedSuggestions = async () => {
    if (creating || !planningContext) return
    const createDate = date
    setCreating(true)
    setErrors([])
    setCreationSummary(null)
    try {
      const latestContext = await loadPlanningContext({
        date: createDate,
        availableMinutes,
        tasksAPI,
        mistakesAPI,
        subjectsAPI,
        entriesAPI,
      })
      if (!mountedRef.current || currentDateRef.current !== createDate) return
      const latestSignature = buildTodayActionPlanningContextSignature(latestContext)
      setPlanningContext(latestContext)
      let currentSuggestions = validateTodayActionDrafts(suggestions, latestContext)
      setSuggestions(currentSuggestions)
      if (generationProvenance === null) return
      if (
        reviewedConfirmationContextSignature === null
        || reviewedConfirmationContextSignature !== latestSignature
      ) {
        setReviewedConfirmationContextSignature(latestSignature)
        setStaleContextNotice('规划依据已更新，候选已按最新本地数据重新校验。请查看结果后再次确认创建。')
        return
      }

      setStaleContextNotice(null)
      await flushPlanningCandidates(currentSuggestions, planningSession)
      const confirmationSnapshot: StudyTaskActionConfirmationSnapshot = {
        mode: 'today_action',
        generation: generationProvenance,
        confirmationContextSignature: latestSignature,
        expectedCurrentDate: createDate,
        plannedDate: createDate,
      }
      let currentContext = latestContext
      let createdCount = 0
      let replayedCount = 0
      let failedCount = 0
      let uncertainCount = 0
      let recoveryWarning: string | undefined
      const candidateIds = currentSuggestions.map(suggestion => suggestion.clientId)

      for (const clientId of candidateIds) {
        if (!mountedRef.current || currentDateRef.current !== createDate) return
        currentSuggestions = validateTodayActionDrafts(currentSuggestions, currentContext)
        setSuggestions(currentSuggestions)
        const suggestion = currentSuggestions.find(item => item.clientId === clientId)
        if (!suggestion) continue
        if (
          !suggestion.selected
          || !planningSession?.candidates.some(candidate => candidate.clientId === suggestion.clientId)
          || suggestion.creationState === 'created'
          || suggestion.creationState === 'creating'
          || suggestion.creationState === 'uncertain'
          || suggestion.operationId
          || suggestion.validationErrors.length > 0
        ) continue
        try {
          const operationId = createConfirmedStudyTaskOperationId()
          const action = createConfirmedStudyTaskAction({
            operationId,
            confirmationSnapshot,
            draft: {
              title: suggestion.title,
              description: suggestion.reason,
              type: suggestion.type,
              subject_id: suggestion.subject_id,
              related_mistake_id: suggestion.related_mistake_id,
              related_entry_id: suggestion.related_entry_id,
              related_chapter_id: null,
              estimate_minutes: suggestion.estimate_minutes,
            },
          })
          const request = buildIdempotentAIStudyTaskCreateRequest(action)
          try {
            savePendingStudyTaskOperation(request)
            setRecoveryRevision(current => current + 1)
          } catch {
            failedCount += 1
            currentSuggestions = currentSuggestions.map(item => (
              item.clientId === suggestion.clientId
                ? {
                    ...item,
                    creationState: 'failed',
                    creationError: '无法先保存本地恢复记录，因此没有创建任务。请检查本地存储后重试。',
                  }
                : item
            ))
            setSuggestions(currentSuggestions)
            continue
          }
          setPlanningSession(current => current
            ? updatePlanningSessionCandidate(current, suggestion.clientId, record => (
                confirmPlanningCandidateRecord(record, operationId)
              ))
            : current)
          currentSuggestions = currentSuggestions.map(item => (
            item.clientId === suggestion.clientId
              ? { ...item, operationId, creationState: 'creating', creationError: undefined }
              : item
          ))
          setSuggestions(currentSuggestions)
          const result = await executeConfirmedStudyTaskAction(
            action,
            confirmationSnapshot,
            tasksAPI,
            getDurablePlanningCandidateId(durablePlanningRunRef.current, 'today_action', suggestion.clientId),
          )
          if (!mountedRef.current || currentDateRef.current !== createDate) return
          const observation = observeStudyTaskActionExecutionResult(result, operationId)
          setPlanningSession(current => current
            ? updatePlanningSessionCandidate(current, suggestion.clientId, record => (
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
            currentSuggestions = currentSuggestions.map(item => (
              item.clientId === suggestion.clientId
                ? {
                    ...item,
                    operationId: retainForConflict ? operationId : undefined,
                    creationState: 'failed',
                    creationError: observation.outcome.message,
                    selected: retainForConflict ? false : item.selected,
                  }
                : item
            ))
            setSuggestions(currentSuggestions)
            continue
          }
          if (observation.status === 'uncertain') {
            uncertainCount += 1
            currentSuggestions = currentSuggestions.map(item => (
              item.clientId === suggestion.clientId
                ? {
                  ...item,
                  operationId,
                  creationState: 'uncertain',
                  creationError: observation.outcome.message,
                    selected: false,
                  }
                : item
            ))
            setSuggestions(currentSuggestions)
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
            todayTasks: [...currentContext.todayTasks, task],
          }
          currentSuggestions = currentSuggestions.map(item => (
            item.clientId === suggestion.clientId
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
          setSuggestions(currentSuggestions)
        } catch (error) {
          failedCount += 1
          const creationError = error instanceof Error ? error.message : String(error)
          currentSuggestions = currentSuggestions.map(item => (
            item.clientId === suggestion.clientId
              ? { ...item, creationState: 'failed', creationError }
              : item
          ))
          setSuggestions(currentSuggestions)
        }
      }
      if (!mountedRef.current || currentDateRef.current !== createDate) return
      setPlanningContext(currentContext)
      setReviewedConfirmationContextSignature(buildTodayActionPlanningContextSignature(currentContext))
      setSuggestions(currentSuggestions)
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
        setErrors([`创建前无法刷新规划依据：${error instanceof Error ? error.message : String(error)}`])
      }
    } finally {
      if (mountedRef.current && currentDateRef.current === createDate) setCreating(false)
    }
  }

  const visiblePlanningContext = planningContext?.date === date && planningContext.availableMinutes === availableMinutes
    ? planningContext
    : null
  const planningPreview = visiblePlanningContext
    ? buildTodayActionPlanningContextPreview(visiblePlanningContext)
    : []
  const isPlanningContextEmpty = visiblePlanningContext
    && planningPreview.find(item => item.source === 'today_tasks')?.count === 0
    && planningPreview.find(item => item.source === 'due_mistakes')?.count === 0
    && !visiblePlanningContext.todayEntry
  const selectedValidCount = suggestions.filter(suggestion => (
    suggestion.selected &&
    (suggestion.creationState === 'draft' || (suggestion.creationState === 'failed' && !suggestion.operationId)) &&
    suggestion.validationErrors.length === 0 &&
    planningSession?.candidates.some(candidate => candidate.clientId === suggestion.clientId) === true
  )).length
  const hasFatalParseErrors = errors.length > 0
  const explainabilityCandidates = planningSession?.candidates || []
  const explainabilitySummary = {
    providerValidated: explainabilityCandidates.filter(candidate => (
      candidate.admissionOrigin === 'provider_validated'
    )).length,
    userRepaired: explainabilityCandidates.filter(candidate => (
      candidate.admissionOrigin === 'provider_suggested_user_repaired'
    )).length,
    edited: explainabilityCandidates.filter(candidate => candidate.changedFields.length > 0).length,
    removed: explainabilityCandidates.filter(candidate => candidate.decision === 'removed').length,
    retainedUnselected: explainabilityCandidates.filter(candidate => candidate.decision === 'retained_unselected').length,
    selected: explainabilityCandidates.filter(candidate => candidate.selected && candidate.decision !== 'removed').length,
    confirmed: explainabilityCandidates.filter(candidate => (
      candidate.decision === 'confirmed' || candidate.outcome !== null
    )).length,
  }
  const confirmedOutcomes = explainabilityCandidates.filter(candidate => candidate.outcome !== null)
  const hasReplaceableGenerationState = planningSession !== null && (
    suggestions.some(suggestion => suggestion.creationState === 'draft')
    || explainabilityCandidates.some(candidate => (
      candidate.decision !== 'confirmed' && candidate.outcome === null
    ))
  )

  const modal = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="today-action-suggestion-title"
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
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
          width: 'min(760px, 100%)',
          maxHeight: 'min(780px, calc(100vh - 48px))',
          overflow: 'hidden',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div className="flex items-start justify-between gap-sm" style={{ padding: 'var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 id="today-action-suggestion-title" style={{ margin: 0, color: 'var(--text-primary)' }}>
              AI 规划今日行动
            </h3>
            <p className="text-sm" style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
              AI 只生成候选建议；本地校验后，由你确认才会创建任务。
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="关闭 AI 今日行动建议"
            className="button button-secondary"
            disabled={generating || creating}
            onClick={closeDialog}
            style={{ padding: 6 }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          data-testid="today-action-dialog-content"
          style={{ padding: 'var(--space-lg)', overflowY: 'auto', maxHeight: 'min(580px, calc(100vh - 220px))' }}
        >
          <div className="flex flex-wrap items-center gap-sm">
            <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              今日可用时间
              <input
                data-testid="ai-plan-available-minutes"
                className="input"
                type="number"
                min={5}
                max={720}
                value={availableMinutes}
                disabled={generating || creating}
                onChange={event => {
                  setPlanningContext(null)
                  setAvailableMinutes(clampTodayActionAvailableMinutes(event.target.value))
                }}
                style={{ width: 96, marginLeft: 8, minHeight: 36 }}
              />
              分钟
            </label>
            <button
              type="button"
              className="button button-primary"
              data-testid="ai-plan-generate"
              disabled={generating || creating || feedbackLoading}
              onClick={generateSuggestions}
            >
              {generating || feedbackLoading
                ? <><Loader2 size={14} className="animate-spin" /> {feedbackLoading ? '准备中...' : '生成中...'}</>
                : <><Sparkles size={14} /> {planningSession ? '重新生成一组建议' : '生成建议'}</>}
            </button>
          </div>
          {hasReplaceableGenerationState && (
            <p
              className="mt-2 text-xs"
              data-testid="today-action-regeneration-warning"
              style={{ color: 'var(--text-muted)' }}
            >
              重新生成会开始一次新的规划，当前尚未确认的候选和修改将被替换；已创建的任务不受影响。
            </p>
          )}

          {showFeedbackPreview && (
            <section
              data-testid="today-action-feedback-preview"
              aria-label="历史参考信息预览"
              className="mt-3 p-3 rounded"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="flex items-center justify-between">
                <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 14 }}>
                  历史参考信息（可选）
                </h4>
                <button
                  type="button"
                  className="button button-secondary"
                  data-testid="ai-plan-feedback-cancel"
                  disabled={feedbackLoading}
                  onClick={cancelFeedbackPreview}
                  style={{ padding: '2px 8px', fontSize: 12 }}
                >
                  取消
                </button>
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                以下是此前确认并执行的规划记录。只有你确认后，它们才会作为本次候选生成的参考数据。完成、跳过或专注记录不代表建议好坏，也不表示 AI 导致了这些结果。
              </p>

              {feedbackWarning && (
                <div
                  role="alert"
                  data-testid="today-action-feedback-warning"
                  className="mt-2 text-xs"
                  style={{ color: 'var(--warning, #b45309)', padding: 8, backgroundColor: 'var(--bg-card)', borderRadius: 4 }}
                >
                  {feedbackWarning}
                </div>
              )}

              {feedbackStaleNotice && (
                <div
                  role="alert"
                  data-testid="today-action-feedback-stale-notice"
                  className="mt-2 text-xs"
                  style={{ color: 'var(--danger, #dc2626)', padding: 8, backgroundColor: 'var(--bg-card)', borderRadius: 4 }}
                >
                  {feedbackStaleNotice}
                </div>
              )}

              {feedbackPreviewCandidates.length > 0 && (
                <>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      已选 {selectedFeedbackKeys.size} / {feedbackPreviewCandidates.length} 项
                    </span>
                    <button
                      type="button"
                      className="button button-secondary"
                      data-testid="ai-plan-feedback-toggle-all"
                      disabled={feedbackLoading}
                      onClick={toggleFeedbackSelectAll}
                      style={{ padding: '2px 8px', fontSize: 12 }}
                    >
                      {selectedFeedbackKeys.size === feedbackPreviewCandidates.length ? '全不选' : '全选'}
                    </button>
                  </div>

                  <div className="mt-2 flex flex-col gap-xs">
                    {feedbackPreviewCandidates.map(candidate => {
                      const keyStr = `${candidate.key.runId}:${candidate.key.candidateId}`
                      const isSelected = selectedFeedbackKeys.has(keyStr)
                      const statusLabel = candidate.currentStatus === 'done' ? '已完成'
                        : candidate.currentStatus === 'skipped' ? '已跳过'
                        : candidate.currentStatus === 'doing' ? '进行中'
                        : '待办'

                      return (
                        <label
                          key={keyStr}
                          data-testid={`feedback-item-${candidate.key.runId}-${candidate.key.candidateId}`}
                          className="flex items-start gap-sm p-2 rounded cursor-pointer"
                          style={{
                            backgroundColor: isSelected ? 'var(--bg-card)' : 'transparent',
                            border: '1px solid var(--border)',
                            fontSize: 13,
                          }}
                        >
                          <input
                            type="checkbox"
                            aria-label={`选择历史反馈 ${candidate.title}`}
                            checked={isSelected}
                            disabled={feedbackLoading}
                            onChange={() => toggleFeedbackKey(keyStr)}
                            style={{ marginTop: 3 }}
                          />
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                              <span>{candidate.title}</span>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                （{candidate.targetDate} · {candidate.type} · {candidate.estimateMinutes}分钟 · {statusLabel}）
                              </span>
                            </div>
                            <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                              专注时长：{candidate.focusMinutes} 分钟 · 专注次数：{candidate.focusSessions} 次
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-end gap-sm">
                <button
                  type="button"
                  className="button button-secondary"
                  data-testid="ai-plan-feedback-skip"
                  disabled={feedbackLoading}
                  onClick={() => { void startActualGeneration(null) }}
                >
                  不使用历史反馈生成
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  data-testid="ai-plan-feedback-confirm"
                  disabled={feedbackLoading || selectedFeedbackKeys.size === 0}
                  onClick={() => { void confirmFeedbackGeneration() }}
                >
                  {feedbackLoading ? <><Loader2 size={14} className="animate-spin" /> 处理中...</> : '使用选中历史反馈生成'}
                </button>
              </div>
            </section>
          )}

          <section className="mt-4" aria-label="当前本地规划预览" data-testid="planning-context-preview">
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <div>
                <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>当前本地预览（仅本地读取）</h4>
                <p className="text-xs" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                  查看不会请求 AI，也不会创建或修改任务。
                </p>
              </div>
              <button
                type="button"
                className="button button-secondary"
                data-testid="ai-plan-refresh-context"
                disabled={contextLoading || generating || creating}
                onClick={() => { void refreshPlanningContext() }}
              >
                {contextLoading ? '加载中...' : '刷新规划依据'}
              </button>
            </div>

            {contextLoading && (
              <p className="mt-2 text-sm" data-testid="planning-context-loading" style={{ color: 'var(--text-muted)' }}>
                正在加载本地规划依据…
              </p>
            )}
            {contextError && (
              <p className="mt-2 text-sm" role="alert" style={{ color: 'var(--danger)' }}>
                规划依据加载失败：{contextError}
              </p>
            )}
            {visiblePlanningContext && !contextLoading && (
              <>
                {isPlanningContextEmpty && (
                  <p className="mt-2 text-sm" data-testid="planning-context-empty" style={{ color: 'var(--text-muted)' }}>
                    今天没有待办任务、到期错题或日记；仍会使用可用时间和现有科目作为规划依据。
                  </p>
                )}
                <ul className="mt-2 flex flex-col gap-xs" style={{ marginBottom: 0, paddingLeft: 18 }}>
                  {planningPreview.map(item => (
                    <li key={item.source} data-testid={`planning-context-${item.source}`} className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <strong style={{ color: item.included ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {item.included ? '本地已准备' : '本地未准备'}：{item.label}{typeof item.count === 'number' ? `（${item.count}）` : ''}
                      </strong>
                      <span> — {item.reason}</span>
                      {item.warnings?.map(warning => (
                        <div key={warning} className="text-xs" style={{ color: 'var(--warning, var(--text-muted))', marginTop: 2 }}>
                          风险提示：{warning}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <details className="mt-3" open data-testid="today-action-request-explainability">
            <summary className="text-sm" style={{ color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
              本次请求依据
            </summary>
            <p className="text-xs" style={{ marginTop: 6, color: 'var(--text-muted)' }}>
              {planningSession
                ? '本代请求快照在生成时固定；刷新只会更新上方当前本地预览。'
                : '尚未生成；当前只有本地预览，还没有 generation request snapshot。'}
            </p>
            {planningSession && planningSession.contextDecisions.length === 0 && (
              <p className="text-xs" data-testid="today-action-request-not-formed" style={{ color: 'var(--text-muted)' }}>
                本代请求尚未形成可发送的本地投影。
              </p>
            )}
            {planningSession && planningSession.contextDecisions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-xs" style={{ marginBottom: 0, paddingLeft: 18 }}>
                {planningSession.contextDecisions.map(decision => (
                  <li
                    key={decision.category}
                    data-testid={`today-action-request-context-${decision.category}`}
                    className="text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <strong>{decision.label}</strong>：{CONTEXT_PREPARATION_LABELS[decision.preparation]}；{CONTEXT_DISPOSITION_LABELS[decision.disposition]}
                    （本地 {decision.preparedCount}，请求 {decision.includedCount}）
                    {decision.limit ? `；上限 ${decision.limit}` : ''}
                    <span> — {CONTEXT_REASON_LABELS[decision.reasonCode]}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs" data-testid="today-action-provider-usage-disclaimer" style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              {PROVIDER_USAGE_DISCLAIMER}
            </p>
          </details>

          {errors.length > 0 && (
            <div className="mt-3 text-sm" role="alert" data-testid="ai-plan-errors" style={{ color: 'var(--danger)' }}>
              {errors.map(error => <div key={error}>{error}</div>)}
              <div>请检查规划依据后重新生成建议；在出现这些错误时不会创建任务。</div>
            </div>
          )}
          {planningHistoryWarning && (
            <p className="mt-3 text-sm" role="status" data-testid="planning-history-save-warning" style={{ color: 'var(--warning, var(--text-secondary))' }}>
              {planningHistoryWarning}
            </p>
          )}

          {staleContextNotice && (
            <p className="mt-3 text-sm" role="status" data-testid="ai-plan-stale-context" style={{ color: 'var(--warning, var(--text-secondary))' }}>
              {staleContextNotice}
            </p>
          )}

          {planningSession && (
            <details className="mt-3" open data-testid="today-action-candidate-explainability">
              <summary className="text-sm" style={{ color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
                候选决策摘要
              </summary>
              <p className="text-xs" data-testid="today-action-candidate-counts" style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
                初始通过验证 {explainabilitySummary.providerValidated} · 用户修复后纳入 {explainabilitySummary.userRepaired} · 已净编辑 {explainabilitySummary.edited} · 已移除 {explainabilitySummary.removed} · 保留但未选择 {explainabilitySummary.retainedUnselected} · 当前选择 {explainabilitySummary.selected} · 已确认 {explainabilitySummary.confirmed}
              </p>
              {explainabilityCandidates.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>本代没有通过本地解析与验证的候选。</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-xs" style={{ marginBottom: 0, paddingLeft: 18 }}>
                  {explainabilityCandidates.map(candidate => (
                    <li
                      key={candidate.candidateId}
                      data-testid={`today-action-candidate-decision-${candidate.clientId}`}
                      className="text-xs"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <strong>{candidate.current.title || candidate.initial.title || candidate.clientId}</strong>
                      {' · '}{CANDIDATE_ADMISSION_ORIGIN_LABELS[candidate.admissionOrigin]}
                      {' · '}{candidate.decision === 'removed'
                        ? '已移除'
                        : candidate.decision === 'confirmed'
                          ? '已确认'
                          : candidate.selected
                            ? '已选择'
                            : candidate.decision === 'retained_unselected'
                              ? '保留但未选择'
                              : '首次纳入'}
                      {candidate.changedFields.length > 0 && (
                        <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                          {candidate.changedFields.map(field => (
                            <li key={field}>
                              {CANDIDATE_FIELD_LABELS[field]}：{formatCandidateSnapshotValue(candidate.initial[field])} → {formatCandidateSnapshotValue(candidate.current[field])}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}

          {planningSession && (
            <details className="mt-3" open data-testid="today-action-outcome-explainability">
              <summary className="text-sm" style={{ color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
                确认结果
              </summary>
              {confirmedOutcomes.length === 0 ? (
                <p className="text-xs" style={{ marginTop: 6, color: 'var(--text-muted)' }}>本代尚无已观察到的确认结果。</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-xs" style={{ marginBottom: 0, paddingLeft: 18 }}>
                  {confirmedOutcomes.map(candidate => (
                    <li
                      key={candidate.candidateId}
                      data-testid={`today-action-confirmed-outcome-${candidate.clientId}`}
                      className="text-xs"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <strong>{candidate.current.title || candidate.initial.title || candidate.clientId}</strong>：{candidate.outcome!.message}
                      {candidate.outcome!.taskId ? `（任务 #${candidate.outcome!.taskId}）` : ''}
                      {candidate.outcome!.operationId ? `；操作 ID：${candidate.outcome!.operationId}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}

          <PendingStudyTaskRecoveryPanel
            operationKind="today_action"
            tasksAPI={tasksAPI}
            revision={recoveryRevision}
            onOutcome={async (observation: PlanningStudyTaskActionExecutionObservation) => {
              setCreationSummary(null)
              setPlanningSession(current => {
                if (!current) return current
                const candidate = current.candidates.find(item => item.operationId === observation.operationId)
                return candidate
                  ? updatePlanningSessionCandidate(current, candidate.clientId, record => (
                      applyPlanningCandidateObservedOutcome(record, observation, candidate.operationId!)
                    ))
                  : current
              })
              setSuggestions(current => current.map(suggestion => (
                suggestion.operationId === observation.operationId
                  ? observation.status === 'succeeded'
                    ? {
                        ...suggestion,
                        creationState: 'created',
                        createdTaskId: observation.task.id,
                        replayed: observation.replayed,
                        creationError: undefined,
                        selected: false,
                      }
                    : observation.status === 'uncertain'
                      ? {
                          ...suggestion,
                          creationState: 'uncertain',
                          creationError: observation.outcome.message,
                          selected: false,
                        }
                      : {
                          ...suggestion,
                          operationId: observation.code === 'IDEMPOTENCY_CONFLICT'
                            ? observation.operationId
                            : undefined,
                          creationState: 'failed',
                          creationError: observation.outcome.message,
                          selected: false,
                        }
                  : suggestion
              )))
              if (observation.status !== 'succeeded') return
              setPlanningContext(current => {
                if (!current || current.todayTasks.some(task => task.id === observation.task.id)) return current
                return { ...current, todayTasks: [...current.todayTasks, observation.task] }
              })
              await onCreated()
            }}
          />

          {creationSummary && (
            <p className="mt-3 text-sm" role="status" data-testid="ai-plan-creation-summary" style={{ color: creationSummary.failed > 0 || creationSummary.uncertain > 0 ? 'var(--warning, var(--text-secondary))' : 'var(--success)' }}>
              本次新创建 {creationSummary.created - creationSummary.replayed} 项，重放确认 {creationSummary.replayed} 项，未新建 {creationSummary.failed} 项，结果待检查 {creationSummary.uncertain} 项。
              {creationSummary.failed > 0 ? ' 请以每项确认结果为准；可修改已解锁的候选后重试。' : ''}
              {creationSummary.uncertain > 0 ? ' 结果不确定的候选已锁定，请使用恢复区检查。' : ''}
              {creationSummary.recoveryWarning ? ` ${creationSummary.recoveryWarning}` : ''}
              {creationSummary.refreshError ? ` 刷新今日任务失败：${creationSummary.refreshError}` : ''}
            </p>
          )}

          {suggestions.length === 0 && !generating && (
            <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              生成后会在这里显示可编辑的候选任务。
            </p>
          )}

          {suggestions.length > 0 && (
            <div className="mt-4 flex flex-col gap-sm">
              {suggestions.map(suggestion => {
                const isCreated = suggestion.creationState === 'created'
                const isLocked = creating
                  || isCreated
                  || suggestion.creationState === 'creating'
                  || suggestion.creationState === 'uncertain'
                  || Boolean(suggestion.operationId)
                const isKnownSubject = suggestion.subject_id === null || Boolean(
                  planningContext?.subjects.some(subject => subject.id === suggestion.subject_id),
                )
                const isKnownMistake = suggestion.related_mistake_id === null || Boolean(
                  planningContext?.dueMistakes.some(mistake => mistake.id === suggestion.related_mistake_id),
                )
                const isKnownEntry = suggestion.related_entry_id === null || planningContext?.todayEntry?.id === suggestion.related_entry_id
                const evidence = planningContext
                  ? buildTodayActionSuggestionLocalEvidence(suggestion, planningContext)
                  : []
                const matchingMistake = planningContext?.dueMistakes.find(mistake => mistake.id === suggestion.related_mistake_id)

                return (
                  <div
                    key={suggestion.clientId}
                    data-testid={`ai-suggestion-${suggestion.clientId}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--space-sm)',
                      background: 'var(--bg-tertiary)',
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-sm">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${suggestion.title || suggestion.clientId}`}
                        checked={suggestion.selected}
                        disabled={isLocked}
                        onChange={event => updateSuggestion(
                          suggestion.clientId,
                          { selected: event.target.checked },
                          'selection',
                        )}
                      />
                      <input
                        className="input"
                        aria-label="建议标题"
                        value={suggestion.title}
                        disabled={isLocked}
                        onChange={event => updateSuggestion(suggestion.clientId, { title: event.target.value }, 'edit')}
                        onBlur={() => commitSuggestion(suggestion)}
                        style={{ flex: '1 1 220px', minHeight: 36 }}
                      />
                      <select
                        className="input"
                        aria-label="建议类型"
                        value={suggestion.type}
                        disabled={isLocked}
                        onChange={event => updateSuggestion(suggestion.clientId, { type: event.target.value as StudyTaskType }, 'edit', true)}
                        style={{ width: 112, minHeight: 36 }}
                      >
                        {!TASK_TYPES.includes(suggestion.type) && <option value={suggestion.type} disabled>请选择有效类型</option>}
                        {TASK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                      </select>
                      <input
                        className="input"
                        aria-label="预计分钟"
                        type="number"
                        min={5}
                        max={180}
                        value={suggestion.estimate_minutes}
                        disabled={isLocked}
                        onChange={event => updateSuggestion(suggestion.clientId, { estimate_minutes: Math.round(Number(event.target.value) || 0) }, 'edit', true)}
                        style={{ width: 86, minHeight: 36 }}
                      />
                      <select
                        className="input"
                        aria-label="建议科目"
                        value={suggestion.subject_id ?? ''}
                        disabled={isLocked}
                        onChange={event => updateSuggestion(suggestion.clientId, { subject_id: event.target.value ? Number(event.target.value) : null }, 'edit', true)}
                        style={{ width: 120, minHeight: 36 }}
                      >
                        {!isKnownSubject && <option value={suggestion.subject_id ?? ''} disabled>请选择有效科目</option>}
                        <option value="">无科目</option>
                        {planningContext?.subjects.map(subject => (
                          <option key={subject.id} value={subject.id}>{subject.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label="删除建议"
                        className="button button-secondary"
                        disabled={isLocked}
                        onClick={() => removeSuggestion(suggestion.clientId)}
                        style={{ padding: 8 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-sm">
                      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        关联到期错题
                        <select
                          className="input"
                          aria-label="关联到期错题"
                          value={suggestion.related_mistake_id ?? ''}
                          disabled={isLocked}
                          onChange={event => {
                            const relatedMistakeId = event.target.value ? Number(event.target.value) : null
                            const selectedMistake = planningContext?.dueMistakes.find(mistake => mistake.id === relatedMistakeId)
                            updateSuggestion(suggestion.clientId, {
                              related_mistake_id: relatedMistakeId,
                              ...(selectedMistake?.subject_id !== null && selectedMistake?.subject_id !== undefined
                                ? { subject_id: selectedMistake.subject_id }
                                : {}),
                            }, 'edit', true)
                          }}
                          style={{ marginLeft: 6, minHeight: 32 }}
                        >
                          {!isKnownMistake && <option value={suggestion.related_mistake_id ?? ''} disabled>请选择有效错题</option>}
                          <option value="">{suggestion.type === 'review' ? '选择到期错题' : '不关联错题'}</option>
                          {suggestion.type === 'review' && planningContext?.dueMistakes.map(mistake => (
                            <option key={mistake.id} value={mistake.id}>#{mistake.id} {mistake.question || '（无题目）'}</option>
                          ))}
                          {suggestion.type !== 'review' && matchingMistake && (
                            <option value={matchingMistake.id} disabled>#{matchingMistake.id} 已关联，请移除</option>
                          )}
                        </select>
                      </label>
                      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        关联今日日记
                        <select
                          className="input"
                          aria-label="关联今日日记"
                          value={suggestion.related_entry_id ?? ''}
                          disabled={isLocked}
                          onChange={event => updateSuggestion(suggestion.clientId, {
                            related_entry_id: event.target.value ? Number(event.target.value) : null,
                          }, 'edit', true)}
                          style={{ marginLeft: 6, minHeight: 32 }}
                        >
                          {!isKnownEntry && <option value={suggestion.related_entry_id ?? ''} disabled>请选择有效日记</option>}
                          <option value="">{planningContext?.todayEntry ? '不关联日记' : '今天没有可关联日记'}</option>
                          {planningContext?.todayEntry && (
                            <option value={planningContext.todayEntry.id}>{planningContext.todayEntry.title || planningContext.todayEntry.date}</option>
                          )}
                        </select>
                      </label>
                      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        AI 建议优先级（不写入任务）
                        <select
                          className="input"
                          aria-label="建议优先级"
                          value={suggestion.priority}
                          disabled={isLocked}
                          onChange={event => updateSuggestion(suggestion.clientId, { priority: event.target.value as TodayActionPriority }, 'edit', true)}
                          style={{ marginLeft: 6, minHeight: 32 }}
                        >
                          {!PRIORITIES.includes(suggestion.priority) && <option value={suggestion.priority} disabled>请选择有效优先级</option>}
                          {PRIORITIES.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
                        </select>
                      </label>
                    </div>
                    <textarea
                      className="input"
                      aria-label="建议理由"
                      value={suggestion.reason}
                      disabled={isLocked}
                      onChange={event => updateSuggestion(suggestion.clientId, { reason: event.target.value }, 'edit')}
                      onBlur={() => commitSuggestion(suggestion)}
                      style={{ width: '100%', minHeight: 58, marginTop: 8 }}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-sm text-xs" style={{ color: 'var(--text-muted)' }}>
                      {evidence.map(item => <span key={item}>本地依据：{item}</span>)}
                      {suggestion.creationState === 'created' && <span style={{ color: 'var(--success)' }}>{suggestion.replayed ? '已重放并恢复' : '已创建'} #{suggestion.createdTaskId}</span>}
                      {suggestion.creationState === 'failed' && <span style={{ color: 'var(--danger)' }}>{suggestion.creationError}</span>}
                      {suggestion.creationState === 'uncertain' && <span style={{ color: 'var(--warning)' }}>{suggestion.creationError}</span>}
                    </div>
                    {suggestion.validationErrors.length > 0 && (
                      <ul className="mt-2 text-xs" role="alert" style={{ color: 'var(--danger)', paddingLeft: 18 }}>
                        {suggestion.validationErrors.map(error => (
                          <li key={error}>{formatCandidateValidationMessage(error)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm" style={{ padding: 'var(--space-md) var(--space-lg)', borderTop: '1px solid var(--border)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            可创建 {selectedValidCount} 项
          </span>
          <div className="flex items-center gap-sm">
            <button type="button" className="button button-secondary" disabled={generating || creating} onClick={closeDialog}>
              关闭
            </button>
            <button
              type="button"
              className="button button-primary"
              data-testid="ai-plan-create-selected"
              disabled={generating || creating || contextLoading || !visiblePlanningContext || selectedValidCount === 0 || hasFatalParseErrors}
              onClick={createSelectedSuggestions}
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
