import { useState, useEffect, useRef, useCallback } from 'react'
import { calculateWordCount } from '../utils/helpers'
import { useDiary } from '../contexts/DiaryContext'
import { saveAs } from 'file-saver'
import ShareCard from './ShareCard'
import { showToast } from './Toast'
import TemplateManager from './TemplateManager'
import TagBadge from './TagBadge'
import { Bot, ImagePlus, X, ChevronDown, ChevronUp, LayoutTemplate, Tags as TagsIcon } from 'lucide-react'
import MarkdownRenderer from './common/MarkdownRenderer'
import FormatToolbar from './common/FormatToolbar'
import DiaryWritingSurface, { type DiaryWritingHandle, type DiaryFormatState } from './common/DiaryWritingSurface'
import { logger } from '../utils/logger'
import { buildDiarySummaryPrompt, SYSTEM_PROMPT } from '../utils/promptTemplates'
import type { DiaryEntry, AIMessage, DiaryTemplate, Tag } from '../types'

// dom-to-image-more is only needed for share card export; lazy-load it on demand
const getDomToImage = () => import('dom-to-image-more').then(m => m.default || m)

interface PomodoroRecord {
  duration: number
}

export interface PendingDiaryInsert {
  id: number
  content: string
  date?: string
}

interface EditorProps {
  entry: DiaryEntry | null
  onSave: (data: { title: string; content: string; tags: number[] }, options?: { origin?: 'editor-auto' | 'editor-manual' }) => Promise<unknown>
  loading: boolean
  pendingInsert?: PendingDiaryInsert | null
  onPendingInsertApplied?: (id: number) => void
  onDirtyChange?: (isDirty: boolean) => void
}

interface SummaryRequestContext {
  entryId: number | null
  entryDate: string
  content: string
}

const getSummaryRequestContext = (entry: DiaryEntry | null, content: string): SummaryRequestContext => ({
  entryId: entry?.id ?? null,
  entryDate: entry?.date ?? '',
  content,
})

const isSameSummaryRequestContext = (a: SummaryRequestContext, b: SummaryRequestContext) => (
  a.entryId === b.entryId &&
  a.entryDate === b.entryDate &&
  a.content === b.content
)

