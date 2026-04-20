import { useState, useEffect } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import Skeleton from './Skeleton'
import type { Tag } from '../types'

function TagManager() {
  const diary = useDiary()
  const [tags, setTags] = useState<Tag[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#6366f1')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadTags()
  }, [])

  const loadTags = async () => {
    setLoading(true)
    try {
      const data = await diary.tags.getAll()
      setTags(data || [])
    } catch (error) {
      console.error('Failed to load tags:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    try {
      await diary.tags.create({ name: newTagName.trim(), color: newTagColor })
      setNewTagName('')
      setNewTagColor('#6366f1')
      loadTags()
      showToast(`标签「${newTagName.trim()}」已创建`, 'success')
    } catch (error) {
      console.error('Failed to create tag:', error)
      showToast('创建失败', 'error')
    }
  }

  const handleUpdateTag = async (id: number, updates: Partial<Tag>) => {
    try {
      await diary.tags.update(id, updates)
      loadTags()
    } catch (error) {
      console.error('Failed to update tag:', error)
    }
  }

  const handleDeleteTag = async (id: number) => {
    if (!confirm('确定删除这个标签吗？')) return
    try {
      await diary.tags.delete(id)
      loadTags()
      showToast('标签已删除', 'success')
    } catch (error) {
      console.error('Failed to delete tag:', error)
    }
  }

  const presetColors = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#06b6d4']

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'var(--space-xl)', width: '100%' }}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] items-start" style={{ gap: 'var(--space-xl)' }}>
        {/* Create new tag */}
        <div className="card" style={{ padding: 'var(--space-lg)' }}>
          <h3 className="font-semibold text-base mb-5" style={{ color: 'var(--text-primary)' }}>新建标签</h3>
          <div className="flex flex-col" style={{ gap: 'var(--space-lg)' }}>
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>标签名称</label>
              <input
                type="text" className="input w-full"
                placeholder="例如：政治、英语、错题..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-3" style={{ color: 'var(--text-secondary)' }}>专属识别色</label>
              <div className="flex flex-wrap gap-2">
                {presetColors.map(c => (
                  <button
                    key={c}
                    className="color-picker-btn"
                    onClick={() => setNewTagColor(c)}
                    style={{
                      background: c,
                      outline: newTagColor === c ? '2px solid var(--accent)' : 'none',
                      outlineOffset: 2,
                      width: 24, height: 24, borderRadius: '50%',
                      border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                      transform: newTagColor === c ? 'scale(1.1)' : 'scale(1)'
                    }}
                  />
                ))}
              </div>
            </div>
            <button
              className="button button-primary w-full mt-2"
              onClick={handleCreateTag}
              disabled={loading || !newTagName.trim()}
              style={{ justifyContent: 'center', padding: '10px 0' }}
            >
              + 创建标签
            </button>
          </div>
        </div>

        {/* Tags list */}
        <div className="card" style={{ padding: 'var(--space-lg)', minHeight: 400 }}>
          <h3 className="font-semibold text-base mb-5" style={{ color: 'var(--text-primary)' }}>
            现有标签 ({tags.length})
          </h3>
        {loading ? (
          <div className="tag-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={60} />
            ))}
          </div>
        ) : tags.length === 0 ? (
          <div className="text-muted" style={{ textAlign: 'center', padding: 32 }}>
            还没有标签，创建一个吧
          </div>
        ) : (
          <div className="tag-grid">
            {tags.map(tag => (
              <div
                key={tag.id}
                className="tag-item"
                style={{ borderLeft: `3px solid ${tag.color}` }}
              >
                <div className="flex items-center" style={{ gap: 'var(--space-sm)' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                  <span className="font-medium">{tag.name}</span>
                </div>
                <div className="flex items-center" style={{ gap: 'var(--space-xs)' }}>
                  <button
                    className="tag-action-btn"
                    onClick={() => {
                      const newColor = presetColors[Math.floor(Math.random() * presetColors.length)]!
                      handleUpdateTag(tag.id, { ...tag, color: newColor })
                    }}
                    title="随机换色"
                  >🎨</button>
                  <button
                    className="tag-action-btn delete"
                    style={{ fontSize: 16 }}
                    onClick={() => handleDeleteTag(tag.id)}
                    title="删除"
                  >×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      <div className="text-sm text-center" style={{ marginTop: 'var(--space-xl)', color: 'var(--text-muted)' }}>
        标签可用于分类日记内容，例如按科目（政治、英语）、按类型（错题、灵感）等。
      </div>
    </div>
  )
}

export default TagManager