import { useState, useEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { PenLine, Calendar, Search, BookOpen, BookX, Timer, Tags, Bot, Settings } from 'lucide-react'
import { useModalFocus } from '../hooks/useModalFocus'
import './CommandPalette.css'

interface CommandPaletteProps {
    isOpen: boolean
    onClose: () => void
    onNavigate: (viewId: string) => void
}

interface Command {
    id: string
    title: string
    icon: React.ReactElement
    description: string
}

export default function CommandPalette({ isOpen, onClose, onNavigate }: CommandPaletteProps) {
    const [query, setQuery] = useState('')
    const [selectedIndex, setSelectedIndex] = useState(0)
    const modalRef = useModalFocus(onClose, isOpen)
    const listRef = useRef<HTMLDivElement>(null)
    const listId = useId()
    const helpId = useId()

    const commands: Command[] = [
        { id: 'editor', title: '写日记', icon: <PenLine size={24} />, description: '记录当天的学习和生活' },
        { id: 'calendar', title: '日历', icon: <Calendar size={24} />, description: '按日期查看日记和专注记录' },
        { id: 'search', title: '搜索日记', icon: <Search size={24} />, description: '按内容、日期、心情或标签查找' },
        { id: 'progress', title: '科目进度', icon: <BookOpen size={24} />, description: '查看各科的章节完成情况' },
        { id: 'mistakes', title: '错题本', icon: <BookX size={24} />, description: '复习错题和知识点' },
        { id: 'pomodoro', title: '专注计时', icon: <Timer size={24} />, description: '打开专注计时页面' },
        { id: 'tags', title: '标签', icon: <Tags size={24} />, description: '用标签给日记分类' },
        { id: 'ai', title: 'AI 助手', icon: <Bot size={24} />, description: '提问或整理学习思路' },
        { id: 'settings', title: '设置', icon: <Settings size={24} />, description: '调整外观、AI、计时和数据设置' }
    ]

    const filteredCommands = commands.filter(c =>
        c.title.toLowerCase().includes(query.toLowerCase()) ||
        c.description.toLowerCase().includes(query.toLowerCase())
    )
    const activeIndex = filteredCommands.length === 0
        ? -1
        : Math.max(0, Math.min(selectedIndex, filteredCommands.length - 1))
    const activeCommand = filteredCommands[activeIndex]

    useEffect(() => {
        if (isOpen) {
            setQuery('')
            setSelectedIndex(0)
        }
    }, [isOpen])

    useEffect(() => {
        if (isOpen) {
            listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
                ?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
        }
    }, [isOpen, query, activeIndex])

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (filteredCommands.length) setSelectedIndex((activeIndex + 1) % filteredCommands.length)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (filteredCommands.length) setSelectedIndex((activeIndex - 1 + filteredCommands.length) % filteredCommands.length)
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (activeCommand) {
                executeCommand(activeCommand)
            }
        }
    }

    const executeCommand = (cmd: Command) => {
        onNavigate(cmd.id)
        onClose()
    }

    if (!isOpen) return null

    return createPortal(
        <div className="command-palette-overlay" onClick={onClose}>
            <div
                ref={modalRef}
                className="command-palette"
                role="dialog"
                aria-modal="true"
                aria-label="快捷菜单"
                tabIndex={-1}
                onClick={e => e.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <div className="command-palette__search">
                    <input
                        className="input w-full"
                        role="combobox"
                        aria-label="搜索功能"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-activedescendant={activeCommand ? `${listId}-${activeCommand.id}` : undefined}
                        aria-describedby={helpId}
                        placeholder="搜索功能，例如：设置、日记"
                        value={query}
                        onChange={e => { setQuery(e.target.value); setSelectedIndex(0) }}
                    />
                </div>

                <div ref={listRef} id={listId} role="listbox" aria-label="功能" tabIndex={-1} className="command-palette__list">
                    {filteredCommands.map((cmd, idx) => {
                        const selected = idx === activeIndex
                        const optionId = `${listId}-${cmd.id}`
                        return (
                            <button
                                type="button"
                                role="option"
                                tabIndex={-1}
                                id={optionId}
                                key={cmd.id}
                                aria-selected={selected}
                                aria-labelledby={`${optionId}-title`}
                                aria-describedby={`${optionId}-description`}
                                className="command-palette__option"
                                onClick={() => executeCommand(cmd)}
                                onMouseEnter={() => setSelectedIndex(idx)}
                            >
                                <span className="command-palette__icon" aria-hidden="true">{cmd.icon}</span>
                                <span className="command-palette__copy">
                                    <span id={`${optionId}-title`} className="command-palette__title">{cmd.title}</span>
                                    <span id={`${optionId}-description`} className="command-palette__description">{cmd.description}</span>
                                </span>
                                {selected && <span className="command-palette__enter" aria-hidden="true">↵ Enter</span>}
                            </button>
                        )
                    })}
                </div>
                {filteredCommands.length === 0 && (
                    <div className="command-palette__empty" role="status">
                        没找到功能，换个词试试。
                    </div>
                )}
                <div id={helpId} className="command-palette__help">
                    <span><kbd>↑↓</kbd> 选择功能</span>
                    <span><kbd>↵</kbd> 打开功能</span>
                    <span><kbd>esc</kbd> 关闭菜单</span>
                </div>
            </div>
        </div>, document.body,
    )
}
