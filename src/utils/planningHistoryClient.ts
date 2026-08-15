import type { DailyReviewCandidateDraft } from './dailyReviewAgent'
import type { PlanningContextDecision } from './planningSessionExplainability'
import type { TodayActionSuggestionDraft } from './todayActionSuggestions'
import type {
  ElectronPlanningRunsAPI,
  PlanningCandidateSnapshot,
  PlanningContextSummaryItem,
  PlanningEntryPoint,
  PlanningRunCandidateCreateInput,
  PlanningRunCreateRequest,
  PlanningRunRecord,
} from '../types/planningHistory'

export const PLANNING_HISTORY_SAVE_WARNING = '规划仍可继续，但本次规划历史未保存'
export const PLANNING_HISTORY_UNAVAILABLE = '当前环境不支持持久化 AI 规划记录'

const CONTEXT_CATEGORY_ORDER: Readonly<Record<PlanningEntryPoint, readonly string[]>> = {
  today_action: [
    'available_minutes',
    'today_tasks',
    'due_mistakes',
    'subjects',
    'today_entry',
    'chapters',
    'focus_history',
  ],
  daily_review: [
    'today_tasks',
    'candidate_date_tasks',
    'pomodoro',
    'subjects',
    'today_entry',
    'due_mistakes',
    'available_minutes',
  ],
}

export function getPlanningRunsAPI(): ElectronPlanningRunsAPI | undefined {
  return typeof window === 'undefined' ? undefined : window.api?.planningRuns
}

export function createPlanningRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().toLowerCase()
  }
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function mapPlanningContextSummary(
  entryPoint: PlanningEntryPoint,
  decisions: readonly PlanningContextDecision[],
): PlanningContextSummaryItem[] {
  const byCategory = new Map(decisions.map(decision => [decision.category, decision]))
  return CONTEXT_CATEGORY_ORDER[entryPoint].flatMap(category => {
    const decision = byCategory.get(category)
    return decision
      ? [{
          category,
          preparation: decision.preparation,
          disposition: decision.disposition,
          reasonCode: decision.reasonCode,
        }]
      : []
  })
}

export function getPlanningCandidateOrdinal(
  entryPoint: PlanningEntryPoint,
  clientId: string,
): number | null {
  const pattern = entryPoint === 'today_action'
    ? /^suggestion-([1-6])$/
    : /^daily-review-candidate-([1-6])$/
  const match = pattern.exec(clientId)
  return match ? Number(match[1]) - 1 : null
}

export function buildTodayActionCandidateSnapshot(
  suggestion: TodayActionSuggestionDraft,
): PlanningCandidateSnapshot {
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

export function buildDailyReviewCandidateSnapshot(
  candidate: DailyReviewCandidateDraft,
): PlanningCandidateSnapshot {
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

function buildCandidateCreateInput(
  ordinal: number,
  snapshot: PlanningCandidateSnapshot,
  selected: boolean,
): PlanningRunCandidateCreateInput {
  return {
    ordinal,
    admissionOrigin: 'provider_validated',
    userDisposition: selected ? 'selected_unconfirmed' : 'unselected',
    ...snapshot,
  }
}

export function buildTodayActionPlanningRunRequest({
  id,
  date,
  contextDecisions,
  suggestions,
}: {
  id: string
  date: string
  contextDecisions: readonly PlanningContextDecision[]
  suggestions: readonly TodayActionSuggestionDraft[]
}): PlanningRunCreateRequest {
  const candidates = suggestions.flatMap(suggestion => {
    const ordinal = getPlanningCandidateOrdinal('today_action', suggestion.clientId)
    return ordinal !== null && suggestion.validationErrors.length === 0
      ? [buildCandidateCreateInput(
          ordinal,
          buildTodayActionCandidateSnapshot(suggestion),
          suggestion.selected,
        )]
      : []
  })
  return {
    id,
    entryPoint: 'today_action',
    planningDate: date,
    targetDate: date,
    generationResultKind: suggestions.length === 0 ? 'valid_empty' : 'candidate_set',
    contextSummary: mapPlanningContextSummary('today_action', contextDecisions),
    candidates,
  }
}

export function buildDailyReviewPlanningRunRequest({
  id,
  planningDate,
  targetDate,
  contextDecisions,
  candidates: sourceCandidates,
}: {
  id: string
  planningDate: string
  targetDate: string
  contextDecisions: readonly PlanningContextDecision[]
  candidates: readonly DailyReviewCandidateDraft[]
}): PlanningRunCreateRequest {
  const candidates = sourceCandidates.flatMap(candidate => {
    const ordinal = getPlanningCandidateOrdinal('daily_review', candidate.clientId)
    return ordinal !== null && candidate.validationErrors.length === 0
      ? [buildCandidateCreateInput(
          ordinal,
          buildDailyReviewCandidateSnapshot(candidate),
          candidate.selected,
        )]
      : []
  })
  return {
    id,
    entryPoint: 'daily_review',
    planningDate,
    targetDate,
    generationResultKind: sourceCandidates.length === 0 ? 'valid_empty' : 'candidate_set',
    contextSummary: mapPlanningContextSummary('daily_review', contextDecisions),
    candidates,
  }
}

export function getDurablePlanningCandidateId(
  run: PlanningRunRecord | null,
  entryPoint: PlanningEntryPoint,
  clientId: string,
): number | undefined {
  const ordinal = getPlanningCandidateOrdinal(entryPoint, clientId)
  return ordinal === null
    ? undefined
    : run?.candidates.find(candidate => candidate.ordinal === ordinal)?.id
}
