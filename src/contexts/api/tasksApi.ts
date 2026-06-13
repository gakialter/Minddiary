import { IS_ELECTRON } from '../../utils/apiAdapter'
import { STORAGE_KEYS } from '../../data/mockData'
import type {
    NewStudyTask,
    PomodoroSession,
    SaveToLocalFn,
    StudyTask,
    StudyTaskQuery,
    StudyTaskSource,
    StudyTaskStatus,
    StudyTaskType,
} from '../../types'
import type { TasksContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

const TASK_TYPES: StudyTaskType[] = ['review', 'focus', 'diary', 'mistake', 'custom']
const TASK_STATUSES: StudyTaskStatus[] = ['todo', 'doing', 'done', 'skipped']
const TASK_SOURCES: StudyTaskSource[] = ['manual', 'dashboard', 'ai', 'pomodoro']
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const STATUS_ORDER: Record<StudyTaskStatus, number> = {
    doing: 0,
    todo: 1,
    skipped: 2,
    done: 3,
}

function requireDateKey(date: string): string {
    if (!DATE_KEY_PATTERN.test(date)) {
        throw new Error('planned_date must be YYYY-MM-DD')
    }
    return date
}

function requireTitle(title: string): string {
    const trimmed = title.trim()
    if (!trimmed) {
        throw new Error('Task title is required')
    }
    return trimmed
}

function normalizeType(type: StudyTaskType | undefined): StudyTaskType {
    const normalized = type ?? 'custom'
    if (!TASK_TYPES.includes(normalized)) {
        throw new Error('Invalid task type')
    }
    return normalized
}

function normalizeStatus(status: StudyTaskStatus | undefined): StudyTaskStatus {
    const normalized = status ?? 'todo'
    if (!TASK_STATUSES.includes(normalized)) {
        throw new Error('Invalid task status')
    }
    return normalized
}

function normalizeSource(source: StudyTaskSource | undefined): StudyTaskSource {
    const normalized = source ?? 'manual'
    if (!TASK_SOURCES.includes(normalized)) {
        throw new Error('Invalid task source')
    }
    return normalized
}

function normalizeNullableId(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error('Task related ids must be positive integers')
    }
    return value
}

function normalizeEstimate(value: number | undefined): number {
    if (value === undefined) return 25
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error('estimate_minutes must be a positive integer')
    }
    return value
}

function sortTasks(tasks: StudyTask[]): StudyTask[] {
    return [...tasks].sort((a, b) => {
        const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        if (statusDiff !== 0) return statusDiff
        return a.created_at.localeCompare(b.created_at) || a.id - b.id
    })
}

function matchesQuery(task: StudyTask, query: StudyTaskQuery): boolean {
    if (query.planned_date !== undefined && task.planned_date !== requireDateKey(query.planned_date)) return false
    if (query.type !== undefined && task.type !== normalizeType(query.type)) return false
    if (query.status !== undefined) {
        const statuses = Array.isArray(query.status) ? query.status : [query.status]
        if (statuses.length === 0) return false
        statuses.forEach(status => normalizeStatus(status))
        if (!statuses.includes(task.status)) return false
    }
    if (query.related_mistake_id !== undefined) {
        const relatedMistakeId = normalizeNullableId(query.related_mistake_id)
        if (task.related_mistake_id !== relatedMistakeId) return false
    }
    if (query.related_entry_id !== undefined) {
        const relatedEntryId = normalizeNullableId(query.related_entry_id)
        if (task.related_entry_id !== relatedEntryId) return false
    }
    return true
}

export const createTasksApi = (
    tasksRef: MutableRefObject<StudyTask[]>,
    saveToLocal: SaveToLocalFn,
    pomodoroSessionsRef?: MutableRefObject<PomodoroSession[]>
): TasksContextAPI => ({
    getByDate: async (date: string) => {
        if (IS_ELECTRON) return window.api.tasks.getByDate(date)
        requireDateKey(date)
        return sortTasks(tasksRef.current.filter(task => task.planned_date === date))
    },
    find: async (query: StudyTaskQuery) => {
        if (IS_ELECTRON) return window.api.tasks.find(query)
        return sortTasks(tasksRef.current.filter(task => matchesQuery(task, query)))
    },
    create: async (data: NewStudyTask) => {
        if (IS_ELECTRON) return window.api.tasks.create(data)

        const now = new Date().toISOString()
        const newTask: StudyTask = {
            id: Math.max(0, ...tasksRef.current.map(task => task.id)) + 1,
            title: requireTitle(data.title),
            description: data.description ?? '',
            type: normalizeType(data.type),
            subject_id: normalizeNullableId(data.subject_id),
            related_mistake_id: normalizeNullableId(data.related_mistake_id),
            related_entry_id: normalizeNullableId(data.related_entry_id),
            planned_date: requireDateKey(data.planned_date),
            estimate_minutes: normalizeEstimate(data.estimate_minutes),
            status: normalizeStatus(data.status),
            source: normalizeSource(data.source),
            created_at: now,
            updated_at: now,
        }
        tasksRef.current = [...tasksRef.current, newTask]
        saveToLocal(STORAGE_KEYS.TASKS, tasksRef.current)
        return newTask
    },
    update: async (id: number, patch: Partial<StudyTask>) => {
        if (IS_ELECTRON) return window.api.tasks.update(id, patch)

        const existing = tasksRef.current.find(task => task.id === id)
        if (!existing) {
            throw new Error('Task not found')
        }

        const updated: StudyTask = {
            ...existing,
            ...(patch.title !== undefined ? { title: requireTitle(patch.title) } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.type !== undefined ? { type: normalizeType(patch.type) } : {}),
            ...(patch.subject_id !== undefined ? { subject_id: normalizeNullableId(patch.subject_id) } : {}),
            ...(patch.related_mistake_id !== undefined ? { related_mistake_id: normalizeNullableId(patch.related_mistake_id) } : {}),
            ...(patch.related_entry_id !== undefined ? { related_entry_id: normalizeNullableId(patch.related_entry_id) } : {}),
            ...(patch.planned_date !== undefined ? { planned_date: requireDateKey(patch.planned_date) } : {}),
            ...(patch.estimate_minutes !== undefined ? { estimate_minutes: normalizeEstimate(patch.estimate_minutes) } : {}),
            ...(patch.status !== undefined ? { status: normalizeStatus(patch.status) } : {}),
            ...(patch.source !== undefined ? { source: normalizeSource(patch.source) } : {}),
            id,
            created_at: existing.created_at,
            updated_at: new Date().toISOString(),
        }
        tasksRef.current = tasksRef.current.map(task => task.id === id ? updated : task)
        saveToLocal(STORAGE_KEYS.TASKS, tasksRef.current)
        return updated
    },
    delete: async (id: number) => {
        if (IS_ELECTRON) return window.api.tasks.delete(id)
        const before = tasksRef.current.length
        tasksRef.current = tasksRef.current.filter(task => task.id !== id)
        saveToLocal(STORAGE_KEYS.TASKS, tasksRef.current)
        if (pomodoroSessionsRef) {
            pomodoroSessionsRef.current = pomodoroSessionsRef.current.map(session => (
                session.task_id === id ? { ...session, task_id: null } : session
            ))
            saveToLocal(STORAGE_KEYS.POMODORO_SESSIONS, pomodoroSessionsRef.current)
        }
        return before !== tasksRef.current.length
    },
    complete: async (id: number) => {
        if (IS_ELECTRON) return window.api.tasks.complete(id)
        return createTasksApi(tasksRef, saveToLocal, pomodoroSessionsRef).update(id, { status: 'done' })
    },
    skip: async (id: number) => {
        if (IS_ELECTRON) return window.api.tasks.skip(id)
        return createTasksApi(tasksRef, saveToLocal, pomodoroSessionsRef).update(id, { status: 'skipped' })
    },
    startFocus: async (id: number, date: string) => {
        if (IS_ELECTRON) return window.api.tasks.startFocus(id, date)
        requireDateKey(date)
        const existing = tasksRef.current.find(task => task.id === id)
        if (!existing) {
            throw new Error('Task not found')
        }
        if (existing.planned_date !== date) {
            throw new Error('Task is not planned for this date')
        }
        if (existing.status === 'done' || existing.status === 'skipped') {
            throw new Error('Cannot start focus for a completed or skipped task')
        }
        if (existing.status === 'doing') return existing
        return createTasksApi(tasksRef, saveToLocal, pomodoroSessionsRef).update(id, { status: 'doing' })
    },
})
