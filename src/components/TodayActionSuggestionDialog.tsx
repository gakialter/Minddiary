import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, Trash2, X } from 'lucide-react'
import type { DiaryEntry, Mistake, StudyTask, StudyTaskType, Subject } from '../types'
import type { AIContextAPI, EntriesContextAPI, MistakesContextAPI, SubjectsContextAPI, TasksContextAPI } from '../types/api'
import {
  buildTodayActionSuggestionMessages,
  buildTodayActionPlanningContextPreview,
  parseTodayActionSuggestions,
  validateTodayActionDrafts,
  type TodayActionPlanningContext,
  type TodayActionSuggestionDraft,
} from '../utils/todayActionSuggestions'

const TASK_TYPES: StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']

interface TodayActionSuggestionDialogProps {
  date: string
  aiAPI: Pick<AIContextAPI, 'chat'>
  tasksAPI: Pick<TasksContextAPI, 'getByDate' | 'create'>
  mistakesAPI: Pick<MistakesContextAPI, 'getAll'>
  subjectsAPI: Pick<SubjectsContextAPI, 'getAll'>
  entriesAPI: Pick<EntriesContextAPI, 'getByDate'>
  onClose: () => void
  onCreated: () => void | Promise<void>
}

async function loadPlanningContext({
  date,
  availableMinutes,
  tasksAPI,
  mistakesAPI,
  subjectsAPI,
  entriesAPI,
}: {
  date: string
  availableMinutes: number
  tasksAPI: Pick<TasksContextAPI, 'getByDate'>
  mistakesAPI: Pick<MistakesContextAPI, 'getAll'>
  subjectsAPI: Pick<SubjectsContextAPI, 'getAll'>
  entriesAPI: Pick<EntriesContextAPI, 'getByDate'>
}): Promise<TodayActionPlanningContext> {
  const [todayTasks, mistakesResponse, subjects, todayEntry] = await Promise.all([
    tasksAPI.getByDate(date),
    mistakesAPI.getAll({ due: true, dueDate: date, limit: 12 }),
    subjectsAPI.getAll(),
    entriesAPI.getByDate(date),
  ])
  return {
    date,
    availableMinutes,
    todayTasks,
    dueMistakes: mistakesResponse.data || [],
    dueMistakeTotal: mistakesResponse.total,
    subjects,
    todayEntry,
  }
}

