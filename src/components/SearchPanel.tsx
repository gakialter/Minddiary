import { useState, useEffect, useCallback, useRef } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { formatShortDate } from '../utils/helpers'
import { logger } from '../utils/logger'
import MoodIcon from './MoodIcon'
import { SkeletonText } from './Skeleton'
import TagBadge from './TagBadge'
import { Search, FileText, Trash2 } from 'lucide-react'
import ClickableImage from './ClickableImage'
import ImagePreviewModal, { type PreviewImage } from './ImagePreviewModal'
import { showToast } from './Toast'
import { isBlankDiaryEntry } from '../utils/diaryEntry'
import { toLocalAssetUrl } from '../utils/localAssetUrl'
import type { Attachment, DiaryEntry, Tag } from '../types'
import { createSearchSession, type SearchFilters, type SearchIntent, type SearchSessionState } from '../utils/searchSession'

interface SearchPanelProps {
  onSelectEntry?: (entry: DiaryEntry) => void
  session?: SearchSessionState
  onSessionChange?: (session: SearchSessionState) => void
}

type SearchResultEntry = DiaryEntry & {
  previewImages: PreviewImage[]
  displayTags: Tag[]
}

const normalizeEntryIds = (entries: DiaryEntry[]): number[] => (
  Array.from(new Set(
    entries
      .map(entry => entry.id)
      .filter(entryId => Number.isInteger(entryId) && entryId > 0),
  ))
)

