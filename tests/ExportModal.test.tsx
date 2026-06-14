import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ExportModal from '../src/components/ExportModal'

const diaryApi = vi.hoisted(() => ({
  entries: {
    getAll: vi.fn(),
    create: vi.fn(),
  },
  subjects: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  subjectChapters: {
    getBySubject: vi.fn(),
    bulkCreate: vi.fn(),
  },
  mistakes: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  exportUtil: {
    showSaveDialog: vi.fn(),
    writeFile: vi.fn(),
    toPDF: vi.fn(),
  },
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: () => diaryApi,
}))

describe('ExportModal JSON import', () => {
  it('preserves legacy subject summaries and remaps chapter and mistake subject ids', async () => {
    diaryApi.subjects.create
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 })
    diaryApi.subjects.update.mockResolvedValue({})
    diaryApi.subjectChapters.bulkCreate.mockResolvedValue([])
    diaryApi.entries.create.mockResolvedValue({ id: 201 })
    diaryApi.mistakes.create.mockResolvedValue({ id: 301 })
    diaryApi.mistakes.update.mockResolvedValue({})

    render(<ExportModal onClose={vi.fn()} />)

    const snapshot = {
      subjects: [
        { id: 1, name: 'Math', total_chapters: 5, completed_chapters: 3, color: '#0F766E' },
        { id: 2, name: 'Physics', total_chapters: 2, completed_chapters: 1, color: '#854D0E' },
      ],
      subject_chapters: [
        { id: 8, subject_id: 2, title: '第二章', notes: '后导入但排序靠后', completed: false, sort_order: 1 },
        { id: 7, subject_id: 2, title: '第一章', notes: '', completed: true, sort_order: 0 },
      ],
      entries: [
        { id: 4, date: '2026-06-14', title: 'Imported', content: 'content', mood: null },
      ],
      mistakes: [
        { id: 5, subject_id: 2, question: 'q', answer: 'a', notes: '', mastered: true },
      ],
    }
    const file = new File([JSON.stringify(snapshot)], 'snapshot.json', { type: 'application/json' })

    const importButton = screen.getByRole('button', { name: /导入 JSON/ })
    fireEvent.click(importButton)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/导入完成：2 个科目、2 个章节、1 篇日记、1 条错题/)).toBeInTheDocument()
    })

    expect(diaryApi.subjects.update).toHaveBeenCalledWith(101, {
      name: 'Math',
      color: '#0F766E',
      total_chapters: 5,
      completed_chapters: 3,
    })
    expect(diaryApi.subjectChapters.bulkCreate).toHaveBeenCalledWith({
      subject_id: 102,
      chapters: [
        { title: '第一章', notes: '', completed: true },
        { title: '第二章', notes: '后导入但排序靠后', completed: false },
      ],
    })
    expect(diaryApi.mistakes.create).toHaveBeenCalledWith(expect.objectContaining({
      subject_id: 102,
      question: 'q',
      answer: 'a',
    }))
    expect(diaryApi.mistakes.update).toHaveBeenCalledWith(301, { mastered: true })
  })
})
