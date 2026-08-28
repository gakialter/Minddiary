import type {
    IdempotentAIStudyTaskCreateRequest,
    IdempotentAIStudyTaskCreateResponse,
    PrivilegedTodayActionV2CreateCommand,
    TodayActionCommittedStatus,
} from '../src/types/api'
import type { PlanningCandidateOutcomeKind } from '../src/types/planningHistory'
import type { CandidateIdentityClassification } from './planningHistory'

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
    runInTransaction: <T>(operation: () => T) => T
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

function opaquePlanningAuditIntegrityFailure(
    request: IdempotentAIStudyTaskCreateRequest,
): IdempotentAIStudyTaskCreateResponse {
    return {
        ok: false,
        operationId: request.operationId,
        code: 'INTEGRITY_ERROR',
        message: 'The study task could not be created safely.',
    }
}

type PrivilegedTodayActionPlanningAuditDependencies = {
    preflightReceipt: (
        request: PrivilegedTodayActionV2CreateCommand['request'],
        requestDigest: string,
    ) => IdempotentAIStudyTaskCreateResponse | null
    classifyCandidate: (
        planningCandidateId: number,
        operationId: string,
        planningDate: string,
        targetDate: string,
        request: PrivilegedTodayActionV2CreateCommand['request'],
    ) => CandidateIdentityClassification
    claim: (
        planningCandidateId: number,
        request: PrivilegedTodayActionV2CreateCommand['request'],
    ) => { claimed: true }
    execute: (
        request: PrivilegedTodayActionV2CreateCommand['request'],
    ) => IdempotentAIStudyTaskCreateResponse
    recordOutcome: (
        planningCandidateId: number,
        operationId: string,
        outcome: PlanningCandidateOutcomeKind,
    ) => { recorded: boolean } | void
    warn: (message: string, error?: unknown) => void
    runInTransaction: <T>(operation: () => T) => T
}

type CommittedStatusAuditDependencies = {
    planningCandidateId?: number
    recordOutcome: (
        planningCandidateId: number,
        operationId: string,
        outcome: PlanningCandidateOutcomeKind,
    ) => { recorded: boolean } | void
    warn: (message: string, error?: unknown) => void
    runInTransaction: <T>(operation: () => T) => T
}

function throwReadFailure(classification: { kind: 'READ_FAILURE'; error: unknown }): never {
    if (classification.error instanceof Error) throw classification.error
    throw new Error('Planning History candidate identity read failed')
}

function assertOutcomeRecorded(result: { recorded: boolean } | void): void {
    if (result?.recorded !== true) {
        throw new Error('Planning History definitive outcome was not durably recorded')
    }
}

function definitiveOutcomeWithoutReceipt(
    request: IdempotentAIStudyTaskCreateRequest,
    outcomeKind: PlanningCandidateOutcomeKind,
): IdempotentAIStudyTaskCreateResponse {
    if (outcomeKind === 'validation_error') {
        return {
            ok: false,
            operationId: request.operationId,
            code: 'INVALID_REQUEST',
            message: 'The confirmed request was already rejected.',
        }
    }
    if (outcomeKind === 'date_mismatch') {
        return {
            ok: false,
            operationId: request.operationId,
            code: 'DATE_MISMATCH',
            message: 'The confirmed date was already rejected.',
        }
    }
    return opaquePlanningAuditIntegrityFailure(request)
}

function constrainReceiptResponseToDefinitiveOutcome(
    response: IdempotentAIStudyTaskCreateResponse,
    outcomeKind: PlanningCandidateOutcomeKind,
    request: IdempotentAIStudyTaskCreateRequest,
): IdempotentAIStudyTaskCreateResponse {
    if (!response.ok && response.code === 'INTEGRITY_ERROR') return response
    if (response.ok) {
        return outcomeKind === 'created' || outcomeKind === 'replayed'
            ? response
            : opaquePlanningAuditIntegrityFailure(request)
    }
    if (response.code === 'IDEMPOTENCY_CONFLICT') {
        return outcomeKind === 'conflict'
            ? response
            : opaquePlanningAuditIntegrityFailure(request)
    }
    if (response.code === 'RESULT_DELETED') {
        return outcomeKind === 'created'
            || outcomeKind === 'replayed'
            || outcomeKind === 'deleted'
            ? response
            : opaquePlanningAuditIntegrityFailure(request)
    }
    return opaquePlanningAuditIntegrityFailure(request)
}

