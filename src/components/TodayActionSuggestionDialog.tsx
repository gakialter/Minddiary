import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, Trash2, X } from 'lucide-react'
import type { DiaryEntry, Mistake, StudyTask, StudyTaskType, Subject } from '../types'
import type { AIContextAPI, EntriesContextAPI, MistakesContextAPI, SubjectsContextAPI, TasksContextAPI } from '../types/api'
import {
  buildTodayActionPlanningContextSignature,
  buildTodayActionSuggestionMessages,
  buildTodayActionSuggestionLocalEvidence,
  buildTodayActionPlanningContextPreview,
  clampTodayActionAvailableMinutes,
  parseTodayActionSuggestions,
  validateTodayActionDrafts,
  type TodayActionPlanningContext,
  type TodayActionPriority,
  type TodayActionSuggestionDraft,
} from '../utils/todayActionSuggestions'
import {
  createConfirmedStudyTaskAction,
  executeConfirmedStudyTaskAction,
  type StudyTaskActionConfirmationSnapshot,
} from '../utils/agentStudyTaskActions'

const TASK_TYPES: StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']
const PRIORITIES: TodayActionPriority[] = ['high', 'medium', 'low']
const PRIORITY_LABELS: Record<TodayActionPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

interface CreationSummary {
  created: number
  failed: number
  refreshError?: string
}

