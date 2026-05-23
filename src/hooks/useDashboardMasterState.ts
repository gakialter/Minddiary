import { TodayDashboardData } from '../types';

export type DashboardStateType = 'A' | 'B' | 'C' | 'D';

export interface DashboardStateConfig {
    type: DashboardStateType;
    title: string;
    subtitle: string;
    ctaText: string;
}

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
            ctaText: '请稍候...'
        };
    }

    const { commanderMetrics, pomodoroToday } = data;
    const { riskPoolCount, focusConversionRate } = commanderMetrics;

    // State D: Cold Start / No Data
    // If absolutely no history and 0 risks, we prompt the user to start a minimum loop.
    // We can assume user is cold if streak is 0 and no pomodoros today and no risks.
    if (data.streakDays === 0 && riskPoolCount === 0 && pomodoroToday.sessionCount === 0) {
        return {
            type: 'D',
            title: '先用一次完整闭环，把今天的节奏重新拉起来。',
            subtitle: '完成 1 个番茄、1 条复盘、1 次错题整理后，系统会恢复更准确的建议。',
            ctaText: '先完成 1 轮复习'
        };
    }

    // State A: High Risk
    const RISK_THRESHOLD = 5;
    if (riskPoolCount >= RISK_THRESHOLD) {
        const estMinutes = riskPoolCount * 3; // roughly 3 mins per question
        return {
            type: 'A',
            title: `今天有 ${riskPoolCount} 个高风险知识点待抢救。`,
            subtitle: `预计 ${estMinutes} 分钟完成首轮抢救，建议优先锁定分数。`,
            ctaText: `立即开始 ${estMinutes} 分钟抢救`
        };
    }

    // State C: Imbalanced (High effort, low yield)
    // E.g., user did 3+ pomodoros but conversion is < 50%
    if (pomodoroToday.sessionCount >= 3 && focusConversionRate < 50) {
        return {
            type: 'C',
            title: '今天更需要把学习沉淀下来，而不是继续堆时长。',
            subtitle: `你的有效专注转化率为 ${focusConversionRate}%，建议先完成 1 次复盘或整理 3 道错题。`,
            ctaText: '先整理 3 道错题'
        };
    }

    // State B: Steady progress (catch-all for healthy states)
    const nextSession = pomodoroToday.sessionCount + 1;
    return {
        type: 'B',
        title: '今天没有明显遗忘风险，适合推进新内容。',
        subtitle: '建议完成后续番茄，并沉淀复盘记录维持高转化率。',
        ctaText: `开始今天第 ${nextSession} 个有效番茄`
    };
}
