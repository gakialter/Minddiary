import { useState, useEffect, useMemo } from 'react';
import { getTodayStr } from '../utils/helpers';
import { getLocalDateKey } from '../utils/dateKey';
import { useDiary } from '../contexts/DiaryContext';
import { logger } from '../utils/logger';
import { normalizeCountdownEvents } from '../utils/countdown';
import { Flame, Clock3, Target, TrendingUp, CalendarDays, RefreshCw } from 'lucide-react';
import type { PomodoroRangeEntry, Mistake } from '../types';
import CountdownEventsPanel from './CountdownEventsPanel';
import FocusDistributionChart from './FocusDistributionChart';

interface DashboardStats {
    totalPomodoroMinutes: number
    sessionCount: number
    streakDays: number
    masteredMistakes: number
    totalMistakes: number
    dueMistakes: number
}

interface WeeklyDataPoint {
    date: string
    label: string
    value: number
}

interface HeatmapDataPoint {
    date: string
    hasEntry: boolean
    mood: string | null
}

export default function Dashboard() {
    const { pomodoro, dashboard, mistakes, todayDashboard, settingsData, dataRefreshVersion } = useDiary();
    const [stats, setStats] = useState<DashboardStats>({
        totalPomodoroMinutes: 0,
        sessionCount: 0,
        streakDays: 0,
        masteredMistakes: 0,
        totalMistakes: 0,
        dueMistakes: 0,
    });
    const [weeklyData, setWeeklyData] = useState<WeeklyDataPoint[]>([]);
    const [heatmapData, setHeatmapData] = useState<HeatmapDataPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadDashboardData();
    }, [dataRefreshVersion]);

    const loadDashboardData = async () => {
        setLoading(true);
        setError(null);
        try {
            const today = new Date();

            // 7 Days Range (Trend)
            const weekAgo = new Date(today);
            weekAgo.setDate(today.getDate() - 6);
            const startWeek = getLocalDateKey(weekAgo);
            const endWeek = getLocalDateKey(today);

            // 90 Days Range (Heatmap)
            const threeMonthsAgo = new Date(today);
            threeMonthsAgo.setDate(today.getDate() - 89);
            const startHeatmap = getLocalDateKey(threeMonthsAgo);

            const [
                pomodoroWeek,
                mistakesList,
                heatmapEntries,
                pomodoroAllTime,
                todaySummary
            ] = await Promise.all([
                pomodoro.getRange(startWeek, endWeek).catch(() => [] as PomodoroRangeEntry[]),
                mistakes.getAll({}).catch(() => [] as Mistake[]),
                dashboard.entryDatesRange(startHeatmap, endWeek).catch(() => [] as Array<{ date: string; mood: string | null }>),
                pomodoro.getRange('2000-01-01', endWeek).catch(() => [] as PomodoroRangeEntry[]),
                todayDashboard.getData(endWeek).catch(() => ({
                    todayEntry: null,
                    pomodoroToday: { totalMinutes: 0, sessionCount: 0 },
                    commanderMetrics: {
                        riskPoolCount: 0,
                        lockedKnowledgeGrowth: 0,
                        focusConversionRate: 0,
                    },
                    streakDays: 0,
                }))
            ]);

            // Calculate overall stats
            const totalMins = (pomodoroAllTime as PomodoroRangeEntry[]).reduce((sum: number, day: PomodoroRangeEntry) => sum + day.total_minutes, 0);
            const totalSessions = (pomodoroAllTime as PomodoroRangeEntry[]).reduce((sum: number, day: PomodoroRangeEntry) => sum + day.session_count, 0);

            const mistArray = mistakesList && 'data' in (mistakesList as any) ? (mistakesList as any).data : mistakesList;

            setStats({
                totalPomodoroMinutes: totalMins,
                sessionCount: totalSessions,
                streakDays: todaySummary.streakDays,
                masteredMistakes: (mistArray as Mistake[]).filter(m => m.mastered).length,
                totalMistakes: (mistArray as Mistake[]).length,
                dueMistakes: todaySummary.commanderMetrics.riskPoolCount
            });

            // Format Weekly Data (Ensure 7 days are represented even if 0)
            const formattedWeek: WeeklyDataPoint[] = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(weekAgo);
                d.setDate(weekAgo.getDate() + i);
                const dStr = getLocalDateKey(d);
                const dayLabel = d.toLocaleDateString('zh-CN', { weekday: 'short' });

                const dayData = (pomodoroWeek as PomodoroRangeEntry[]).find(p => p.date === dStr);
                formattedWeek.push({
                    date: dStr,
                    label: dayLabel,
                    value: dayData ? dayData.total_minutes : 0
                });
            }
            setWeeklyData(formattedWeek);

            // Format Heatmap Data (Last 90 days)
            const hMap = new Map((heatmapEntries as Array<{ date: string; mood: string | null }>).map(e => [e.date, e.mood]));
            const formattedHeatmap: HeatmapDataPoint[] = [];
            for (let i = 0; i < 90; i++) {
                const d = new Date(threeMonthsAgo);
                d.setDate(threeMonthsAgo.getDate() + i);
                const dStr = getLocalDateKey(d);
                formattedHeatmap.push({
                    date: dStr,
                    hasEntry: hMap.has(dStr),
                    mood: hMap.get(dStr) || null
                });
            }
            setHeatmapData(formattedHeatmap);

        } catch (err: unknown) {
            logger.error('Failed to load dashboard:', err);
            setError(err instanceof Error ? err.message : '加载统计数据失败');
        } finally {
            setLoading(false);
        }
    };

    // --- SVG Charts Logics ---
    const maxWeeklyValue = useMemo(() => {
        const mx = Math.max(...weeklyData.map(d => d.value), 60); // Ensure at least 60m scale
        return Math.ceil(mx / 30) * 30; // Round up to nearest half-hour
    }, [weeklyData]);

    const formatDuration = (mins: number): string => {
        if (mins < 60) return `${mins} 分钟`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
    };

    const countdownEvents = useMemo(
        () => normalizeCountdownEvents(settingsData?.countdownEvents, settingsData?.examDate),
        [settingsData?.countdownEvents, settingsData?.examDate]
    );

    const hasWeeklyData = weeklyData.some(day => day.value > 0);
    const hasHeatmapData = heatmapData.some(day => day.hasEntry);
    const masteryRate = stats.totalMistakes > 0
        ? Math.round((stats.masteredMistakes / stats.totalMistakes) * 100)
        : 0;
    const firstWeeklyDate = weeklyData[0]?.date;
    const lastWeeklyDate = weeklyData[weeklyData.length - 1]?.date;
    const weeklyPeriod = firstWeeklyDate && lastWeeklyDate
        ? `${firstWeeklyDate} — ${lastWeeklyDate}`
        : '最近 7 日';

    if (loading) {
        return (
            <div className="statistics-dashboard statistics-dashboard--state" role="status" aria-live="polite">
                <div className="statistics-dashboard__state-copy">
                    <span className="statistics-dashboard__eyebrow">学习数据</span>
                    <h2>正在整理统计信息</h2>
                    <p>正在聚合并分析学习图谱...</p>
                </div>
                <div className="statistics-dashboard__loading-bars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="statistics-dashboard statistics-dashboard--state" role="alert">
                <div className="statistics-dashboard__state-icon" aria-hidden="true">
                    <TrendingUp size={24} />
                </div>
                <div className="statistics-dashboard__state-copy">
                    <span className="statistics-dashboard__eyebrow">数据状态</span>
                    <h2>统计信息暂时无法加载</h2>
                    <p>{error}</p>
                </div>
                <button type="button" className="button button-primary" onClick={loadDashboardData}>
                    <RefreshCw size={15} aria-hidden="true" /> 重新加载
                </button>
            </div>
        );
    }

    return (
        <div className="statistics-dashboard">
            <header className="statistics-dashboard__intro" aria-labelledby="dashboard-insight">
                <div>
                    <span className="statistics-dashboard__eyebrow">学习概览 · 数据截至今天</span>
                    <p id="dashboard-insight" className="statistics-dashboard__insight">
                        连续专注 <strong>{stats.streakDays}</strong> 天，今日待复习 <strong>{stats.dueMistakes}</strong> 题。
                    </p>
                </div>
                <p className="statistics-dashboard__context">趋势范围为最近 7 日，日记轨迹范围为最近 90 日。</p>
            </header>

            <dl className="statistics-dashboard__metrics" aria-label="学习数据摘要">
                <div className="statistics-dashboard__metric">
                    <dt><Flame size={15} aria-hidden="true" />连续专注</dt>
                    <dd><strong>{stats.streakDays}</strong><span>天</span></dd>
                    <dd className="statistics-dashboard__metric-note">当前连续学习记录</dd>
                </div>
                <div className="statistics-dashboard__metric">
                    <dt><Clock3 size={15} aria-hidden="true" />历史总专注</dt>
                    <dd>
                        <strong>{Math.floor(stats.totalPomodoroMinutes / 60)}</strong><span>小时</span>
                        <strong>{stats.totalPomodoroMinutes % 60}</strong><span>分钟</span>
                    </dd>
                    <dd className="statistics-dashboard__metric-note">累计完成的番茄专注</dd>
                </div>
                <div className="statistics-dashboard__metric">
                    <dt><Target size={15} aria-hidden="true" />错题掌握</dt>
                    <dd><strong>{masteryRate}</strong><span>%</span></dd>
                    <dd className="statistics-dashboard__metric-note">已掌握 {stats.masteredMistakes} / 共 {stats.totalMistakes} 题</dd>
                </div>
                <div className="statistics-dashboard__metric">
                    <dt><RefreshCw size={15} aria-hidden="true" />今日待复习</dt>
                    <dd data-testid="dashboard-due-mistakes"><strong>{stats.dueMistakes}</strong><span>题</span></dd>
                    <dd className="statistics-dashboard__metric-note">来自今日风险池</dd>
                </div>
            </dl>

            <div className="statistics-dashboard__main-grid">
                <section className="statistics-dashboard__section statistics-dashboard__trend" aria-labelledby="weekly-trend-title">
                    <div className="statistics-dashboard__section-header">
                        <div>
                            <span className="statistics-dashboard__section-kicker">专注节奏</span>
                            <h2 id="weekly-trend-title"><TrendingUp size={18} aria-hidden="true" />近 7 日专注趋势</h2>
                        </div>
                        <div className="statistics-dashboard__period">
                            <span>{weeklyPeriod}</span>
                            <span>单位：分钟</span>
                        </div>
                    </div>

                    <figure className="statistics-dashboard__trend-figure" aria-describedby="weekly-trend-description weekly-trend-data">
                        <figcaption id="weekly-trend-description" className="statistics-dashboard__chart-caption">
                            每日柱高表示已记录的专注分钟数，今天以实心描边标识。
                        </figcaption>

                        <div className="statistics-dashboard__trend-plot" aria-hidden="true">
                            <div className="statistics-dashboard__trend-grid">
                                {[4, 3, 2, 1, 0].map(i => (
                                    <div key={i}>
                                        <span>{Math.round((maxWeeklyValue / 4) * i)}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="statistics-dashboard__trend-bars">
                                {weeklyData.map(d => {
                                    const isToday = d.date === getTodayStr();
                                    const heightPct = maxWeeklyValue > 0 ? (d.value / maxWeeklyValue) * 100 : 0;
                                    return (
                                        <div
                                            key={d.date}
                                            className="statistics-dashboard__bar-column"
                                            data-today={isToday || undefined}
                                            data-empty={d.value === 0 || undefined}
                                        >
                                            <span className="statistics-dashboard__bar-value">{d.value}</span>
                                            <div className="statistics-dashboard__bar-track">
                                                <span
                                                    className="statistics-dashboard__bar-fill"
                                                    style={{ height: `${heightPct}%`, minHeight: d.value > 0 ? 2 : 0 }}
                                                />
                                            </div>
                                            <span className="statistics-dashboard__bar-label">{isToday ? '今日' : d.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {!hasWeeklyData && (
                            <p className="statistics-dashboard__empty-note">当前 7 日范围暂无可显示的专注时长。</p>
                        )}
                        <ul id="weekly-trend-data" className="statistics-dashboard__sr-only">
                            {weeklyData.map(day => (
                                <li key={day.date}>{day.date}，{day.label}，{formatDuration(day.value)}</li>
                            ))}
                        </ul>
                    </figure>
                </section>

                <aside className="statistics-dashboard__support-stack" aria-label="学习轨迹与关键日期">
                    <section className="statistics-dashboard__section statistics-dashboard__heatmap" aria-labelledby="learning-trail-title">
                        <div className="statistics-dashboard__section-header">
                            <div>
                                <span className="statistics-dashboard__section-kicker">日记证据</span>
                                <h2 id="learning-trail-title"><CalendarDays size={18} aria-hidden="true" />近 90 日日记记录</h2>
                            </div>
                        </div>
                        <p className="statistics-dashboard__chart-caption">
                            每个方格仅表示当天有无日记记录，不代表时长或强度。
                        </p>

                        {!hasHeatmapData && (
                            <p className="statistics-dashboard__empty-note">当前范围暂无可显示的日记记录。</p>
                        )}

                        <div className="statistics-dashboard__heatmap-grid" aria-hidden="true">
                            {heatmapData.map(d => (
                                <span key={d.date} data-recorded={d.hasEntry || undefined} title={`${d.date} · ${d.hasEntry ? '有记录' : '无记录'}`} />
                            ))}
                        </div>
                        <div className="statistics-dashboard__heatmap-legend" aria-hidden="true">
                            <span className="statistics-dashboard__legend-cell" />无记录
                            <span className="statistics-dashboard__legend-cell" data-recorded="true" />有记录
                        </div>
                        <ul className="statistics-dashboard__sr-only">
                            {heatmapData.map(day => (
                                <li key={day.date}>{day.date}，{day.hasEntry ? '有日记记录' : '无日记记录'}</li>
                            ))}
                        </ul>
                    </section>

                    <CountdownEventsPanel events={countdownEvents} />
                </aside>
            </div>

            <FocusDistributionChart pomodoro={pomodoro} dataRefreshVersion={dataRefreshVersion} />
        </div>
    );
}
