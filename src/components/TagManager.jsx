import { useState, useEffect } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import Skeleton from './Skeleton'

function TagManager() {
  const diary = useDiary()
  const [tags, setTags] = useState([])
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

  const handleUpdateTag = async (id, updates) => {
    try {
      await diary.tags.update(id, updates)
      loadTags()
    } catch (error) {
      console.error('Failed to update tag:', error)
    }
  }

  const handleDeleteTag = async (id) => {
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
    <div className="flex flex-col gap-md">
      <h2 className="text-xl font-semibold">标签管理</h2>

      {/* Create new tag */}
      <div className="card p-md">
        <h3 className="font-medium text-base mb-4">新建标签</h3>
        <div className="flex gap-md items-end">
          <div className="flex-1">
            <label className="text-sm text-muted block mb-sm">标签名称</label>
            <input
              type="text" className="input w-full"
              placeholder="例如：政治、英语、错题..."
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
            />
          </div>
          <div>
            <label className="text-sm text-muted block mb-sm">颜色</label>
            <div className="flex items-center gap-xs">
              {presetColors.map(c => (
                <button
                  key={c}
                  className="color-picker-btn"
                  onClick={() => setNewTagColor(c)}
                  style={{
                    background: c,
                    outline: newTagColor === c ? '2px solid var(--accent)' : 'none',
                  }}
                />
              ))}
            </div>
          </div>
          <button
            className="button button-primary"
            onClick={handleCreateTag}
            disabled={loading || !newTagName.trim()}
          >
            + 创建
          </button>
        </div>
      </div>

      {/* Tags list */}
      <div className="card p-md">
        <h3 className="font-medium text-base mb-4">
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
                <div className="flex items-center gap-sm">
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                  <span className="font-medium">{tag.name}</span>
                </div>
                <div className="flex items-center gap-xs">
                  <button
                    className="tag-action-btn"
                    onClick={() => {
                      const newColor = presetColors[Math.floor(Math.random() * presetColors.length)]
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

      <div className="text-sm text-muted">
        标签可用于分类日记内容，例如按科目（政治、英语）、按类型（错题、灵感）等。
      </div>
    </div>
  )
}

export default TagManager