export default function TodayActionSuggestionDialog({
  date,
  aiAPI,
  tasksAPI,
  mistakesAPI,
  subjectsAPI,
  entriesAPI,
  onClose,
  onCreated,
}: TodayActionSuggestionDialogProps) {
  const [availableMinutes, setAvailableMinutes] = useState(90)
  const [planningContext, setPlanningContext] = useState<TodayActionPlanningContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<TodayActionSuggestionDraft[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const generationRef = useRef(0)
  const contextRequestRef = useRef(0)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !generating && !creating) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [creating, generating, onClose])

  useEffect(() => () => {
    generationRef.current += 1
    contextRequestRef.current += 1
  }, [])

  const refreshPlanningContext = useCallback(async (): Promise<TodayActionPlanningContext | null> => {
    const request = ++contextRequestRef.current
    setContextLoading(true)
    setContextError(null)
    try {
      const context = await loadPlanningContext({
        date,
        availableMinutes,
        tasksAPI,
        mistakesAPI,
        subjectsAPI,
        entriesAPI,
      })
      if (contextRequestRef.current !== request) return null
      setPlanningContext(context)
      return context
    } catch (error) {
      if (contextRequestRef.current === request) {
        setPlanningContext(null)
        setContextError(error instanceof Error ? error.message : String(error))
      }
      return null
    } finally {
      if (contextRequestRef.current === request) setContextLoading(false)
    }
  }, [availableMinutes, date, entriesAPI, mistakesAPI, subjectsAPI, tasksAPI])

  useEffect(() => {
    void refreshPlanningContext()
  }, [refreshPlanningContext])

  const revalidate = (nextSuggestions: TodayActionSuggestionDraft[], context = planningContext) => (
    context ? validateTodayActionDrafts(nextSuggestions, context) : nextSuggestions
  )

  const updateSuggestion = (clientId: string, patch: Partial<TodayActionSuggestionDraft>) => {
    setSuggestions(current => revalidate(current.map(suggestion => {
      if (suggestion.clientId !== clientId) return suggestion
      const next = { ...suggestion, ...patch }
      if (patch.type && patch.type !== 'review') next.related_mistake_id = null
      return next
    })))
  }

  const removeSuggestion = (clientId: string) => {
    setSuggestions(current => revalidate(current.filter(suggestion => suggestion.clientId !== clientId)))
  }

  const generateSuggestions = async () => {
    if (generating || creating) return
    const generation = ++generationRef.current
    setGenerating(true)
    setErrors([])
    setSuggestions([])
    try {
      const context = await refreshPlanningContext()
      if (!context) return
      if (generationRef.current !== generation) return
      setPlanningContext(context)

      const result = await aiAPI.chat(buildTodayActionSuggestionMessages(context))
      if (generationRef.current !== generation) return
      if (result.unsupported || result.error) {
        setErrors([result.error || 'AI provider is not supported in this environment'])
        return
      }

      const parsed = parseTodayActionSuggestions(result.content, context)
      setErrors(parsed.errors)
      setSuggestions(parsed.suggestions)
    } catch (error) {
      if (generationRef.current === generation) {
        setErrors([error instanceof Error ? error.message : String(error)])
      }
    } finally {
      if (generationRef.current === generation) setGenerating(false)
    }
  }

  const createSelectedSuggestions = async () => {
    if (creating || !planningContext) return
    setCreating(true)
    setErrors([])
    let createdAny = false
    try {
      const latestContext = await loadPlanningContext({
        date,
        availableMinutes,
        tasksAPI,
        mistakesAPI,
        subjectsAPI,
        entriesAPI,
      })
      setPlanningContext(latestContext)
      let currentSuggestions = validateTodayActionDrafts(suggestions, latestContext)
      setSuggestions(currentSuggestions)

      for (const suggestion of currentSuggestions) {
        if (!suggestion.selected || suggestion.creationState === 'created' || suggestion.validationErrors.length > 0) continue
        currentSuggestions = currentSuggestions.map(item => (
          item.clientId === suggestion.clientId ? { ...item, creationState: 'creating', creationError: undefined } : item
        ))
        setSuggestions(currentSuggestions)
        try {
          const task = await tasksAPI.create({
            title: suggestion.title,
            description: suggestion.reason,
            type: suggestion.type,
            subject_id: suggestion.subject_id,
            related_mistake_id: suggestion.related_mistake_id,
            related_entry_id: suggestion.related_entry_id,
            planned_date: date,
            estimate_minutes: suggestion.estimate_minutes,
            status: 'todo',
            source: 'ai',
          })
          createdAny = true
          currentSuggestions = currentSuggestions.map(item => (
            item.clientId === suggestion.clientId
              ? { ...item, creationState: 'created', createdTaskId: task.id, selected: false }
              : item
          ))
          setSuggestions(currentSuggestions)
        } catch (error) {
          const creationError = error instanceof Error ? error.message : String(error)
          currentSuggestions = currentSuggestions.map(item => (
            item.clientId === suggestion.clientId
              ? { ...item, creationState: 'failed', creationError }
              : item
          ))
          setSuggestions(currentSuggestions)
        }
      }
      if (createdAny) await onCreated()
    } catch (error) {
      setErrors([`创建前无法刷新规划依据：${error instanceof Error ? error.message : String(error)}`])
    } finally {
      setCreating(false)
    }
  }

  const visiblePlanningContext = planningContext?.date === date && planningContext.availableMinutes === availableMinutes
    ? planningContext
    : null
  const planningPreview = visiblePlanningContext
    ? buildTodayActionPlanningContextPreview(visiblePlanningContext)
    : []
  const isPlanningContextEmpty = visiblePlanningContext
    && planningPreview.find(item => item.source === 'today_tasks')?.count === 0
    && planningPreview.find(item => item.source === 'due_mistakes')?.count === 0
    && !visiblePlanningContext.todayEntry
  const selectedValidCount = suggestions.filter(suggestion => (
    suggestion.selected &&
    suggestion.creationState !== 'created' &&
    suggestion.validationErrors.length === 0
  )).length
  const hasFatalParseErrors = errors.length > 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="today-action-suggestion-title"
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
          width: 'min(760px, 100%)',
          maxHeight: 'min(780px, calc(100vh - 48px))',
          overflow: 'hidden',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div className="flex items-start justify-between gap-sm" style={{ padding: 'var(--space-lg)', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 id="today-action-suggestion-title" style={{ margin: 0, color: 'var(--text-primary)' }}>
              AI 规划今日行动
            </h3>
            <p className="text-sm" style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
              AI 只生成候选建议；本地校验后，由你确认才会创建任务。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭 AI 今日行动建议"
            className="button button-secondary"
            disabled={generating || creating}
            onClick={onClose}
            style={{ padding: 6 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-lg)', overflowY: 'auto', maxHeight: 'min(580px, calc(100vh - 220px))' }}>
          <div className="flex flex-wrap items-center gap-sm">
            <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              今日可用时间
              <input
                data-testid="ai-plan-available-minutes"
                className="input"
                type="number"
                min={5}
                max={720}
                value={availableMinutes}
                disabled={generating || creating}
                onChange={event => {
                  setPlanningContext(null)
                  setAvailableMinutes(Math.max(5, Math.round(Number(event.target.value) || 90)))
                }}
                style={{ width: 96, marginLeft: 8, minHeight: 36 }}
              />
              分钟
            </label>
            <button
              type="button"
              className="button button-primary"
              data-testid="ai-plan-generate"
              disabled={generating || creating}
              onClick={generateSuggestions}
            >
              {generating ? <><Loader2 size={14} className="animate-spin" /> 生成中...</> : <><Sparkles size={14} /> 生成建议</>}
            </button>
          </div>

          <section className="mt-4" aria-label="AI 规划依据" data-testid="planning-context-preview">
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <div>
                <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>规划依据（仅本地读取）</h4>
                <p className="text-xs" style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                  查看不会请求 AI，也不会创建或修改任务。
                </p>
              </div>
              <button
                type="button"
                className="button button-secondary"
                data-testid="ai-plan-refresh-context"
                disabled={contextLoading || generating || creating}
                onClick={() => { void refreshPlanningContext() }}
              >
                {contextLoading ? '加载中...' : '刷新规划依据'}
              </button>
            </div>

            {contextLoading && (
              <p className="mt-2 text-sm" data-testid="planning-context-loading" style={{ color: 'var(--text-muted)' }}>
                正在加载本地规划依据…
              </p>
            )}
            {contextError && (
              <p className="mt-2 text-sm" role="alert" style={{ color: 'var(--danger)' }}>
                规划依据加载失败：{contextError}
              </p>
            )}
            {visiblePlanningContext && !contextLoading && (
              <>
                {isPlanningContextEmpty && (
                  <p className="mt-2 text-sm" data-testid="planning-context-empty" style={{ color: 'var(--text-muted)' }}>
                    今天没有待办任务、到期错题或日记；仍会使用可用时间和现有科目作为规划依据。
                  </p>
                )}
                <ul className="mt-2 flex flex-col gap-xs" style={{ marginBottom: 0, paddingLeft: 18 }}>
                  {planningPreview.map(item => (
                    <li key={item.source} data-testid={`planning-context-${item.source}`} className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <strong style={{ color: item.included ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {item.included ? '已使用' : '未使用'}：{item.label}{typeof item.count === 'number' ? `（${item.count}）` : ''}
                      </strong>
                      <span> — {item.reason}</span>
                      {item.warnings?.map(warning => (
                        <div key={warning} className="text-xs" style={{ color: 'var(--warning, var(--text-muted))', marginTop: 2 }}>
                          风险提示：{warning}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {errors.length > 0 && (
            <div className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>
              {errors.map(error => <div key={error}>{error}</div>)}
            </div>
          )}

          {suggestions.length === 0 && !generating && (
            <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              生成后会在这里显示可编辑的候选任务。
            </p>
          )}

          {suggestions.length > 0 && (
            <div className="mt-4 flex flex-col gap-sm">
              {suggestions.map(suggestion => (
                <div
                  key={suggestion.clientId}
                  data-testid={`ai-suggestion-${suggestion.clientId}`}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-sm)',
                    background: 'var(--bg-tertiary)',
                  }}
                >
                  <div className="flex flex-wrap items-center gap-sm">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${suggestion.title || suggestion.clientId}`}
                      checked={suggestion.selected}
                      disabled={creating || suggestion.creationState === 'created'}
                      onChange={event => updateSuggestion(suggestion.clientId, { selected: event.target.checked })}
                    />
                    <input
                      className="input"
                      aria-label="建议标题"
                      value={suggestion.title}
                      disabled={creating || suggestion.creationState === 'created'}
                      onChange={event => updateSuggestion(suggestion.clientId, { title: event.target.value })}
                      style={{ flex: '1 1 220px', minHeight: 36 }}
                    />
                    <select
                      className="input"
                      aria-label="建议类型"
                      value={suggestion.type}
                      disabled={creating || suggestion.creationState === 'created'}
                      onChange={event => updateSuggestion(suggestion.clientId, { type: event.target.value as StudyTaskType })}
                      style={{ width: 112, minHeight: 36 }}
                    >
                      {TASK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <input
                      className="input"
                      aria-label="预计分钟"
                      type="number"
                      min={5}
                      max={180}
                      value={suggestion.estimate_minutes}
                      disabled={creating || suggestion.creationState === 'created'}
                      onChange={event => updateSuggestion(suggestion.clientId, { estimate_minutes: Math.round(Number(event.target.value) || 0) })}
                      style={{ width: 86, minHeight: 36 }}
                    />
                    <select
                      className="input"
                      aria-label="建议科目"
                      value={suggestion.subject_id ?? ''}
                      disabled={creating || suggestion.creationState === 'created'}
                      onChange={event => updateSuggestion(suggestion.clientId, { subject_id: event.target.value ? Number(event.target.value) : null })}
                      style={{ width: 120, minHeight: 36 }}
                    >
                      <option value="">无科目</option>
                      {planningContext?.subjects.map(subject => (
                        <option key={subject.id} value={subject.id}>{subject.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label="删除建议"
                      className="button button-secondary"
                      disabled={creating || suggestion.creationState === 'created'}
                      onClick={() => removeSuggestion(suggestion.clientId)}
                      style={{ padding: 8 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <textarea
                    className="input"
                    aria-label="建议理由"
                    value={suggestion.reason}
                    disabled={creating || suggestion.creationState === 'created'}
                    onChange={event => updateSuggestion(suggestion.clientId, { reason: event.target.value })}
                    style={{ width: '100%', minHeight: 58, marginTop: 8 }}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-sm text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>priority: {suggestion.priority}</span>
                    {suggestion.related_mistake_id && <span>错题 #{suggestion.related_mistake_id}</span>}
                    {suggestion.related_entry_id && <span>日记 #{suggestion.related_entry_id}</span>}
                    {suggestion.creationState === 'created' && <span style={{ color: 'var(--success)' }}>已创建 #{suggestion.createdTaskId}</span>}
                    {suggestion.creationState === 'failed' && <span style={{ color: 'var(--danger)' }}>{suggestion.creationError}</span>}
                  </div>
                  {suggestion.validationErrors.length > 0 && (
                    <ul className="mt-2 text-xs" style={{ color: 'var(--danger)', paddingLeft: 18 }}>
                      {suggestion.validationErrors.map(error => <li key={error}>{error}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-sm" style={{ padding: 'var(--space-md) var(--space-lg)', borderTop: '1px solid var(--border)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            可创建 {selectedValidCount} 项
          </span>
          <div className="flex items-center gap-sm">
            <button type="button" className="button button-secondary" disabled={generating || creating} onClick={onClose}>
              关闭
            </button>
            <button
              type="button"
              className="button button-primary"
              data-testid="ai-plan-create-selected"
              disabled={generating || creating || selectedValidCount === 0 || hasFatalParseErrors}
              onClick={createSelectedSuggestions}
            >
              {creating ? '创建中...' : '创建选中任务'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
