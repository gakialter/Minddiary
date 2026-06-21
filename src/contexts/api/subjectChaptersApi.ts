import { IS_ELECTRON } from '../../utils/apiAdapter'
import { STORAGE_KEYS } from '../../data/mockData'
import type {
    BulkSubjectChaptersInput,
    ConvertSubjectChaptersInput,
    CreateSubjectChapterInput,
    SaveToLocalFn,
    Subject,
    SubjectChapter,
    SubjectChapterDraft,
    SubjectChapterPatch,
    StudyTask,
} from '../../types'
import type { SubjectChaptersContextAPI } from '../../types/api'
import type { MutableRefObject } from 'react'
import {
    normalizeChapterDrafts,
    normalizeChapterNotes,
    normalizeChapterTitle,
    normalizeCompleted,
} from '../../utils/subjectChapters'

function assertPositiveInteger(value: number, label: string): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer`)
    }
    return value
}

function sortChapters(chapters: SubjectChapter[]): SubjectChapter[] {
    return [...chapters].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
}

function nowIso(): string {
    return new Date().toISOString()
}

function syncSubjectSummary(subjects: Subject[], chapters: SubjectChapter[], subjectId: number): Subject[] {
    const subjectChapters = chapters.filter(chapter => chapter.subject_id === subjectId)
    const total = subjectChapters.length
    const completed = subjectChapters.filter(chapter => chapter.completed).length
    return subjects.map(subject => (
        subject.id === subjectId
            ? { ...subject, total_chapters: total, completed_chapters: completed }
            : subject
    ))
}

function assertSubjectExists(subjects: Subject[], subjectId: number): Subject {
    const subject = subjects.find(item => item.id === subjectId)
    if (!subject) throw new Error('Subject not found')
    return subject
}

function createChapterRows(
    chapters: SubjectChapter[],
    subjectId: number,
    drafts: SubjectChapterDraft[],
    completedCount = 0,
): { chapters: SubjectChapter[]; created: SubjectChapter[] } {
    const normalized = normalizeChapterDrafts(drafts)
    const maxId = Math.max(0, ...chapters.map(chapter => chapter.id))
    const maxSortOrder = Math.max(-1, ...chapters.filter(chapter => chapter.subject_id === subjectId).map(chapter => chapter.sort_order))
    const timestamp = nowIso()
    const created = normalized.map((draft, index): SubjectChapter => ({
        id: maxId + index + 1,
        subject_id: subjectId,
        title: draft.title,
        notes: draft.notes ?? '',
        completed: index < completedCount || !!draft.completed,
        sort_order: maxSortOrder + index + 1,
        created_at: timestamp,
        updated_at: timestamp,
    }))
    return { chapters: [...chapters, ...created], created }
}

export const createSubjectChaptersApi = (
    subjectsRef: MutableRefObject<Subject[]>,
    chaptersRef: MutableRefObject<SubjectChapter[]>,
    saveToLocal: SaveToLocalFn,
    tasksRef?: MutableRefObject<StudyTask[]>,
): SubjectChaptersContextAPI => {
    const commit = (subjects: Subject[], chapters: SubjectChapter[]) => {
        subjectsRef.current = subjects
        chaptersRef.current = sortChapters(chapters)
        saveToLocal(STORAGE_KEYS.SUBJECTS, subjectsRef.current)
        saveToLocal(STORAGE_KEYS.SUBJECT_CHAPTERS, chaptersRef.current)
    }

    const clearTaskChapterLinks = (chapterIds: Set<number>) => {
        if (!tasksRef || chapterIds.size === 0) return
        tasksRef.current = tasksRef.current.map(task => (
            task.related_chapter_id !== null && chapterIds.has(task.related_chapter_id)
                ? { ...task, related_chapter_id: null, updated_at: nowIso() }
                : task
        ))
        saveToLocal(STORAGE_KEYS.TASKS, tasksRef.current)
    }

    return {
        getBySubject: async (subjectId: number) => {
            if (IS_ELECTRON) return window.api.subjectChapters.getBySubject(subjectId)
            const normalizedSubjectId = assertPositiveInteger(subjectId, 'subjectId')
            return sortChapters(chaptersRef.current.filter(chapter => chapter.subject_id === normalizedSubjectId))
        },
        create: async (data: CreateSubjectChapterInput) => {
            if (IS_ELECTRON) return window.api.subjectChapters.create(data)
            const subjectId = assertPositiveInteger(data.subject_id, 'subject_id')
            assertSubjectExists(subjectsRef.current, subjectId)
            const { chapters, created } = createChapterRows(chaptersRef.current, subjectId, [data])
            commit(syncSubjectSummary(subjectsRef.current, chapters, subjectId), chapters)
            return created[0]!
        },
        bulkCreate: async (input: BulkSubjectChaptersInput) => {
            if (IS_ELECTRON) return window.api.subjectChapters.bulkCreate(input)
            const subjectId = assertPositiveInteger(input.subject_id, 'subject_id')
            assertSubjectExists(subjectsRef.current, subjectId)
            const { chapters, created } = createChapterRows(chaptersRef.current, subjectId, input.chapters)
            commit(syncSubjectSummary(subjectsRef.current, chapters, subjectId), chapters)
            return created
        },
        convertFromSummary: async (input: ConvertSubjectChaptersInput) => {
            if (IS_ELECTRON) return window.api.subjectChapters.convertFromSummary(input)
            const subjectId = assertPositiveInteger(input.subject_id, 'subject_id')
            assertSubjectExists(subjectsRef.current, subjectId)
            if (chaptersRef.current.some(chapter => chapter.subject_id === subjectId)) {
                throw new Error('Subject already has detailed chapters')
            }
            const normalized = normalizeChapterDrafts(input.chapters)
            if (!Number.isInteger(input.markCompletedCount) || input.markCompletedCount < 0) {
                throw new Error('markCompletedCount must be a non-negative integer')
            }
            if (input.markCompletedCount > normalized.length) {
                throw new Error('Cannot mark more chapters complete than were provided')
            }
            const { chapters, created } = createChapterRows(chaptersRef.current, subjectId, normalized, input.markCompletedCount)
            commit(syncSubjectSummary(subjectsRef.current, chapters, subjectId), chapters)
            return created
        },
        patch: async (id: number, patch: SubjectChapterPatch) => {
            if (IS_ELECTRON) return window.api.subjectChapters.patch(id, patch)
            const chapterId = assertPositiveInteger(id, 'chapter id')
            const existing = chaptersRef.current.find(chapter => chapter.id === chapterId)
            if (!existing) throw new Error('Chapter not found')
            const updated: SubjectChapter = {
                ...existing,
                ...(Object.prototype.hasOwnProperty.call(patch, 'title') ? { title: normalizeChapterTitle(patch.title) } : {}),
                ...(Object.prototype.hasOwnProperty.call(patch, 'notes') ? { notes: normalizeChapterNotes(patch.notes) } : {}),
                ...(Object.prototype.hasOwnProperty.call(patch, 'completed') ? { completed: normalizeCompleted(patch.completed) } : {}),
                updated_at: nowIso(),
            }
            const chapters = chaptersRef.current.map(chapter => chapter.id === chapterId ? updated : chapter)
            commit(syncSubjectSummary(subjectsRef.current, chapters, existing.subject_id), chapters)
            return updated
        },
        toggleCompleted: async (id: number, completed?: boolean) => {
            if (IS_ELECTRON) return window.api.subjectChapters.toggleCompleted(id, completed)
            const chapterId = assertPositiveInteger(id, 'chapter id')
            const existing = chaptersRef.current.find(chapter => chapter.id === chapterId)
            if (!existing) throw new Error('Chapter not found')
            const updated = {
                ...existing,
                completed: typeof completed === 'boolean' ? completed : !existing.completed,
                updated_at: nowIso(),
            }
            const chapters = chaptersRef.current.map(chapter => chapter.id === chapterId ? updated : chapter)
            commit(syncSubjectSummary(subjectsRef.current, chapters, existing.subject_id), chapters)
            return updated
        },
        reorder: async (subjectId: number, chapterIds: number[]) => {
            if (IS_ELECTRON) return window.api.subjectChapters.reorder(subjectId, chapterIds)
            const normalizedSubjectId = assertPositiveInteger(subjectId, 'subject id')
            assertSubjectExists(subjectsRef.current, normalizedSubjectId)
            const current = sortChapters(chaptersRef.current.filter(chapter => chapter.subject_id === normalizedSubjectId))
            if (chapterIds.length !== current.length || new Set(chapterIds).size !== chapterIds.length) {
                throw new Error('chapterIds must include each subject chapter exactly once')
            }
            const currentIds = new Set(current.map(chapter => chapter.id))
            if (!chapterIds.every(id => currentIds.has(assertPositiveInteger(id, 'chapter id')))) {
                throw new Error('chapterIds must include only chapters for this subject')
            }
            const updatedAt = nowIso()
            const order = new Map(chapterIds.map((id, index) => [id, index]))
            const chapters = chaptersRef.current.map(chapter => (
                chapter.subject_id === normalizedSubjectId
                    ? { ...chapter, sort_order: order.get(chapter.id)!, updated_at: updatedAt }
                    : chapter
            ))
            commit(subjectsRef.current, chapters)
            return sortChapters(chapters.filter(chapter => chapter.subject_id === normalizedSubjectId))
        },
        delete: async (id: number) => {
            if (IS_ELECTRON) {
                await window.api.subjectChapters.delete(id)
                return true
            }
            const chapterId = assertPositiveInteger(id, 'chapter id')
            const existing = chaptersRef.current.find(chapter => chapter.id === chapterId)
            if (!existing) throw new Error('Chapter not found')
            const before = chaptersRef.current.filter(chapter => chapter.subject_id === existing.subject_id)
            const chapters = chaptersRef.current.filter(chapter => chapter.id !== chapterId)
            clearTaskChapterLinks(new Set([chapterId]))
            const after = chapters.filter(chapter => chapter.subject_id === existing.subject_id)
            const subjects = after.length === 0
                ? subjectsRef.current.map(subject => (
                    subject.id === existing.subject_id
                        ? {
                            ...subject,
                            total_chapters: before.length,
                            completed_chapters: before.filter(chapter => chapter.completed).length,
                        }
                        : subject
                ))
                : syncSubjectSummary(subjectsRef.current, chapters, existing.subject_id)
            commit(subjects, chapters)
            return true
        },
        clearDetailedChapters: async (subjectId: number) => {
            if (IS_ELECTRON) return window.api.subjectChapters.clearDetailedChapters(subjectId)
            const normalizedSubjectId = assertPositiveInteger(subjectId, 'subject id')
            const existingSubject = assertSubjectExists(subjectsRef.current, normalizedSubjectId)
            const existing = chaptersRef.current.filter(chapter => chapter.subject_id === normalizedSubjectId)
            if (existing.length === 0) {
                return existingSubject
            }
            const total = existing.length
            const completed = existing.filter(chapter => chapter.completed).length
            const chapters = chaptersRef.current.filter(chapter => chapter.subject_id !== normalizedSubjectId)
            clearTaskChapterLinks(new Set(existing.map(chapter => chapter.id)))
            const subjects = subjectsRef.current.map(subject => (
                subject.id === normalizedSubjectId
                    ? { ...subject, total_chapters: total, completed_chapters: completed }
                    : subject
            ))
            commit(subjects, chapters)
            return subjects.find(subject => subject.id === normalizedSubjectId)!
        },
    }
}
