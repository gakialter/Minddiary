import type { PlanningFeedbackPayload } from './planningFeedback'

export type PlanningStrategyId = 'balanced' | 'deep_focus' | 'light_load'

export interface PlanningStrategyMetadata {
  readonly id: PlanningStrategyId
  readonly label: string
  readonly description: string
}

export const DEFAULT_PLANNING_STRATEGY_ID: PlanningStrategyId = 'balanced'

export const PLANNING_STRATEGY_IDS: readonly PlanningStrategyId[] = Object.freeze([
  'balanced',
  'deep_focus',
  'light_load',
] as const)

export const PLANNING_STRATEGY_METADATA: Readonly<Record<PlanningStrategyId, PlanningStrategyMetadata>> = Object.freeze({
  balanced: Object.freeze({
    id: 'balanced',
    label: '均衡规划',
    description: '兼顾重要复习与新知推进，保持各科目合理分配与适度节奏。',
  }),
  deep_focus: Object.freeze({
    id: 'deep_focus',
    label: '深度专注',
    description: '倾向于较少数量的大颗粒度连续学习块，聚焦核心科目攻坚，减少频繁切换。',
  }),
  light_load: Object.freeze({
    id: 'light_load',
    label: '轻量推进',
    description: '倾向于低启动门槛的小颗粒度行动，优先消化错题与轻量任务，平缓推进。',
  }),
})

export const PLANNING_STRATEGIES: readonly PlanningStrategyMetadata[] = Object.freeze(
  PLANNING_STRATEGY_IDS.map(id => PLANNING_STRATEGY_METADATA[id]),
)

export function isPlanningStrategyId(value: unknown): value is PlanningStrategyId {
  return typeof value === 'string' && PLANNING_STRATEGY_IDS.includes(value as PlanningStrategyId)
}

export function requirePlanningStrategyId(value: unknown): PlanningStrategyId {
  if (!isPlanningStrategyId(value)) {
    throw new Error(`Invalid planning strategy id: ${String(value)}`)
  }
  return value
}

export function getPlanningStrategyMetadata(id: unknown): PlanningStrategyMetadata {
  const strategyId = requirePlanningStrategyId(id)
  return PLANNING_STRATEGY_METADATA[strategyId]
}

const TODAY_ACTION_STRATEGY_DIRECTIVES: Readonly<Record<PlanningStrategyId, string>> = Object.freeze({
  balanced: '规划策略：均衡规划（balanced）。兼顾任务时长与学科分布，平衡重要复习与新知推进，避免过度偏向单一重度任务或零碎琐事。',
  deep_focus: '规划策略：深度专注（deep_focus）。倾向于建议较少数量、较长连续时长的单科目深度学习块，减少科目频繁切换，优先安排需要高度沉浸的核心攻坚或系统性复习。',
  light_load: '规划策略：轻量推进（light_load）。倾向于建议启动门槛低、单项时长适中偏短、易于执行的行动，优先消化到期错题或完成小颗粒度目标，避免安排高负荷长时任务。',
})

const DAILY_REVIEW_STRATEGY_DIRECTIVES: Readonly<Record<PlanningStrategyId, string>> = Object.freeze({
  balanced: '规划策略：均衡规划（balanced）。次日候选任务兼顾各学科复习与新内容推进，单项时长适中，节奏平稳。',
  deep_focus: '规划策略：深度专注（deep_focus）。次日候选任务倾向于安排少数重点科目的深度专注块，减少多科目碎片化切换。',
  light_load: '规划策略：轻量推进（light_load）。次日候选任务倾向于轻量、低启动负担的温和推进，优先清理到期错题或小切口行动，避免重负荷任务。',
})

export function renderPlanningStrategyDirective(
  operationKind: 'today_action' | 'daily_review',
  strategyId: PlanningStrategyId,
): string {
  const validStrategyId = requirePlanningStrategyId(strategyId)
  if (operationKind === 'today_action') {
    return TODAY_ACTION_STRATEGY_DIRECTIVES[validStrategyId]
  }
  if (operationKind === 'daily_review') {
    return DAILY_REVIEW_STRATEGY_DIRECTIVES[validStrategyId]
  }
  throw new Error(`Unsupported operation kind for planning strategy: ${String(operationKind)}`)
}

export function buildTodayActionGenerationContextSignature({
  baseDomainContextSignature,
  strategyId,
  feedbackPayload,
}: {
  baseDomainContextSignature: string
  strategyId: PlanningStrategyId
  feedbackPayload?: PlanningFeedbackPayload | null
}): string {
  return JSON.stringify({
    baseDomainContextSignature,
    strategyId: requirePlanningStrategyId(strategyId),
    feedback: feedbackPayload && feedbackPayload.items.length > 0 ? feedbackPayload : null,
  })
}

export function buildDailyReviewGenerationContextSignature({
  baseDomainContextSignature,
  strategyId,
}: {
  baseDomainContextSignature: string
  strategyId: PlanningStrategyId
}): string {
  return JSON.stringify({
    baseDomainContextSignature,
    strategyId: requirePlanningStrategyId(strategyId),
  })
}
