import { useState, useEffect } from 'react'
import { useDiary } from '../contexts/DiaryContext'
import { showToast } from './Toast'
import { logger } from '../utils/logger'
import Skeleton from './Skeleton'
import TagBadge from './TagBadge'
import { Check, Edit3, Palette, RotateCcw, Tags, Trash2, X } from 'lucide-react'
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
    if (!name) {
      showToast('标签名不能为空', 'error')
      return
    }
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
    if (!name) {
      showToast('标签名不能为空', 'error')
      return
    }
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

  const renderColorPicker = (value: string, onChange: (color: string) => void, legend: string) => (
    <fieldset className="workspace-tags__color-fieldset">
      <legend>{legend}</legend>
      <div className="workspace-tags__color-options">
        {presetColors.map(color => (
          <button
            key={color}
            type="button"
            className="workspace-tags__color-option"
            data-selected={value === color ? 'true' : 'false'}
            aria-label={`${legend}：${color}`}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </fieldset>
  )

  const renderStyleControls = (draft: TagDraft, onChange: (updates: Partial<TagDraft>) => void, prefix: string) => (
    <div className="workspace-tags__style-grid">
      <div className="workspace-field">
        <label htmlFor={`${prefix}-icon`}>图标 / emoji</label>
        <input
          id={`${prefix}-icon`}
          data-testid={`${prefix}-icon-input`}
          type="text"
          className="input w-full"
          placeholder="🌿 / ☆ / 研"
          maxLength={12}
          value={draft.icon}
          onChange={(event) => onChange({ icon: event.target.value })}
        />
      </div>
      <div className="workspace-field">
        <label htmlFor={`${prefix}-variant`}>展示样式</label>
        <select
          id={`${prefix}-variant`}
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
      <div className="workspace-field">
        <label htmlFor={`${prefix}-pattern`}>纹理</label>
        <select
          id={`${prefix}-pattern`}
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
      <div className="workspace-field">
        <span className="workspace-tags__preview-label">预览</span>
        <div className="workspace-tags__preview workspace-tag-preview" data-variant={draft.variant} role="group" aria-label="标签预览">
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
    <div className="workspace-page workspace-page--wide workspace-tags" aria-busy={loading}>
      <div className="workspace-tags__layout">
        <section className="workspace-section workspace-tags__create" aria-labelledby="tag-create-title">
          <div className="workspace-section__heading">
            <div>
              <h2 id="tag-create-title">新建标签</h2>
              <p className="workspace-help">用简短名称和克制的识别色整理日记主题。</p>
            </div>
          </div>
          <div className="workspace-tags__form">
            <div className="workspace-field">
              <label htmlFor="tag-name">标签名称</label>
              <input
                id="tag-name"
                data-testid="tag-name-input"
                type="text"
                className="input w-full"
                placeholder="例如：政治、英语、错题..."
                value={newTag.name}
                onChange={(event) => setNewTag(current => ({ ...current, name: event.target.value }))}
                onKeyDown={(event) => event.key === 'Enter' && handleCreateTag()}
              />
            </div>
            {renderColorPicker(newTag.color, color => setNewTag(current => ({ ...current, color })), '专属识别色')}
            {renderStyleControls(newTag, updates => setNewTag(current => ({ ...current, ...updates })), 'tag')}
            <button
              type="button"
              data-testid="tag-create-button"
              className="button button-primary workspace-tags__create-button"
              onClick={handleCreateTag}
              disabled={loading || !newTag.name.trim()}
            >
              + 创建标签
            </button>
          </div>
        </section>

        <section className="workspace-section workspace-tags__collection" aria-labelledby="tag-collection-title">
          <div className="workspace-section__heading">
            <div>
              <h2 id="tag-collection-title">现有标签 <span className="workspace-tags__count">{tags.length}</span></h2>
              <p className="workspace-help">编辑识别方式不会改变标签的已有归属。</p>
            </div>
          </div>
          {loading ? (
            <div className="workspace-tags__loading" role="status" aria-live="polite">
              <span className="sr-only">正在加载标签</span>
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} height={60} />
              ))}
            </div>
          ) : tags.length === 0 ? (
            <div className="workspace-empty workspace-tags__empty" role="status">
              <div className="workspace-empty__icon" aria-hidden="true"><Tags size={36} /></div>
              <h3>还没有任何标签</h3>
              <p>
                使用标签为日记内容建立有意义的分类系统，让回顾和复盘更加高效。
              </p>
            </div>
          ) : (
            <ul className="workspace-tags__list">
              {tags.map(tag => {
                const normalized = normalizeTag(tag)
                const isEditing = editingTagId === normalized.id
                return (
                  <li
                    key={normalized.id}
                    className="workspace-tags__item"
                    data-editing={isEditing ? 'true' : 'false'}
                    style={{ borderLeftColor: normalized.color }}
                  >
                    {isEditing ? (
                      <>
                        <div className="workspace-field">
                          <label htmlFor={`tag-edit-${normalized.id}-name`}>标签名称</label>
                          <input
                            id={`tag-edit-${normalized.id}-name`}
                            data-testid={`tag-edit-name-${normalized.id}`}
                            className="input w-full"
                            value={editDraft.name}
                            onChange={(event) => setEditDraft(current => ({ ...current, name: event.target.value }))}
                          />
                        </div>
                        {renderColorPicker(
                          editDraft.color,
                          color => setEditDraft(current => ({ ...current, color })),
                          `标签「${normalized.name}」的识别色`,
                        )}
                        {renderStyleControls(editDraft, updates => setEditDraft(current => ({ ...current, ...updates })), `tag-edit-${normalized.id}`)}
                        <div className="workspace-action-row workspace-tags__edit-actions">
                          <button
                            type="button"
                            className="workspace-tags__icon-action"
                            onClick={() => handleSaveEdit(normalized.id)}
                            aria-label={`保存标签 ${normalized.name}`}
                            title="保存"
                          >
                            <Check size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="workspace-tags__icon-action"
                            onClick={() => {
                              setEditingTagId(null)
                              setEditDraft(emptyDraft)
                            }}
                            aria-label={`取消编辑标签 ${normalized.name}`}
                            title="取消"
                          >
                            <X size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="workspace-tags__item-header">
                          <span className="workspace-tag-preview" data-variant={normalized.variant}>
                            <TagBadge tag={normalized} size="md" />
                          </span>
                          <div className="workspace-tags__item-actions">
                            <button
                              type="button"
                              className="workspace-tags__icon-action"
                              onClick={() => handleStartEdit(normalized)}
                              aria-label={`编辑标签 ${normalized.name}`}
                              title="编辑"
                            >
                              <Edit3 size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="workspace-tags__icon-action"
                              onClick={() => {
                                const newColor = presetColors[Math.floor(Math.random() * presetColors.length)]!
                                handleUpdateTag(normalized.id, { color: newColor })
                              }}
                              aria-label={`随机更换标签 ${normalized.name} 的颜色`}
                              title="随机换色"
                            >
                              <Palette size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="workspace-tags__icon-action workspace-tags__icon-action--danger"
                              onClick={() => handleDeleteTag(normalized.id)}
                              aria-label={`删除标签 ${normalized.name}`}
                              title="删除"
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                        <div className="workspace-tags__metadata">
                          <RotateCcw size={12} aria-hidden="true" />
                          <span>{variantLabels[normalized.variant || DEFAULT_TAG_VARIANT]} / {patternLabels[normalized.pattern || DEFAULT_TAG_PATTERN]}</span>
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <p className="workspace-help workspace-tags__footer-note">
        标签可用于分类日记内容；现在可以组合颜色、emoji / 简短符号、展示样式和预设纹理。
      </p>
    </div>
  )
}

export default TagManager
