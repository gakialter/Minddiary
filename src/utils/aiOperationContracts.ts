export type AIStudyTaskOperationKind =
  | 'today_action'
  | 'daily_review'
  | 'mistake_review'

export interface AIOperationContractVersions {
  readonly promptVersion: string
  readonly responseSchemaVersion: string
  readonly parserVersion: string
  readonly policyVersion: string
  readonly contextProjectionVersion: string
  readonly actionContractVersion: string
}

export interface AIStudyTaskOperationContract
  extends AIOperationContractVersions {
  readonly operationKind: AIStudyTaskOperationKind
}

export interface AIStudyTaskGenerationProvenance {
  readonly operationKind: AIStudyTaskOperationKind
  readonly versions: AIOperationContractVersions
  readonly generationContextSignature: string
}

export const CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION = 'confirmed-study-task-action.v1'
export const CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION = 'confirmed-mistake-review-task-action.v2'

export const AI_STUDY_TASK_OPERATION_KINDS = Object.freeze([
  'today_action',
  'daily_review',
  'mistake_review',
] as const)

const VERSION_KEYS = [
  'promptVersion',
  'responseSchemaVersion',
  'parserVersion',
  'policyVersion',
  'contextProjectionVersion',
  'actionContractVersion',
] as const

const PROVENANCE_KEYS = [
  'operationKind',
  'versions',
  'generationContextSignature',
] as const

function freezeContract(
  contract: AIStudyTaskOperationContract,
): AIStudyTaskOperationContract {
  return Object.freeze(contract)
}

const OPERATION_CONTRACTS: Readonly<Record<
  AIStudyTaskOperationKind,
  AIStudyTaskOperationContract
>> = Object.freeze({
  today_action: freezeContract({
    operationKind: 'today_action',
    promptVersion: 'today-action.prompt.v3',
    responseSchemaVersion: 'today-action.response-schema.v1',
    parserVersion: 'today-action.parser.v1',
    policyVersion: 'today-action.policy.v1',
    contextProjectionVersion: 'today-action.context-projection.v1',
    actionContractVersion: CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION,
  }),
  daily_review: freezeContract({
    operationKind: 'daily_review',
    promptVersion: 'daily-review.prompt.v2',
    responseSchemaVersion: 'daily-review.response-schema.v1',
    parserVersion: 'daily-review.parser.v1',
    policyVersion: 'daily-review.policy.v1',
    contextProjectionVersion: 'daily-review.context-projection.v1',
    actionContractVersion: CONFIRMED_STUDY_TASK_ACTION_CONTRACT_VERSION,
  }),
  mistake_review: freezeContract({
    operationKind: 'mistake_review',
    promptVersion: 'mistake-review.prompt.v1',
    responseSchemaVersion: 'mistake-review.response-schema.v1',
    parserVersion: 'mistake-review.parser.v1',
    policyVersion: 'mistake-review.policy.v1',
    contextProjectionVersion: 'mistake-review.context-projection.v1',
    actionContractVersion: CONFIRMED_MISTAKE_REVIEW_TASK_ACTION_CONTRACT_VERSION,
  }),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(record).filter(key => !allowed.includes(key))
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unsupported.join(', ')}`)
  }
  const missing = allowed.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
  if (missing.length > 0) {
    throw new Error(`${label} is missing required fields: ${missing.map(key => `${label}.${key}`).join(', ')}`)
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireOperationKind(value: unknown): AIStudyTaskOperationKind {
  if (value !== 'today_action' && value !== 'daily_review' && value !== 'mistake_review') {
    throw new Error('AI study task operation kind is invalid')
  }
  return value
}

function freezeVersions(
  versions: AIOperationContractVersions,
): AIOperationContractVersions {
  return Object.freeze(versions)
}

function versionsFromContract(
  contract: AIStudyTaskOperationContract,
): AIOperationContractVersions {
  return freezeVersions({
    promptVersion: contract.promptVersion,
    responseSchemaVersion: contract.responseSchemaVersion,
    parserVersion: contract.parserVersion,
    policyVersion: contract.policyVersion,
    contextProjectionVersion: contract.contextProjectionVersion,
    actionContractVersion: contract.actionContractVersion,
  })
}

export function getAIStudyTaskOperationContract(
  kind: unknown,
): AIStudyTaskOperationContract {
  return OPERATION_CONTRACTS[requireOperationKind(kind)]
}

export function createAIStudyTaskGenerationProvenance(
  kind: AIStudyTaskOperationKind,
  generationContextSignature: string,
): AIStudyTaskGenerationProvenance {
  const contract = getAIStudyTaskOperationContract(kind)
  return Object.freeze({
    operationKind: contract.operationKind,
    versions: versionsFromContract(contract),
    generationContextSignature: requireNonEmptyString(
      generationContextSignature,
      'generation context signature',
    ),
  })
}

export function validateAIStudyTaskGenerationProvenance(
  value: unknown,
  expectedMode: AIStudyTaskOperationKind,
): AIStudyTaskGenerationProvenance {
  const provenance = requireRecord(value, 'AI study task generation provenance')
  assertOnlyKeys(provenance, PROVENANCE_KEYS, 'AI study task generation provenance')
  const operationKind = requireOperationKind(provenance.operationKind)
  const canonical = getAIStudyTaskOperationContract(expectedMode)
  if (operationKind !== expectedMode) {
    throw new Error('AI study task operation kind does not match action mode')
  }

  const versions = requireRecord(provenance.versions, 'AI study task operation versions')
  assertOnlyKeys(versions, VERSION_KEYS, 'AI study task operation versions')
  const validatedVersions = Object.fromEntries(VERSION_KEYS.map(key => [
    key,
    requireNonEmptyString(versions[key], `AI study task operation versions.${key}`),
  ])) as unknown as AIOperationContractVersions

  for (const key of VERSION_KEYS) {
    if (validatedVersions[key] !== canonical[key]) {
      throw new Error(`AI study task operation versions.${key} is not canonical`)
    }
  }

  return Object.freeze({
    operationKind,
    versions: freezeVersions(validatedVersions),
    generationContextSignature: requireNonEmptyString(
      provenance.generationContextSignature,
      'generation context signature',
    ),
  })
}
