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
    taskFocusToday: {
      effectiveTaskCount: 0,
      completedTaskCount: 0,
      completionRate: 0,
      focusedTaskCount: 0,
      focusCoverageRate: 0,
      focusedMinutes: 0,
      skippedTaskCount: 0,
      openWithoutFocusCount: 0,
      focusedOpenTaskCount: 0,
      unclosedTaskTitles: [],
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
    expect(state.explanation).toContain('正在加载')
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
    expect(state.title).toContain('完整闭环')
    expect(state.explanation).toBe('今天暂无有效专注和风险数据，所以建议先完成一轮最小学习闭环。')
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
    expect(state.explanation).toBe('当前建议来自：待复习错题 5 ≥ 5，所以优先进入抢救模式。')
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
    expect(state.explanation).toContain('待复习错题 6 ≥ 5')
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
    expect(state.title).toContain('学习沉淀下来')
    expect(state.subtitle).toContain('40%')
    expect(state.explanation).toBe('你今天已完成 3 个番茄，但有效专注转化率 40% < 50%，所以建议先整理错题，而不是继续堆时长。')
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
    expect(state.explanation).toBe('当前没有明显遗忘风险，可以继续推进新内容。')
  })

  it('State B ctaText shows "第 1 个" when today has 0 sessions', () => {
    const state = useDashboardMasterState(
      makeMockData({
        streakDays: 3,
        commanderMetrics: { riskPoolCount: 0, focusConversionRate: 80 },
        pomodoroToday: { sessionCount: 0 },
      }),
    )

    expect(state.type).toBe('B')
    expect(state.ctaText).toBe('开始今天第 1 个有效番茄')
  })

  it('State B ctaText shows "第 2 个" when today has 1 session', () => {
    const state = useDashboardMasterState(
      makeMockData({
        streakDays: 3,
        commanderMetrics: { riskPoolCount: 0, focusConversionRate: 80 },
        pomodoroToday: { sessionCount: 1 },
      }),
    )

    expect(state.type).toBe('B')
    expect(state.ctaText).toBe('开始今天第 2 个有效番茄')
  })

  it('State B ctaText shows correct next number with multiple sessions', () => {
    const state = useDashboardMasterState(
      makeMockData({
        streakDays: 10,
        commanderMetrics: { riskPoolCount: 1, focusConversionRate: 90 },
        pomodoroToday: { sessionCount: 5 },
      }),
    )

    expect(state.type).toBe('B')
    expect(state.ctaText).toBe('开始今天第 6 个有效番茄')
  })

  it('loading state (null data) does not show a session-count CTA', () => {
    const state = useDashboardMasterState(null)

    expect(state.type).toBe('D')
    expect(state.ctaText).toBe('请稍候...')
    expect(state.ctaText).not.toContain('有效番茄')
  })
})