interface TodayActionSuggestionDialogProps {
  date: string
  aiAPI: Pick<AIContextAPI, 'chat'>
  tasksAPI: Pick<TasksContextAPI, 'getByDate' | 'createForCurrentDate'>
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
  const [generatedContextSignature, setGeneratedContextSignature] = useState<string | null>(null)
  const [staleContextNotice, setStaleContextNotice] = useState<string | null>(null)
  const [creationSummary, setCreationSummary] = useState<CreationSummary | null>(null)
  const generationRef = useRef(0)
  const contextRequestRef = useRef(0)
  const currentDateRef = useRef(date)
  const mountedRef = useRef(true)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !generating && !creating) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [creating, generating, onClose])

  useEffect(() => {
    currentDateRef.current = date
    generationRef.current += 1
    contextRequestRef.current += 1
    setPlanningContext(null)
    setSuggestions([])
    setErrors([])
    setCreating(false)
    setGeneratedContextSignature(null)
    setStaleContextNotice(null)
    setCreationSummary(null)
  }, [date])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      contextRequestRef.current += 1
    }
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
      setSuggestions(current => current.length > 0 ? validateTodayActionDrafts(current, context) : current)
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
    setGeneratedContextSignature(null)
    setStaleContextNotice(null)
    setCreationSummary(null)
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
      setGeneratedContextSignature(buildTodayActionPlanningContextSignature(context))
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
    const createDate = date
    setCreating(true)
    setErrors([])
    setCreationSummary(null)
    try {
      const latestContext = await loadPlanningContext({
        date: createDate,
        availableMinutes,
        tasksAPI,
        mistakesAPI,
        subjectsAPI,
        entriesAPI,
      })
      if (!mountedRef.current || currentDateRef.current !== createDate) return
      const latestSignature = buildTodayActionPlanningContextSignature(latestContext)
      setPlanningContext(latestContext)
      let currentSuggestions = validateTodayActionDrafts(suggestions, latestContext)
      setSuggestions(currentSuggestions)
      if (generatedContextSignature === null || generatedContextSignature !== latestSignature) {
        setGeneratedContextSignature(latestSignature)
        setStaleContextNotice('规划依据已更新，候选已按最新本地数据重新校验。请查看结果后再次确认创建。')
        return
      }

      setStaleContextNotice(null)
      let currentContext = latestContext
      let createdCount = 0
      let failedCount = 0
      const candidateIds = currentSuggestions.map(suggestion => suggestion.clientId)

      for (const clientId of candidateIds) {
        if (!mountedRef.current || currentDateRef.current !== createDate) return
        currentSuggestions = validateTodayActionDrafts(currentSuggestions, currentContext)
        setSuggestions(currentSuggestions)
        const suggestion = currentSuggestions.find(item => item.clientId === clientId)
        if (!suggestion) continue
        if (!suggestion.selected || suggestion.creationState === 'created' || suggestion.validationErrors.length > 0) continue
        currentSuggestions = currentSuggestions.map(item => (
          item.clientId === suggestion.clientId ? { ...item, creationState: 'creating', creationError: undefined } : item
        ))
        setSuggestions(currentSuggestions)
        try {
          const confirmationSnapshot: StudyTaskActionConfirmationSnapshot = {
            mode: 'today_action',
            contextFingerprint: buildTodayActionPlanningContextSignature(currentContext),
            expectedCurrentDate: currentContext.date,
            plannedDate: currentContext.date,
          }
          const action = createConfirmedStudyTaskAction({
            actionId: suggestion.clientId,
            confirmationSnapshot,
            draft: {
              title: suggestion.title,
              description: suggestion.reason,
              type: suggestion.type,
              subject_id: suggestion.subject_id,
              related_mistake_id: suggestion.related_mistake_id,
              related_entry_id: suggestion.related_entry_id,
              related_chapter_id: null,
              estimate_minutes: suggestion.estimate_minutes,
            },
          })
          const result = await executeConfirmedStudyTaskAction(action, confirmationSnapshot, tasksAPI)
          if (!mountedRef.current || currentDateRef.current !== createDate) return
          if (result.status === 'failed') {
            failedCount += 1
            currentSuggestions = currentSuggestions.map(item => (
              item.clientId === suggestion.clientId
                ? { ...item, creationState: 'failed', creationError: result.error }
                : item
            ))
            setSuggestions(currentSuggestions)
            continue
          }
          const task = result.task
          createdCount += 1
          currentContext = {
            ...currentContext,
            todayTasks: [...currentContext.todayTasks, task],
          }
          currentSuggestions = currentSuggestions.map(item => (
            item.clientId === suggestion.clientId
              ? { ...item, creationState: 'created', createdTaskId: task.id, selected: false }
              : item
          ))
          setSuggestions(currentSuggestions)
        } catch (error) {
          failedCount += 1
          const creationError = error instanceof Error ? error.message : String(error)
          currentSuggestions = currentSuggestions.map(item => (
            item.clientId === suggestion.clientId
              ? { ...item, creationState: 'failed', creationError }
              : item
          ))
          setSuggestions(currentSuggestions)
        }
      }
      if (!mountedRef.current || currentDateRef.current !== createDate) return
      setPlanningContext(currentContext)
      setGeneratedContextSignature(buildTodayActionPlanningContextSignature(currentContext))
      setSuggestions(currentSuggestions)
      if (createdCount > 0 || failedCount > 0) {
        setCreationSummary({ created: createdCount, failed: failedCount })
      }
      if (createdCount > 0) {
        try {
          await onCreated()
          if (!mountedRef.current || currentDateRef.current !== createDate) return
        } catch (error) {
          if (!mountedRef.current || currentDateRef.current !== createDate) return
          setCreationSummary({
            created: createdCount,
            failed: failedCount,
            refreshError: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } catch (error) {
      if (mountedRef.current && currentDateRef.current === createDate) {
        setErrors([`创建前无法刷新规划依据：${error instanceof Error ? error.message : String(error)}`])
      }
    } finally {
      if (mountedRef.current && currentDateRef.current === createDate) setCreating(false)
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
                  setAvailableMinutes(clampTodayActionAvailableMinutes(event.target.value))
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
              {generating
                ? <><Loader2 size={14} className="animate-spin" /> 生成中...</>
                : <><Sparkles size={14} /> {errors.length > 0 ? '重新生成建议' : '生成建议'}</>}
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
            <div className="mt-3 text-sm" role="alert" data-testid="ai-plan-errors" style={{ color: 'var(--danger)' }}>
              {errors.map(error => <div key={error}>{error}</div>)}
              <div>请检查规划依据后重新生成建议；在出现这些错误时不会创建任务。</div>
            </div>
          )}

          {staleContextNotice && (
            <p className="mt-3 text-sm" role="status" data-testid="ai-plan-stale-context" style={{ color: 'var(--warning, var(--text-secondary))' }}>
              {staleContextNotice}
            </p>
          )}

          {creationSummary && (
            <p className="mt-3 text-sm" role="status" data-testid="ai-plan-creation-summary" style={{ color: creationSummary.failed > 0 ? 'var(--warning, var(--text-secondary))' : 'var(--success)' }}>
              本次已创建 {creationSummary.created} 项，失败 {creationSummary.failed} 项。
              {creationSummary.failed > 0 ? ' 已保留成功任务；可修改失败候选后重试。' : ''}
              {creationSummary.refreshError ? ` 刷新今日任务失败：${creationSummary.refreshError}` : ''}
            </p>
          )}

          {suggestions.length === 0 && !generating && (
            <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              生成后会在这里显示可编辑的候选任务。
            </p>
          )}

          {suggestions.length > 0 && (
            <div className="mt-4 flex flex-col gap-sm">
              {suggestions.map(suggestion => {
                const isCreated = suggestion.creationState === 'created'
                const isKnownSubject = suggestion.subject_id === null || Boolean(
                  planningContext?.subjects.some(subject => subject.id === suggestion.subject_id),
                )
                const isKnownMistake = suggestion.related_mistake_id === null || Boolean(
                  planningContext?.dueMistakes.some(mistake => mistake.id === suggestion.related_mistake_id),
                )
                const isKnownEntry = suggestion.related_entry_id === null || planningContext?.todayEntry?.id === suggestion.related_entry_id
                const evidence = planningContext
                  ? buildTodayActionSuggestionLocalEvidence(suggestion, planningContext)
                  : []
                const matchingMistake = planningContext?.dueMistakes.find(mistake => mistake.id === suggestion.related_mistake_id)

                return (
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
                        disabled={creating || isCreated}
                        onChange={event => updateSuggestion(suggestion.clientId, { selected: event.target.checked })}
                      />
                      <input
                        className="input"
                        aria-label="建议标题"
                        value={suggestion.title}
                        disabled={creating || isCreated}
                        onChange={event => updateSuggestion(suggestion.clientId, { title: event.target.value })}
                        style={{ flex: '1 1 220px', minHeight: 36 }}
                      />
                      <select
                        className="input"
                        aria-label="建议类型"
                        value={suggestion.type}
                        disabled={creating || isCreated}
                        onChange={event => updateSuggestion(suggestion.clientId, { type: event.target.value as StudyTaskType })}
                        style={{ width: 112, minHeight: 36 }}
                      >
                        {!TASK_TYPES.includes(suggestion.type) && <option value={suggestion.type} disabled>请选择有效类型</option>}
                        {TASK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                      </select>
                      <input
                        className="input"
                        aria-label="预计分钟"
                        type="number"
                        min={5}
                        max={180}
                        value={suggestion.estimate_minutes}
                        disabled={creating || isCreated}
                        onChange={event => updateSuggestion(suggestion.clientId, { estimate_minutes: Math.round(Number(event.target.value) || 0) })}
                        style={{ width: 86, minHeight: 36 }}
                      />
                      <select
                        className="input"
                        aria-label="建议科目"
                        value={suggestion.subject_id ?? ''}
                        disabled={creating || isCreated}
                        onChange={event => updateSuggestion(suggestion.clientId, { subject_id: event.target.value ? Number(event.target.value) : null })}
                        style={{ width: 120, minHeight: 36 }}
                      >
                        {!isKnownSubject && <option value={suggestion.subject_id ?? ''} disabled>请选择有效科目</option>}
                        <option value="">无科目</option>
                        {planningContext?.subjects.map(subject => (
                          <option key={subject.id} value={subject.id}>{subject.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label="删除建议"
                        className="button button-secondary"
                        disabled={creating || isCreated}
                        onClick={() => removeSuggestion(suggestion.clientId)}
                        style={{ padding: 8 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-sm">
                      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        关联到期错题
                        <select
                          className="input"
                          aria-label="关联到期错题"
                          value={suggestion.related_mistake_id ?? ''}
                          disabled={creating || isCreated}
                          onChange={event => {
                            const relatedMistakeId = event.target.value ? Number(event.target.value) : null
                            const selectedMistake = planningContext?.dueMistakes.find(mistake => mistake.id === relatedMistakeId)
                            updateSuggestion(suggestion.clientId, {
                              related_mistake_id: relatedMistakeId,
                              ...(selectedMistake?.subject_id !== null && selectedMistake?.subject_id !== undefined
                                ? { subject_id: selectedMistake.subject_id }
                                : {}),
                            })
                          }}
                          style={{ marginLeft: 6, minHeight: 32 }}
                        >
                          {!isKnownMistake && <option value={suggestion.related_mistake_id ?? ''} disabled>请选择有效错题</option>}
                          <option value="">{suggestion.type === 'review' ? '选择到期错题' : '不关联错题'}</option>
                          {suggestion.type === 'review' && planningContext?.dueMistakes.map(mistake => (
                            <option key={mistake.id} value={mistake.id}>#{mistake.id} {mistake.question || '（无题目）'}</option>
                          ))}
                          {suggestion.type !== 'review' && matchingMistake && (
                            <option value={matchingMistake.id} disabled>#{matchingMistake.id} 已关联，请移除</option>
                          )}
                        </select>
                      </label>
                      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        关联今日日记
                        <select
                          className="input"
                          aria-label="关联今日日记"
                          value={suggestion.related_entry_id ?? ''}
                          disabled={creating || isCreated}
                          onChange={event => updateSuggestion(suggestion.clientId, {
                            related_entry_id: event.target.value ? Number(event.target.value) : null,
                          })}
                          style={{ marginLeft: 6, minHeight: 32 }}
                        >
                          {!isKnownEntry && <option value={suggestion.related_entry_id ?? ''} disabled>请选择有效日记</option>}
                          <option value="">{planningContext?.todayEntry ? '不关联日记' : '今天没有可关联日记'}</option>
                          {planningContext?.todayEntry && (
                            <option value={planningContext.todayEntry.id}>{planningContext.todayEntry.title || planningContext.todayEntry.date}</option>
                          )}
                        </select>
                      </label>
                      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        AI 建议优先级（不写入任务）
                        <select
                          className="input"
                          aria-label="建议优先级"
                          value={suggestion.priority}
                          disabled={creating || isCreated}
                          onChange={event => updateSuggestion(suggestion.clientId, { priority: event.target.value as TodayActionPriority })}
                          style={{ marginLeft: 6, minHeight: 32 }}
                        >
                          {!PRIORITIES.includes(suggestion.priority) && <option value={suggestion.priority} disabled>请选择有效优先级</option>}
                          {PRIORITIES.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
                        </select>
                      </label>
                    </div>
                    <textarea
                      className="input"
                      aria-label="建议理由"
                      value={suggestion.reason}
                      disabled={creating || isCreated}
                      onChange={event => updateSuggestion(suggestion.clientId, { reason: event.target.value })}
                      style={{ width: '100%', minHeight: 58, marginTop: 8 }}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-sm text-xs" style={{ color: 'var(--text-muted)' }}>
                      {evidence.map(item => <span key={item}>本地依据：{item}</span>)}
                      {suggestion.creationState === 'created' && <span style={{ color: 'var(--success)' }}>已创建 #{suggestion.createdTaskId}</span>}
                      {suggestion.creationState === 'failed' && <span style={{ color: 'var(--danger)' }}>{suggestion.creationError}</span>}
                    </div>
                    {suggestion.validationErrors.length > 0 && (
                      <ul className="mt-2 text-xs" role="alert" style={{ color: 'var(--danger)', paddingLeft: 18 }}>
                        {suggestion.validationErrors.map(error => <li key={error}>{error}</li>)}
                      </ul>
                    )}
                  </div>
                )
              })}
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
              disabled={generating || creating || contextLoading || !visiblePlanningContext || selectedValidCount === 0 || hasFatalParseErrors}
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
