import type { StudyTaskType, StudyTaskStatus } from './index'

export type PlanningEntryPoint = 'today_action' | 'daily_review'
export type PlanningGenerationResultKind = 'valid_empty' | 'candidate_set'
export type PlanningCandidateAdmissionOrigin =
  | 'provider_validated'
  | 'provider_suggested_user_repaired'
export type PlanningCandidateDisposition =
  | 'selected_unconfirmed'
  | 'unselected'
  | 'confirmed'
export type PlanningCandidatePriority = 'high' | 'medium' | 'low'
export type PlanningRunCloseReason =
  | 'dialog_closed'
  | 'regenerated'
  | 'date_rollover'
  | 'app_closed'
export type PlanningCandidateOutcomeKind =
  | 'created'
  | 'replayed'
  | 'uncertain'
  | 'conflict'
  | 'deleted'
  | 'integrity_error'
  | 'date_mismatch'
  | 'validation_error'

export type PlanningContextPreparation =
  | 'prepared'
  | 'prepared_empty'
  | 'source_unavailable'
  | 'not_integrated'
  | 'preparation_failed'
export type PlanningContextDisposition =
  | 'included'
  | 'included_empty'
  | 'partially_included'
  | 'excluded'
export type PlanningContextReasonCode =
  | 'included_required'
  | 'included_available'
  | 'included_empty'
  | 'limit_applied'
  | 'no_record'
  | 'source_unavailable'
  | 'not_integrated'
  | 'preparation_failed'

export interface PlanningContextSummaryItem {
  category: string
  preparation: PlanningContextPreparation
  disposition: PlanningContextDisposition
  reasonCode: PlanningContextReasonCode
}

// ─── C3: Deterministic Execution Attribution ────────────────────────────────

export interface PlanningSemanticDifference<T> {
  candidateValue: T
  currentValue: T
}

export interface PlanningSemanticDrift {
  hasDrift: boolean
  differences: {
    title?: PlanningSemanticDifference<string>
    description?: PlanningSemanticDifference<string>
    type?: PlanningSemanticDifference<StudyTaskType>
    subjectId?: PlanningSemanticDifference<number | null>
    relatedMistakeId?: PlanningSemanticDifference<number | null>
    relatedEntryId?: PlanningSemanticDifference<number | null>
    relatedChapterId?: PlanningSemanticDifference<number | null>
    plannedDate?: PlanningSemanticDifference<string>
    estimateMinutes?: PlanningSemanticDifference<number>
  }
}

export type PlanningFocusAttributionState =
  | 'available'
  | 'unavailable'
  | 'corrupt_data'
  | 'not_applicable'

export type PlanningFocusUnavailableReason =
  | 'task_deleted'
  | 'confirmation_uncertain'

export interface PlanningFocusAttribution {
  state: PlanningFocusAttributionState
  totalDurationMinutes: number | null
  sessionCount: number | null
  unavailableReason: PlanningFocusUnavailableReason | null
}

export type PlanningExecutionAttributionKind =
  | 'verified_linked'
  | 'task_deleted'
  | 'known_conflict'
  | 'no_execution_expected'
  | 'unresolved'
  | 'integrity_inconsistency'
  | 'not_confirmed'

export interface PlanningExecutionAttribution {
  kind: PlanningExecutionAttributionKind
  receiptValidated: boolean
  taskId: number | null
  taskCurrentTitle: string | null
  taskCurrentStatus: StudyTaskStatus | null
  semanticDrift: PlanningSemanticDrift | null
  focus: PlanningFocusAttribution
}

// ─── End C3 Types ───────────────────────────────────────────────────────────

export interface PlanningCandidateSnapshot {
  title: string
  description: string
  type: StudyTaskType
  estimateMinutes: number
  priority: PlanningCandidatePriority
  subjectId: number | null
  relatedMistakeId: number | null
  relatedEntryId: number | null
}

export interface PlanningRunCandidateCreateInput extends PlanningCandidateSnapshot {
  ordinal: number
  admissionOrigin: PlanningCandidateAdmissionOrigin
  userDisposition: Exclude<PlanningCandidateDisposition, 'confirmed'>
}

export interface PlanningRunCreateRequest {
  id: string
  entryPoint: PlanningEntryPoint
  planningDate: string
  targetDate: string
  generationResultKind: PlanningGenerationResultKind
  contextSummary: readonly PlanningContextSummaryItem[]
  candidates: readonly PlanningRunCandidateCreateInput[]
}

export type PlanningEditBefore = Partial<PlanningCandidateSnapshot>

export type PlanningSourceRelation =
  | { available: true; id: number; label: string }
  | { available: false; id: number }

export type PlanningTaskRelation =
  | { available: true; title: string; status: string }
  | { available: false }

export interface PlanningRunCandidateRecord extends PlanningCandidateSnapshot {
  id: number
  ordinal: number
  admissionOrigin: PlanningCandidateAdmissionOrigin
  editBefore: PlanningEditBefore
  editBeforeSourceRelations: {
    subject: PlanningSourceRelation | null
    mistake: PlanningSourceRelation | null
    entry: PlanningSourceRelation | null
  }
  userDisposition: PlanningCandidateDisposition
  outcomeKind: PlanningCandidateOutcomeKind | null
  outcomeObservedAt: string | null
  admittedAt: string
  updatedAt: string
  sourceRelations: {
    subject: PlanningSourceRelation | null
    mistake: PlanningSourceRelation | null
    entry: PlanningSourceRelation | null
  }
  taskRelation: PlanningTaskRelation | null
  executionAttribution: PlanningExecutionAttribution | null
}

export interface PlanningRunRecord {
  id: string
  entryPoint: PlanningEntryPoint
  planningDate: string
  targetDate: string
  generationResultKind: PlanningGenerationResultKind
  contextSummary: PlanningContextSummaryItem[]
  createdAt: string
  updatedAt: string
  closedAt: string | null
  closeReason: PlanningRunCloseReason | null
  candidates: PlanningRunCandidateRecord[]
}

export type PlanningRunTransitionRequest =
  | {
      kind: 'admit_repaired_candidate'
      runId: string
      candidate: Omit<PlanningRunCandidateCreateInput, 'admissionOrigin'>
    }
  | {
      kind: 'commit_candidate'
      runId: string
      ordinal: number
      candidate: PlanningCandidateSnapshot
    }
  | {
      kind: 'set_selection'
      runId: string
      ordinal: number
      selected: boolean
    }
  | {
      kind: 'remove_candidate'
      runId: string
      ordinal: number
    }
  | {
      kind: 'close_run'
      runId: string
      reason: Exclude<PlanningRunCloseReason, 'app_closed'>
    }

export interface PlanningRunListCursor {
  beforeCreatedAt: string
  beforeId: string
}

export interface PlanningRunListResult {
  items: PlanningRunRecord[]
  nextCursor: PlanningRunListCursor | null
}

export interface ElectronPlanningRunsAPI {
  create: (request: PlanningRunCreateRequest) => Promise<PlanningRunRecord>
  transition: (request: PlanningRunTransitionRequest) => Promise<PlanningRunRecord>
  listRecent: (options?: {
    limit?: number
    cursor?: PlanningRunListCursor
  }) => Promise<PlanningRunListResult>
  get: (id: string) => Promise<PlanningRunRecord | null>
  delete: (request: { runId: string | null }) => Promise<{ deleted?: boolean; deletedCount?: number }>
}
