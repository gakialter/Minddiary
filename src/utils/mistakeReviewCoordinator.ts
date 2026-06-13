import type { Mistake, ReviewData, StudyTask } from '../types'
import type { MistakesContextAPI, TasksContextAPI } from '../types/api'
import { calculateNextReview } from './spacedRepetition'

export type MistakeTaskSettlementStatus = 'none' | 'completed' | 'conflict' | 'failed'

export interface MistakeReviewSettlementResult {
  taskSettlementStatus: MistakeTaskSettlementStatus
  completedTask?: StudyTask
  conflictTasks: StudyTask[]
  settlementError?: string
}

export interface MistakeReviewSubmitResult extends MistakeReviewSettlementResult {
  reviewSaved: true
  reviewData: ReviewData
  reviewedMistake: Mistake
}

export async function settleMistakeReviewTask({
  mistakeId,
  reviewDate,
  tasksAPI,
  taskId,
}: {
  mistakeId: number
  reviewDate: string
  tasksAPI: Pick<TasksContextAPI, 'find' | 'update'>
  taskId?: number
}): Promise<MistakeReviewSettlementResult> {
  const activeTasks = await tasksAPI.find({
    type: 'review',
    planned_date: reviewDate,
    status: ['todo', 'doing'],
    related_mistake_id: mistakeId,
  })

  if (taskId !== undefined) {
    const selectedTask = activeTasks.find(task => task.id === taskId)
    if (!selectedTask) {
      return { taskSettlementStatus: 'none', conflictTasks: [] }
    }
    try {
      const completedTask = await tasksAPI.update(selectedTask.id, { status: 'done' })
      return { taskSettlementStatus: 'completed', completedTask, conflictTasks: [] }
    } catch (error) {
      return {
        taskSettlementStatus: 'failed',
        conflictTasks: [],
        settlementError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (activeTasks.length === 0) {
    return { taskSettlementStatus: 'none', conflictTasks: [] }
  }
  if (activeTasks.length > 1) {
    return { taskSettlementStatus: 'conflict', conflictTasks: activeTasks }
  }

  const [task] = activeTasks
  try {
    const completedTask = await tasksAPI.update(task!.id, { status: 'done' })
    return { taskSettlementStatus: 'completed', completedTask, conflictTasks: [] }
  } catch (error) {
    return {
      taskSettlementStatus: 'failed',
      conflictTasks: [],
      settlementError: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function submitMistakeReview({
  mistake,
  quality,
  reviewDate,
  mistakesAPI,
  tasksAPI,
}: {
  mistake: Mistake
  quality: number
  reviewDate: string
  mistakesAPI: Pick<MistakesContextAPI, 'review'>
  tasksAPI: Pick<TasksContextAPI, 'find' | 'update'>
}): Promise<MistakeReviewSubmitResult> {
  const reviewData = calculateNextReview(
    quality,
    mistake.ease_factor || 2.5,
    mistake.review_interval || 1,
    mistake.review_count || 0,
  )

  const reviewResult = await mistakesAPI.review(mistake.id, reviewData)
  if (!reviewResult.success || !reviewResult.mistake) {
    throw new Error('Mistake review was not saved')
  }

  const settlement = await settleMistakeReviewTask({
    mistakeId: mistake.id,
    reviewDate,
    tasksAPI,
  })

  return {
    reviewSaved: true,
    reviewData,
    reviewedMistake: reviewResult.mistake,
    ...settlement,
  }
}
