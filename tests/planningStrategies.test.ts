import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLANNING_STRATEGY_ID,
  PLANNING_STRATEGIES,
  PLANNING_STRATEGY_IDS,
  PLANNING_STRATEGY_METADATA,
  buildDailyReviewGenerationContextSignature,
  buildTodayActionGenerationContextSignature,
  getPlanningStrategyMetadata,
  isPlanningStrategyId,
  renderPlanningStrategyDirective,
  requirePlanningStrategyId,
  type PlanningStrategyId,
} from '../src/utils/planningStrategies'
import type { PlanningFeedbackPayload } from '../src/utils/planningFeedback'

describe('planningStrategies domain & metadata', () => {
  it('contains exactly the three closed strategies with balanced as default', () => {
    expect(PLANNING_STRATEGY_IDS).toEqual(['balanced', 'deep_focus', 'light_load'])
    expect(DEFAULT_PLANNING_STRATEGY_ID).toBe('balanced')
    expect(PLANNING_STRATEGIES.map(s => s.id)).toEqual(['balanced', 'deep_focus', 'light_load'])
  })

  it('provides immutable and canonical metadata for each strategy', () => {
    expect(getPlanningStrategyMetadata('balanced')).toEqual({
      id: 'balanced',
      label: '均衡规划',
      description: '兼顾重要复习与新知推进，保持各科目合理分配与适度节奏。',
    })
    expect(getPlanningStrategyMetadata('deep_focus')).toEqual({
      id: 'deep_focus',
      label: '深度专注',
      description: '倾向于较少数量的大颗粒度连续学习块，聚焦核心科目攻坚，减少频繁切换。',
    })
    expect(getPlanningStrategyMetadata('light_load')).toEqual({
      id: 'light_load',
      label: '轻量推进',
      description: '倾向于低启动门槛的小颗粒度行动，优先消化错题与轻量任务，平缓推进。',
    })

    for (const id of PLANNING_STRATEGY_IDS) {
      const meta = getPlanningStrategyMetadata(id)
      expect(meta.id).toBe(id)
      expect(Object.isFrozen(meta)).toBe(true)
    }
    expect(Object.isFrozen(PLANNING_STRATEGY_METADATA)).toBe(true)
    expect(Object.isFrozen(PLANNING_STRATEGIES)).toBe(true)
  })

  it('validates strategy IDs and fails closed for invalid or unknown values', () => {
    expect(isPlanningStrategyId('balanced')).toBe(true)
    expect(isPlanningStrategyId('deep_focus')).toBe(true)
    expect(isPlanningStrategyId('light_load')).toBe(true)

    expect(isPlanningStrategyId('unknown')).toBe(false)
    expect(isPlanningStrategyId('')).toBe(false)
    expect(isPlanningStrategyId(null)).toBe(false)
    expect(isPlanningStrategyId(123)).toBe(false)
    expect(isPlanningStrategyId('BALANCED')).toBe(false)

    expect(requirePlanningStrategyId('balanced')).toBe('balanced')
    expect(() => requirePlanningStrategyId('unknown')).toThrow('Invalid planning strategy id')
    expect(() => getPlanningStrategyMetadata('invalid')).toThrow('Invalid planning strategy id')
  })

  it('renders exact operation-specific prompt directives for each strategy', () => {
    expect(renderPlanningStrategyDirective('today_action', 'balanced')).toBe(
      '规划策略：均衡规划（balanced）。兼顾任务时长与学科分布，平衡重要复习与新知推进，避免过度偏向单一重度任务或零碎琐事。',
    )
    expect(renderPlanningStrategyDirective('today_action', 'deep_focus')).toBe(
      '规划策略：深度专注（deep_focus）。倾向于建议较少数量、较长连续时长的单科目深度学习块，减少科目频繁切换，优先安排需要高度沉浸的核心攻坚或系统性复习。',
    )
    expect(renderPlanningStrategyDirective('today_action', 'light_load')).toBe(
      '规划策略：轻量推进（light_load）。倾向于建议启动门槛低、单项时长适中偏短、易于执行的行动，优先消化到期错题或完成小颗粒度目标，避免安排高负荷长时任务。',
    )

    expect(renderPlanningStrategyDirective('daily_review', 'balanced')).toBe(
      '规划策略：均衡规划（balanced）。次日候选任务兼顾各学科复习与新内容推进，单项时长适中，节奏平稳。',
    )
    expect(renderPlanningStrategyDirective('daily_review', 'deep_focus')).toBe(
      '规划策略：深度专注（deep_focus）。次日候选任务倾向于安排少数重点科目的深度专注块，减少多科目碎片化切换。',
    )
    expect(renderPlanningStrategyDirective('daily_review', 'light_load')).toBe(
      '规划策略：轻量推进（light_load）。次日候选任务倾向于轻量、低启动负担的温和推进，优先清理到期错题或小切口行动，避免重负荷任务。',
    )

    // @ts-expect-error test unsupported operation kind
    expect(() => renderPlanningStrategyDirective('mistake_review', 'balanced')).toThrow(
      'Unsupported operation kind',
    )
  })
})

describe('planningStrategies signature builders', () => {
  it('builds generation input signature for today_action with and without feedback', () => {
    const baseDomainContextSignature = '{"date":"2026-06-12","availableMinutes":90}'
    const sigNoFeedback = buildTodayActionGenerationContextSignature({
      baseDomainContextSignature,
      strategyId: 'deep_focus',
    })
    expect(JSON.parse(sigNoFeedback)).toEqual({
      baseDomainContextSignature,
      strategyId: 'deep_focus',
      feedback: null,
    })

    const feedbackPayload: PlanningFeedbackPayload = {
      feedback_contract: 'planning-feedback.v1',
      items: [{
        target_date: '2026-06-11',
        title: '复习极限',
        type: 'review',
        estimate_minutes: 25,
        current_status: 'done',
        explicit_focus_minutes: 30,
        explicit_focus_sessions: 1,
      }],
    }
    const sigWithFeedback = buildTodayActionGenerationContextSignature({
      baseDomainContextSignature,
      strategyId: 'light_load',
      feedbackPayload,
    })
    expect(JSON.parse(sigWithFeedback)).toEqual({
      baseDomainContextSignature,
      strategyId: 'light_load',
      feedback: feedbackPayload,
    })
  })

  it('builds generation input signature for daily_review', () => {
    const baseDomainContextSignature = '{"reviewDate":"2026-06-12","candidateDate":"2026-06-13"}'
    const sig = buildDailyReviewGenerationContextSignature({
      baseDomainContextSignature,
      strategyId: 'balanced',
    })
    expect(JSON.parse(sig)).toEqual({
      baseDomainContextSignature,
      strategyId: 'balanced',
    })
  })
})
