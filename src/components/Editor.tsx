import { useState, useEffect, useRef, useCallback } from 'react'
import { calculateWordCount } from '../utils/helpers'
import { useDiary } from '../contexts/DiaryContext'
import { saveAs } from 'file-saver'
import ShareCard from './ShareCard'
import { showToast } from './Toast'
import TemplateManager from './TemplateManager'
import TagBadge from './TagBadge'
import { ImagePlus, Save, Sparkles, X, ChevronDown, ChevronUp, LayoutTemplate, Tags as TagsIcon } from 'lucide-react'
import MarkdownRenderer from './common/MarkdownRenderer'
import { logger } from '../utils/logger'
import { buildDiarySummaryPrompt, SYSTEM_PROMPT } from '../utils/promptTemplates'
import type { DiaryEntry, AIMessage, DiaryTemplate, Tag } from '../types'

// dom-to-image-more is only needed for share card export; lazy-load it on demand
const getDomToImage = () => import('dom-to-image-more').then(m => m.default || m)

const defaultTemplate = `## 今日学了什么
-

## 薄弱点 / 疑问
-

## 明日计划
-

## 感悟 / 碎碎念
`

interface PomodoroRecord {
  duration: number
}

interface EditorProps {
  entry: DiaryEntry | null
  onSave: (data: { title: string; content: string; tags: number[] }) => Promise<void>
  loading: boolean
}

