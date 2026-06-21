import { useMemo, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Check, Edit3, ListPlus, Save, Trash2, X } from 'lucide-react'
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

interface SubjectChapterPanelProps {
    subject: Subject
    chapters: SubjectChapter[]
    color: string
    api: SubjectChaptersContextAPI
    onRefresh: () => Promise<void>
    todayChapterTaskIds: Set<number>
    onAddToToday: (chapter: SubjectChapter) => Promise<void>
}

interface PendingConversion {
    drafts: SubjectChapterDraft[]
}

export default function SubjectChapterPanel({
    subject,
    chapters,
    color,
    api,
    onRefresh,
    todayChapterTaskIds,
    onAddToToday,
}: SubjectChapterPanelProps) {
    const [filter, setFilter] = useState<ChapterFilter>('all')
    const [singleTitle, setSingleTitle] = useState('')
    const [bulkText, setBulkText] = useState('')
    const [editingId, setEditingId] = useState<number | null>(null)
    const [editTitle, setEditTitle] = useState('')
    const [editNotes, setEditNotes] = useState('')
    const [pending, setPending] = useState<string | null>(null)
    const [conversion, setConversion] = useState<PendingConversion | null>(null)

    const stats = useMemo(() => calculateChapterStats(chapters), [chapters])
    const visibleChapters = useMemo(() => filterChapters(chapters, filter), [chapters, filter])
    const hasDetailedChapters = chapters.length > 0

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
            await api.toggleCompleted(chapter.id, !chapter.completed)
            await onRefresh()
        })
    }

    const addToToday = async (chapter: SubjectChapter) => {
        await runAction(`today-${chapter.id}`, async () => {
            await onAddToToday(chapter)
        })
    }

    const reorder = async (chapter: SubjectChapter, direction: -1 | 1) => {
        const ordered = filterChapters(chapters, 'all')
        const index = ordered.findIndex(item => item.id === chapter.id)
        const nextIndex = index + direction
        if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return
        const next = [...ordered]
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
        if (event.key === 'Enter') {
            event.preventDefault()
            void handleSingleAdd()
        }
        if (event.key === 'Escape') {
            setSingleTitle('')
        }
    }

    return (
        <div
            style={{
                marginTop: 'var(--space-lg)',
                paddingTop: 'var(--space-lg)',
                borderTop: '1px solid var(--border)',
            }}
        >
            <div className="flex items-center justify-between gap-md flex-wrap" style={{ marginBottom: 'var(--space-md)' }}>
                <div>
                    <div className="font-semibold">章节管理</div>
                    <div className="text-sm text-muted">
                        {hasDetailedChapters
                            ? `全部 ${stats.total} · 未完成 ${stats.open} · 已完成 ${stats.completed}`
                            : '当前是汇总模式，添加第一批章节后会转换为详细章节模式。'}
                    </div>
                </div>
                {hasDetailedChapters && (
                    <button
                        className="button button-secondary"
                        onClick={clearDetailed}
                        disabled={!!pending}
                        title="退出详细章节模式并保留汇总进度"
                    >
                        退出详细模式
                    </button>
                )}
            </div>

            <div className="flex gap-sm" style={{ marginBottom: 'var(--space-sm)' }}>
                <input
                    className="input"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="输入章节名称，按 Enter 添加"
                    value={singleTitle}
                    onChange={event => setSingleTitle(event.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    disabled={!!pending}
                    data-testid="chapter-title-input"
                    aria-label="章节名称"
                />
                <button
                    className="button button-primary"
                    onClick={handleSingleAdd}
                    disabled={!!pending || !singleTitle.trim()}
                    data-testid="chapter-add-button"
                    title="添加章节"
                >
                    添加
                </button>
            </div>

            <div style={{ display: 'grid', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                <textarea
                    className="input"
                    style={{ minHeight: 92, resize: 'vertical' }}
                    placeholder={'批量粘贴目录，一行一个章节\n第一章 函数、极限与连续\n第二章 一元函数微分学'}
                    value={bulkText}
                    onChange={event => setBulkText(event.target.value)}
                    disabled={!!pending}
                    data-testid="chapter-bulk-input"
                    aria-label="批量章节目录"
                />
                <div className="flex items-center justify-between gap-sm flex-wrap">
                    <div className="text-xs text-muted">
                        空行会自动忽略；本次输入中的完全重复行只创建一次。
                    </div>
                    <button
                        className="button button-secondary"
                        onClick={handleBulkAdd}
                        disabled={!!pending || !bulkText.trim()}
                        data-testid="chapter-bulk-button"
                        title="批量添加章节"
                    >
                        <ListPlus size={15} /> 批量添加
                    </button>
                </div>
            </div>

            {hasDetailedChapters && (
                <div className="flex items-center gap-sm flex-wrap" style={{ marginBottom: 'var(--space-md)' }}>
                    {([
                        ['all', `全部 ${stats.total}`],
                        ['open', `未完成 ${stats.open}`],
                        ['done', `已完成 ${stats.completed}`],
                    ] as const).map(([key, label]) => (
                        <button
                            key={key}
                            className={`button ${filter === key ? 'button-primary' : 'button-secondary'}`}
                            style={{ borderRadius: 20, padding: '6px 12px' }}
                            onClick={() => setFilter(key)}
                            aria-pressed={filter === key}
                            data-testid={`chapter-filter-${key}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

            {hasDetailedChapters && stats.nextIncomplete && (
                <div
                    className="text-sm"
                    style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-light)',
                        borderRadius: 8,
                        padding: '8px 10px',
                        marginBottom: 'var(--space-sm)',
                    }}
                >
                    下一未完成章节：<span className="font-semibold">{stats.nextIncomplete.title}</span>
                </div>
            )}

            {hasDetailedChapters && visibleChapters.length === 0 && (
                <div className="empty-state" style={{ padding: 'var(--space-lg)', background: 'var(--bg-secondary)' }}>
                    {filter === 'open' && stats.open === 0 ? '全部章节都已完成。' : '当前筛选下没有章节。'}
                </div>
            )}

            {hasDetailedChapters && visibleChapters.length > 0 && (
                <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                    {visibleChapters.map((chapter, index) => {
                        const editing = editingId === chapter.id
                        return (
                            <div
                                key={chapter.id}
                                data-testid={`chapter-row-${chapter.id}`}
                                style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '10px',
                                    background: chapter.completed ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                                }}
                            >
                                <div className="flex items-start gap-sm">
                                    <input
                                        type="checkbox"
                                        checked={chapter.completed}
                                        onChange={() => void toggleCompleted(chapter)}
                                        disabled={!!pending}
                                        data-testid={`chapter-toggle-${chapter.id}`}
                                        aria-label={`切换章节完成状态：${chapter.title}`}
                                        style={{ marginTop: 5 }}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        {editing ? (
                                            <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                                                <input
                                                    className="input"
                                                    value={editTitle}
                                                    onChange={event => setEditTitle(event.target.value)}
                                                    data-testid={`chapter-edit-title-${chapter.id}`}
                                                    onKeyDown={event => {
                                                        if (event.key === 'Escape') cancelEdit()
                                                        if (event.key === 'Enter') void saveEdit(chapter)
                                                    }}
                                                    aria-label="编辑章节标题"
                                                />
                                                <textarea
                                                    className="input"
                                                    value={editNotes}
                                                    onChange={event => setEditNotes(event.target.value)}
                                                    data-testid={`chapter-edit-notes-${chapter.id}`}
                                                    placeholder="可选说明"
                                                    aria-label="编辑章节说明"
                                                    style={{ minHeight: 68, resize: 'vertical' }}
                                                />
                                            </div>
                                        ) : (
                                            <>
                                                <div
                                                    className="font-semibold"
                                                    style={{
                                                        textDecoration: chapter.completed ? 'line-through' : 'none',
                                                        color: chapter.completed ? 'var(--text-secondary)' : 'var(--text-primary)',
                                                        overflowWrap: 'anywhere',
                                                    }}
                                                >
                                                    {chapter.title}
                                                </div>
                                                {chapter.notes && (
                                                    <div className="text-sm text-muted" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>
                                                        {chapter.notes}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <div className="flex gap-xs" style={{ flexShrink: 0 }}>
                                        {editing ? (
                                            <>
                                                <button className="icon-button" onClick={() => void saveEdit(chapter)} title="保存章节" disabled={!!pending}>
                                                    <Save size={15} />
                                                </button>
                                                <button className="icon-button" onClick={cancelEdit} title="取消编辑" disabled={!!pending}>
                                                    <X size={15} />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    className="icon-button"
                                                    onClick={() => void reorder(chapter, -1)}
                                                    disabled={!!pending || index === 0 || filter !== 'all'}
                                                    data-testid={`chapter-up-${chapter.id}`}
                                                    title="上移章节"
                                                >
                                                    <ArrowUp size={15} />
                                                </button>
                                                <button
                                                    className="icon-button"
                                                    onClick={() => void reorder(chapter, 1)}
                                                    disabled={!!pending || index === visibleChapters.length - 1 || filter !== 'all'}
                                                    data-testid={`chapter-down-${chapter.id}`}
                                                    title="下移章节"
                                                >
                                                    <ArrowDown size={15} />
                                                </button>
                                                <button className="icon-button" onClick={() => startEdit(chapter)} title="编辑章节" disabled={!!pending}>
                                                    <Edit3 size={15} />
                                                </button>
                                                <button
                                                    className="icon-button"
                                                    onClick={() => void deleteChapter(chapter)}
                                                    title="删除章节"
                                                    disabled={!!pending}
                                                    style={{ color: 'var(--danger)' }}
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {!chapter.completed && !editing && (
                                    <div style={{ marginTop: 8, paddingLeft: 26 }}>
                                        <button
                                            type="button"
                                            className="button button-secondary"
                                            data-testid={todayChapterTaskIds.has(chapter.id)
                                                ? `chapter-added-today-${chapter.id}`
                                                : `chapter-add-today-${chapter.id}`}
                                            disabled={!!pending || todayChapterTaskIds.has(chapter.id)}
                                            onClick={() => void addToToday(chapter)}
                                            style={{ minHeight: 32, padding: '4px 10px', borderRadius: 16, fontSize: 12 }}
                                        >
                                            {todayChapterTaskIds.has(chapter.id) ? '已加入今日任务' : '加入今日任务'}
                                        </button>
                                    </div>
                                )}
                                {chapter.completed && !editing && (
                                    <div className="text-xs" style={{ color: color, marginTop: 6, paddingLeft: 26 }}>
                                        <Check size={12} style={{ display: 'inline', marginRight: 4 }} />
                                        已完成
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {conversion && (
                <SubjectConversionDialog
                    subject={subject}
                    chapterCount={conversion.drafts.length}
                    onCancel={() => setConversion(null)}
                    onConfirm={confirmConversion}
                />
            )}
        </div>
    )
}
