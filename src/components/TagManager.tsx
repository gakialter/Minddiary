import { useState, useEffect } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { logger } from '../utils/logger'
import Skeleton from './Skeleton'
import TagBadge from './TagBadge'
import { Check, Edit3, Palette, RotateCcw, Tags, X } from 'lucide-react'
import {
  DEFAULT_TAG_COLOR,
  DEFAULT_TAG_PATTERN,
  DEFAULT_TAG_VARIANT,
  TAG_PATTERNS,
  TAG_VARIANTS,
  normalizeTag,
  normalizeTagIcon,
} from '../utils/tagStyle'
import type { Tag, TagPattern, TagVariant } from '../types'

interface TagDraft {
  name: string
  color: string
  icon: string
  variant: TagVariant
  pattern: TagPattern
}

const presetColors = ['#0F766E', '#2F8F6B', '#0E7490', '#475569', '#854D0E', '#C65A3A', '#4D7C0F', '#6B7280']

const variantLabels: Record<TagVariant, string> = {
  soft: '柔和',
  solid: '实色',
  outline: '描边',
  ghost: '清淡',
}

const patternLabels: Record<TagPattern, string> = {
  none: '无纹理',
  dots: '点阵',
  stripes: '细纹',
  grid: '网格',
  leaf: '叶影',
}

const emptyDraft: TagDraft = {
  name: '',
  color: DEFAULT_TAG_COLOR,
  icon: '',
  variant: DEFAULT_TAG_VARIANT,
  pattern: DEFAULT_TAG_PATTERN,
}

function draftFromTag(tag: Tag): TagDraft {
  const normalized = normalizeTag(tag)
  return {
    name: normalized.name,
    color: normalized.color,
    icon: normalized.icon || '',
    variant: normalized.variant || DEFAULT_TAG_VARIANT,
    pattern: normalized.pattern || DEFAULT_TAG_PATTERN,
  }
}