function Editor({ entry, onSave, loading, pendingInsert, onPendingInsertApplied, onDirtyChange }: EditorProps) {
  const diary = useDiary()
  const [title, setTitle] = useState(entry?.title || '')
  const [content, setContent] = useState(entry?.content || '')
  const [wordCount, setWordCount] = useState(() => calculateWordCount(entry?.content || ''))
  const [saving, setSaving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [pomodoros, setPomodoros] = useState<PomodoroRecord[]>([])
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryExpanded, setSummaryExpanded] = useState(true)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [quickTemplates, setQuickTemplates] = useState<DiaryTemplate[]>([])
  const [availableTags, setAvailableTags] = useState<Tag[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const isDirty = useRef(false)
  const entryRef = useRef<DiaryEntry | null>(null)
  const appliedInsertIdsRef = useRef<Set<number>>(new Set())
  const shareCardRef = useRef<HTMLDivElement>(null)
  const writingRef = useRef<DiaryWritingHandle>(null)
  const [formatState, setFormatState] = useState<DiaryFormatState>({ bold: false, underline: false, highlight: false, color: undefined })
  const summaryGenerationRef = useRef(0)
  const activeSummaryGenerationRef = useRef<number | null>(null)
  const summaryRequestContextRef = useRef(getSummaryRequestContext(entry, content))

  const setDirtyState = useCallback((dirty: boolean) => {
    isDirty.current = dirty
    onDirtyChange?.(dirty)
  }, [onDirtyChange])

  const beginSummaryRequest = () => {
    const generation = ++summaryGenerationRef.current
    activeSummaryGenerationRef.current = generation
    setSummaryLoading(true)
    return generation
  }

  const isCurrentSummaryRequest = (generation: number, context: SummaryRequestContext) => (
    summaryGenerationRef.current === generation &&
    activeSummaryGenerationRef.current === generation &&
    isSameSummaryRequestContext(summaryRequestContextRef.current, context)
  )

  const hasActiveSummaryRequest = () => (
    activeSummaryGenerationRef.current !== null &&
    summaryGenerationRef.current === activeSummaryGenerationRef.current
  )

  const invalidateSummaryRequest = (updateLoading = true) => {
    summaryGenerationRef.current++
    activeSummaryGenerationRef.current = null
    if (updateLoading) setSummaryLoading(false)
  }

  const clearAiSummary = () => {
    invalidateSummaryRequest()
    setAiSummary(null)
  }

  // Load daily pomodoro total when the entry date changes
  useEffect(() => {
    if (!entry?.date) return
    diary.pomodoro.getDailyTotal(entry.date).then((totalMinutes: number) => {
      // getDailyTotal returns minutes; ShareCard expects { duration } in seconds
      setPomodoros(totalMinutes > 0 ? [{ duration: totalMinutes * 60 }] : [])
    }).catch(() => setPomodoros([]))
  }, [entry?.date])

  // Load quick-access templates (first 3)
  useEffect(() => {
    diary.templates.getAll().then(data => {
      setQuickTemplates((data || []).slice(0, 3))
    }).catch(() => {})
  }, [showTemplateManager])

  // Load tags for diary assignment.
  useEffect(() => {
    diary.tags.getAll().then(data => {
      setAvailableTags(data || [])
    }).catch(error => {
      logger.error('Failed to load tags:', error)
      setAvailableTags([])
    })
  }, [diary.tags])

  // Sync from entry prop (only when entry changes reference)
  useEffect(() => {
    if (entry && entry !== entryRef.current) {
      entryRef.current = entry
      setTitle(entry.title || '')
      setContent(entry.content || '')
      setSelectedTagIds(entry.tags || [])
      setWordCount(calculateWordCount(entry.content || ''))
      setDirtyState(false)
    } else if (!entry) {
      entryRef.current = null
      setTitle('')
      setContent('')
      setSelectedTagIds([])
      setWordCount(0)
      setDirtyState(false)
    }
  }, [entry, setDirtyState])

  useEffect(() => {
    const nextContext = getSummaryRequestContext(entry, content)
    if (!isSameSummaryRequestContext(summaryRequestContextRef.current, nextContext)) {
      summaryRequestContextRef.current = nextContext
      invalidateSummaryRequest()
      setAiSummary(null)
    }
  }, [entry?.id, entry?.date, content])

  useEffect(() => () => {
    invalidateSummaryRequest(false)
  }, [])

  useEffect(() => {
    if (!entry || !pendingInsert || appliedInsertIdsRef.current.has(pendingInsert.id)) return
    if (pendingInsert.date && pendingInsert.date !== entry.date) return

    const insertContent = pendingInsert.content.trim()
    const applied = () => {
      appliedInsertIdsRef.current.add(pendingInsert.id)
      onPendingInsertApplied?.(pendingInsert.id)
    }
    // An IME-deferred insert is acknowledged only after its transaction applies.
    // Switching diary/date cancels the queued operation, leaving the request pending.
    if (insertContent) return writingRef.current?.append(insertContent, applied)
    applied()
  }, [entry, onPendingInsertApplied, pendingInsert, setDirtyState])

  const handleSave = useCallback(async (isManual = false) => {
    if (!entry) return
    setSaving(true)
    try {
      const saved = await onSave(
        { title, content, tags: selectedTagIds },
        { origin: isManual ? 'editor-manual' : 'editor-auto' },
      )
      if (saved === null) {
        throw new Error('Save returned null')
      }
      setDirtyState(false)
      if (isManual) showToast('保存成功', 'success')
    } catch (err) {
      logger.error('Save failed:', err)
      showToast('保存失败', 'error')
    }
    setSaving(false)
  }, [entry, title, content, selectedTagIds, onSave, setDirtyState])

  const handleAiSummary = useCallback(async () => {
    if (!content.trim()) {
      showToast('请先写点内容再让 AI 总结吧！', 'info')
      return
    }
    if (hasActiveSummaryRequest()) return

    const requestContext = getSummaryRequestContext(entry, content)
    summaryRequestContextRef.current = requestContext
    const generation = beginSummaryRequest()
    setSummaryExpanded(true)
    setAiSummary(null)
    try {
      const prompt = buildDiarySummaryPrompt(content, entry?.date || '')
      const messages: AIMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ]
      const result = await diary.ai.chat(messages)
      if (!isCurrentSummaryRequest(generation, requestContext)) return
      if (result.error) {
        showToast(result.error, 'error')
      } else {
        setAiSummary(result.content || '')
        showToast('AI 汇总完成！', 'success')
      }
    } catch (e) {
      if (!isCurrentSummaryRequest(generation, requestContext)) return
      logger.error(e)
      showToast('AI 请求失败，请检查网络', 'error')
    } finally {
      if (isCurrentSummaryRequest(generation, requestContext)) {
        activeSummaryGenerationRef.current = null
        setSummaryLoading(false)
      }
    }
  }, [content, entry?.date, entry?.id, diary])

  // MarkdownRenderer handles rendering via react-markdown + remark-gfm
  const handleShare = useCallback(async () => {
    if (!shareCardRef.current) return
    setSharing(true)
    try {
      const domToImage = await getDomToImage()
      const blob = await domToImage.toBlob(shareCardRef.current, { scale: 2 })
      saveAs(blob, 'MindDiary-Share.png')
    } catch (err) {
      logger.error('Share image generation failed:', err)
    } finally {
      setSharing(false)
    }
  }, [])

  // Auto-save after 2 seconds of inactivity (only when dirty)
  useEffect(() => {
    if (!isDirty.current) return

    const timeout = setTimeout(() => {
      if (isDirty.current) {
        handleSave()
      }
    }, 2000)
    return () => clearTimeout(timeout)
  }, [handleSave])

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value)
    setDirtyState(true)
  }

  // Every writing transaction publishes canonical Markdown to the save/AI state.
  const handleContentChange = useCallback((newValue: string) => {
    setContent(newValue)
    setWordCount(calculateWordCount(newValue))
    setDirtyState(true)
  }, [setDirtyState])

  const handleTagToggle = (tagId: number) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    )
    setDirtyState(true)
  }

  const handleClearTags = () => {
    if (selectedTagIds.length === 0) return
    setSelectedTagIds([])
    setDirtyState(true)
  }

  // Ctrl+S manual save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  const handleTemplateInsert = (templateContent: string) => {
    writingRef.current?.replace(templateContent)
  }

  const saveState = saving ? 'saving' : loading ? 'loading' : isDirty.current ? 'dirty' : entry ? 'saved' : 'idle'
  const saveStateLabel = saving
    ? '保存中…'
    : loading
      ? '加载中…'
      : isDirty.current
        ? '未保存'
        : entry
          ? '已保存'
          : '等待输入'

  return (
    <div className="editor-workspace content-selectable">
      <section className="editor-document" aria-label="日记编辑区" aria-busy={saving || loading}>
        <header className="editor-document__header">
          <p className="editor-document__date">
            {entry?.date ? <time dateTime={entry.date}>{entry.date}</time> : '新日记'}
          </p>
          <label className="editor-visually-hidden" htmlFor="editor-diary-title">日记标题</label>
          <input
            id="editor-diary-title"
            type="text"
            className="editor-document__title"
            placeholder="日记标题（可选）"
            value={title}
            onChange={handleTitleChange}
          />
        </header>

        <section className="editor-commandbar" aria-label="编辑工具与状态">
          <div className="editor-commandbar__primary" data-diary-format="true">
            <FormatToolbar
              active={formatState}
              onClearColor={() => writingRef.current?.format('color', null)}
              onBold={() => writingRef.current?.format('bold')}
              onHighlight={() => writingRef.current?.format('highlight')}
              onUnderline={() => writingRef.current?.format('underline')}
              onColor={color => writingRef.current?.format('color', color)}
            />
            <span className="editor-commandbar__separator" aria-hidden="true" />
            <div
              className="editor-save-state"
              data-state={saveState}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="editor-save-state__dot" aria-hidden="true" />
              {saveStateLabel}
            </div>
            <div className="editor-word-count" aria-label={`日记字数 ${wordCount}`}>
              <span>{wordCount}</span> 字
            </div>
          </div>

          <div className="editor-commandbar__secondary" aria-label="编辑器辅助操作">
            {quickTemplates.map(tpl => (
              <button
                key={tpl.id}
                type="button"
                className="editor-utility-button editor-utility-button--template"
                onClick={() => handleTemplateInsert(tpl.content)}
                title={`插入「${tpl.name}」模板`}
              >
                {tpl.name}
              </button>
            ))}
            <button
              type="button"
              className="editor-utility-button"
              onClick={() => setShowTemplateManager(true)}
              title="管理自定义模板"
            >
              <LayoutTemplate size={14} aria-hidden="true" />
              管理模板
            </button>
            <span className="editor-commandbar__separator" aria-hidden="true" />
            <button
              type="button"
              className="editor-utility-button editor-utility-button--ai"
              onClick={handleAiSummary}
              disabled={summaryLoading || !content.trim()}
              title="AI 分析并汇总今日日记"
            >
              <Bot size={14} aria-hidden="true" />
              {summaryLoading ? '汇总中…' : 'AI 汇总'}
            </button>
            <button
              type="button"
              className="editor-utility-button"
              onClick={handleShare}
              disabled={sharing}
            >
              <ImagePlus size={14} aria-hidden="true" />
              {sharing ? '生成中…' : '分享'}
            </button>
          </div>
        </section>

        <div className="editor-writing-canvas" data-empty={!content.trim() ? 'true' : 'false'}>
          <label className="editor-visually-hidden" htmlFor="editor-diary-content">日记正文</label>
          {!content.trim() && (
            <div className="editor-writing-canvas__empty" aria-hidden="true">
              <strong>今天最值得记住的是什么？</strong>
              <span>从一件具体的小事开始写。</span>
            </div>
          )}
          <DiaryWritingSurface
            key={entry?.date ?? 'new'}
            ref={writingRef}
            identity={`${entry?.date ?? 'new'}:${entry?.id ?? ''}`}
            polishChat={diary.ai.chat}
            value={entry !== entryRef.current ? entry?.content || '' : content}
            onChange={handleContentChange}
            onFormatState={setFormatState}
          />
        </div>

        <section className="editor-metadata" aria-labelledby="editor-tags-heading">
          <div className="editor-metadata__header">
            <div>
              <h2 id="editor-tags-heading" className="editor-metadata__title">
                <TagsIcon size={14} aria-hidden="true" />
                标签
              </h2>
              <p>用于稍后在“搜索”中按主题回顾。</p>
            </div>
            {selectedTagIds.length > 0 && (
              <button type="button" className="editor-metadata__clear" onClick={handleClearTags}>
                <X size={12} aria-hidden="true" />
                清空
              </button>
            )}
          </div>
          {availableTags.length > 0 ? (
            <div className="editor-metadata__tags">
              {availableTags.map(tag => {
                const selected = selectedTagIds.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className="editor-tag-toggle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-pressed={selected}
                    onClick={() => handleTagToggle(tag.id)}
                  >
                    <TagBadge tag={tag} selected={selected} interactive size="md" />
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="editor-metadata__empty">还没有可选标签，请先到“标签管理”创建。</p>
          )}
        </section>

        {(aiSummary || summaryLoading) && (
          <section className="editor-ai-summary" aria-label="AI 辅助摘要">
            <div className="editor-ai-summary__header">
              <button
                type="button"
                className="editor-ai-summary__disclosure"
                aria-label="AI 辅助摘要"
                aria-describedby="editor-ai-summary-provenance"
                aria-expanded={summaryExpanded}
                aria-controls="editor-ai-summary-content"
                onClick={() => setSummaryExpanded(expanded => !expanded)}
              >
                <span className="editor-ai-summary__identifier" aria-hidden="true">AI</span>
                <span className="editor-ai-summary__label">
                  <strong>AI 辅助摘要</strong>
                  <small id="editor-ai-summary-provenance">
                    {summaryLoading ? '正在分析 · 仅供参考' : '由模型生成 · 仅供参考'}
                  </small>
                </span>
                {summaryExpanded
                  ? <ChevronUp size={15} aria-hidden="true" />
                  : <ChevronDown size={15} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="editor-ai-summary__close"
                onClick={clearAiSummary}
                aria-label="关闭 AI 摘要"
                title="关闭 AI 摘要"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            {summaryExpanded && (
              <div id="editor-ai-summary-content" className="editor-ai-summary__content">
                {summaryLoading && !aiSummary && (
                  <div className="editor-ai-summary__loading" role="status" aria-live="polite">
                    <span className="editor-ai-summary__spinner" aria-hidden="true" />
                    小研正在分析你的日记…
                  </div>
                )}
                {aiSummary && <MarkdownRenderer>{aiSummary}</MarkdownRenderer>}
              </div>
            )}
          </section>
        )}

        <footer className="editor-document__footer">
          <div>
            <strong>实时预览 · Markdown</strong>
            <span>选中文字设置格式；移入格式内可编辑 Markdown 标记。</span>
          </div>
          <div className="editor-document__shortcuts">
            <span>保存 <kbd>Ctrl/⌘ S</kbd></span>
            <span>命令面板 <kbd>Ctrl/⌘ K</kbd></span>
          </div>
        </footer>
      </section>

      <TemplateManager
        visible={showTemplateManager}
        onClose={() => setShowTemplateManager(false)}
        onInsert={handleTemplateInsert}
      />
      <ShareCard ref={shareCardRef} diary={entry} pomodoros={pomodoros} />
    </div>
  )
}

export default Editor
