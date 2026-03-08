import { useState, useEffect, useCallback } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { formatShortDate } from '../utils/helpers'
import MoodIcon from './MoodIcon'
import { SkeletonText } from './Skeleton'

function SearchPanel({ onSelectEntry }) {
  const diary = useDiary()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    mood: '',
    startDate: '',
    endDate: '',
    tagId: null,
  })
  const [tags, setTags] = useState([])

  useEffect(() => {
    loadTags()
    // Load recent entries on mount
    loadRecent()
  }, [])

  const loadTags = async () => {
    try {
      const data = await diary.tags.getAll()
      setTags(data || [])
    } catch (error) {
      console.error('Failed to load tags:', error)
    }
  }

  const loadRecent = async () => {
    try {
      setLoading(true)
      const data = await diary.entries.getAll({ limit: 50 })
      setResults(data || [])
    } catch (error) {
      console.error('Failed to load entries:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = useCallback(async () => {
    if (!query.trim() && !filters.mood && !filters.startDate && !filters.tagId) {
      loadRecent()
      return
    }

    setLoading(true)
    try {
      let data
      if (query.trim()) {
        data = await diary.entries.search(query)
      } else {
        data = await diary.entries.getAll(filters)
      }
      setResults(data || [])
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setLoading(false)
    }
  }, [query, filters, diary])

  const clearFilters = () => {
    setQuery('')
    setFilters({ mood: '', startDate: '', endDate: '', tagId: null })
    loadRecent()
  }

  const handleEntryClick = (entry) => {
    if (onSelectEntry) {
      onSelectEntry(entry)
    }
  }

  return (
    <div className="flex flex-col gap-md" style={{ height: '100%' }}>
      <h2 className="text-xl font-semibold">搜索日记</h2>

      {/* Search box */}
      <div className="card" style={{ padding: 'var(--space-md)' }}>
        <div className="flex gap-md" style={{ marginBottom: 16 }}>
          <div className="flex-1">
            <input
              type="text"
              className="input w-full"
              placeholder="搜索日记内容或标题..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button className="button button-primary" onClick={handleSearch} disabled={loading}>
            {loading ? '搜索中...' : '搜索'}
          </button>
          <button className="button button-secondary" onClick={clearFilters}>
            清空
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-md)' }}>
          <div>
            <label className="text-sm text-muted" style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>心情</label>
            <select
              className="input w-full"
              value={filters.mood}
              onChange={(e) => setFilters({ ...filters, mood: e.target.value })}
            >
              <option value="">全部心情</option>
              <option value="motivated">💪 动力满满</option>
              <option value="happy">😊 开心</option>
              <option value="calm">😐 平静</option>
              <option value="tired">😫 疲惫</option>
              <option value="anxious">😰 焦虑</option>
              <option value="sad">😢 低落</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-muted" style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>开始日期</label>
            <input
              type="date"
              className="input w-full"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm text-muted" style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>结束日期</label>
            <input
              type="date"
              className="input w-full"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm text-muted" style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>标签</label>
            <select
              className="input w-full"
              value={filters.tagId || ''}
              onChange={(e) => setFilters({ ...filters, tagId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">全部标签</option>
              {tags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="card" style={{ padding: 'var(--space-md)', flex: 1, overflow: 'auto' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <h3 className="text-lg font-medium">搜索结果 ({results.length})</h3>
          {results.length > 0 && (
            <div className="text-sm text-muted">点击条目可跳转到该日期</div>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 'var(--space-md)' }}>
            <SkeletonText lines={10} gap={32} />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: 300, gap: 'var(--space-md)' }}>
            <div style={{ fontSize: 56, opacity: 0.6 }}>
              {query || Object.values(filters).some(f => f) ? '🔍' : '📝'}
            </div>
            <h3 className="text-base font-medium">
              {query || Object.values(filters).some(f => f) ? '没有找到匹配的日记' : '开始搜索你的记忆'}
            </h3>
            {query || Object.values(filters).some(f => f) ? (
              <div className="text-muted text-sm" style={{ maxWidth: 320, lineHeight: 1.6 }}>
                尝试减少一些筛选条件，或者使用不同关键词。<br />
                <span style={{ fontSize: 13, display: 'inline-block', marginTop: 'var(--space-md)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                  💡 快捷键提示：随时按下 <b>Cmd/Ctrl + K</b> 也可以发起搜索导航哦
                </span>
              </div>
            ) : (
              <p className="text-muted text-sm" style={{ maxWidth: 280, lineHeight: 1.6 }}>
                支持通过包含的单词、特定的心情、日期范围或者是设定的标签来精确查找过往日记。
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {results.map(entry => (
              <div
                key={entry.id}
                className="card"
                onClick={() => handleEntryClick(entry)}
                style={{
                  padding: 'var(--space-md)', cursor: 'pointer',
                  transition: 'background 0.15s',
                  borderLeft: '3px solid var(--accent)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                onMouseLeave={(e) => e.currentTarget.style.background = ''}
              >
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <div className="font-medium">{entry.title || '无标题'}</div>
                  <div className="text-sm text-muted">{formatShortDate(entry.date)}</div>
                </div>
                <div className="text-sm text-secondary" style={{
                  marginBottom: 4, overflow: 'hidden',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
                }}>
                  {entry.content?.substring(0, 200)}
                </div>
                <div className="flex items-center gap-sm">
                  {entry.mood && <MoodIcon mood={entry.mood} size={20} />}
                  <span className="text-xs text-muted">{entry.word_count || 0} 字</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchPanel