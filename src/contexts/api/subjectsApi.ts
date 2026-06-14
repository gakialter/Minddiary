import { IS_ELECTRON } from '../../utils/apiAdapter'
import { STORAGE_KEYS } from '../../data/mockData'
import type { Mistake, PomodoroSession, StudyTask, Subject, SubjectChapter, SaveToLocalFn } from '../../types'
import type { SubjectsContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

export const createSubjectsApi = (
    subjectsRef: MutableRefObject<Subject[]>,
    saveToLocal: SaveToLocalFn,
    relatedRefs?: {
        mistakesRef?: MutableRefObject<Mistake[]>
        tasksRef?: MutableRefObject<StudyTask[]>
        pomodoroSessionsRef?: MutableRefObject<PomodoroSession[]>
        subjectChaptersRef?: MutableRefObject<SubjectChapter[]>
    },
): SubjectsContextAPI => ({
    getAll: async () => {
        if (IS_ELECTRON) return window.api.subjects.getAll()
        return subjectsRef.current.sort((a, b) => (a.order || 0) - (b.order || 0))
    },
    create: async (data: Partial<Subject>) => {
        if (IS_ELECTRON) return window.api.subjects.create(data)
        
        const newSubject: Subject = {
            name: '', color: '#0F766E',
            ...data,
            id: Math.max(0, ...subjectsRef.current.map(s => s.id)) + 1,
            order: subjectsRef.current.length + 1,
        }
        subjectsRef.current = [...subjectsRef.current, newSubject]
        saveToLocal(STORAGE_KEYS.SUBJECTS, subjectsRef.current)
        return newSubject
    },
    update: async (id: number, data: Partial<Subject>) => {
        if (IS_ELECTRON) {
            await window.api.subjects.update(id, data)
            return data
        }
        subjectsRef.current = subjectsRef.current.map(s => s.id === id ? { ...s, ...data } : s)
        saveToLocal(STORAGE_KEYS.SUBJECTS, subjectsRef.current)
        return data
    },
    delete: async (id: number) => {
        if (IS_ELECTRON) {
            await window.api.subjects.delete(id)
            return true
        }
        subjectsRef.current = subjectsRef.current.filter(s => s.id !== id)
        saveToLocal(STORAGE_KEYS.SUBJECTS, subjectsRef.current)
        if (relatedRefs?.subjectChaptersRef) {
            relatedRefs.subjectChaptersRef.current = relatedRefs.subjectChaptersRef.current.filter(chapter => chapter.subject_id !== id)
            saveToLocal(STORAGE_KEYS.SUBJECT_CHAPTERS, relatedRefs.subjectChaptersRef.current)
        }
        if (relatedRefs?.mistakesRef) {
            relatedRefs.mistakesRef.current = relatedRefs.mistakesRef.current.map(mistake => (
                mistake.subject_id === id ? { ...mistake, subject_id: null } : mistake
            ))
            saveToLocal(STORAGE_KEYS.MISTAKES, relatedRefs.mistakesRef.current)
        }
        if (relatedRefs?.tasksRef) {
            relatedRefs.tasksRef.current = relatedRefs.tasksRef.current.map(task => (
                task.subject_id === id ? { ...task, subject_id: null } : task
            ))
            saveToLocal(STORAGE_KEYS.TASKS, relatedRefs.tasksRef.current)
        }
        if (relatedRefs?.pomodoroSessionsRef) {
            relatedRefs.pomodoroSessionsRef.current = relatedRefs.pomodoroSessionsRef.current.map(session => (
                session.subject_id === id ? { ...session, subject_id: null } : session
            ))
            saveToLocal(STORAGE_KEYS.POMODORO_SESSIONS, relatedRefs.pomodoroSessionsRef.current)
        }
        return true
    }
})
