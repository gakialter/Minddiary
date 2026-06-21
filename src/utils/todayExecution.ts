import type { StudyTask, Subject, SubjectChapter } from '../types'

export type TodayDiaryStatus = 'missing' | 'draft' | 'written'

export interface TodayExecutionSummary {
  totalTasks: number
  completedTasks: number
  focusMinutes: number
  chapterTaskCount: number
  completedChapterTaskCount: number
  diaryStatus: TodayDiaryStatus
}

interface BuildTodayExecutionSummaryInput {
  tasks: readonly StudyTask[]
  focusMinutes: number
  todayEntry: { wordCount: number } | null
}

export interface TaskSourceLabel {
  subjectName: string | null
  chapterName: string | null
  label: string
  missingChapter: boolean
}

interface ResolveTaskSourceLabelsInput {
  tasks: readonly StudyTask[]
  subjects: readonly Subject[]
  chaptersBySubject: Readonly<Record<number, readonly SubjectChapter[]>>
}

export type NextTodayAction = {
  kind: 'active-focus' | 'task' | 'add-chapter' | 'review'
  title: string
  reason: string
  actionLabel: string
  task: StudyTask | null
}

interface GetNextTodayActionInput {
  tasks: readonly StudyTask[]
  hasActivePomodoroSession: boolean
  activeTask: StudyTask | null
  hasIncompleteChapters: boolean
  diaryStatus: TodayDiaryStatus
}

export function buildTodayExecutionSummary({
  tasks,
  focusMinutes,
  todayEntry,
}: BuildTodayExecutionSummaryInput): TodayExecutionSummary {
  const chapterTasks = tasks.filter(task => task.related_chapter_id !== null)

  return {
    totalTasks: tasks.length,
    completedTasks: tasks.filter(task => task.status === 'done').length,
    focusMinutes: Math.max(0, Math.round(focusMinutes)),
    chapterTaskCount: chapterTasks.length,
    completedChapterTaskCount: chapterTasks.filter(task => task.status === 'done').length,
    diaryStatus: todayEntry === null
      ? 'missing'
      : todayEntry.wordCount > 0
        ? 'written'
        : 'draft',
  }
}

export function resolveTaskSourceLabels({
  tasks,
  subjects,
  chaptersBySubject,
}: ResolveTaskSourceLabelsInput): Record<number, TaskSourceLabel> {
  const subjectsById = new Map(subjects.map(subject => [subject.id, subject]))
  const labels: Record<number, TaskSourceLabel> = {}

  for (const task of tasks) {
    if (task.related_chapter_id === null) continue

    const subject = task.subject_id === null ? undefined : subjectsById.get(task.subject_id)
    const chapter = task.subject_id === null
      ? undefined
      : chaptersBySubject[task.subject_id]?.find(item => item.id === task.related_chapter_id)

    if (!chapter) {
      labels[task.id] = {
        subjectName: subject?.name ?? null,
        chapterName: null,
        label: '章节已删除',
        missingChapter: true,
      }
      continue
    }

    const subjectName = subject?.name ?? null
    labels[task.id] = {
      subjectName,
      chapterName: chapter.title,
      label: subjectName ? `${subjectName} · ${chapter.title}` : chapter.title,
      missingChapter: false,
    }
  }

  return labels
}

export function getNextTodayAction({
  tasks,
  hasActivePomodoroSession,
  activeTask,
  hasIncompleteChapters,
  diaryStatus,
}: GetNextTodayActionInput): NextTodayAction {
  if (hasActivePomodoroSession) {
    return {
      kind: 'active-focus',
      title: activeTask ? `返回当前专注：${activeTask.title}` : '返回当前专注',
      reason: '已有专注会话正在进行，保持当前任务不变。',
      actionLabel: '返回当前专注',
      task: activeTask,
    }
  }

  const doingTask = tasks.find(task => task.status === 'doing')
  if (doingTask) {
    return {
      kind: 'task',
      title: `继续：${doingTask.title}`,
      reason: '该任务已经开始，优先完成现有闭环。',
      actionLabel: '进入专注',
      task: doingTask,
    }
  }

  const chapterTodo = tasks.find(task => task.status === 'todo' && task.related_chapter_id !== null)
  if (chapterTodo) {
    return {
      kind: 'task',
      title: `推进章节：${chapterTodo.title}`,
      reason: '优先推进已加入今天的章节。',
      actionLabel: '进入专注',
      task: chapterTodo,
    }
  }

  const ordinaryTodo = tasks.find(task => task.status === 'todo')
  if (ordinaryTodo) {
    return {
      kind: 'task',
      title: `开始：${ordinaryTodo.title}`,
      reason: '按加入今日计划的顺序执行。',
      actionLabel: '进入专注',
      task: ordinaryTodo,
    }
  }

  if (tasks.length === 0 && hasIncompleteChapters) {
    return {
      kind: 'add-chapter',
      title: '选择一个章节开始推进',
      reason: '今天还没有任务，可以从未完成章节加入一个最小行动。',
      actionLabel: '去科目进度',
      task: null,
    }
  }

  if (diaryStatus === 'missing') {
    return {
      kind: 'review',
      title: '写今日复盘',
      reason: tasks.length > 0
        ? '今天的可执行任务已处理，记录收获并完成今日闭环。'
        : '今天还没有复盘，先记录当前状态和下一步。',
      actionLabel: '写今日复盘',
      task: null,
    }
  }

  return {
    kind: 'review',
    title: '今日已闭环',
    reason: '今天的任务已处理，可以继续完善复盘或结束今天。',
    actionLabel: '继续写今日复盘',
    task: null,
  }
}
