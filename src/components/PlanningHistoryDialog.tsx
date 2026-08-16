import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Trash2, X } from 'lucide-react'
import type {
  ElectronPlanningRunsAPI,
  PlanningCandidateOutcomeKind,
  PlanningCandidateSnapshot,
  PlanningContextDisposition,
  PlanningContextPreparation,
  PlanningContextReasonCode,
  PlanningRunCandidateRecord,
  PlanningRunCloseReason,
  PlanningRunRecord,
  PlanningSourceRelation,
} from '../types/planningHistory'
import { PLANNING_HISTORY_UNAVAILABLE } from '../utils/planningHistoryClient'

interface PlanningHistoryDialogProps {
  planningRunsAPI: ElectronPlanningRunsAPI | undefined
  onClose: () => void
}

const ENTRY_POINT_LABELS = {
  today_action: '今日行动',
  daily_review: '每日复盘',
} as const

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  available_minutes: '可用时间',
  today_tasks: '今日任务',
  due_mistakes: '到期错题',
  subjects: '科目',
  today_entry: '今日日记',
  chapters: '章节进度',
  focus_history: '专注历史',
  candidate_date_tasks: '目标日期任务',
  pomodoro: '今日专注',
}

const PREPARATION_LABELS: Readonly<Record<PlanningContextPreparation, string>> = {
  prepared: '本地已准备',
  prepared_empty: '本地没有相应记录',
  source_unavailable: '来源暂不可用',
  not_integrated: '当前版本尚未接入',
  preparation_failed: '本地准备失败',
}

const DISPOSITION_LABELS: Readonly<Record<PlanningContextDisposition, string>> = {
  included: '已加入本次请求',
  included_empty: '以空记录加入本次请求',
  partially_included: '部分加入本次请求',
  excluded: '未加入本次请求',
}

const REASON_LABELS: Readonly<Record<PlanningContextReasonCode, string>> = {
  included_required: '规划所需的基础信息',
  included_available: '本地来源可用并已加入',
  included_empty: '请求保留了该类别，但没有相应记录',
  limit_applied: '已应用本地请求数量上限',
  no_record: '本地没有相应记录',
  source_unavailable: '本地来源暂不可用',
  not_integrated: '当前版本尚未接入该来源',
  preparation_failed: '本地准备该来源时失败',
}

const TYPE_LABELS: Readonly<Record<PlanningCandidateSnapshot['type'], string>> = {
  review: '复习',
  focus: '专注',
  diary: '日记',
  mistake: '错题',
  custom: '自定义',
}

const PRIORITY_LABELS: Readonly<Record<PlanningCandidateSnapshot['priority'], string>> = {
  high: '高',
  medium: '中',
  low: '低',
}

const OUTCOME_LABELS: Readonly<Record<PlanningCandidateOutcomeKind, string>> = {
  created: '已创建任务',
  replayed: '已确认该任务已存在，使用既有结果',
  uncertain: '结果尚无法确认',
  conflict: '确认内容与既有操作冲突，未创建任务',
  deleted: '关联任务后来已删除',
  integrity_error: '完整性检查未通过',
  date_mismatch: '确认日期已失效，未创建任务',
  validation_error: '确认内容未通过校验，未创建任务',
}

const CLOSE_REASON_LABELS: Readonly<Record<PlanningRunCloseReason, string>> = {
  dialog_closed: '已关闭规划窗口',
  regenerated: '已开始重新生成',
  date_rollover: '已观察到日期切换',
  app_closed: '已正常关闭应用',
}

const EDIT_FIELD_ORDER = [
  'title',
  'description',
  'type',
  'estimateMinutes',
  'priority',
  'subjectId',
  'relatedMistakeId',
  'relatedEntryId',
] as const satisfies readonly (keyof PlanningCandidateSnapshot)[]

const EDIT_FIELD_LABELS: Readonly<Record<keyof PlanningCandidateSnapshot, string>> = {
  title: '标题',
  description: '说明',
  type: '类型',
  estimateMinutes: '预计时间',
  priority: '优先级',
  subjectId: '科目',
  relatedMistakeId: '关联错题',
  relatedEntryId: '关联日记',
}

function getCategoryLabel(run: PlanningRunRecord, category: string): string {
  if (category === 'available_minutes') {
    return run.entryPoint === 'today_action' ? '今日可用时间' : '次日可用时间'
  }
  return CATEGORY_LABELS[category] ?? category
}

function formatPlanningTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间不可用' : date.toLocaleString('zh-CN', { hour12: false })
}

function formatRelation(relation: PlanningSourceRelation | null): string {
  if (relation === null) return '无'
  return relation.available ? relation.label : '当前关联内容不可用'
}

function formatHistoricalRelation(relation: PlanningSourceRelation | null): string {
  if (relation === null) return '无'
  return relation.available ? relation.label : '历史关联内容不可用'
}

function formatCandidateValue(
  candidate: PlanningRunCandidateRecord,
  field: keyof PlanningCandidateSnapshot,
  value: PlanningCandidateSnapshot[keyof PlanningCandidateSnapshot],
  current: boolean,
): string {
  if (field === 'type') return TYPE_LABELS[value as PlanningCandidateSnapshot['type']]
  if (field === 'priority') return `${PRIORITY_LABELS[value as PlanningCandidateSnapshot['priority']]}优先级`
  if (field === 'estimateMinutes') return `${String(value)} 分钟`
  if (field === 'subjectId') {
    return current
      ? formatRelation(candidate.sourceRelations.subject)
      : formatHistoricalRelation(candidate.editBeforeSourceRelations.subject)
  }
  if (field === 'relatedMistakeId') {
    return current
      ? formatRelation(candidate.sourceRelations.mistake)
      : formatHistoricalRelation(candidate.editBeforeSourceRelations.mistake)
  }
  if (field === 'relatedEntryId') {
    return current
      ? formatRelation(candidate.sourceRelations.entry)
      : formatHistoricalRelation(candidate.editBeforeSourceRelations.entry)
  }
  return value === null || value === '' ? '无' : String(value)
}

