import type { StudyTaskStatus, StudyTaskType } from '../types'

export const STUDY_TASK_STATUS_LABELS: Record<StudyTaskStatus, string> = {
  todo: '待开始', doing: '进行中', done: '已完成', skipped: '已跳过',
}

export const STUDY_TASK_TYPE_LABELS: Record<StudyTaskType, string> = {
  custom: '自定义', focus: '专注学习', review: '复习', diary: '日记', mistake: '错题',
}
