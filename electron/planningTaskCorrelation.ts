import type {
    IdempotentAIStudyTaskCreateRequest,
    IdempotentAIStudyTaskCreateResponse,
} from '../src/types/api'
import type { PlanningCandidateOutcomeKind } from '../src/types/planningHistory'

type PlanningTaskCorrelationDependencies = {
    claim: (
        planningCandidateId: unknown,
        request: unknown,
    ) => { claimed: true }
    execute: (request: unknown) => IdempotentAIStudyTaskCreateResponse
    recordOutcome: (
        planningCandidateId: unknown,
        operationId: unknown,
        outcome: unknown,
    ) => { recorded: boolean } | void
    warn: (message: string, error?: unknown) => void
}

function deriveOutcome(
    response: IdempotentAIStudyTaskCreateResponse,
): PlanningCandidateOutcomeKind {
    if (response.ok) return response.replayed ? 'replayed' : 'created'
    switch (response.code) {
        case 'IDEMPOTENCY_CONFLICT': return 'conflict'
        case 'RESULT_DELETED': return 'deleted'
        case 'INTEGRITY_ERROR': return 'integrity_error'
        case 'DATE_MISMATCH': return 'date_mismatch'
        case 'INVALID_REQUEST': return 'validation_error'
    }
}

export function executeStudyTaskCommandWithPlanningAudit(
    request: IdempotentAIStudyTaskCreateRequest,
    planningCandidateId: unknown,
    dependencies: PlanningTaskCorrelationDependencies,
): IdempotentAIStudyTaskCreateResponse {
    let claimed = false
    if (planningCandidateId !== undefined) {
        try {
            claimed = dependencies.claim(planningCandidateId, request).claimed === true
        } catch (error) {
            dependencies.warn('Planning History confirmation claim failed', error)
        }
    }

    let response: IdempotentAIStudyTaskCreateResponse
    try {
        response = dependencies.execute(request)
    } catch (error) {
        if (claimed) {
            try {
                dependencies.recordOutcome(
                    planningCandidateId,
                    request.operationId,
                    'uncertain',
                )
            } catch (auditError) {
                dependencies.warn('Planning History uncertain outcome write failed', auditError)
            }
        }
        throw error
    }

    if (claimed) {
        try {
            dependencies.recordOutcome(
                planningCandidateId,
                request.operationId,
                deriveOutcome(response),
            )
        } catch (error) {
            dependencies.warn('Planning History outcome write failed', error)
        }
    }
    return response
}
