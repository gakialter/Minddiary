import type { StudyTask, TodayDashboardData } from '../types'

type TaskFocusMetricTask = Pick<StudyTask, 'id' | 'title' | 'status'>

export interface TaskFocusMinutesRow {
  task_id: number
  total_minutes: number
}

const MAX_UNCLOSED_TASK_TITLES = 3

function hasFocusMinutes(focusedMinutesByTask: Map<number, number>, taskId: number): boolean {
  return (focusedMinutesByTask.get(taskId) ?? 0) > 0
}

function uniqueByTaskId(tasks: TaskFocusMetricTask[]): TaskFocusMetricTask[] {
  return tasks.filter((task, index, allTasks) => (
    allTasks.findIndex(candidate => candidate.id === task.id) === index
  ))
}

function formatUnclosedTaskTitles(tasks: TaskFocusMetricTask[]): string[] {
  const uniqueTasks = uniqueByTaskId(tasks)
  const titles = uniqueTasks.slice(0, MAX_UNCLOSED_TASK_TITLES).map(task => task.title)
  const remaining = uniqueTasks.length - titles.length
  return remaining > 0 ? [...titles, `等 ${remaining} 项`] : titles
}

export function calculateTaskFocusMetrics(
  taskRows: TaskFocusMetricTask[],
  taskFocusRows: TaskFocusMinutesRow[],
): TodayDashboardData['taskFocusToday'] {
  const focusedMinutesByTask = new Map<number, number>()
  for (const row of taskFocusRows) {
    const minutes = Number(row.total_minutes) || 0
    focusedMinutesByTask.set(row.task_id, (focusedMinutesByTask.get(row.task_id) ?? 0) + minutes)
  }

  const effectiveTasks = taskRows.filter(task => task.status !== 'skipped')
  const completedTaskCount = effectiveTasks.filter(task => task.status === 'done').length
  const focusedTaskCount = effectiveTasks.filter(task => hasFocusMinutes(focusedMinutesByTask, task.id)).length
  const openWithoutFocusTasks = effectiveTasks.filter(task => (
    (task.status === 'todo' || task.status === 'doing') &&
    !hasFocusMinutes(focusedMinutesByTask, task.id)
  ))
  const focusedOpenTasks = effectiveTasks.filter(task => (
    task.status !== 'done' &&
    hasFocusMinutes(focusedMinutesByTask, task.id)
  ))
  const focusedMinutes = taskFocusRows.reduce((total, row) => total + (Number(row.total_minutes) || 0), 0)

  return {
    effectiveTaskCount: effectiveTasks.length,
    completedTaskCount,
    completionRate: effectiveTasks.length > 0 ? Math.round((completedTaskCount / effectiveTasks.length) * 100) : 0,
    focusedTaskCount,
    focusCoverageRate: effectiveTasks.length > 0 ? Math.round((focusedTaskCount / effectiveTasks.length) * 100) : 0,
    focusedMinutes,
    skippedTaskCount: taskRows.filter(task => task.status === 'skipped').length,
    openWithoutFocusCount: openWithoutFocusTasks.length,
    focusedOpenTaskCount: focusedOpenTasks.length,
    unclosedTaskTitles: formatUnclosedTaskTitles([...openWithoutFocusTasks, ...focusedOpenTasks]),
  }
}
