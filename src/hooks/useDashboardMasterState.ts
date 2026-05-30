import { TodayDashboardData } from '../types'

export type DashboardStateType = 'A' | 'B' | 'C' | 'D'

export interface DashboardStateConfig {
    type: DashboardStateType
    title: string
    subtitle: string
    ctaText: string
    explanation: string
}

const RISK_THRESHOLD = 5
const LOW_CONVERSION_THRESHOLD = 50
const HIGH_EFFORT_SESSION_THRESHOLD = 3

/**
 * Determines the current "Commander" state of the dashboard based on real-time data.
 * Adheres strictly to the 4 predefined states from the wireframe spec.
 */
export function useDashboardMasterState(data: TodayDashboardData | null): DashboardStateConfig {
    if (!data) {
        return {
            type: 'D',
            title: '正在加载系统判断...',
            subtitle: '准备拉取最新学习核心指标。',
            ctaText: '请稍候...',
            explanation: '系统正在加载今日专注和风险数据，加载完成后会给出具体建议。',
        }
    }

    const { commanderMetrics, pomodoroToday } = data
    const { riskPoolCount, focusConversionRate } = commanderMetrics

    if (data.streakDays === 0 && riskPoolCount === 0 && pomodoroToday.sessionCount === 0) {
        return {
            type: 'D',
            title: '先用一次完整闭环，把今天的节奏重新拉起来。',
            subtitle: '完成 1 个番茄、1 条复盘、1 次错题整理后，系统会恢复更准确的建议。',
            ctaText: '先完成 1 轮复习',
            explanation: '今天暂无有效专注和风险数据，所以建议先完成一轮最小学习闭环。',
        }
    }

    if (riskPoolCount >= RISK_THRESHOLD) {
        const estMinutes = riskPoolCount * 3
        return {
            type: 'A',
            title: `今天有 ${riskPoolCount} 个高风险知识点待抢救。`,
            subtitle: `预计 ${estMinutes} 分钟完成首轮抢救，建议优先锁定分数。`,
            ctaText: `立即开始 ${estMinutes} 分钟抢救`,
            explanation: `当前建议来自：待复习错题 ${riskPoolCount} ≥ ${RISK_THRESHOLD}，所以优先进入抢救模式。`,
        }
    }

    if (
        pomodoroToday.sessionCount >= HIGH_EFFORT_SESSION_THRESHOLD
        && focusConversionRate < LOW_CONVERSION_THRESHOLD
    ) {
        return {
            type: 'C',
            title: '今天更需要把学习沉淀下来，而不是继续堆时长。',
            subtitle: `你的有效专注转化率为 ${focusConversionRate}%，建议先完成 1 次复盘或整理 3 道错题。`,
            ctaText: '先整理 3 道错题',
            explanation: `你今天已完成 ${pomodoroToday.sessionCount} 个番茄，但有效专注转化率 ${focusConversionRate}% < ${LOW_CONVERSION_THRESHOLD}%，所以建议先整理错题，而不是继续堆时长。`,
        }
    }

    const nextSession = pomodoroToday.sessionCount + 1
    return {
        type: 'B',
        title: '今天没有明显遗忘风险，适合推进新内容。',
        subtitle: '建议完成后续番茄，并沉淀复盘记录维持高转化率。',
        ctaText: `开始今天第 ${nextSession} 个有效番茄`,
        explanation: '当前没有明显遗忘风险，可以继续推进新内容。',
    }
}
