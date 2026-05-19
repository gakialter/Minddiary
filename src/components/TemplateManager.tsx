import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Edit3, Check, X, FileText } from 'lucide-react'
import { showToast } from './Toast'
import { useDiary } from '../contexts/DiaryContext'
import { logger } from '../utils/logger'
import type { DiaryTemplate } from '../types'

interface TemplateManagerProps {
  visible: boolean
  onClose: () => void
  onInsert: (content: string) => void
}

export default function TemplateManager({ visible, onClose, onInsert }: TemplateManagerProps) {
  const { templates: templatesAPI } = useDiary()
  const [templates, setTemplates] = useState<DiaryTemplate[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editContent, setEditContent] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')

  const loadTemplates = useCallback(async () => {
    try {
      const data = await templatesAPI.getAll()
      setTemplates(data || [])
    } catch (e) {
      logger.error('Failed to load templates:', e)
    }
  }, [])

  useEffect(() => {
    if (visible) loadTemplates()
  }, [visible, loadTemplates])

  const handleAdd = async () => {
    if (!newName.trim()) {
      showToast('请输入模板名称', 'error')
      return
    }
    try {
      await templatesAPI.create({ name: newName.trim(), content: newContent })
      showToast('模板已创建', 'success')
      setIsAdding(false)
      setNewName('')
      setNewContent('')
      loadTemplates()
    } catch (e) {
      logger.error(e)
      showToast('创建失败', 'error')
    }
  }

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return
    try {
      await templatesAPI.update(id, { name: editName.trim(), content: editContent })
      showToast('模板已更新', 'success')
      setEditingId(null)
      loadTemplates()
    } catch (e) {
      logger.error(e)
      showToast('更新失败', 'error')
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除这个模板吗？')) return
    try {
      const result = await templatesAPI.delete(id)
      if (result.success) {
        showToast('模板已删除', 'success')
        loadTemplates()
      } else {
        showToast(result.message || '删除失败', 'error')
      }
    } catch (e) {
      logger.error(e)
      showToast('删除失败', 'error')
    }
  }

  const startEditing = (tpl: DiaryTemplate) => {
    setEditingId(tpl.id)
    setEditName(tpl.name)
    setEditContent(tpl.content)
  }

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
        background: 'var(--bg-overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'page-fade-in 0.2s ease forwards',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="card"
        style={{
          width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          padding: 0, overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: 'var(--space-md) var(--space-lg)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-sm">
            <FileText size={18} style={{ color: 'var(--accent)' }} />
            <h3 className="font-semibold" style={{ fontSize: 16 }}>管理日记模板</h3>
          </div>
          <div className="flex items-center gap-sm">
            <button
              className="button button-primary text-sm"
              onClick={() => { setIsAdding(true); setNewName(''); setNewContent('') }}
              disabled={isAdding}
            >
              <Plus size={14} /> 新建模板
            </button>
            <button
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', display: 'flex', padding: 4,
              }}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ overflow: 'auto', padding: 'var(--space-md) var(--space-lg)', flex: 1 }}>
          {/* Add new template form */}
          {isAdding && (
            <div
              className="card"
              style={{
                padding: 'var(--space-md)', marginBottom: 'var(--space-md)',
                border: '1px solid var(--accent)',
                background: 'color-mix(in srgb, var(--accent) 5%, var(--bg-secondary))',
              }}
            >
              <input
                type="text"
                className="input w-full"
                placeholder="模板名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                style={{ marginBottom: 'var(--space-sm)' }}
              />
              <textarea
                className="input w-full resize-none"
                placeholder="模板内容（支持 Markdown）"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={5}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7 }}
              />
              <div className="flex gap-sm" style={{ marginTop: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                <button className="button button-secondary text-sm" onClick={() => setIsAdding(false)}>
                  取消
                </button>
                <button className="button button-primary text-sm" onClick={handleAdd}>
                  <Check size={14} /> 保存
                </button>
              </div>
            </div>
          )}

          {/* Template list */}
          <div className="flex flex-col gap-sm">
            {templates.map(tpl => (
              <div
                key={tpl.id}
                className="card"
                style={{
                  padding: 'var(--space-md)',
                  cursor: editingId === tpl.id ? 'default' : 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => {
                  if (editingId !== tpl.id) {
                    onInsert(tpl.content)
                    onClose()
                  }
                }}
              >
                {editingId === tpl.id ? (
                  /* Editing mode */
                  <div>
                    <input
                      type="text"
                      className="input w-full"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      style={{ marginBottom: 'var(--space-sm)' }}
                    />
                    <textarea
                      className="input w-full resize-none"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={5}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7 }}
                    />
                    <div className="flex gap-sm" style={{ marginTop: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                      <button className="button button-secondary text-sm" onClick={() => setEditingId(null)}>
                        取消
                      </button>
                      <button className="button button-primary text-sm" onClick={() => handleUpdate(tpl.id)}>
                        <Check size={14} /> 更新
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Display mode */
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-sm" style={{ flex: 1 }}>
                      <FileText size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <div>
                        <div className="font-medium" style={{ fontSize: 14 }}>
                          {tpl.name}
                          {tpl.is_default ? (
                            <span className="text-xs text-muted" style={{ marginLeft: 8, opacity: 0.7 }}>默认</span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted" style={{ marginTop: 2, opacity: 0.7, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tpl.content.replace(/\n/g, ' ').substring(0, 60)}...
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-xs" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="tag-action-btn"
                        onClick={() => startEditing(tpl)}
                        title="编辑模板"
                      >
                        <Edit3 size={14} />
                      </button>
                      {!tpl.is_default && (
                        <button
                          className="tag-action-btn delete"
                          onClick={() => handleDelete(tpl.id)}
                          title="删除模板"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {templates.length === 0 && !isAdding && (
            <div className="text-sm text-muted text-center" style={{ padding: 'var(--space-xl)' }}>
              暂无模板，点击右上角"新建模板"创建你的第一个模板。
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div
          className="text-xs text-muted"
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
          }}
        >
          点击模板名称即可插入到编辑器 · 默认模板不可删除但可编辑内容
        </div>
      </div>
    </div>
  )
}
