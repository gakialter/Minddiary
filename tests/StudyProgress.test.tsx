import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudyProgress from '../src/components/StudyProgress'
import type { Mistake, PomodoroStat, Subject } from '../src/types'

const mocks = vi.hoisted(() => ({
  subjectsGetAll: vi.fn(),
  subjectsDelete: vi.fn(),
  pomodoroGetStats: vi.fn(),
  mistakesGetAll: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: () => ({
    subjects: {
      getAll: mocks.subjectsGetAll,
      delete: mocks.subjectsDelete,
    },
    pomodoro: {
      getStats: mocks.pomodoroGetStats,
    },
    mistakes: {
      getAll: mocks.mistakesGetAll,
    },
  }),
}))

vi.mock('../src/components/Toast', () => ({
  showToast: mocks.showToast,
}))

const DELETE_CONFIRM_MESSAGE = '确定要删除这个科目吗？关联的错题、专注记录和任务会保留，但将不再归属任何科目。'

const mathSubject: Subject = {
  id: 7,
  name: 'Math',
  color: '#0F766E',
  total_chapters: 10,
  completed_chapters: 4,
}

const pomodoroStats: PomodoroStat[] = [{
  subject_name: 'Math',
  color: '#0F766E',
  total_minutes: 50,
  session_count: 2,
}]

const mistakes: Mistake[] = [{
  id: 3,
  subject_id: 7,
  question: '1 + 1',
  answer: '2',
  notes: '',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  next_review_date: null,
  review_count: 0,
  created_at: '2026-06-07 09:00:00',
}]

describe('StudyProgress subject deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.subjectsGetAll.mockResolvedValue([mathSubject])
    mocks.subjectsDelete.mockResolvedValue(true)
    mocks.pomodoroGetStats.mockResolvedValue(pomodoroStats)
    mocks.mistakesGetAll.mockResolvedValue({ data: mistakes })
  })

  it('does not delete a subject when confirmation is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)

    render(<StudyProgress />)

    await screen.findByText('Math')
    fireEvent.click(screen.getByTitle('删除科目'))

    expect(window.confirm).toHaveBeenCalledWith(DELETE_CONFIRM_MESSAGE)
    expect(mocks.subjectsDelete).not.toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalledWith('科目已删除', 'success')
  })

  it('deletes the confirmed subject id and shows success feedback', async () => {
    mocks.subjectsGetAll
      .mockResolvedValueOnce([mathSubject])
      .mockResolvedValueOnce([])

    render(<StudyProgress />)

    await screen.findByText('Math')
    fireEvent.click(screen.getByTitle('删除科目'))

    expect(window.confirm).toHaveBeenCalledWith(DELETE_CONFIRM_MESSAGE)
    await waitFor(() => {
      expect(mocks.subjectsDelete).toHaveBeenCalledWith(7)
    })
    expect(mocks.showToast).toHaveBeenCalledWith('科目已删除', 'success')
  })

  it('shows failure feedback when confirmed subject deletion rejects', async () => {
    mocks.subjectsDelete.mockRejectedValue(new Error('delete failed'))

    render(<StudyProgress />)

    await screen.findByText('Math')
    fireEvent.click(screen.getByTitle('删除科目'))

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('删除失败', 'error')
    })
    expect(mocks.subjectsDelete).toHaveBeenCalledWith(7)
  })
})
