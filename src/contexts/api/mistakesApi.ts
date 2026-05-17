import { IS_ELECTRON } from '../../utils/apiAdapter'
import { STORAGE_KEYS } from '../../data/mockData'
import type { Mistake, MistakeFilters, Subject, SaveToLocalFn, ReviewData } from '../../types'
import type { MistakesContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'

export const createMistakesApi = (
    mistakesRef: MutableRefObject<Mistake[]>,
    subjectsRef: MutableRefObject<Subject[]>,
    saveToLocal: SaveToLocalFn
): MistakesContextAPI => ({
    getAll: async (filters: MistakeFilters = {}) => {
        if (IS_ELECTRON) return window.api.mistakes.getAll(filters)
        let result = mistakesRef.current.map(m => {
            const subject = subjectsRef.current.find(s => s.id === m.subject_id)
            return { ...m, subject_name: subject?.name, subject_color: subject?.color }
        })
        if (filters.subject_id) result = result.filter(m => m.subject_id === filters.subject_id)
        if (filters.mastered !== undefined) result = result.filter(m => m.mastered === filters.mastered)
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
        result = result.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        
        if (filters.limit) {
            const offset = filters.offset || 0;
            result = result.slice(offset, offset + filters.limit);
        }
        return { data: result, total, masteredTotal };
    },
    create: async (data: Partial<Mistake>) => {
        if (IS_ELECTRON) {
            const { id } = await window.api.mistakes.create(data)
            return { ...data, id, mastered: false } as Mistake
        }
        
        const newMistake: Mistake = {
            question: '', answer: '', notes: '', subject_id: null,
            ease_factor: 2.5, review_interval: 1, next_review_date: null, review_count: 0,
            ...data,
            id: Math.max(0, ...mistakesRef.current.map(m => m.id)) + 1,
            mastered: false,
            created_at: new Date().toISOString(),
        }
        mistakesRef.current = [...mistakesRef.current, newMistake]
        saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
        return newMistake
    },
    update: async (id: number, data: Partial<Mistake>) => {
        if (IS_ELECTRON) {
            await window.api.mistakes.update(id, data)
            return data
        }
        mistakesRef.current = mistakesRef.current.map(m => m.id === id ? { ...m, ...data } : m)
        saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
        return data
    },
    delete: async (id: number) => {
        if (IS_ELECTRON) {
            await window.api.mistakes.delete(id)
            return true
        }
        mistakesRef.current = mistakesRef.current.filter(m => m.id !== id)
        saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
        return true
    },
    toggleMastered: async (id: number) => {
        if (IS_ELECTRON) {
            const res = await window.api.mistakes.toggleMastered(id);
            return { mastered: !!res.mastered };
        }
        
        mistakesRef.current = mistakesRef.current.map(m => m.id === id ? { ...m, mastered: !m.mastered } : m)
        saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
        return { mastered: true }
    },
    review: async (id: number, data: ReviewData) => {
        if (IS_ELECTRON) {
            await window.api.mistakes.review(id, data);
            return { success: true };
        }
        mistakesRef.current = mistakesRef.current.map(m => m.id === id ? { ...m, ...data } : m);
        saveToLocal(STORAGE_KEYS.MISTAKES, mistakesRef.current)
        return { success: true };
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
            return window.api.mistakes.saveImage(data);
        }
        return '';
    },
    getImagePath: async (filename: string) => {
        if (IS_ELECTRON && window.api.mistakes.getImagePath) {
            return window.api.mistakes.getImagePath(filename);
        }
        return filename;
    }
})
