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

    const formatHours = (mins: number): string => {
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h${m}m` : `${h}h`;
    };

    const countdownEvents = useMemo(
        () => normalizeCountdownEvents(settingsData?.countdownEvents, settingsData?.examDate),
        [settingsData?.countdownEvents, settingsData?.examDate]
    );

    if (loading) {
        return <div className="p-8 text-center text-muted">正在聚合并分析学习图谱...</div>;
    }

    if (error) {
        return (
            <div className="empty-state p-8" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <TrendingUp size={56} style={{ marginBottom: 'var(--space)', opacity: 0.2 }} />
                <h3 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space)' }}>数据聚合失败</h3>
                <p className="text-muted mb-6">{error}</p>
                <button className="button button-primary" onClick={loadDashboardData}>
                    <RefreshCw size={15} /> 重新聚合
                </button>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 'var(--space-2xl)' }}>
            <div style={{ marginBottom: 'var(--space-md)' }}>
                <p className="text-muted text-sm">洞察你的努力轨迹，看到每一滴汗水。</p>
            </div>

            {/* Top Cards Grid */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--space-md)', marginBottom: 'var(--space-2xl)'
            }}>
                <div className="card" style={{ padding: 'var(--space-lg)', borderTop: '3px solid var(--accent)' }}>
                    <div className="text-muted text-sm font-medium mb-2 flex items-center gap-xs">
                        <Flame size={14} style={{ color: 'var(--warning)' }} /> 连续专注
                    </div>
                    <div className="text-3xl font-extrabold flex items-baseline gap-xs" style={{ color: 'var(--accent)' }}>
                        {stats.streakDays} <span className="text-sm font-normal text-muted">天</span>
                    </div>
                </div>

                <div className="card" style={{ padding: 'var(--space-lg)', borderTop: '3px solid var(--color-state-success)' }}>
                    <div className="text-muted text-sm font-medium mb-2 flex items-center gap-xs">
                        <Clock3 size={14} style={{ color: 'var(--color-state-success)' }} /> 历史总专注时间
                    </div>
                    <div className="text-3xl font-extrabold flex items-baseline gap-xs">
                        {Math.floor(stats.totalPomodoroMinutes / 60)} <span className="text-sm font-normal text-muted">h</span>
                        {stats.totalPomodoroMinutes % 60} <span className="text-sm font-normal text-muted">m</span>
                    </div>
                </div>

                <div className="card" style={{ padding: 'var(--space-lg)', borderTop: '3px solid var(--warning)' }}>
                    <div className="text-muted text-sm font-medium mb-2 flex items-center gap-xs">
                        <Target size={14} style={{ color: 'var(--warning)' }} /> 错题消灭率
                    </div>
                    <div className="text-3xl font-extrabold flex items-baseline gap-xs">
                        {stats.totalMistakes > 0 ? Math.round((stats.masteredMistakes / stats.totalMistakes) * 100) : 0}
                        <span className="text-lg">%</span>
                    </div>
                    <div className="text-sm text-muted mt-1">
                        已掌握 {stats.masteredMistakes} / 共 {stats.totalMistakes}
                    </div>
                </div>

                <div className="card" style={{ padding: 'var(--space-lg)', borderTop: '3px solid var(--color-state-danger)' }}>
                    <div className="text-muted text-sm font-medium mb-2 flex items-center gap-xs">
                        <RefreshCw size={14} style={{ color: 'var(--color-state-danger)' }} /> 今日待复习错题
                    </div>
                    <div className="text-3xl font-extrabold flex items-baseline gap-xs" data-testid="dashboard-due-mistakes" style={{ color: stats.dueMistakes > 0 ? 'var(--color-state-danger)' : 'var(--color-state-success)' }}>
                        {stats.dueMistakes} <span className="text-sm font-normal text-muted">题</span>
                    </div>
                    <div className="text-sm text-muted mt-1">
                        {stats.dueMistakes > 0 ? '赶紧去错题本消灭它们吧！' : '太棒了，今天没有欠债！'}
                    </div>
                </div>

                <CountdownEventsPanel events={countdownEvents} />
            </div>

            {/* Main Layout: 2 Columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-xl)', alignItems: 'start' }}>

                {/* Left Col: Trend Chart */}
                <div className="card" style={{ padding: 'var(--space-xl)' }}>
                    <h3 className="font-semibold text-lg" style={{ marginBottom: 'var(--space-xl)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TrendingUp size={18} style={{ color: 'var(--accent)' }} /> 近 7 日专注趋势
                    </h3>

                    <div style={{ height: 260, position: 'relative', marginTop: 'var(--space-xl)' }}>
                        {/* Y-Axis Guidelines */}
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                            {[4, 3, 2, 1, 0].map(i => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', width: '100%', borderBottom: i !== 0 ? '1px dashed var(--border-light)' : '1px solid var(--border)' }}>
                                    <span className="text-xs text-muted" style={{ transform: 'translateY(12px)', width: 40 }}>
                                        {formatHours((maxWeeklyValue / 4) * i)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* X-Axis Labels & Bars */}
                        <div style={{ position: 'absolute', left: 45, right: 0, bottom: 0, top: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: 1 }}>
                            {weeklyData.map((d, i) => {
                                const isToday = d.date === getTodayStr();
                                const heightPct = maxWeeklyValue > 0 ? (d.value / maxWeeklyValue) * 100 : 0;

                                return (
                                    <div key={i} className="group" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '10%', height: '100%', position: 'relative', justifyContent: 'flex-end' }}>
                                        {/* Tooltip on Hover */}
                                        <div className="chart-tooltip" style={{ opacity: 0, position: 'absolute', top: `calc(100% - ${heightPct}% - 35px)`, background: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 'bold', pointerEvents: 'none', transition: 'all 0.2s', whiteSpace: 'nowrap', zIndex: 10 }}>
                                            {formatHours(d.value)}
                                        </div>

                                        {/* Pure CSS Bar */}
                                        <div style={{
                                            width: '100%', maxWidth: 36, height: `${Math.max(heightPct, 1)}%`,
                                            background: isToday ? 'var(--accent)' : 'var(--bg-tertiary)',
                                            borderRadius: '6px 6px 0 0',
                                            transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                            cursor: 'pointer',
                                            boxShadow: isToday ? '0 -2px 10px rgba(15, 118, 110, 0.3)' : 'none'
                                        }}
                                            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; (e.currentTarget.previousSibling as HTMLElement).style.opacity = '1'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; (e.currentTarget.previousSibling as HTMLElement).style.opacity = '0'; }}
                                        />

                                        <div className="text-xs text-muted" style={{ position: 'absolute', bottom: -24, fontWeight: isToday ? 'bold' : 'normal', color: isToday ? 'var(--accent)' : 'inherit' }}>
                                            {isToday ? '今日' : d.label}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right Col: 90-Day Contribution Heatmap */}
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <h3 className="font-semibold text-lg" style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CalendarDays size={18} style={{ color: 'var(--accent)' }} /> 学习轨迹（近 90 天）
                    </h3>
                    <p className="text-xs text-muted mb-4">有写日记的日子会点亮板块。</p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, transform: 'rotate(90deg) scaleY(-1)', transformOrigin: 'center', margin: '20px auto 0', width: 140 }}>
                        {heatmapData.map((d, i) => (
                            <div
                                key={i}
                                title={`${d.date} ${d.hasEntry ? '· 有记录' : '· 无记录'}`}
                                style={{
                                    width: 14, height: 14, borderRadius: 3,
                                    background: d.hasEntry ? 'var(--accent)' : 'var(--bg-tertiary)',
                                    opacity: d.hasEntry ? 0.7 + ((d.date.charCodeAt(d.date.length - 1) % 4) * 0.1) : 1, // Deterministic variance
                                    transform: 'rotate(-90deg) scaleX(-1)', // Counter-rotate element
                                }}
                            />
                        ))}
                    </div>

                    <div className="flex items-center justify-center gap-sm mt-6 mb-2">
                        <span className="text-xs text-muted">少</span>
                        <div style={{ width: 12, height: 12, background: 'var(--bg-tertiary)', borderRadius: 2 }} />
                        <div style={{ width: 12, height: 12, background: 'var(--accent)', opacity: 0.4, borderRadius: 2 }} />
                        <div style={{ width: 12, height: 12, background: 'var(--accent)', opacity: 0.7, borderRadius: 2 }} />
                        <div style={{ width: 12, height: 12, background: 'var(--accent)', opacity: 1, borderRadius: 2 }} />
                        <span className="text-xs text-muted">多</span>
                    </div>
                </div>
            </div>

            {/* Focus Distribution Chart */}
            <FocusDistributionChart pomodoro={pomodoro} dataRefreshVersion={dataRefreshVersion} />

            <style>{`
                .chart-tooltip::after {
                    content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
                    border-width: 4px; border-style: solid; border-color: var(--text-primary) transparent transparent transparent;
                }
            `}</style>
        </div >
    );
}
