import { useState, useEffect, useRef } from 'react'

export default function CommandPalette({ isOpen, onClose, onNavigate }) {
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const inputRef = useRef(null)

    const commands = [
        { id: 'editor', title: '写新日记', icon: '📝', description: '记录今天的生活' },
        { id: 'calendar', title: '查看日历', icon: '📅', description: '按日期回顾历史记录' },
        { id: 'search', title: '搜索日记', icon: '🔍', description: '全局搜索记忆' },
        { id: 'progress', title: '学习进度', icon: '📖', description: '追踪考研各科目完成度' },
        { id: 'mistakes', title: '错题本', icon: '📓', description: '复习整理的错题和知识点' },
        { id: 'pomodoro', title: '专注番茄钟', icon: '🍅', description: '开启一段沉浸式学习' },
        { id: 'tags', title: '管理标签', icon: '🏷️', description: '分类整理日记' },
        { id: 'ai', title: 'AI 助手', icon: '🤖', description: '让 AI 帮你总结或答疑' },
        { id: 'settings', title: '偏好设置', icon: '⚙️', description: '修改主题和高级选项' }
    ]

    const filteredCommands = commands.filter(c =>
        c.title.toLowerCase().includes(query.toLowerCase()) ||
        c.description.toLowerCase().includes(query.toLowerCase())
    )

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 10)
            setQuery('')
            setSelectedIndex(0)
        }
    }, [isOpen])

    useEffect(() => {
        setSelectedIndex(0)
    }, [query])

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelectedIndex(i => (i + 1) % filteredCommands.length)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelectedIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (filteredCommands[selectedIndex]) {
                executeCommand(filteredCommands[selectedIndex])
            }
        } else if (e.key === 'Escape') {
            onClose()
        }
    }

    const executeCommand = (cmd) => {
        onNavigate(cmd.id)
        onClose()
    }

    if (!isOpen) return null

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'var(--bg-overlay)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            paddingTop: '15vh', zIndex: 9999,
            animation: 'page-fade-in 0.2s cubic-bezier(0.2, 0, 0, 1)'
        }} onClick={onClose}>
            <div
                style={{
                    width: '100%', maxWidth: 640,
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-lg)',
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    display: 'flex', flexDirection: 'column'
                }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--border)' }}>
                    <input
                        ref={inputRef}
                        className="input w-full"
                        style={{
                            fontSize: 20, padding: 'var(--space-md)',
                            background: 'transparent', border: 'none', outline: 'none',
                            boxShadow: 'none'
                        }}
                        placeholder="你想做什么？(尝试搜索 '设置' 或 '日记')"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                </div>

                <div style={{ maxHeight: '50vh', overflowY: 'auto', padding: 'var(--space-sm)' }}>
                    {filteredCommands.length === 0 ? (
                        <div className="text-muted text-center" style={{ padding: 'var(--space-xl)' }}>
                            没有匹配的命令
                        </div>
                    ) : (
                        filteredCommands.map((cmd, idx) => {
                            const selected = idx === selectedIndex
                            return (
                                <div
                                    key={cmd.id}
                                    onClick={() => executeCommand(cmd)}
                                    onMouseEnter={() => setSelectedIndex(idx)}
                                    style={{
                                        padding: 'var(--space-md)',
                                        borderRadius: 'var(--radius)',
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
                                        background: selected ? 'var(--accent)' : 'transparent',
                                        color: selected ? '#fff' : 'inherit',
                                        transition: 'none' // instant feedback for keyboard
                                    }}
                                >
                                    <span style={{ fontSize: 24 }}>{cmd.icon}</span>
                                    <div>
                                        <div style={{ fontWeight: 500, fontSize: 15 }}>{cmd.title}</div>
                                        <div style={{ fontSize: 13, color: selected ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>
                                            {cmd.description}
                                        </div>
                                    </div>
                                    {selected && (
                                        <div style={{
                                            marginLeft: 'auto', fontSize: 12,
                                            background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: 4
                                        }}>
                                            ↵ Enter
                                        </div>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
                <div style={{
                    padding: 'var(--space-sm) var(--space-md)',
                    background: 'var(--bg-tertiary)', borderTop: '1px solid var(--border)',
                    display: 'flex', justifyContent: 'center', gap: 'var(--space-lg)',
                    fontSize: 12, color: 'var(--text-muted)'
                }}>
                    <span><kbd style={{ fontFamily: 'var(--font-mono)' }}>↑↓</kbd> 选择导航</span>
                    <span><kbd style={{ fontFamily: 'var(--font-mono)' }}>↵</kbd> 确认执行</span>
                    <span><kbd style={{ fontFamily: 'var(--font-mono)' }}>esc</kbd> 关闭菜单</span>
                </div>
            </div>
        </div>
    )
}
