import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, CalendarPlus, Check, Edit3, ListPlus, Save, Trash2, X } from 'lucide-react'
import type { Subject, SubjectChapter, SubjectChapterDraft } from '../types'
import type { SubjectChaptersContextAPI } from '../types/api'
import {
    calculateChapterStats,
    filterChapters,
    parseChapterLines,
    type ChapterFilter,
} from '../utils/subjectChapters'
import { showToast } from './Toast'
import { logger } from '../utils/logger'
import SubjectConversionDialog from './SubjectConversionDialog'
import './SubjectChapterPanel.css'

interface SubjectChapterPanelProps {
    subject: Subject
    chapters: SubjectChapter[]
    api: SubjectChaptersContextAPI
    onRefresh: () => Promise<void>
    onChapterUpdated: (previousChapter: SubjectChapter, updatedChapter: SubjectChapter) => void
    todayChapterTaskIds: Set<number>
    onAddToToday: (chapter: SubjectChapter) => Promise<void>
}

interface PendingConversion {
    drafts: SubjectChapterDraft[]
}

export default function SubjectChapterPanel({
    subject,
    chapters,
    api,
    onRefresh,
    onChapterUpdated,
    todayChapterTaskIds,
    onAddToToday,
}: SubjectChapterPanelProps) {
    const [filter, setFilter] = useState<ChapterFilter>('open')
    const [management, setManagement] = useState(chapters.length === 0)
    const [query, setQuery] = useState('')
    const listRef = useRef<HTMLDivElement>(null)
    const scrollBeforeModeChange = useRef<number | null>(null)
    const planningScroll = useRef(0)
    const creationInputRef = useRef<HTMLInputElement>(null)
    const editInputRef = useRef<HTMLInputElement>(null)
    const editButtons = useRef(new Map<number, HTMLButtonElement>())
    const returnEditFocus = useRef<number | null>(null)
    const [singleTitle, setSingleTitle] = useState('')
    const [bulkText, setBulkText] = useState('')
    const [editingId, setEditingId] = useState<number | null>(null)
    const [editTitle, setEditTitle] = useState('')
    const [editNotes, setEditNotes] = useState('')
    const [pending, setPending] = useState<string | null>(null)
    const [conversion, setConversion] = useState<PendingConversion | null>(null)

    const stats = useMemo(() => calculateChapterStats(chapters), [chapters])
    const orderedChapters = useMemo(() => filterChapters(chapters, 'all'), [chapters])
    const visibleChapters = useMemo(() => {
        const search = query.trim().toLocaleLowerCase()
        return filterChapters(chapters, filter).filter(chapter =>
            !search || `${chapter.title} ${chapter.notes}`.toLocaleLowerCase().includes(search))
    }, [chapters, filter, query])
    const hasDetailedChapters = chapters.length > 0
    const showManagement = management
    const managementId = `chapter-management-${subject.id}`

    useLayoutEffect(() => {
        if (listRef.current && scrollBeforeModeChange.current !== null) {
            listRef.current.scrollTop = scrollBeforeModeChange.current
            scrollBeforeModeChange.current = null
        }
    }, [management])

    useLayoutEffect(() => {
        if (!showManagement) return
        if (editingId !== null) {
            editInputRef.current?.focus({ preventScroll: true })
        } else if (!pending && returnEditFocus.current !== null) {
            editButtons.current.get(returnEditFocus.current)?.focus({ preventScroll: true })
            returnEditFocus.current = null
        }
    }, [editingId, showManagement, pending])

    const toggleManagement = () => {
        if (!showManagement) planningScroll.current = listRef.current?.scrollTop ?? 0
        scrollBeforeModeChange.current = showManagement ? planningScroll.current : listRef.current?.scrollTop ?? 0
        setManagement(!showManagement)
    }

    const goToCreation = () => {
        if (listRef.current) listRef.current.scrollTop = 0
        creationInputRef.current?.focus({ preventScroll: true })
    }

    const runAction = async (label: string, action: () => Promise<void>) => {
        if (pending) return
        setPending(label)
        try {
            await action()
        } catch (error) {
            logger.error(error)
            showToast(error instanceof Error ? error.message : '章节操作失败', 'error')
            await onRefresh()
        } finally {
            setPending(null)
        }
    }

    const addDrafts = async (drafts: SubjectChapterDraft[]) => {
        if (!hasDetailedChapters) {
            setConversion({ drafts })
            return
        }
        await runAction('add', async () => {
            await api.bulkCreate({ subject_id: subject.id, chapters: drafts })
            setSingleTitle('')
            setBulkText('')
            showToast(`已添加 ${drafts.length} 个章节`, 'success')
            await onRefresh()
        })
    }

    const handleSingleAdd = async () => {
        const title = singleTitle.trim()
        if (!title) return
        await addDrafts([{ title }])
    }

    const handleBulkAdd = async () => {
        const parsed = parseChapterLines(bulkText)
        if (parsed.drafts.length === 0) {
            showToast('没有可添加的章节，请按“一行一个章节”粘贴目录。', 'error')
            return
        }
        if (parsed.duplicateTitles.length > 0) {
            showToast(`已忽略本次输入中的重复行：${parsed.duplicateTitles.join('、')}`, 'success')
        }
        await addDrafts(parsed.drafts)
    }

    const confirmConversion = async (markCompletedCount: number) => {
        if (!conversion) return
        await runAction('convert', async () => {
            await api.convertFromSummary({
                subject_id: subject.id,
                chapters: conversion.drafts,
                markCompletedCount,
            })
            setConversion(null)
            setSingleTitle('')
            setBulkText('')
            showToast('已转换为详细章节模式', 'success')
            await onRefresh()
        })
    }

    const startEdit = (chapter: SubjectChapter) => {
        setEditingId(chapter.id)
        setEditTitle(chapter.title)
        setEditNotes(chapter.notes || '')
    }

    const cancelEdit = () => {
        returnEditFocus.current = editingId
        setEditingId(null)
        setEditTitle('')
        setEditNotes('')
    }

    const saveEdit = async (chapter: SubjectChapter) => {
        await runAction(`edit-${chapter.id}`, async () => {
            await api.patch(chapter.id, { title: editTitle, notes: editNotes })
            cancelEdit()
            showToast('章节已更新', 'success')
            await onRefresh()
        })
    }

    const toggleCompleted = async (chapter: SubjectChapter) => {
        await runAction(`toggle-${chapter.id}`, async () => {
            const updated = await api.toggleCompleted(chapter.id, !chapter.completed)
            onChapterUpdated(chapter, updated)
        })
    }

    const addToToday = async (chapter: SubjectChapter) => {
        if (pending || chapter.completed || todayChapterTaskIds.has(chapter.id)) return
        await runAction(`today-${chapter.id}`, async () => {
            await onAddToToday(chapter)
        })
    }

    const reorder = async (chapter: SubjectChapter, direction: -1 | 1) => {
        const index = orderedChapters.findIndex(item => item.id === chapter.id)
        const nextIndex = index + direction
        if (index < 0 || nextIndex < 0 || nextIndex >= orderedChapters.length) return
        const next = [...orderedChapters]
        const [moved] = next.splice(index, 1)
        if (!moved) return
        next.splice(nextIndex, 0, moved)
        await runAction(`reorder-${chapter.id}`, async () => {
            await api.reorder(subject.id, next.map(item => item.id))
            await onRefresh()
        })
    }

    const deleteChapter = async (chapter: SubjectChapter) => {
        const isLast = chapters.length === 1
        const needsConfirm = isLast || chapter.completed || chapter.notes.trim().length > 0
        if (needsConfirm) {
            const message = isLast
                ? `删除最后一个章节后，将退出详细章节模式并保留当前 ${stats.completed}/${stats.total} 汇总进度。确认删除吗？`
                : `删除「${chapter.title}」吗？已完成状态或说明也会一起删除。`
            if (!window.confirm(message)) return
        }
        await runAction(`delete-${chapter.id}`, async () => {
            await api.delete(chapter.id)
            showToast(isLast ? '已退出详细章节模式并保留汇总进度' : '章节已删除', 'success')
            await onRefresh()
        })
    }

    const clearDetailed = async () => {
        if (!window.confirm(`确认删除全部详细章节，并保留当前 ${stats.completed}/${stats.total} 为汇总进度吗？`)) return
        await runAction('clear', async () => {
            await api.clearDetailedChapters(subject.id)
            showToast('已退出详细章节模式，汇总进度已保留', 'success')
            await onRefresh()
        })
    }

    const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') {
            event.preventDefault()
            void handleSingleAdd()
        }
        if (event.key === 'Escape') {
            setSingleTitle('')
        }
    }

    return (
        <section className="chapter-workspace" aria-label={`${subject.name}章节规划`}>
            <div className="chapter-workspace__toolbar">
                <div className="chapter-workspace__filters" aria-label="筛选章节">
                    {([
                        ['open', `未完成 ${stats.open}`],
                        ['all', `全部 ${stats.total}`],
                        ['done', `已完成 ${stats.completed}`],
                    ] as const).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            className="chapter-workspace__filter"
                            onClick={() => setFilter(key)}
                            aria-pressed={filter === key}
                            data-testid={`chapter-filter-${key}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="chapter-workspace__search">
                    <input
                        className="chapter-workspace__input"
                        type="search"
                        placeholder="搜索章节或说明"
                        aria-label="搜索章节或说明"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                    />
                </div>
                <div className="chapter-workspace__toolbar-actions">
                    {showManagement && <button type="button" className="chapter-workspace__text-button" onClick={goToCreation} data-testid="chapter-go-to-create">添加章节</button>}
                    <button
                        type="button"
                        className="chapter-workspace__button"
                        onClick={toggleManagement}
                        aria-expanded={showManagement}
                        aria-controls={managementId}
                        data-testid="chapter-management-toggle"
                    >
                        {showManagement ? '完成管理' : '管理章节'}
                    </button>
                </div>
            </div>
            <div className="chapter-workspace__body" aria-label="章节列表" tabIndex={0} ref={listRef}>
                <div id={managementId} hidden={!showManagement} className="chapter-workspace__management">
                    <div className="chapter-workspace__management-heading">
                        <h3>{hasDetailedChapters ? '添加章节' : '建立章节目录'}</h3>
                        {hasDetailedChapters && (
                            <button
                                type="button"
                                className="chapter-workspace__text-button chapter-workspace__danger"
                                onClick={() => void clearDetailed()}
                                disabled={!!pending}
                                title="删除章节明细并保留汇总进度"
                            >
                                删除明细，保留汇总进度
                            </button>
                        )}
                    </div>
                    {!hasDetailedChapters && <p className="chapter-workspace__hint">添加章节后，逐章记录进度并安排今日任务。</p>}
                    <div className="chapter-workspace__single-add">
                        <input
                            className="chapter-workspace__input"
                            placeholder="输入章节名后按回车添加"
                            value={singleTitle}
                            onChange={event => setSingleTitle(event.target.value)}
                            onKeyDown={handleTitleKeyDown}
                            disabled={!!pending}
                            data-testid="chapter-title-input"
                            ref={creationInputRef}
                            aria-label="章节名"
                        />
                        <button
                            type="button"
                            className="chapter-workspace__button chapter-workspace__button--primary"
                            onClick={() => void handleSingleAdd()}
                            disabled={!!pending || !singleTitle.trim()}
                            data-testid="chapter-add-button"
                            title="添加章节"
                        >添加</button>
                    </div>
                    <label className="chapter-workspace__field-label" htmlFor={`chapter-bulk-${subject.id}`}>批量添加</label>
                    <textarea
                        id={`chapter-bulk-${subject.id}`}
                        className="chapter-workspace__input chapter-workspace__bulk"
                        placeholder={'一行一个章节，例如：\n第一章 函数、极限与连续\n第二章 一元函数微分学'}
                        value={bulkText}
                        onChange={event => setBulkText(event.target.value)}
                        disabled={!!pending}
                        data-testid="chapter-bulk-input"
                        aria-label="章节目录"
                    />
                    <div className="chapter-workspace__bulk-footer">
                        <span className="chapter-workspace__hint">空行忽略，本次输入中的重复章节只添加一次。</span>
                        <button
                            type="button"
                            className="chapter-workspace__button"
                            onClick={() => void handleBulkAdd()}
                            disabled={!!pending || !bulkText.trim()}
                            data-testid="chapter-bulk-button"
                            title="批量添加"
                        ><ListPlus size={15} />批量添加</button>
                    </div>
                </div>
                {!hasDetailedChapters && !showManagement && (
                    <div className="chapter-workspace__empty">
                        <p>还没有章节，建立目录后开始规划。</p>
                        <button type="button" className="chapter-workspace__button chapter-workspace__button--primary" onClick={toggleManagement}>建立章节目录</button>
                    </div>
                )}
                {hasDetailedChapters && visibleChapters.length === 0 && (
                    <div className="chapter-workspace__empty" role="status">
                        {query.trim() ? '没有匹配的章节。' : filter === 'open' && stats.open === 0 ? '全部章节都已完成。' : '当前筛选下没有章节。'}
                    </div>
                )}
                {visibleChapters.map(chapter => {
                    const editing = showManagement && editingId === chapter.id
                    const index = orderedChapters.findIndex(item => item.id === chapter.id)
                    const added = todayChapterTaskIds.has(chapter.id)
                    return (
                        <div
                            key={chapter.id}
                            className={`chapter-workspace__row${chapter.completed ? ' chapter-workspace__row--done' : ''}${editing ? ' chapter-workspace__row--editing' : ''}`}
                            data-testid={`chapter-row-${chapter.id}`}
                        >
                            <label className="chapter-workspace__completion">
                                <input
                                    className="chapter-workspace__checkbox"
                                    type="checkbox"
                                    checked={chapter.completed}
                                    onChange={() => void toggleCompleted(chapter)}
                                    disabled={!!pending}
                                    data-testid={`chapter-toggle-${chapter.id}`}
                                    aria-label={`${chapter.completed ? '标记为未完成' : '标记为已完成'}：${chapter.title}`}
                                />
                                <span>{chapter.completed ? '已完成' : '完成'}</span>
                            </label>
                            <div className="chapter-workspace__content">
                                {editing ? (
                                    <div className="chapter-workspace__edit-fields">
                                        <input
                                            className="chapter-workspace__input"
                                            value={editTitle}
                                            onChange={event => setEditTitle(event.target.value)}
                                            data-testid={`chapter-edit-title-${chapter.id}`}
                                            ref={editInputRef}
                                            onKeyDown={event => {
                                                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                                                if (event.key === 'Escape') cancelEdit()
                                                if (event.key === 'Enter') {
                                                    event.preventDefault()
                                                    void saveEdit(chapter)
                                                }
                                            }}
                                            aria-label="章节名称"
                                        />
                                        <textarea
                                            className="chapter-workspace__input chapter-workspace__notes-input"
                                            value={editNotes}
                                            onChange={event => setEditNotes(event.target.value)}
                                            data-testid={`chapter-edit-notes-${chapter.id}`}
                                            placeholder="说明"
                                            aria-label="章节说明"
                                        />
                                    </div>
                                ) : (
                                    <div className="chapter-workspace__chapter-copy">
                                        <span className="chapter-workspace__title" title={chapter.title}>{chapter.title}</span>
                                        {chapter.notes && <span className="chapter-workspace__notes" title={chapter.notes}>{chapter.notes}</span>}
                                    </div>
                                )}
                            </div>
                            {!editing && (
                                <button
                                    type="button"
                                    className="chapter-workspace__button chapter-workspace__today"
                                    data-state={added ? 'added' : chapter.completed ? 'completed' : 'available'}
                                    data-testid={added ? `chapter-added-today-${chapter.id}` : `chapter-add-today-${chapter.id}`}
                                    aria-disabled={!!pending || added || chapter.completed}
                                    aria-label={`${added ? '已加入今日任务' : chapter.completed ? '章节已完成' : '加入今日任务'}：${chapter.title}`}
                                    onClick={() => void addToToday(chapter)}
                                >
                                    {added ? <><Check size={14} aria-hidden="true" />已加入今日</> : chapter.completed ? '已完成' : <><CalendarPlus size={14} aria-hidden="true" />加入今日</>}
                                </button>
                            )}
                            {showManagement && (
                                <div className="chapter-workspace__row-actions">
                                    {editing ? (
                                        <>
                                            <button type="button" className="chapter-workspace__icon" onClick={() => void saveEdit(chapter)} title="保存章节" aria-label="保存章节" disabled={!!pending || !editTitle.trim()}><Save size={15} /></button>
                                            <button type="button" className="chapter-workspace__icon" onClick={cancelEdit} title="取消编辑" aria-label="取消编辑" disabled={!!pending}><X size={15} /></button>
                                        </>
                                    ) : (
                                        <>
                                            <button type="button" className="chapter-workspace__icon" onClick={() => void reorder(chapter, -1)} disabled={!!pending || index === 0 || filter !== 'all' || !!query.trim()} data-testid={`chapter-up-${chapter.id}`} title="上移" aria-label={`上移：${chapter.title}`}><ArrowUp size={15} /></button>
                                            <button type="button" className="chapter-workspace__icon" onClick={() => void reorder(chapter, 1)} disabled={!!pending || index === chapters.length - 1 || filter !== 'all' || !!query.trim()} data-testid={`chapter-down-${chapter.id}`} title="下移" aria-label={`下移：${chapter.title}`}><ArrowDown size={15} /></button>
                                            <button type="button" className="chapter-workspace__icon" ref={button => {
                                                if (button) editButtons.current.set(chapter.id, button)
                                                else editButtons.current.delete(chapter.id)
                                            }} onClick={() => startEdit(chapter)} title="编辑章节" aria-label="编辑章节" disabled={!!pending}><Edit3 size={15} /></button>
                                            <button type="button" className="chapter-workspace__icon chapter-workspace__danger" onClick={() => void deleteChapter(chapter)} title="删除章节" aria-label="删除章节" disabled={!!pending}><Trash2 size={15} /></button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
            {conversion && (
                <SubjectConversionDialog
                    subject={subject}
                    chapterCount={conversion.drafts.length}
                    onCancel={() => setConversion(null)}
                    onConfirm={confirmConversion}
                />
            )}
        </section>
    )
}