function CandidateDetail({ candidate }: { candidate: PlanningRunCandidateRecord }) {
  const editFields = EDIT_FIELD_ORDER.filter(field => Object.prototype.hasOwnProperty.call(candidate.editBefore, field))
  const relations = [
    candidate.subjectId === null ? null : `科目：${formatRelation(candidate.sourceRelations.subject)}`,
    candidate.relatedMistakeId === null ? null : `关联错题：${formatRelation(candidate.sourceRelations.mistake)}`,
    candidate.relatedEntryId === null ? null : `关联日记：${formatRelation(candidate.sourceRelations.entry)}`,
  ].filter((value): value is string => value !== null)

  return (
    <article className="rounded-xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
      <h4 className="font-medium" style={{ color: 'var(--text-primary)' }}>{candidate.title}</h4>
      <p className="mt-1 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{candidate.description}</p>
      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        {TYPE_LABELS[candidate.type]} · {candidate.estimateMinutes} 分钟 · {PRIORITY_LABELS[candidate.priority]}优先级
      </p>
      {relations.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {relations.map(relation => <li key={relation}>{relation}</li>)}
        </ul>
      )}
      {editFields.length > 0 && (
        <div className="mt-3 rounded-lg p-3 text-xs" style={{ background: 'var(--bg-secondary)' }}>
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>最终净修改</p>
          <ul className="mt-1 space-y-1" style={{ color: 'var(--text-secondary)' }}>
            {editFields.map(field => (
              <li key={field}>
                {EDIT_FIELD_LABELS[field]}：{formatCandidateValue(candidate, field, candidate.editBefore[field]!, false)} → {formatCandidateValue(candidate, field, candidate[field], true)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {candidate.userDisposition === 'unselected' && (
        <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>本次未选择</p>
      )}
      {candidate.userDisposition === 'selected_unconfirmed' && (
        <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>已选择，未确认创建</p>
      )}
      {candidate.userDisposition === 'confirmed' && (
        <div className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <p>{candidate.outcomeKind ? OUTCOME_LABELS[candidate.outcomeKind] : '已确认，结果尚未记录'}</p>
          {candidate.taskRelation?.available === true && (
            <p className="mt-1">当前任务：{candidate.taskRelation.title}（{candidate.taskRelation.status}）</p>
          )}
          {candidate.taskRelation?.available === false && <p className="mt-1">当前任务不可用</p>}
          {candidate.executionAttribution && (
            <div className="mt-2 text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
              {candidate.executionAttribution.kind === 'task_deleted' && (
                <p>关联任务后来已删除，历史专注归属不可再验证</p>
              )}
              {candidate.executionAttribution.kind === 'known_conflict' && (
                <p>确认操作与既有操作记录冲突</p>
              )}
              {candidate.executionAttribution.kind === 'unresolved' && (
                <p>确认结果仍无法验证</p>
              )}
              {candidate.executionAttribution.kind === 'integrity_inconsistency' && (
                <p>数据完整性异常，当前执行归属不可验证</p>
              )}
              {candidate.executionAttribution.kind === 'verified_linked' && (
                <>
                  {candidate.executionAttribution.semanticDrift?.hasDrift && (
                    <div className="rounded p-2" style={{ background: 'var(--bg-secondary)' }}>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>任务后续调整：</p>
                      <ul className="mt-1 space-y-0.5">
                        {candidate.executionAttribution.semanticDrift.differences.title && (
                          <li>标题：{candidate.executionAttribution.semanticDrift.differences.title.candidateValue} → {candidate.executionAttribution.semanticDrift.differences.title.currentValue}</li>
                        )}
                        {candidate.executionAttribution.semanticDrift.differences.description && (
                          <li>说明：{candidate.executionAttribution.semanticDrift.differences.description.candidateValue} → {candidate.executionAttribution.semanticDrift.differences.description.currentValue}</li>
                        )}
                        {candidate.executionAttribution.semanticDrift.differences.type && (
                          <li>类型：{TYPE_LABELS[candidate.executionAttribution.semanticDrift.differences.type.candidateValue]} → {TYPE_LABELS[candidate.executionAttribution.semanticDrift.differences.type.currentValue]}</li>
                        )}
                        {candidate.executionAttribution.semanticDrift.differences.estimateMinutes && (
                          <li>预计时间：{candidate.executionAttribution.semanticDrift.differences.estimateMinutes.candidateValue} 分钟 → {candidate.executionAttribution.semanticDrift.differences.estimateMinutes.currentValue} 分钟</li>
                        )}
                        {candidate.executionAttribution.semanticDrift.differences.plannedDate && (
                          <li>计划日期：{candidate.executionAttribution.semanticDrift.differences.plannedDate.candidateValue} → {candidate.executionAttribution.semanticDrift.differences.plannedDate.currentValue}</li>
                        )}
                      </ul>
                    </div>
                  )}
                  {candidate.executionAttribution.focus.state === 'available' && (
                    candidate.executionAttribution.focus.totalDurationMinutes !== null && candidate.executionAttribution.focus.totalDurationMinutes > 0 ? (
                      <p>已累计专注 {candidate.executionAttribution.focus.totalDurationMinutes} 分钟（{candidate.executionAttribution.focus.sessionCount} 次专注）</p>
                    ) : (
                      <p>暂无显式绑定专注记录</p>
                    )
                  )}
                  {candidate.executionAttribution.focus.state === 'corrupt_data' && (
                    <p>专注记录数据异常</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export default function PlanningHistoryDialog({ planningRunsAPI, onClose }: PlanningHistoryDialogProps) {
  const [runs, setRuns] = useState<PlanningRunRecord[]>([])
  const [selectedRun, setSelectedRun] = useState<PlanningRunRecord | null>(null)
  const [loading, setLoading] = useState(planningRunsAPI !== undefined)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)
  const detailRequestRef = useRef(0)

  useEffect(() => () => {
    detailRequestRef.current += 1
  }, [])

  useEffect(() => {
    let current = true
    if (!planningRunsAPI) return () => { current = false }
    setLoading(true)
    planningRunsAPI.listRecent({ limit: 20 })
      .then(result => {
        if (current) setRuns(result.items)
      })
      .catch(() => {
        if (current) setError('规划历史暂时无法读取。')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => { current = false }
  }, [planningRunsAPI])

  const openRun = async (run: PlanningRunRecord) => {
    if (!planningRunsAPI) return
    const request = ++detailRequestRef.current
    setError(null)
    setSelectedRun(null)
    try {
      const detail = await planningRunsAPI.get(run.id)
      if (detailRequestRef.current !== request) return
      if (detail === null) {
        setRuns(current => current.filter(item => item.id !== run.id))
        setError('这次规划已不存在。')
        return
      }
      setSelectedRun(detail)
    } catch {
      if (detailRequestRef.current !== request) return
      setError('这次规划详情暂时无法读取。')
    }
  }

  const deleteRun = async (run: PlanningRunRecord) => {
    if (!planningRunsAPI || mutating) return
    detailRequestRef.current += 1
    setMutating(true)
    setError(null)
    try {
      await planningRunsAPI.delete({ runId: run.id })
      setRuns(current => current.filter(item => item.id !== run.id))
      setSelectedRun(current => current?.id === run.id ? null : current)
    } catch {
      setError('删除这次规划失败，请稍后重试。')
    } finally {
      setMutating(false)
    }
  }

  const clearHistory = async () => {
    if (!planningRunsAPI || mutating) return
    detailRequestRef.current += 1
    setMutating(true)
    setError(null)
    try {
      await planningRunsAPI.delete({ runId: null })
      setRuns([])
      setSelectedRun(null)
    } catch {
      setError('清空规划历史失败，请稍后重试。')
    } finally {
      setMutating(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.55)' }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="planning-history-title"
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-primary)' }}
      >
        <header className="flex items-center justify-between gap-4 px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 id="planning-history-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>最近 AI 规划</h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>仅展示本地保存的最小规划记录，不用于继续旧规划。</p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            aria-label="关闭最近 AI 规划"
            onClick={() => {
              detailRequestRef.current += 1
              onClose()
            }}
          ><X size={16} /></button>
        </header>

        {!planningRunsAPI ? (
          <p className="p-6 text-sm" style={{ color: 'var(--text-secondary)' }}>{PLANNING_HISTORY_UNAVAILABLE}</p>
        ) : (
          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.6fr)]">
            <aside className="min-h-0 overflow-y-auto p-4" style={{ borderRight: '1px solid var(--border)' }}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>最近记录</h3>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label="清空全部规划历史"
                  disabled={mutating || runs.length === 0}
                  onClick={() => { void clearHistory() }}
                >
                  清空全部
                </button>
              </div>
              {loading && <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}><Loader2 className="animate-spin" size={14} />读取中...</p>}
              {!loading && runs.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>还没有持久化的 AI 规划记录。</p>}
              <div className="space-y-2">
                {runs.map(run => (
                  <div key={run.id} data-testid="planning-history-row" className="rounded-xl p-3" style={{ border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    <button type="button" className="w-full text-left" onClick={() => { void openRun(run) }}>
                      <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {ENTRY_POINT_LABELS[run.entryPoint]} · {run.planningDate}
                      </span>
                      <span className="mt-1 block text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatPlanningTime(run.createdAt)} · {run.generationResultKind === 'valid_empty' ? '无候选建议' : `${run.candidates.length} 个保留候选`}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1 text-xs"
                      style={{ color: 'var(--danger)' }}
                      aria-label="删除这次规划"
                      disabled={mutating}
                      onClick={() => { void deleteRun(run) }}
                    >
                      <Trash2 size={13} />删除
                    </button>
                  </div>
                ))}
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto p-5">
              {error && <p role="alert" className="mb-4 rounded-lg p-3 text-sm" style={{ color: 'var(--danger)', border: '1px solid var(--danger)' }}>{error}</p>}
              {!selectedRun ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>选择一条记录查看当时的规划详情。</p>
              ) : (
                <div data-testid="planning-history-detail" className="space-y-5">
                  <section>
                    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{ENTRY_POINT_LABELS[selectedRun.entryPoint]}</h3>
                    <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>规划时间：{formatPlanningTime(selectedRun.createdAt)}</p>
                    <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>规划日期：{selectedRun.planningDate}</p>
                    <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>目标日期：{selectedRun.targetDate}</p>
                    <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {selectedRun.closeReason === null
                        ? '上次规划未记录结束状态'
                        : `已观察结束：${CLOSE_REASON_LABELS[selectedRun.closeReason]}`}
                    </p>
                  </section>

                  <section>
                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>本次请求上下文</h3>
                    <ul className="mt-2 space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {selectedRun.contextSummary.map(item => (
                        <li key={item.category}>
                          <span className="font-medium">{getCategoryLabel(selectedRun, item.category)}</span>：{PREPARATION_LABELS[item.preparation]}；{DISPOSITION_LABELS[item.disposition]}；{REASON_LABELS[item.reasonCode]}
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section>
                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>保留候选</h3>
                    {selectedRun.generationResultKind === 'valid_empty' && <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>本次生成了有效空候选集。</p>}
                    {selectedRun.generationResultKind === 'candidate_set' && selectedRun.candidates.length === 0 && <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>本次候选均未保留。</p>}
                    <div className="mt-2 space-y-3">
                      {selectedRun.candidates.map(candidate => <CandidateDetail key={candidate.id} candidate={candidate} />)}
                    </div>
                  </section>
                </div>
              )}
            </main>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