function recordDefinitiveResponse(
    command: PrivilegedTodayActionV2CreateCommand,
    response: IdempotentAIStudyTaskCreateResponse,
    dependencies: PrivilegedTodayActionPlanningAuditDependencies,
): IdempotentAIStudyTaskCreateResponse {
    return dependencies.runInTransaction(() => {
        assertOutcomeRecorded(dependencies.recordOutcome(
            command.planningCandidateId,
            command.request.operationId,
            deriveOutcome(response),
        ))
        return response
    })
}

function executeFreshPhase2(
    command: PrivilegedTodayActionV2CreateCommand,
    dependencies: PrivilegedTodayActionPlanningAuditDependencies,
): IdempotentAIStudyTaskCreateResponse {
    try {
        return dependencies.runInTransaction(() => {
            const response = dependencies.execute(command.request)
            assertOutcomeRecorded(dependencies.recordOutcome(
                command.planningCandidateId,
                command.request.operationId,
                deriveOutcome(response),
            ))
            return response
        })
    } catch (error) {
        dependencies.warn('Planning History Today Phase 2 transaction failed', error)
        throw error
    }
}

function resolveReceiptPreflight(
    command: PrivilegedTodayActionV2CreateCommand,
    response: IdempotentAIStudyTaskCreateResponse,
    classification: CandidateIdentityClassification,
    dependencies: PrivilegedTodayActionPlanningAuditDependencies,
): IdempotentAIStudyTaskCreateResponse {
    switch (classification.kind) {
        case 'READ_FAILURE': return throwReadFailure(classification)
        case 'EXACT_MISMATCH':
        case 'EXACT_CORRUPT':
        case 'ABSENT_COMPETING_OPERATION':
            return opaquePlanningAuditIntegrityFailure(command.request)
        case 'EXACT_UNCONFIRMED':
        case 'ABSENT_NO_COMPETING_OPERATION':
            // Historical full-request compatibility is business replay only.
            return response
        case 'EXACT_CONFIRMED_MATCH':
            if (
                classification.outcomeKind === null
                || classification.outcomeKind === 'uncertain'
            ) {
                return recordDefinitiveResponse(command, response, dependencies)
            }
            return constrainReceiptResponseToDefinitiveOutcome(
                response,
                classification.outcomeKind,
                command.request,
            )
    }
}

export function executePrivilegedTodayActionV2CommandWithPlanningAudit(
    command: PrivilegedTodayActionV2CreateCommand,
    requestDigest: string,
    dependencies: PrivilegedTodayActionPlanningAuditDependencies,
): IdempotentAIStudyTaskCreateResponse {
    // Main has already structurally validated command/request and computed H(request).
    const receiptResponse = dependencies.preflightReceipt(command.request, requestDigest)
    const classification = dependencies.classifyCandidate(
        command.planningCandidateId,
        command.request.operationId,
        command.request.expectedCurrentDate,
        command.request.payload.planned_date,
        command.request,
    )
    if (receiptResponse !== null) {
        return resolveReceiptPreflight(command, receiptResponse, classification, dependencies)
    }

    switch (classification.kind) {
        case 'READ_FAILURE': return throwReadFailure(classification)
        case 'EXACT_MISMATCH':
        case 'EXACT_CORRUPT':
        case 'ABSENT_NO_COMPETING_OPERATION':
        case 'ABSENT_COMPETING_OPERATION':
            return opaquePlanningAuditIntegrityFailure(command.request)
        case 'EXACT_CONFIRMED_MATCH':
            if (
                classification.outcomeKind !== null
                && classification.outcomeKind !== 'uncertain'
            ) {
                return definitiveOutcomeWithoutReceipt(
                    command.request,
                    classification.outcomeKind,
                )
            }
            throw new Error(
                'The Today Action operation is already accepted and requires status-first recovery',
            )
        case 'EXACT_UNCONFIRMED': {
            try {
                const claim = dependencies.claim(command.planningCandidateId, command.request)
                if (claim.claimed !== true) {
                    throw new Error('Planning History confirmation claim was not durably acknowledged')
                }
            } catch (error) {
                dependencies.warn('Planning History confirmation claim failed', error)
                throw error
            }
            return executeFreshPhase2(command, dependencies)
        }
    }
}