function SearchPanel({ onSelectEntry, session, onSessionChange }: SearchPanelProps) {
  const diary = useDiary()
  const getEntries = diary.entries.getAll
  const searchEntries = diary.entries.search
  const deleteEntry = diary.entries.delete
  const getTags = diary.tags.getAll
  const getEntryTagsBatch = diary.tags.getEntryTagsBatch
  const getEntryAttachmentsBatch = diary.attachments.getByEntries
  const [query, setQuery] = useState(session?.query ?? '')
  const [results, setResults] = useState<SearchResultEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>(session?.filters ?? createSearchSession().filters)
  const [submitted, setSubmitted] = useState<SearchIntent | null>(session?.submitted ?? null)
  const initialIntent = useRef(session?.submitted ?? null)
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
        displayTags: entryTags,
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
  }, [loadTags])

  useEffect(() => {
    onSessionChange?.({ query, filters, submitted })
  }, [query, filters, submitted, onSessionChange])

  const runSearch = useCallback(async ({ query, filters }: SearchIntent) => {
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
      const enriched = (await enrichResults(data || [])).filter(entry => (
        (!filters.mood || entry.mood === filters.mood)
        && (!filters.startDate || entry.date >= filters.startDate)
        && (!filters.endDate || entry.date <= filters.endDate)
        && (!filters.tagId || entry.tags?.includes(filters.tagId))
      ))
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
  }, [enrichResults, getEntries, loadRecent, searchEntries])

  useEffect(() => {
    if (initialIntent.current) void runSearch(initialIntent.current)
    else void loadRecent()
    return () => { searchRequestIdRef.current++ }
  }, [loadRecent, runSearch])

  const handleSearch = () => {
    const intent = { query, filters }
    initialIntent.current = intent
    setSubmitted(intent)
    void runSearch(intent)
  }

  const clearFilters = () => {
    initialIntent.current = null
    setQuery('')
    setFilters({ mood: '', startDate: '', endDate: '', tagId: null })
    setSubmitted(null)
    void loadRecent()
  }

  const handleEntryClick = (entry: DiaryEntry) => {
    if (onSelectEntry) {
      onSelectEntry(entry)
    }
  }

  const handleDeleteEntry = async (event: React.MouseEvent<HTMLButtonElement>, entry: SearchResultEntry) => {
    event.stopPropagation()
    if (!window.confirm('删除这篇日记？删除后无法恢复。')) return

    try {
      await deleteEntry(entry.id)
      setResults(current => current.filter(item => item.id !== entry.id))
      showToast('日记已删除', 'success')
    } catch (error) {
      logger.error('Failed to delete entry from search result:', error)
      showToast('未能删除日记，请重试。', 'error')
    }
  }

  return (
    <div className="workspace-page workspace-page--wide workspace-search" aria-busy={loading}>
      <section className="workspace-section workspace-search__controls" aria-labelledby="search-controls-title">
        <div className="workspace-section__heading">
          <div>
            <h2 id="search-controls-title">搜索条件</h2>
            <p className="workspace-help">按标题或内容、心情、日期或标签找日记。</p>
          </div>
        </div>

        <div className="workspace-search__query-row">
          <div className="workspace-field workspace-search__query">
            <label htmlFor="diary-search-query">搜索内容</label>
            <input
              id="diary-search-query"
              type="text"
              className="input w-full"
              placeholder="搜索日记内容或标题..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button type="button" className="button button-primary" onClick={handleSearch} disabled={loading}>
            {loading ? '正在查找…' : '搜索'}
          </button>
          <button type="button" className="button button-secondary" onClick={clearFilters}>
            清空搜索条件
          </button>
        </div>

        <div className="workspace-search__filters">
          <div className="workspace-field">
            <label htmlFor="diary-search-mood">心情</label>
            <select
              id="diary-search-mood"
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
          <div className="workspace-field">
            <label htmlFor="diary-search-start-date">开始日期</label>
            <input
              id="diary-search-start-date"
              type="date"
              className="input w-full"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
          </div>
          <div className="workspace-field">
            <label htmlFor="diary-search-end-date">结束日期</label>
            <input
              id="diary-search-end-date"
              type="date"
              className="input w-full"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
          </div>
          <div className="workspace-field">
            <label htmlFor="diary-search-tag">标签</label>
            <select
              id="diary-search-tag"
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
      </section>

      <section
        className="workspace-section workspace-search__results"
        aria-labelledby="search-results-title"
        aria-busy={loading}
      >
        <div className="workspace-section__heading workspace-search__results-heading">
          <h2 id="search-results-title">搜索结果 <span className="workspace-search__result-count">{results.length}</span></h2>
          {results.length > 0 && (
            <p className="workspace-help">点击标题，打开这篇日记。</p>
          )}
        </div>

        {loading ? (
          <div className="workspace-status workspace-search__loading" role="status" aria-live="polite">
            <span className="sr-only">正在查找日记…</span>
            <SkeletonText lines={10} gap={32} />
          </div>
        ) : results.length === 0 ? (
          <div className="workspace-empty workspace-search__empty" role="status">
            <div className="workspace-empty__icon" aria-hidden="true">
              {query || Object.values(filters).some(f => f) ? <Search size={36} /> : <FileText size={36} />}
            </div>
            <h3>
              {query || Object.values(filters).some(f => f) ? '没找到日记，换个词或减少筛选。' : '输入关键词，或按心情、日期、标签筛选日记。'}
            </h3>
            {query || Object.values(filters).some(f => f) ? (
              <p>换个词，或减少筛选条件。</p>
            ) : (
              <p>
                可按标题、内容、心情、日期或标签查找日记。
              </p>
            )}
            <p className="workspace-search__shortcut-hint">
              按 <kbd>Ctrl/⌘ K</kbd> 打开快捷菜单。
            </p>
          </div>
        ) : (
          <div className="workspace-search__result-list" role="list">
            {results.map(entry => (
              <article
                key={entry.id}
                data-testid={`search-result-${entry.id}`}
                className="workspace-search__result"
                role="listitem"
                onClick={() => handleEntryClick(entry)}
              >
                <div className="workspace-search__result-header">
                  <button
                    type="button"
                    className="workspace-search__open-result"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleEntryClick(entry)
                    }}
                    aria-label={`打开日记 ${entry.title || formatShortDate(entry.date)}`}
                  >
                    {entry.title || '未写标题'}
                  </button>
                  <div className="workspace-search__result-actions">
                    <time className="workspace-search__date" dateTime={entry.date}>{formatShortDate(entry.date)}</time>
                    <button
                      type="button"
                      className="workspace-search__delete-result"
                      onClick={(event) => handleDeleteEntry(event, entry)}
                      aria-label={`删除日记 ${entry.title || formatShortDate(entry.date)}`}
                      title="删除日记"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <p className="workspace-search__snippet">
                  {(entry as DiaryEntry & { content_snippet?: string }).content_snippet || entry.content?.substring(0, 200)}
                </p>
                {entry.previewImages.length > 0 && (
                  <div className="workspace-search__images">
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
                        imageStyle={{ height: 64, width: 64, objectFit: 'cover', borderRadius: 'var(--radius-control)', border: '1px solid var(--color-border-default)', display: 'block' }}
                      />
                    ))}
                  </div>
                )}
                {entry.displayTags.length > 0 && (
                  <div className="workspace-search__tags">
                    {entry.displayTags.map(tag => (
                      <span key={tag.id} className="workspace-tag-preview" data-variant={tag.variant}>
                        <TagBadge tag={tag} size="sm" />
                      </span>
                    ))}
                  </div>
                )}
                <div className="workspace-search__metadata">
                  {entry.mood && <MoodIcon mood={entry.mood} size={20} />}
                  <span>{entry.word_count || 0} 字</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </div>
  )
}

export default SearchPanel
