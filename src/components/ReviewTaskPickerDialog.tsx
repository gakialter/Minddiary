import { useEffect, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { Mistake, StudyTask } from '../types'
import type { MistakesContextAPI, TasksContextAPI } from '../types/api'

const ACTIVE_STATUSES = ['todo', 'doing'] as const

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function buildReviewTaskTitle(mistake: Mistake): string {
  const subjectPrefix = mistake.subject_name ? `${mistake.subject_name} · ` : ''
  return truncateText(`${subjectPrefix}复习错题 ${mistake.id}`, 80)
}

function buildReviewTaskDescription(mistake: Mistake): string {
  return truncateText(mistake.question || '复习这道错题，并按掌握情况评分。', 180)
}

interface ReviewTaskPickerDialogProps {
  date: string
  riskPoolCount: number
  mistakesAPI: Pick<MistakesContextAPI, 'getAll'>
  tasksAPI: Pick<TasksContextAPI, 'find' | 'create'>
  onClose: () => void
  onCreated: () => void | Promise<void>
}

export default function ReviewTaskPickerDialog({
  date,
  riskPoolCount,
  mistakesAPI,
  tasksAPI,
  onClose,
  onCreated,
}: ReviewTaskPickerDialogProps) {
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const [activeTasks, setActiveTasks] = useState<StudyTask[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [createdCount, setCreatedCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [mistakesResponse, taskRows] = await Promise.all([
          mistakesAPI.getAll({ due: true, dueDate: date, limit: 50 }),
          tasksAPI.find({ planned_date: date, type: 'review', status: [...ACTIVE_STATUSES] }),
        ])
        if (cancelled) return
        setMistakes(mistakesResponse.data || [])
        setActiveTasks(taskRows)
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [date, mistakesAPI, tasksAPI])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [creating, onClose])

  const activeMistakeIds = useMemo(() => new Set(
    activeTasks
      .map(task => task.related_mistake_id)
      .filter((id): id is number => typeof id === 'number'),
  ), [activeTasks])

  const selectableMistakes = mistakes.filter(mistake => !activeMistakeIds.has(mistake.id))
  const selectedCreatableCount = selectableMistakes.filter(mistake => selectedIds.has(mistake.id)).length

  const toggleSelection = (id: number) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(selectableMistakes.map(mistake => mistake.id)))
  }

  const createSelected = async () => {
    if (selectedCreatableCount === 0 || creating) return
    setCreating(true)
    setError(null)
    let created = 0
    try {
      for (const mistake of selectableMistakes) {
        if (!selectedIds.has(mistake.id)) continue
        const latestDuplicate = await tasksAPI.find({
          planned_date: date,
          type: 'review',
          status: [...ACTIVE_STATUSES],
          related_mistake_id: mistake.id,
        })
        if (latestDuplicate.length > 0) continue
        await tasksAPI.create({
          title: buildReviewTaskTitle(mistake),
          description: buildReviewTaskDescription(mistake),
          type: 'review',
          subject_id: mistake.subject_id,
          related_mistake_id: mistake.id,
          planned_date: date,
          estimate_minutes: 10,
          status: 'todo',
          source: 'dashboard',
        })
        created += 1
      }
      setCreatedCount(created)
      setSelectedIds(new Set())
      await onCreated()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-task-picker-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-modal)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-lg)',
        background: 'rgba(0,0,0,0.42)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: 'min(640px, 100%)',
          maxHeight: 'min(720px, calc(100vh - 48px))',
          overflow: 'hidden',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div className="flex items-start justify-between gap-sm" style={{ padding: 'var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 id="review-task-picker-title" style={{ margin: 0, color: 'var(--text-primary)' }}>
              选择今日错题复习任务
            </h3>
            <p className="text-sm" style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
              今日风险池 {riskPoolCount} 题。选择后会为每道错题创建一个独立 review task。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭错题任务选择"
            className="button button-secondary"
            disabled={creating}
            onClick={onClose}
            style={{ padding: 6 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-lg)', overflowY: 'auto', maxHeight: 'min(520px, calc(100vh - 220px))' }}>
          {loading && (
            <div className="flex items-center gap-sm text-sm" style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={16} className="animate-spin" /> 正在读取今日到期错题...
            </div>
          )}

          {!loading && error && (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
          )}

          {!loading && !error && mistakes.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>今天没有到期错题。</p>
          )}

          {!loading && !error && mistakes.length > 0 && (
            <div className="flex flex-col gap-sm">
              {mistakes.map(mistake => {
                const duplicate = activeMistakeIds.has(mistake.id)
                const selected = selectedIds.has(mistake.id)
                return (
                  <label
                    key={mistake.id}
                    className="flex items-start gap-sm"
                    style={{
                      padding: 'var(--space-sm)',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)',
                      background: duplicate ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                      opacity: duplicate ? 0.62 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={duplicate || creating}
                      onChange={() => toggleSelection(mistake.id)}
                      style={{ marginTop: 4 }}
                    />
                    <span className="min-w-0">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {mistake.subject_name ? `${mistake.subject_name} · ` : ''}{truncateText(mistake.question, 72)}
                      </span>
                      <span className="block text-xs" style={{ color: duplicate ? 'var(--warning)' : 'var(--text-muted)', marginTop: 4 }}>
                        {duplicate ? '今天已有 active review task' : `将创建 10 分钟单题复习任务 #${mistake.id}`}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {createdCount > 0 && (
            <p className="text-sm" style={{ color: 'var(--success)', marginTop: 'var(--space-sm)' }}>
              已创建 {createdCount} 个单题复习任务。
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm" style={{ padding: 'var(--space-md) var(--space-lg)', borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            className="button button-secondary"
            disabled={creating || selectableMistakes.length === 0}
            onClick={selectAll}
          >
            全选可创建项
          </button>
          <div className="flex items-center gap-sm">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              已选择 {selectedCreatableCount} 项
            </span>
            <button
              type="button"
              className="button button-primary"
              disabled={creating || selectedCreatableCount === 0}
              onClick={createSelected}
            >
              {creating ? '创建中...' : '创建任务'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