function constrainCommittedStatusToOutcome(
    status: TodayActionCommittedStatus,
    outcomeKind: PlanningCandidateOutcomeKind,
): TodayActionCommittedStatus {
    const operationId = status.operationId
    if (status.status === 'INTEGRITY_ERROR') return status
    if (status.status === 'RECOVERED_COMMITTED') {
        return outcomeKind === 'created' || outcomeKind === 'replayed'
            ? status
            : { status: 'INTEGRITY_ERROR', operationId }
    }
    if (status.status === 'RESULT_DELETED') {
        return outcomeKind === 'created'
            || outcomeKind === 'replayed'
            || outcomeKind === 'deleted'
            ? status
            : { status: 'INTEGRITY_ERROR', operationId }
    }
    if (status.status === 'IDEMPOTENCY_CONFLICT') {
        return outcomeKind === 'conflict'
            ? status
            : { status: 'INTEGRITY_ERROR', operationId }
    }
    return outcomeKind === 'validation_error' || outcomeKind === 'date_mismatch'
        ? status
        : { status: 'INTEGRITY_ERROR', operationId }
}

function recordCommittedStatusOutcome(
    status: Exclude<TodayActionCommittedStatus, { status: 'NOT_COMMITTED' | 'IDEMPOTENCY_CONFLICT' }>,
    dependencies: CommittedStatusAuditDependencies,
): TodayActionCommittedStatus {
    const planningCandidateId = dependencies.planningCandidateId
    if (planningCandidateId === undefined) {
        throw new Error('Planning candidate identity is required for status reconciliation')
    }
    const outcomeKind: PlanningCandidateOutcomeKind = status.status === 'RECOVERED_COMMITTED'
        ? 'replayed'
        : status.status === 'RESULT_DELETED'
            ? 'deleted'
            : 'integrity_error'
    try {
        return dependencies.runInTransaction(() => {
            assertOutcomeRecorded(dependencies.recordOutcome(
                planningCandidateId,
                status.operationId,
                outcomeKind,
            ))
            return status
        })
    } catch (error) {
        dependencies.warn('Planning History committed-status reconciliation failed', error)
        throw error
    }
}

export function reconcileCommittedStudyTaskStatusWithPlanningAudit(
    status: TodayActionCommittedStatus,
    classification: CandidateIdentityClassification | null,
    dependencies: CommittedStatusAuditDependencies,
): TodayActionCommittedStatus {
    const operationId = status.operationId
    if (classification === null) {
        return status.status === 'RECOVERED_COMMITTED' || status.status === 'RESULT_DELETED'
            ? { status: 'INTEGRITY_ERROR', operationId }
            : status
    }
    switch (classification.kind) {
        case 'READ_FAILURE': return throwReadFailure(classification)
        case 'EXACT_MISMATCH':
        case 'EXACT_CORRUPT':
        case 'ABSENT_COMPETING_OPERATION':
            return { status: 'INTEGRITY_ERROR', operationId }
        case 'EXACT_UNCONFIRMED':
            return status.status === 'NOT_COMMITTED'
                ? status
                : { status: 'INTEGRITY_ERROR', operationId }
        case 'ABSENT_NO_COMPETING_OPERATION':
            // Current-marker digest proof may recover business state, but never audit.
            return status
        case 'EXACT_CONFIRMED_MATCH':
            if (
                classification.outcomeKind !== null
                && classification.outcomeKind !== 'uncertain'
            ) {
                return constrainCommittedStatusToOutcome(status, classification.outcomeKind)
            }
            if (status.status === 'NOT_COMMITTED') return status
            // A local marker digest is not privileged conflict proof.
            if (status.status === 'IDEMPOTENCY_CONFLICT') {
                return { status: 'INTEGRITY_ERROR', operationId }
            }
            return recordCommittedStatusOutcome(status, dependencies)
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

    const outcomeKind = deriveOutcome(response)
    if (claimed) {
        try {
            dependencies.recordOutcome(
                planningCandidateId,
                request.operationId,
                outcomeKind,
            )
        } catch (error) {
            dependencies.warn('Planning History outcome write failed', error)
        }
    }
    return response
}
