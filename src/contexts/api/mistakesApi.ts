import { IS_ELECTRON } from '../../utils/apiAdapter'
import { STORAGE_KEYS } from '../../data/mockData'
import { getLocalDateKey } from '../../utils/dateKey'
import type { Mistake, MistakeFilters, Subject, SaveToLocalFn, ReviewData, StudyTask } from '../../types'
import type { MistakesContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'
import {
    validateMistakeId,
    validateMistakeWritePayload,
    validateMistakeWritePayloadBatch,
} from '../../utils/mistakePayload'

export const createMistakesApi = (
    mistakesRef: MutableRefObject<Mistake[]>,
    subjectsRef: MutableRefObject<Subject[]>,
    tasksRef: MutableRefObject<StudyTask[]>,
    saveToLocal: SaveToLocalFn
): MistakesContextAPI => ({
    getAll: async (filters: MistakeFilters = {}) => {
        if (IS_ELECTRON) return window.api.mistakes.getAll(filters)
        let result = mistakesRef.current.map(m => {
            const subject = subjectsRef.current.find(s => s.id === m.subject_id)
            return { ...m, image_path: m.image_path ?? null, answer_image_path: m.answer_image_path ?? null, subject_name: subject?.name, subject_color: subject?.color }
        })
        if (filters.subject_id) result = result.filter(m => m.subject_id === filters.subject_id)
        if (filters.due) {
            const dueDate = filters.dueDate || getLocalDateKey()
            result = result.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= dueDate))
        } else if (filters.mastered !== undefined) {
            result = result.filter(m => m.mastered === filters.mastered)
        }
        if (filters.search) {
            const query = filters.search.toLowerCase()
            result = result.filter(m =>
                m.question?.toLowerCase().includes(query) ||
                m.answer?.toLowerCase().includes(query) ||
                m.notes?.toLowerCase().includes(query)
            )
        }
        
        const total = result.length;
        const masteredTotal = result.filter(m => m.mastered).length;
        result = result.sort((a, b) => {
            const createdAtOrder = (typeof b.created_at === 'string' ? b.created_at : '')
                .localeCompare(typeof a.created_at === 'string' ? a.created_at : '')
            return createdAtOrder || b.id - a.id
        })
        
        if (filters.limit) {
            const offset = filters.offset || 0;
            result = result.slice(offset, offset + filters.limit);
        }
        return { data: result, total, masteredTotal };
    },
    create: async (data: Partial<Mistake>) => {
        const validated = validateMistakeWritePayload(data)
        if (IS_ELECTRON) {
            const { id } = await window.api.mistakes.create(validated)
            return {
                question: '',
                answer: '',
                notes: '',
                subject_id: null,
                image_path: null,
                answer_image_path: null,
                ...validated,
                mastered: validated.mastered ?? false,
                ease_factor: validated.ease_factor ?? 2.5,
                review_interval: validated.review_interval ?? 1,
                next_review_date: validated.next_review_date ?? null,
                review_count: validated.review_count ?? 0,
                id,
                created_at: new Date().toISOString(),
            }
        }
        
        const newMistake: Mistake = {
            question: '', answer: '', notes: '', subject_id: null,
            image_path: null, answer_image_path: null,
            id: Math.max(0, ...mistakesRef.current.map(m => m.id)) + 1,
            created_at: new Date().toISOString(),
            ...validated,
            mastered: validated.mastered ?? false,
            ease_factor: validated.ease_factor ?? 2.5,
            review_interval: validated.review_interval ?? 1,
            next_review_date: validated.next_review_date ?? null,
            review_count: validated.review_count ?? 0,
        }
        const nextMistakes = [...mistakesRef.current, newMistake]
        saveToLocal(STORAGE_KEYS.MISTAKES, nextMistakes)
        mistakesRef.current = nextMistakes
        return newMistake
    },
    createBatch: async (data: Partial<Mistake>[]) => {
        const validatedBatch = validateMistakeWritePayloadBatch(data)
        if (validatedBatch.length === 0) return []

        const createdAt = new Date().toISOString()
        const materializeMistake = (
            validated: ReturnType<typeof validateMistakeWritePayload>,
            id: number,
        ): Mistake => ({
            question: '',
            answer: '',
            notes: '',
            subject_id: null,
            image_path: null,
            answer_image_path: null,
            ...validated,
            mastered: validated.mastered ?? false,
            ease_factor: validated.ease_factor ?? 2.5,
            review_interval: validated.review_interval ?? 1,
            next_review_date: validated.next_review_date ?? null,
            review_count: validated.review_count ?? 0,
            id,
            created_at: createdAt,
        })

        if (IS_ELECTRON) {
            const { ids } = await window.api.mistakes.createBatch(validatedBatch)
            if (ids.length !== validatedBatch.length || ids.some(id => !Number.isInteger(id) || id <= 0)) {
                throw new Error('Invalid mistake batch result returned by Electron IPC')
            }
            return validatedBatch.map((validated, index) => {
                const id = ids[index]
                if (id === undefined) throw new Error('Invalid mistake batch result returned by Electron IPC')
                return materializeMistake(validated, id)
            })
        }

        const missingSubject = validatedBatch.find(mistake => (
            mistake.subject_id !== undefined
            && mistake.subject_id !== null
            && !subjectsRef.current.some(subject => subject.id === mistake.subject_id)
        ))
        if (missingSubject) {
            throw new Error('Mistake subject not found')
        }

        const firstId = Math.max(0, ...mistakesRef.current.map(m => m.id)) + 1
        const newMistakes = validatedBatch.map((validated, index) => (
            materializeMistake(validated, firstId + index)
        ))
        const nextMistakes = [...mistakesRef.current, ...newMistakes]
        saveToLocal(STORAGE_KEYS.MISTAKES, nextMistakes)
        mistakesRef.current = nextMistakes
        return newMistakes
    },
    update: async (id: number, data: Partial<Mistake>) => {
        const validatedId = validateMistakeId(id)
        const validated = validateMistakeWritePayload(data)
        if (IS_ELECTRON) {
            await window.api.mistakes.update(validatedId, validated)
            return validated
        }
        const nextMistakes = mistakesRef.current.map(m => m.id === validatedId ? { ...m, ...validated } : m)
        saveToLocal(STORAGE_KEYS.MISTAKES, nextMistakes)
        mistakesRef.current = nextMistakes
        return validated
    },
    delete: async (id: number) => {
        const validatedId = validateMistakeId(id)
        if (IS_ELECTRON) {
            await window.api.mistakes.delete(validatedId)
            return true
        }
        mistakesRef.current = mistakesRef.current.filter(m => m.id !== validatedId)
        saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
        tasksRef.current = tasksRef.current.map(task => (
            task.related_mistake_id === validatedId ? { ...task, related_mistake_id: null } : task
        ))
        saveToLocal(STORAGE_KEYS.TASKS, tasksRef.current)
        return true
    },
    toggleMastered: async (id: number) => {
        const validatedId = validateMistakeId(id)
        if (IS_ELECTRON) {
            const res = await window.api.mistakes.toggleMastered(validatedId);
            return { mastered: !!res.mastered };
        }
        
        mistakesRef.current = mistakesRef.current.map(m => m.id === validatedId ? { ...m, mastered: !m.mastered } : m)
        saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
        return { mastered: true }
    },
    review: async (id: number, data: ReviewData) => {
        if (IS_ELECTRON) {
            return window.api.mistakes.review(id, data);
        }
        const existing = mistakesRef.current.find(m => m.id === id)
        if (!existing) {
            throw new Error('Mistake not found')
        }
        const updated = { ...existing, ...data, updated_at: new Date().toISOString() }
        mistakesRef.current = mistakesRef.current.map(m => m.id === id ? updated : m);
        saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
        return { success: true, mistake: updated };
    },
    getDueCount: async (date: string) => {
        if (IS_ELECTRON) return window.api.mistakes.getDueCount(date);
        return mistakesRef.current.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date)).length;
    },
    getRandomDue: async (date: string, subjectId?: number) => {
        if (IS_ELECTRON) return window.api.mistakes.getRandomDue(date, subjectId);
        let due = mistakesRef.current.filter(m => !m.mastered && (!m.next_review_date || m.next_review_date <= date));
        if (subjectId) due = due.filter(m => m.subject_id === subjectId);
        if (due.length === 0) return null;
        return due[Math.floor(Math.random() * due.length)] || null;
    },
    saveImage: async (data: { data: string, ext?: string, name?: string, mimetype?: string }) => {
        if (IS_ELECTRON && window.api.mistakes.saveImage) {
            const imagePath = await window.api.mistakes.saveImage(data);
            if (typeof imagePath !== 'string' || !imagePath.trim()) {
                throw new Error('Invalid mistake image path returned by Electron IPC');
            }
            return imagePath;
        }
        throw new Error('Mistake image uploads are not supported in browser fallback mode');
    },
    deleteImage: async (filename: string) => {
        if (IS_ELECTRON && window.api.mistakes.deleteImage) {
            await window.api.mistakes.deleteImage(filename);
        }
    },
    getImagePath: async (filename: string) => {
        if (IS_ELECTRON && window.api.mistakes.getImagePath) {
            return window.api.mistakes.getImagePath(filename);
        }
        return filename;
    }
})