function TagManager() {
  const diary = useDiary()
  const [tags, setTags] = useState<Tag[]>([])
  const [newTag, setNewTag] = useState<TagDraft>(emptyDraft)
  const [editingTagId, setEditingTagId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<TagDraft>(emptyDraft)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadTags()
  }, [])

  const loadTags = async () => {
    setLoading(true)
    try {
      const data = await diary.tags.getAll()
      setTags((data || []).map(normalizeTag))
    } catch (error) {
      logger.error('Failed to load tags:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTag = async () => {
    const name = newTag.name.trim()
    if (!name) return
    try {
      await diary.tags.create({
        name,
        color: newTag.color,
        icon: normalizeTagIcon(newTag.icon),
        variant: newTag.variant,
        pattern: newTag.pattern,
      })
      setNewTag(emptyDraft)
      loadTags()
      showToast(`标签「${name}」已创建`, 'success')
    } catch (error) {
      logger.error('Failed to create tag:', error)
      showToast('创建失败', 'error')
    }
  }

  const handleUpdateTag = async (id: number, updates: Partial<Tag>) => {
    try {
      await diary.tags.update(id, updates)
      loadTags()
    } catch (error) {
      logger.error('Failed to update tag:', error)
    }
  }

  const handleStartEdit = (tag: Tag) => {
    setEditingTagId(tag.id)
    setEditDraft(draftFromTag(tag))
  }

  const handleSaveEdit = async (id: number) => {
    const name = editDraft.name.trim()
    if (!name) return
    await handleUpdateTag(id, {
      name,
      color: editDraft.color,
      icon: normalizeTagIcon(editDraft.icon),
      variant: editDraft.variant,
      pattern: editDraft.pattern,
    })
    setEditingTagId(null)
    setEditDraft(emptyDraft)
  }

  const handleDeleteTag = async (id: number) => {
    if (!confirm('确定删除这个标签吗？')) return
    try {
      await diary.tags.delete(id)
      loadTags()
      showToast('标签已删除', 'success')
    } catch (error) {
      logger.error('Failed to delete tag:', error)
    }
  }

  const renderColorPicker = (value: string, onChange: (color: string) => void) => (
    <div className="flex flex-wrap gap-2">
      {presetColors.map(color => (
        <button
          key={color}
          type="button"
          className="color-picker-btn"
          aria-label={`选择颜色 ${color}`}
          onClick={() => onChange(color)}
          style={{
            background: color,
            outline: value === color ? '2px solid var(--accent)' : 'none',
            outlineOffset: 2,
            transform: value === color ? 'scale(1.1)' : 'scale(1)',
          }}
        />
      ))}
    </div>
  )

  const renderStyleControls = (draft: TagDraft, onChange: (updates: Partial<TagDraft>) => void, prefix: string) => (
    <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 'var(--space-md)' }}>
      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>图标 / emoji</label>
        <input
          data-testid={`${prefix}-icon-input`}
          type="text"
          className="input w-full"
          placeholder="🌿 / ☆ / 研"
          maxLength={12}
          value={draft.icon}
          onChange={(event) => onChange({ icon: event.target.value })}
        />
      </div>
      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>展示样式</label>
        <select
          data-testid={`${prefix}-variant-select`}
          className="input w-full"
          value={draft.variant}
          onChange={(event) => onChange({ variant: event.target.value as TagVariant })}
        >
          {TAG_VARIANTS.map(variant => (
            <option key={variant} value={variant}>{variantLabels[variant]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>纹理</label>
        <select
          data-testid={`${prefix}-pattern-select`}
          className="input w-full"
          value={draft.pattern}
          onChange={(event) => onChange({ pattern: event.target.value as TagPattern })}
        >
          {TAG_PATTERNS.map(pattern => (
            <option key={pattern} value={pattern}>{patternLabels[pattern]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>预览</label>
        <div className="flex items-center" style={{ minHeight: 40 }}>
          <TagBadge
            tag={{
              id: 0,
              name: draft.name.trim() || '标签预览',
              color: draft.color,
              icon: draft.icon,
              variant: draft.variant,
              pattern: draft.pattern,
            }}
            size="md"
          />
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'var(--space-xl)', width: '100%' }}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] items-start" style={{ gap: 'var(--space-xl)' }}>
        <div className="card" style={{ padding: 'var(--space-lg)' }}>
          <h3 className="font-semibold text-base mb-5" style={{ color: 'var(--text-primary)' }}>新建标签</h3>
          <div className="flex flex-col" style={{ gap: 'var(--space-lg)' }}>
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>标签名称</label>
              <input
                data-testid="tag-name-input"
                type="text"
                className="input w-full"
                placeholder="例如：政治、英语、错题..."
                value={newTag.name}
                onChange={(event) => setNewTag(current => ({ ...current, name: event.target.value }))}
                onKeyDown={(event) => event.key === 'Enter' && handleCreateTag()}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-3" style={{ color: 'var(--text-secondary)' }}>专属识别色</label>
              {renderColorPicker(newTag.color, color => setNewTag(current => ({ ...current, color })))}
            </div>
            {renderStyleControls(newTag, updates => setNewTag(current => ({ ...current, ...updates })), 'tag')}
            <button
              data-testid="tag-create-button"
              className="button button-primary w-full mt-2"
              onClick={handleCreateTag}
              disabled={loading || !newTag.name.trim()}
              style={{ justifyContent: 'center', padding: '10px 0' }}
            >
              + 创建标签
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--space-lg)', minHeight: 400 }}>
          <h3 className="font-semibold text-base mb-5" style={{ color: 'var(--text-primary)' }}>
            现有标签 ({tags.length})
          </h3>
          {loading ? (
            <div className="tag-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} height={60} />
              ))}
            </div>
          ) : tags.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-3xl)' }}>
              <Tags size={56} style={{ marginBottom: 'var(--space)', opacity: 0.2, color: 'var(--text-secondary)' }} />
              <h3 style={{ fontSize: 18, marginBottom: 'var(--space-sm)' }}>还没有任何标签</h3>
              <p className="text-muted" style={{ maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
                使用标签为日记内容建立有意义的分类系统，让回顾和复盘更加高效。
              </p>
            </div>
          ) : (
            <div className="tag-grid">
              {tags.map(tag => {
                const normalized = normalizeTag(tag)
                const isEditing = editingTagId === normalized.id
                return (
                  <div
                    key={normalized.id}
                    className="tag-item"
                    style={{
                      borderLeft: `3px solid ${normalized.color}`,
                      alignItems: isEditing ? 'stretch' : 'center',
                      flexDirection: 'column',
                      gap: 'var(--space-sm)',
                    }}
                  >
                    {isEditing ? (
                      <>
                        <input
                          data-testid={`tag-edit-name-${normalized.id}`}
                          className="input w-full"
                          value={editDraft.name}
                          onChange={(event) => setEditDraft(current => ({ ...current, name: event.target.value }))}
                        />
                        {renderColorPicker(editDraft.color, color => setEditDraft(current => ({ ...current, color })))}
                        {renderStyleControls(editDraft, updates => setEditDraft(current => ({ ...current, ...updates })), `tag-edit-${normalized.id}`)}
                        <div className="flex items-center justify-end" style={{ gap: 'var(--space-xs)' }}>
                          <button
                            className="tag-action-btn flex items-center justify-center"
                            onClick={() => handleSaveEdit(normalized.id)}
                            title="保存"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            className="tag-action-btn flex items-center justify-center"
                            onClick={() => {
                              setEditingTagId(null)
                              setEditDraft(emptyDraft)
                            }}
                            title="取消"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between w-full" style={{ gap: 'var(--space-sm)' }}>
                          <TagBadge tag={normalized} size="md" />
                          <div className="flex items-center" style={{ gap: 'var(--space-xs)' }}>
                            <button
                              className="tag-action-btn flex items-center justify-center"
                              onClick={() => handleStartEdit(normalized)}
                              title="编辑"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              className="tag-action-btn flex items-center justify-center"
                              onClick={() => {
                                const newColor = presetColors[Math.floor(Math.random() * presetColors.length)]!
                                handleUpdateTag(normalized.id, { color: newColor })
                              }}
                              title="随机换色"
                            >
                              <Palette size={14} />
                            </button>
                            <button
                              className="tag-action-btn delete flex items-center justify-center"
                              onClick={() => handleDeleteTag(normalized.id)}
                              title="删除"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="text-xs text-muted flex items-center" style={{ gap: 'var(--space-xs)' }}>
                          <RotateCcw size={12} />
                          <span>{variantLabels[normalized.variant || DEFAULT_TAG_VARIANT]} / {patternLabels[normalized.pattern || DEFAULT_TAG_PATTERN]}</span>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="text-sm text-center" style={{ marginTop: 'var(--space-xl)', color: 'var(--text-muted)' }}>
        标签可用于分类日记内容；现在可以组合颜色、emoji / 简短符号、展示样式和预设纹理。
      </div>
    </div>
  )
}

export default TagManager
