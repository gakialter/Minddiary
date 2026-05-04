import { describe, expect, it } from 'vitest'
import { useDashboardMasterState } from '../src/hooks/useDashboardMasterState'
import type { TodayDashboardData } from '../src/types'

type MockDataOverrides = Partial<Omit<TodayDashboardData, 'commanderMetrics' | 'pomodoroToday'>> & {
  commanderMetrics?: Partial<TodayDashboardData['commanderMetrics']>
  pomodoroToday?: Partial<TodayDashboardData['pomodoroToday']>
}

const makeMockData = (overrides: MockDataOverrides = {}): TodayDashboardData => {
  const defaultData: TodayDashboardData = {
    todayEntry: {
      id: 1,
      title: '今日复盘',
      wordCount: 120,
      mood: 'happy',
    },
    pomodoroToday: {
      totalMinutes: 25,
      sessionCount: 1,
    },
    commanderMetrics: {
      riskPoolCount: 0,
      lockedKnowledgeGrowth: 1,
      focusConversionRate: 80,
    },
    streakDays: 1,
  }

  return {
    ...defaultData,
    ...overrides,
    pomodoroToday: {
      ...defaultData.pomodoroToday,
      ...overrides.pomodoroToday,
    },
    commanderMetrics: {
      ...defaultData.commanderMetrics,
      ...overrides.commanderMetrics,
    },
  }
}

describe('useDashboardMasterState', () => {
  it('returns loading state D when data is null', () => {
    const state = useDashboardMasterState(null)

    expect(state.type).toBe('D')
    expect(state.title).toBe('正在加载系统判断...')
  })

  it('returns cold-start state D when there is no streak, risk, or pomodoro data', () => {
    const state = useDashboardMasterState(
      makeMockData({
        streakDays: 0,
        commanderMetrics: { riskPoolCount: 0 },
        pomodoroToday: { sessionCount: 0 },
      }),
    )

    expect(state.type).toBe('D')
    expect(state.title).toContain('先用一次完整闭环')
  })

  it('returns high-risk state A with estimated rescue minutes', () => {
    const state = useDashboardMasterState(
      makeMockData({
        commanderMetrics: { riskPoolCount: 5 },
      }),
    )

    expect(state.type).toBe('A')
    expect(state.title).toContain('5 个高风险知识点')
    expect(state.subtitle).toContain('预计 15 分钟')
    expect(state.ctaText).toContain('15 分钟')
  })

  it('prioritizes high-risk state A over low-conversion state C', () => {
    const state = useDashboardMasterState(
      makeMockData({
        commanderMetrics: {
          riskPoolCount: 6,
          focusConversionRate: 30,
        },
        pomodoroToday: { sessionCount: 4 },
      }),
    )

    expect(state.type).toBe('A')
    expect(state.title).toContain('6 个高风险知识点')
  })

  it('returns low-conversion state C when effort is high but conversion is low', () => {
    const state = useDashboardMasterState(
      makeMockData({
        commanderMetrics: {
          riskPoolCount: 2,
          focusConversionRate: 40,
        },
        pomodoroToday: { sessionCount: 3 },
      }),
    )

    expect(state.type).toBe('C')
    expect(state.title).toContain('把学习沉淀下来')
    expect(state.subtitle).toContain('40%')
  })

  it('returns healthy progress state B as the fallback state', () => {
    const state = useDashboardMasterState(
      makeMockData({
        streakDays: 5,
        commanderMetrics: {
          riskPoolCount: 2,
          focusConversionRate: 85,
        },
        pomodoroToday: { sessionCount: 2 },
      }),
    )

    expect(state.type).toBe('B')
    expect(state.title).toContain('没有明显遗忘风险')
  })
})
