import { useState, useEffect, useRef, useCallback } from 'react'
import { useDiary } from '../contexts/DiaryContext'

const MODES = {
    WORK: { id: 'work', label: '专注', time: 25 * 60, color: 'var(--accent)' },
    SHORT_BREAK: { id: 'short_break', label: '短休', time: 5 * 60, color: 'var(--success)' },
    LONG_BREAK: { id: 'long_break', label: '长休', time: 15 * 60, color: 'var(--info)' }
}

export default function Pomodoro({ isWidget, onExpand, isCollapsed }) {
    const { settingsData, subjects: subjectsAPI, pomodoro: pomodoroAPI, notification: notificationAPI } = useDiary()
    const customWorkTime = (parseInt(settingsData?.pomodoroMinutes) || 25) * 60

    const dynamicModes = {
        ...MODES,
        WORK: { ...MODES.WORK, time: customWorkTime }
    }

    const [mode, setMode] = useState(dynamicModes.WORK)
    const [timeLeft, setTimeLeft] = useState(mode.time)
    const [isRunning, setIsRunning] = useState(false)

    // Existing State
    const [subjects, setSubjects] = useState([])
    const [selectedSubject, setSelectedSubject] = useState(null)
    const [todayStats, setTodayStats] = useState([])
    const [todayTotal, setTodayTotal] = useState(0)

    // Use Ref to handle accurate countdown
    const endTimeRef = useRef(null)

    useEffect(() => {
        loadSubjects()
        loadTodayStats()

        // Request Notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission()
        }
    }, [])

    const loadSubjects = async () => {
        try {
            const data = await subjectsAPI.getAll()
            setSubjects(data || [])
        } catch (e) { console.error(e) }
    }

    const loadTodayStats = async () => {
        const today = new Date().toISOString().split('T')[0]
        try {
            const stats = await pomodoroAPI.getStats(today)
            setTodayStats(stats || [])
            const total = await pomodoroAPI.getDailyTotal(today)
            setTodayTotal(total || 0)
        } catch (e) { console.error(e) }
    }

    // Reset timer when mode changes manually
    useEffect(() => {
        setTimeLeft(mode.time)
        setIsRunning(false)
        endTimeRef.current = null
    }, [mode])

    // Update work time if settings change while idle
    useEffect(() => {
        if (mode.id === 'work' && !isRunning) {
            setMode(dynamicModes.WORK)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customWorkTime, isRunning])

    // Phase-complete handler — defined BEFORE the timer useEffect that depends on it
    // to avoid TDZ (Temporal Dead Zone) ReferenceError with const/useCallback.
    const handlePhaseComplete = useCallback(async () => {
        setIsRunning(false)
        endTimeRef.current = null

        // Browser Native Notification
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('番茄钟提醒', {
                body: mode.id === 'work' ? '专注完成，休息一下吧！' : '休息结束，准备专注！',
                icon: '/favicon.ico'
            })
        }

        if (mode.id === 'work') {
            // Save Session via Unified API
            try {
                await pomodoroAPI.addSession({
                    subject_id: selectedSubject,
                    duration: mode.time / 60
                })
                loadTodayStats()
                await notificationAPI.show('🍅 番茄钟完成！', '干得漂亮，休息几分钟吧～')
            } catch (e) { console.error(e) }

            // Auto switch to short break (simplified workflow)
            setMode(dynamicModes.SHORT_BREAK)
        } else {
            await notificationAPI.show('⏰ 休息结束', '精力充沛，继续加油！').catch(() => { })
            setMode(dynamicModes.WORK)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, selectedSubject])

    // Main Timer Loop
    // NOTE(Claude): deps are [isRunning, handlePhaseComplete] only — NOT timeLeft.
    // Including timeLeft caused the effect to teardown+recreate the interval every
    // single tick (1 Hz), which leaked one setTimeout per second and forced a new
    // setInterval registration. endTimeRef already pins the wall-clock deadline so
    // accuracy is preserved without timeLeft in the dep array.
    useEffect(() => {
        let interval = null
        if (isRunning) {
            if (!endTimeRef.current) {
                endTimeRef.current = Date.now() + timeLeft * 1000
            }
            interval = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000))
                setTimeLeft(remaining)
                if (remaining <= 0) {
                    clearInterval(interval)
                    handlePhaseComplete()
                }
            }, 1000)
        } else {
            endTimeRef.current = null
        }
        return () => clearInterval(interval)
    }, [isRunning, handlePhaseComplete]) // eslint-disable-line react-hooks/exhaustive-deps

    const toggleTimer = () => {
        setIsRunning(!isRunning)
    }

    const resetTimer = () => {
        setIsRunning(false)
        setTimeLeft(mode.time)
        endTimeRef.current = null
    }

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0')
        const s = (seconds % 60).toString().padStart(2, '0')
        return `${m}:${s}`
    }

    const progress = 1 - (timeLeft / mode.time)
    const circleCircumference = 2 * Math.PI * 90 // For R=90
    const miniCircumference = 2 * Math.PI * 18 // For R=18

    if (isWidget) {
        return (
            <div
                className="pomodoro-mini card"
                style={{
                    position: 'fixed',
                    bottom: 'var(--space-2xl)',
                    left: isCollapsed ? 90 : 260, // Avoid overlapping sidebar
                    padding: '8px 16px 8px 8px',
                    display: 'flex', alignItems: 'center', gap: 12,
                    border: `1px solid ${mode.color}40`,
                    background: 'var(--bg-secondary)',
                    backdropFilter: 'blur(16px)',
                    zIndex: 100,
                    transition: 'all 0.3s cubic-bezier(0.2, 0, 0, 1)',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-lg)',
                    borderRadius: 30
                }}
                onClick={onExpand}
                title="打开番茄钟"
            >
                <div style={{ position: 'relative', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); toggleTimer(); }}>
                    <svg viewBox="0 0 40 40" width="40" height="40" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
                        <circle cx="20" cy="20" r="18" fill="none" stroke="var(--border)" strokeWidth="3" />
                        <circle cx="20" cy="20" r="18" fill="none" stroke={mode.color} strokeWidth="3" strokeLinecap="round"
                            strokeDasharray={miniCircumference} strokeDashoffset={miniCircumference * (1 - progress)}
                            style={{ transition: 'stroke-dashoffset 1s linear' }} />
                    </svg>
                    <div style={{ fontSize: 14, opacity: 0.8 }}>{isRunning ? '⏸' : '▶'}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: mode.color, fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(timeLeft)}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="pomodoro-container flex flex-col items-center w-full" style={{ padding: 'var(--space-xl) 0' }}>

            {/* Mode Switcher */}
            <div className="flex gap-sm p-1 rounded-full bg-secondary" style={{ background: 'var(--bg-tertiary)', padding: 4, borderRadius: 24, marginBottom: 'var(--space-2xl)' }}>
                {Object.values(dynamicModes).map(m => (
                    <button
                        key={m.id}
                        onClick={() => setMode(m)}
                        style={{
                            padding: '6px 16px', borderRadius: 20, fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
                            background: mode.id === m.id ? 'var(--bg-primary)' : 'transparent',
                            color: mode.id === m.id ? m.color : 'var(--text-muted)',
                            boxShadow: mode.id === m.id ? 'var(--shadow-sm)' : 'none',
                            transition: 'all 0.3s'
                        }}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {/* Timer Visual */}
            <div style={{ position: 'relative', width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-xl)' }}>
                <svg viewBox="0 0 200 200" width="260" height="260" style={{ position: 'absolute' }}>
                    {/* Background Track */}
                    <circle cx="100" cy="100" r="90" fill="none" stroke="var(--border)" strokeWidth="4" />
                    {/* Progress Track */}
                    <circle
                        cx="100" cy="100" r="90" fill="none"
                        stroke={mode.color}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={circleCircumference}
                        strokeDashoffset={circleCircumference * (1 - progress)}
                        transform="rotate(-90 100 100)"
                        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s ease' }}
                    />
                </svg>

                {/* Timer Clock */}
                <div className="flex flex-col items-center">
                    <div style={{ fontSize: 64, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', lineHeight: 1 }}>
                        {formatTime(timeLeft)}
                    </div>
                    <div className="text-sm mt-2" style={{ color: mode.color, opacity: 0.8, fontWeight: 500 }}>
                        {isRunning ? '正在进行中...' : '准备就绪'}
                    </div>
                </div>
            </div>

            <div className="flex gap-md" style={{ marginBottom: 'var(--space-2xl)' }}>
                <button
                    className="button"
                    style={{
                        minWidth: 120, height: 44, borderRadius: 22, fontSize: 16, fontWeight: 600, border: 'none',
                        background: isRunning ? 'var(--bg-tertiary)' : mode.color,
                        color: isRunning ? 'var(--text-primary)' : 'white',
                        boxShadow: isRunning ? 'none' : `0 8px 16px ${mode.color}40`,
                    }}
                    onClick={toggleTimer}
                >
                    {isRunning ? '⏸ 暂停' : '▶ 开始专注'}
                </button>
                <button
                    className="button button-secondary"
                    style={{ width: 44, height: 44, borderRadius: 22, padding: 0 }}
                    onClick={resetTimer}
                    title="重置"
                >
                    ↻
                </button>
            </div>

            {/* Subject Select */}
            <div style={{ width: '100%', maxWidth: '300px', marginBottom: 'var(--space-xl)' }}>
                <select
                    className="input w-full"
                    value={selectedSubject || ''}
                    onChange={(e) => setSelectedSubject(e.target.value ? Number(e.target.value) : null)}
                    disabled={mode.id !== 'work'}
                >
                    <option value="">{mode.id === 'work' ? '选择专注科目（可选）' : '休息中...'}</option>
                    {subjects.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
            </div>

            {/* Today Stats */}
            <div className="card w-full" style={{ maxWidth: '340px', padding: 'var(--space-lg)' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-md)' }}>
                    <h3 className="text-base font-semibold">今日总览</h3>
                    <div className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                        {Math.floor(todayTotal / 60)}h {todayTotal % 60}m
                    </div>
                </div>

                {todayStats.length > 0 ? (
                    <div className="flex flex-col gap-sm">
                        {todayStats.map((stat, i) => (
                            <div key={i} className="flex items-center justify-between text-sm py-1" style={{ borderBottom: i < todayStats.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                                <span className="flex items-center gap-sm">
                                    <span style={{
                                        width: 10, height: 10, borderRadius: '50%',
                                        background: stat.color || 'var(--border)'
                                    }} />
                                    {stat.subject_name || '未分类'}
                                </span>
                                <span className="text-muted">{stat.total_minutes}m · {stat.session_count} 番茄</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-muted text-center py-2 opacity-70">
                        今天还没有专注记录哦
                    </div>
                )}
            </div>
        </div>
    )
}
