import type { DiaryEntry, StudyTask } from '../types'
import type { TasksContextAPI } from '../types/api'
import { calculateWordCount } from './helpers'

const ACTIVE_STATUSES = ['todo', 'doing'] as const
export const EFFECTIVE_DIARY_CONTENT_MIN_CHARS = 20

export type DiaryTaskSettlementMatch = 'exact' | 'same-day-unlinked'
export type DiaryTaskSettlementStatus = 'none' | 'ready' | 'conflict' | 'completed' | 'failed'

export interface DiaryTaskSettlementCandidates {
  status: Exclude<DiaryTaskSettlementStatus, 'completed' | 'failed'>
  match?: DiaryTaskSettlementMatch
  tasks: StudyTask[]
  reason?: 'ineffective-content' | 'no-task'
}

export interface DiaryTaskSettlementResult {
  taskSettlementStatus: DiaryTaskSettlementStatus
  completedTask?: StudyTask
  conflictTasks: StudyTask[]
  settlementError?: string
}

export function normalizeDiarySettlementContent(content: string | null | undefined): string {
  return (content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`~>#=+\-[\](){}|]+/g, ' ')
    .replace(/^(学习内容|卡点|下一步|科目|时间|任务|专注|结果)\s*[：:]\s*/gm, ' ')
}

export function getEffectiveDiaryContentLength(content: string | null | undefined): number {
  return calculateWordCount(normalizeDiarySettlementContent(content))
}

export function hasEffectiveDiaryContent(entry: Pick<DiaryEntry, 'content'>): boolean {
  return getEffectiveDiaryContentLength(entry.content) >= EFFECTIVE_DIARY_CONTENT_MIN_CHARS
}

export async function findDiaryTaskSettlementCandidates({
  entry,
  tasksAPI,
}: {
  entry: Pick<DiaryEntry, 'id' | 'date' | 'content'>
  tasksAPI: Pick<TasksContextAPI, 'find'>
}): Promise<DiaryTaskSettlementCandidates> {
  if (!hasEffectiveDiaryContent(entry)) {
    return { status: 'none', tasks: [], reason: 'ineffective-content' }
  }

  const exactTasks = await tasksAPI.find({
    type: 'diary',
    related_entry_id: entry.id,
    status: [...ACTIVE_STATUSES],
  })
  if (exactTasks.length === 1) {
    return { status: 'ready', match: 'exact', tasks: exactTasks }
  }
  if (exactTasks.length > 1) {
    return { status: 'conflict', match: 'exact', tasks: exactTasks }
  }

  const sameDayUnlinkedTasks = await tasksAPI.find({
    type: 'diary',
    planned_date: entry.date,
    related_entry_id: null,
    status: [...ACTIVE_STATUSES],
  })
  if (sameDayUnlinkedTasks.length === 1) {
    return { status: 'ready', match: 'same-day-unlinked', tasks: sameDayUnlinkedTasks }
  }
  if (sameDayUnlinkedTasks.length > 1) {
    return { status: 'conflict', match: 'same-day-unlinked', tasks: sameDayUnlinkedTasks }
  }

  return { status: 'none', tasks: [], reason: 'no-task' }
}

export async function settleDiaryTask({
  entry,
  tasksAPI,
  taskId,
}: {
  entry: Pick<DiaryEntry, 'id' | 'date' | 'content'>
  tasksAPI: Pick<TasksContextAPI, 'find' | 'update'>
  taskId?: number
}): Promise<DiaryTaskSettlementResult> {
  const candidates = await findDiaryTaskSettlementCandidates({ entry, tasksAPI })
  if (candidates.status === 'none') {
    return { taskSettlementStatus: 'none', conflictTasks: [] }
  }

  if (candidates.status === 'conflict' && taskId === undefined) {
    return { taskSettlementStatus: 'conflict', conflictTasks: candidates.tasks }
  }

  const selectedTask = taskId === undefined
    ? candidates.tasks[0]
    : candidates.tasks.find(task => task.id === taskId)
  if (!selectedTask) {
    return { taskSettlementStatus: 'none', conflictTasks: [] }
  }

  try {
    const completedTask = await tasksAPI.update(selectedTask.id, {
      related_entry_id: entry.id,
      status: 'done',
    })
    return { taskSettlementStatus: 'completed', completedTask, conflictTasks: [] }
  } catch (error) {
    return {
      taskSettlementStatus: 'failed',
      conflictTasks: [],
      settlementError: error instanceof Error ? error.message : String(error),
    }
  }
}
