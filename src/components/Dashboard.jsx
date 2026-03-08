import { useState, useEffect, useMemo } from 'react';
import { getTodayStr } from '../utils/helpers';
import { useDiary } from '../contexts/DiaryContext';

export default function Dashboard() {
    const { pomodoro, dashboard, mistakes } = useDiary();
    const [stats, setStats] = useState({
        totalPomodoroMinutes: 0,
        sessionCount: 0,
        streakDays: 0,
        masteredMistakes: 0,
        totalMistakes: 0,
    });
    const [weeklyData, setWeeklyData] = useState([]);
    const [heatmapData, setHeatmapData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadDashboardData();
    }, []);

    const loadDashboardData = async () => {
        setLoading(true);
        try {
            const today = new Date();

            // 7 Days Range (Trend)
            const weekAgo = new Date(today);
            weekAgo.setDate(today.getDate() - 6);
            const startWeek = weekAgo.toISOString().split('T')[0];
            const endWeek = today.toISOString().split('T')[0];

            // 90 Days Range (Heatmap)
            const threeMonthsAgo = new Date(today);
            threeMonthsAgo.setDate(today.getDate() - 89);
            const startHeatmap = threeMonthsAgo.toISOString().split('T')[0];

            const [
                pomodoroWeek,
                streak,
                mistakesList,
                heatmapEntries,
                pomodoroAllTime // MOCK total using a wide range
            ] = await Promise.all([
                pomodoro.getRange(startWeek, endWeek).catch(() => []),
                dashboard.streak().catch(() => 0),
                mistakes.getAll({}).catch(() => []),
                dashboard.entryDatesRange(startHeatmap, endWeek).catch(() => []),
                pomodoro.getRange('2000-01-01', endWeek).catch(() => [])
            ]);

            // Calculate overall stats
            const totalMins = pomodoroAllTime.reduce((sum, day) => sum + day.total_minutes, 0);
            const totalSessions = pomodoroAllTime.reduce((sum, day) => sum + day.session_count, 0);

            setStats({
                totalPomodoroMinutes: totalMins,
                sessionCount: totalSessions,
                streakDays: streak,
                masteredMistakes: mistakesList.filter(m => m.mastered === 1).length,
                totalMistakes: mistakesList.length
            });

            // Format Weekly Data (Ensure 7 days are represented even if 0)
            const formattedWeek = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(weekAgo);
                d.setDate(weekAgo.getDate() + i);
                const dStr = d.toISOString().split('T')[0];
                const dayLabel = d.toLocaleDateString('zh-CN', { weekday: 'short' });

                const dayData = pomodoroWeek.find(p => p.date === dStr);
                formattedWeek.push({
                    date: dStr,
                    label: dayLabel,
                    value: dayData ? dayData.total_minutes : 0
                });
            }
            setWeeklyData(formattedWeek);

            // Format Heatmap Data (Last 90 days)
            const hMap = new Map(heatmapEntries.map(e => [e.date, e.mood]));
            const formattedHeatmap = [];
            for (let i = 0; i < 90; i++) {
                const d = new Date(threeMonthsAgo);
                d.setDate(threeMonthsAgo.getDate() + i);
                const dStr = d.toISOString().split('T')[0];
                formattedHeatmap.push({
                    date: dStr,
                    hasEntry: hMap.has(dStr),
                    mood: hMap.get(dStr) || null
                });
            }
            setHeatmapData(formattedHeatmap);

        } catch (error) {
            console.error('Failed to load dashboard:', error);
        } finally {
            setLoading(false);
        }
    };

    // --- SVG Charts Logics ---
    const maxWeeklyValue = useMemo(() => {
        const mx = Math.max(...weeklyData.map(d => d.value), 60); // Ensure at least 60m scale
        return Math.ceil(mx / 30) * 30; // Round up to nearest half-hour
    }, [weeklyData]);

    const formatHours = (mins) => {
        if (mins < 60) return `${mins}m`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h${m}m` : `${h}h`;
    };

    if (loading) {
        return <div className="p-8 text-center text-muted">正在聚合并分析学习图谱...</div>;
    }

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 'var(--space-2xl)' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-xl)' }}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px' }}>📊 数据统计</h2>
                    <p className="text-muted mt-1 text-sm">洞察你的努力轨迹，看到每一滴汗水。</p>
                </div>
            </div>

            {/* Top Cards Grid */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--space-md)', marginBottom: 'var(--space-2xl)'
            }}>
                <div className="card" style={{ padding: 'var(--space-lg)', borderTop: '3px solid var(--accent)' }}>
                    <div className="text-muted text-sm font-medium mb-2 flex items-center gap-xs">🔥 连续专注</div>
                    <div className="text-3xl font-extrabold flex items-baseline gap-xs" style={{ color: 'var(--accent)' }}>
                        {stats.streakDays} <span className="text-sm font-normal text-muted">天</span>
                    </div>
                </div>

                <div className="card" style={{ padding: 'var(--space-lg)', borderTop: '3px solid var(--success)' }}>
                    <div className="text-muted text-sm font-medium mb-2 flex items-center gap-xs">⏱️ 历史总专注时间</div>
                    <div className="text-3xl font-extrabold flex items-baseline gap-xs">
                        {Math.floor(stats.totalPomodoroMinutes / 60)} <span className="text-sm font-normal text-muted">h</span>
                        {stats.totalPomodoroMinutes % 60} <span className="text-sm font-normal text-muted">m</span>
                    </div>
                </div>

                <div className="card" style={{ padding: 'var(--space-lg)', borderTop: '3px solid var(--warning)' }}>
                    <div className="text-muted text-sm font-medium mb-2 flex items-center gap-xs">🎯 错题消灭率</div>
                    <div className="text-3xl font-extrabold flex items-baseline gap-xs">
                        {stats.totalMistakes > 0 ? Math.round((stats.masteredMistakes / stats.totalMistakes) * 100) : 0}
                        <span className="text-lg">%</span>
                    </div>
                    <div className="text-xs text-muted mt-1">已掌握 {stats.masteredMistakes} / {stats.totalMistakes}</div>
                </div>
            </div>

            {/* Main Layout: 2 Columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-xl)', alignItems: 'start' }}>

                {/* Left Col: Trend Chart */}
                <div className="card" style={{ padding: 'var(--space-xl)' }}>
                    <h3 className="font-semibold text-lg" style={{ marginBottom: 'var(--space-xl)' }}>📈 近 7 日专注趋势</h3>

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
                                            background: isToday ? 'linear-gradient(to top, var(--accent), var(--accent-light))' : 'var(--bg-tertiary)',
                                            borderRadius: '6px 6px 0 0',
                                            transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                            cursor: 'pointer',
                                            boxShadow: isToday ? '0 -2px 10px rgba(139, 92, 246, 0.3)' : 'none'
                                        }}
                                            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; e.currentTarget.previousSibling.style.opacity = '1'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; e.currentTarget.previousSibling.style.opacity = '0'; }}
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
                    <h3 className="font-semibold text-lg" style={{ marginBottom: 'var(--space-md)' }}>🗓️ 学习热力图 (近 90 天)</h3>
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

            <style>{`
                .chart-tooltip::after {
                    content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
                    border-width: 4px; border-style: solid; border-color: var(--text-primary) transparent transparent transparent;
                }
            `}</style>
        </div >
    );
}
