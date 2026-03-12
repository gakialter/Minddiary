import { useState, useEffect, useRef, useCallback } from 'react'
import { calculateWordCount } from '../utils/helpers'
import { useDiary } from '../contexts/DiaryContext'
import { saveAs } from 'file-saver'
import ShareCard from './ShareCard'
import { showToast } from './Toast'

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

function Editor({ entry, onSave, loading }) {
  const diary = useDiary()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState(defaultTemplate)
  const [wordCount, setWordCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [pomodoros, setPomodoros] = useState([])
  const isDirty = useRef(false)
  const entryRef = useRef(null)
  const shareCardRef = useRef(null)

  // Load daily pomodoro total when the entry date changes
  useEffect(() => {
    if (!entry?.date) return
    diary.pomodoro.getDailyTotal(entry.date).then(totalMinutes => {
      // getDailyTotal returns minutes; ShareCard expects { duration } in seconds
      setPomodoros(totalMinutes > 0 ? [{ duration: totalMinutes * 60 }] : [])
    }).catch(() => setPomodoros([]))
  }, [entry?.date])

  // Sync from entry prop (only when entry changes reference)
  useEffect(() => {
    if (entry && entry !== entryRef.current) {
      entryRef.current = entry
      setTitle(entry.title || '')
      setContent(entry.content || defaultTemplate)
      setWordCount(calculateWordCount(entry.content || ''))
      isDirty.current = false
    }
  }, [entry])

  const handleSave = useCallback(async (isManual = false) => {
    if (!entry) return
    setSaving(true)
    isDirty.current = false
    try {
      await onSave({ title, content })
      if (isManual) showToast('保存成功', 'success')
    } catch (err) {
      console.error('Save failed:', err)
      showToast('保存失败', 'error')
    }
    setSaving(false)
  }, [entry, title, content, onSave])

  const handleShare = useCallback(async () => {
    if (!shareCardRef.current) return
    setSharing(true)
    try {
      const domToImage = await getDomToImage()
      const blob = await domToImage.toBlob(shareCardRef.current, { scale: 2 })
      saveAs(blob, 'MindDiary-Share.png')
    } catch (err) {
      console.error('Share image generation failed:', err)
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

  const handleTitleChange = (e) => {
    setTitle(e.target.value)
    isDirty.current = true
  }

  const handleContentChange = (e) => {
    const val = e.target.value
    setContent(val)
    setWordCount(calculateWordCount(val))
    isDirty.current = true
  }

  // Ctrl+S manual save
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  const handleTemplateInsert = (section) => {
    const templates = {
      summary: `## 今日学了什么
-

## 薄弱点 / 疑问
-

## 明日计划
-

## 感悟 / 碎碎念
`,
      simple: `## 今日总结
- 学了什么？
- 有什么收获？
- 明天做什么？
`,
      detailed: `## 学习内容
**科目**：
**章节**：
**用时**：小时

## 重点记录
1.
2.

## 错题分析
-

## 心态调整
-
`,
    }
    setContent(templates[section])
    isDirty.current = true
  }

  return (
    <div className="flex flex-col gap-md" style={{ height: '100%' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <h2 className="text-xl font-semibold">日记编辑</h2>
          {saving && <span className="text-xs text-muted">保存中...</span>}
          {loading && <span className="text-xs text-muted">加载中...</span>}
          {isDirty.current && !saving && <span className="text-xs" style={{ color: 'var(--warning)' }}>● 未保存</span>}
        </div>
        <div className="flex items-center gap-sm">
          <div className="text-sm text-muted">
            字数: <span className="font-medium">{wordCount}</span>
          </div>
          <button
            className="button button-secondary text-sm"
            onClick={handleShare}
            disabled={sharing}
            title="生成分享图片"
          >
            {sharing ? '生成中...' : '🖼️ 分享'}
          </button>
          <button
            className="button button-secondary text-sm"
            onClick={() => handleSave(true)}
            disabled={saving}
          >
            {saving ? '保存中...' : '💾 Ctrl+S'}
          </button>
        </div>
      </div>

      {/* Template buttons */}
      <div className="flex gap-sm">
        <button className="button button-secondary text-sm" onClick={() => handleTemplateInsert('summary')}>
          考研模板
        </button>
        <button className="button button-secondary text-sm" onClick={() => handleTemplateInsert('simple')}>
          简洁模板
        </button>
        <button className="button button-secondary text-sm" onClick={() => handleTemplateInsert('detailed')}>
          详细模板
        </button>
      </div>

      {/* Title input */}
      <div>
        <input
          type="text"
          className="w-full"
          style={{
            fontSize: 22,
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            padding: '4px 0'
          }}
          placeholder="日记标题（可选）"
          value={title}
          onChange={handleTitleChange}
        />
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0" style={{ position: 'relative' }}>
        {content === defaultTemplate && (
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
          spellCheck="false"
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