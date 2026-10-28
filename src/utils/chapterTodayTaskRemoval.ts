import type { RemoveChapterFromTodayInput, StudyTask } from '../types'
import { isDateKey } from './dateKey'

function requirePositiveId(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function validateRemoveChapterFromTodayInput(value: unknown): RemoveChapterFromTodayInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Chapter task removal must be an object')
  }
  const record = value as Record<string, unknown>
  const taskId = requirePositiveId(record.taskId, 'taskId')
  const chapterId = requirePositiveId(record.chapterId, 'chapterId')
  const subjectId = requirePositiveId(record.subjectId, 'subjectId')
  if (!isDateKey(record.date)) throw new Error('date must be YYYY-MM-DD')
  return { taskId, chapterId, subjectId, date: record.date }
}

// The chapter source is retired on any later edit. Legacy manual tasks have no
// reliable provenance, even when their title happens to match this template.
export function isUntouchedChapterTodayTask(task: StudyTask, subjectName: string, chapterTitle: string): boolean {
  return task.source === 'chapter'
    && task.status === 'todo'
    && task.type === 'focus'
    && task.title === `学习：${subjectName} · ${chapterTitle}`
    && task.description === ''
    && task.estimate_minutes === 25
    && task.related_entry_id === null
    && task.related_mistake_id === null
    && task.created_at === task.updated_at
}
