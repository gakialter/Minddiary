import { useState, useEffect, useCallback, useRef } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { formatShortDate } from '../utils/helpers'
import { logger } from '../utils/logger'
import MoodIcon from './MoodIcon'
import { SkeletonText } from './Skeleton'
import { Search, FileText, Trash2 } from 'lucide-react'
import ClickableImage from './ClickableImage'
import ImagePreviewModal, { type PreviewImage } from './ImagePreviewModal'
import { showToast } from './Toast'
import { isBlankDiaryEntry } from '../utils/diaryEntry'
import { toLocalAssetUrl } from '../utils/localAssetUrl'
import type { Attachment, DiaryEntry, Tag } from '../types'

interface SearchPanelProps {
  onSelectEntry?: (entry: DiaryEntry) => void
}

interface SearchFilters {
  mood: string
  startDate: string
  endDate: string
  tagId: number | null
}

type SearchResultEntry = DiaryEntry & {
  previewImages: PreviewImage[]
}

const normalizeEntryIds = (entries: DiaryEntry[]): number[] => (
  Array.from(new Set(
    entries
      .map(entry => entry.id)
      .filter(entryId => Number.isInteger(entryId) && entryId > 0),
  ))
)

function SearchPanel({ onSelectEntry }: SearchPanelProps) {
  const diary = useDiary()
  const getEntries = diary.entries.getAll
  const searchEntries = diary.entries.search
  const deleteEntry = diary.entries.delete
  const getTags = diary.tags.getAll
  const getEntryTagsBatch = diary.tags.getEntryTagsBatch
  const getEntryAttachmentsBatch = diary.attachments.getByEntries
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResultEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({
    mood: '',
    startDate: '',
    endDate: '',
    tagId: null,
  })
  const [tags, setTags] = useState<Tag[]>([])
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null)
  const searchRequestIdRef = useRef(0)

  const loadTags = useCallback(async () => {
    try {
      const data = await getTags()
      setTags(data || [])
    } catch (error) {
      logger.error('Failed to load tags:', error)
    }
  }, [getTags])

  const enrichResults = useCallback(async (entries: DiaryEntry[]): Promise<SearchResultEntry[]> => {
    const entryIds = normalizeEntryIds(entries)
    let tagsByEntry: Record<number, Tag[]> = {}
    let attachmentsByEntry: Record<number, Attachment[]> = {}

    if (entryIds.length > 0) {
      const [tagResults, attachmentResults] = await Promise.all([
        getEntryTagsBatch(entryIds).catch(error => {
          logger.error('Failed to load entry tags batch for search results:', error)
          return {}
        }),
        getEntryAttachmentsBatch(entryIds).catch(error => {
          logger.error('Failed to load entry attachments batch for search results:', error)
          return {}
        }),
      ])
      tagsByEntry = tagResults
      attachmentsByEntry = attachmentResults
    }

    const enriched = entries.map(entry => {
      const hasValidId = Number.isInteger(entry.id) && entry.id > 0
      const entryTags = hasValidId ? tagsByEntry[entry.id] ?? [] : []
      const entryTagIds = hasValidId
        ? entryTags.map(tag => tag.id)
        : Array.isArray(entry.tags) ? entry.tags : []
      const attachments = hasValidId ? attachmentsByEntry[entry.id] ?? [] : []

      const attachmentImages: PreviewImage[] = attachments.map((attachment, index) => ({
        src: toLocalAssetUrl(attachment.filepath, 'attachments'),
        alt: attachment.filename || `日记图片 ${index + 1}`,
      }))
      const legacyImages: PreviewImage[] = (entry.images || []).map((src, index) => ({
        src,
        alt: `日记图片 ${index + 1}`,
      }))
      const previewImages = [...attachmentImages, ...legacyImages]

      return {
        ...entry,
        tags: entryTagIds,
        previewImages,
      }
    })

    return enriched.filter(entry => !isBlankDiaryEntry({
      ...entry,
      images: entry.previewImages.map(image => image.src),
    }))
  }, [getEntryAttachmentsBatch, getEntryTagsBatch])

  const loadRecent = useCallback(async () => {
    const requestId = ++searchRequestIdRef.current
    try {
      setLoading(true)
      const data = await getEntries({ limit: 50 })
      const enriched = await enrichResults(data || [])
      if (requestId === searchRequestIdRef.current) {
        setResults(enriched)
      }
    } catch (error) {
      logger.error('Failed to load entries:', error)
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setLoading(false)
      }
    }
  }, [enrichResults, getEntries])

  useEffect(() => {
    void loadTags()
    // Load recent entries on mount
    void loadRecent()
  }, [loadRecent, loadTags])

  const handleSearch = useCallback(async () => {
    if (!query.trim() && !filters.mood && !filters.startDate && !filters.endDate && !filters.tagId) {
      await loadRecent()
      return
    }

    const requestId = ++searchRequestIdRef.current
    try {
      setLoading(true)
      let data: DiaryEntry[]
      if (query.trim()) {
        data = await searchEntries(query)
      } else {
        data = await getEntries({
          ...filters,
          mood: filters.mood ? filters.mood as import('../types').MoodId : undefined,
          tagId: filters.tagId ?? undefined,
        })
      }
      const enriched = await enrichResults(data || [])
      if (requestId === searchRequestIdRef.current) {
        setResults(enriched)
      }
    } catch (error) {
      logger.error('Search failed:', error)
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setLoading(false)
      }
    }
  }, [query, filters, enrichResults, getEntries, loadRecent, searchEntries])

  const clearFilters = () => {
    setQuery('')
    setFilters({ mood: '', startDate: '', endDate: '', tagId: null })
    void loadRecent()
  }

  const handleEntryClick = (entry: DiaryEntry) => {
    if (onSelectEntry) {
      onSelectEntry(entry)
    }
  }

  const handleDeleteEntry = async (event: React.MouseEvent<HTMLButtonElement>, entry: SearchResultEntry) => {
    event.stopPropagation()
    if (!window.confirm('确认删除这篇日记吗？此操作不可恢复。')) return

    try {
      await deleteEntry(entry.id)
      setResults(current => current.filter(item => item.id !== entry.id))
      showToast('日记已删除', 'success')
    } catch (error) {
      logger.error('Failed to delete entry from search result:', error)
      showToast('删除日记失败', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-md" style={{ height: '100%' }}>
      {/* Search box */}

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
              <option value="motivated">动力满满</option>
              <option value="happy">开心</option>
              <option value="calm">平静</option>
              <option value="tired">疲惫</option>
              <option value="anxious">焦虑</option>
              <option value="sad">低落</option>
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
              {query || Object.values(filters).some(f => f) ? <Search size={48} /> : <FileText size={48} />}
            </div>
            <h3 className="text-base font-medium">
              {query || Object.values(filters).some(f => f) ? '没有找到匹配的日记' : '开始搜索你的记忆'}
            </h3>
            {query || Object.values(filters).some(f => f) ? (
              <div className="text-muted text-sm" style={{ maxWidth: 320, lineHeight: 1.6 }}>
                尝试减少一些筛选条件，或者使用不同关键词。<br />
                <span style={{ fontSize: 13, display: 'inline-block', marginTop: 'var(--space-md)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius)' }}>
                  快捷键提示：随时按下 <b>Cmd/Ctrl + K</b> 也可以发起搜索导航哦
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
                data-testid={`search-result-${entry.id}`}
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
                  <div className="flex items-center gap-sm">
                    <div className="text-sm text-muted">{formatShortDate(entry.date)}</div>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={(event) => handleDeleteEntry(event, entry)}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'inherit'}
                      aria-label={`删除日记 ${entry.title || formatShortDate(entry.date)}`}
                      title="删除日记"
                      style={{ padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="text-sm text-secondary" style={{
                  marginBottom: 4, overflow: 'hidden',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
                }}>
                  {(entry as DiaryEntry & { content_snippet?: string }).content_snippet || entry.content?.substring(0, 200)}
                </div>
                {entry.previewImages.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: 'var(--space-sm) 0' }}>
                    {entry.previewImages.map((image, index) => (
                      <ClickableImage
                        key={`${image.src}-${index}`}
                        src={image.src}
                        alt={image.alt}
                        onPreview={setPreviewImage}
                        stopPropagation
                        ariaLabel={`放大查看日记图片 ${image.alt}`}
                        title={`放大查看 ${image.alt}`}
                        buttonStyle={{
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          cursor: 'zoom-in',
                          display: 'block',
                        }}
                        imageStyle={{ height: 64, width: 64, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'block' }}
                      />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-sm">
                  {entry.mood && <MoodIcon mood={entry.mood} size={20} />}
                  <span className="text-xs text-muted">{entry.word_count || 0} 字</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </div>
  )
}

export default SearchPanel