function Editor({ entry, onSave, loading }: EditorProps) {
  const diary = useDiary()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [wordCount, setWordCount] = useState(0)
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
  const shareCardRef = useRef<HTMLDivElement>(null)

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
      isDirty.current = false
    } else if (!entry) {
      entryRef.current = null
      setTitle('')
      setContent('')
      setSelectedTagIds([])
      setWordCount(0)
      isDirty.current = false
    }
  }, [entry])

  const handleSave = useCallback(async (isManual = false) => {
    if (!entry) return
    setSaving(true)
    isDirty.current = false
    try {
      await onSave({ title, content, tags: selectedTagIds })
      if (isManual) showToast('保存成功', 'success')
    } catch (err) {
      logger.error('Save failed:', err)
      showToast('保存失败', 'error')
    }
    setSaving(false)
  }, [entry, title, content, selectedTagIds, onSave])

  const handleAiSummary = useCallback(async () => {
    if (!content.trim()) {
      showToast('请先写点内容再让 AI 总结吧！', 'info')
      return
    }
    setSummaryLoading(true)
    setSummaryExpanded(true)
    setAiSummary(null)
    try {
      const prompt = buildDiarySummaryPrompt(content, entry?.date || '')
      const messages: AIMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ]
      const result = await diary.ai.chat(messages)
      if (result.error) {
        showToast(result.error, 'error')
      } else {
        setAiSummary(result.content || '')
        showToast('AI 汇总完成！', 'success')
      }
    } catch (e) {
      logger.error(e)
      showToast('AI 请求失败，请检查网络', 'error')
    } finally {
      setSummaryLoading(false)
    }
  }, [content, entry?.date, diary])

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
    isDirty.current = true
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setContent(val)
    setWordCount(calculateWordCount(val))
    isDirty.current = true
  }

  const handleTagToggle = (tagId: number) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    )
    isDirty.current = true
  }

  const handleClearTags = () => {
    if (selectedTagIds.length === 0) return
    setSelectedTagIds([])
    isDirty.current = true
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
    setContent(templateContent)
    isDirty.current = true
  }

  return (
    <div className="flex flex-col gap-md" style={{ height: '100%' }}>
      {/* Title input */}
      <div>
        <input
          type="text"
          className="w-full"
          style={{
            fontSize: 28,
            fontWeight: 700,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            padding: '4px 0',
            letterSpacing: '-0.5px'
          }}
          placeholder="日记标题（可选）"
          value={title}
          onChange={handleTitleChange}
        />
      </div>

      {/* Unified Toolbar & Templates */}
      <div className="flex flex-wrap items-center justify-between" style={{ paddingBottom: 'var(--space-sm)', borderBottom: '1px solid var(--border-light)' }}>
        {/* Left: Templates */}
        <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
          {quickTemplates.map(tpl => (
            <button
              key={tpl.id}
              className="button button-secondary text-sm"
              onClick={() => handleTemplateInsert(tpl.content)}
              title={`插入「${tpl.name}」模板`}
              style={{ padding: '4px 12px', background: 'transparent', border: '1px dashed var(--border)' }}
            >
              {tpl.name}
            </button>
          ))}
          <button
            className="button button-secondary text-sm"
            onClick={() => setShowTemplateManager(true)}
            title="管理自定义模板"
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', background: 'transparent' }}
          >
            <LayoutTemplate size={13} /> 管理模板
          </button>
        </div>

        {/* Right: Actions & Status */}
        <div className="flex items-center gap-sm">
          {saving && <span className="text-xs text-muted">保存中...</span>}
          {loading && <span className="text-xs text-muted">加载中...</span>}
          {isDirty.current && !saving && <span className="text-xs" style={{ color: 'var(--warning)' }}>● 未保存</span>}
          
          <div className="text-sm text-muted" style={{ margin: '0 var(--space-sm)' }}>
            字数: <span className="font-medium">{wordCount}</span>
          </div>

          <button
            className="button button-secondary text-sm"
            onClick={handleAiSummary}
            disabled={summaryLoading || !content.trim()}
            title="AI 分析并汇总今日日记"
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: summaryLoading ? 'var(--text-muted)' : 'var(--accent)', padding: '4px 12px', background: 'transparent' }}
          >
            <Sparkles size={14} style={{ flexShrink: 0 }} />
            {summaryLoading ? '汇总中...' : 'AI 汇总'}
          </button>
          <button
            className="button button-secondary text-sm"
            onClick={handleShare}
            disabled={sharing}
            style={{ padding: '4px 12px', background: 'transparent' }}
          >
            <ImagePlus size={14} /> 分享
          </button>
        </div>
      </div>

      <div
        className="flex flex-col gap-xs"
        style={{
          padding: 'var(--space-sm) 0',
          borderBottom: '1px solid var(--border-light)'
        }}
      >
        <div className="flex items-center justify-between gap-sm">
          <div className="flex items-center gap-xs text-xs text-muted">
            <TagsIcon size={14} style={{ color: 'var(--accent)' }} />
            <span>先在“标签管理”创建标签，再在这里选择标签，之后可在“搜索”中按标签回顾。</span>
          </div>
          {selectedTagIds.length > 0 && (
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={handleClearTags}
              style={{ padding: '3px 8px', background: 'transparent', flexShrink: 0 }}
            >
              <X size={12} /> 清空
            </button>
          )}
        </div>
        {availableTags.length > 0 ? (
          <div className="flex flex-wrap gap-xs">
            {availableTags.map(tag => {
              const selected = selectedTagIds.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  className="text-xs rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-pressed={selected}
                  onClick={() => handleTagToggle(tag.id)}
                  style={{
                    display: 'inline-flex',
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <TagBadge tag={tag} selected={selected} interactive size="md" />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="text-xs text-muted">还没有可选标签，请先到“标签管理”创建。</div>
        )}
      </div>

      <TemplateManager
        visible={showTemplateManager}
        onClose={() => setShowTemplateManager(false)}
        onInsert={handleTemplateInsert}
      />

      {/* AI Summary Card */}
      {(aiSummary || summaryLoading) && (
        <div style={{
          borderRadius: 'var(--radius)',
          border: '1px solid',
          borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
          background: 'color-mix(in srgb, var(--accent) 5%, var(--bg-secondary))',
          overflow: 'hidden',
          transition: 'all 0.3s ease',
          marginBottom: 'var(--space-md)'
        }}>
          <div
            className="flex items-center justify-between"
            style={{ padding: 'var(--space-sm) var(--space-md)', cursor: 'pointer', borderBottom: summaryExpanded ? '1px solid color-mix(in srgb, var(--accent) 20%, transparent)' : 'none' }}
            onClick={() => setSummaryExpanded(e => !e)}
          >
            <div className="flex items-center gap-sm" style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}>
              <Sparkles size={15} />
              <span>AI 智能汇总</span>
              {summaryLoading && <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>分析中...</span>}
            </div>
            <div className="flex items-center gap-xs">
              <button
                onClick={e => { e.stopPropagation(); setAiSummary(null) }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 2 }}
                title="关闭"
              >
                <X size={14} />
              </button>
              {summaryExpanded ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
            </div>
          </div>
          {summaryExpanded && (
            <div style={{ padding: 'var(--space-md)' }}>
              {summaryLoading && !aiSummary && (
                <div className="flex items-center gap-sm text-muted" style={{ fontSize: 14 }}>
                  <div style={{ width: 16, height: 16, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  小研正在分析你的日记...
                </div>
              )}
              {aiSummary && (
                <MarkdownRenderer className="text-sm">{aiSummary}</MarkdownRenderer>
              )}
            </div>
          )}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0" style={{ position: 'relative' }}>
        {!content.trim() && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center',
            opacity: 0.05, filter: 'grayscale(1)', transition: 'opacity 0.3s'
          }}>
            <svg viewBox="0 0 24 24" width="160" height="160" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 'var(--space-lg)' }}>
              开始你的一天
            </div>
          </div>
        )}
        <textarea
          className="w-full h-full font-mono resize-none"
          style={{
            fontSize: 15,
            lineHeight: 1.8,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            padding: '4px 0'
          }}
          placeholder="写下今天的考研日记..."
          value={content}
          onChange={handleContentChange}
          spellCheck={false}
        />
      </div>

      {/* Help text */}
      <div className="text-xs text-muted flex items-center justify-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
        <div className="flex gap-lg">
          <div className="flex items-center gap-xs">
            <span className="font-medium text-secondary">Markdown 支持</span>
            <span style={{ opacity: 0.7 }}>**粗体** · - 列表</span>
          </div>
          <div className="flex items-center gap-xs">
            <span className="font-medium text-secondary">快捷保存</span>
            <span style={{ opacity: 0.7 }}><kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border)' }}>⌘/Ctrl + S</kbd></span>
          </div>
        </div>
        <div className="flex items-center gap-xs" title="全局搜索与导航">
          <span className="font-medium text-secondary">命令面板</span>
          <span style={{ opacity: 0.7 }}><kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border)' }}>⌘/Ctrl + K</kbd></span>
        </div>
      </div>
      <ShareCard ref={shareCardRef} diary={entry} pomodoros={pomodoros} />
    </div>
  )
}

export default Editor
