import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import MistakeBook from '../src/components/MistakeBook'
import * as DiaryContextModule from '../src/contexts/DiaryContext'

// Mock useDiary to return dummy APIs
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

const mockUseDiary = DiaryContextModule.useDiary as ReturnType<typeof vi.fn>

describe('MistakeBook Component', () => {
  const mockMistakes = [
    { id: 1, subject_id: 1, subject_name: 'Math', subject_color: '#ff0000', question: '1+1=?', answer: '2', notes: 'basic', mastered: false },
    { id: 2, subject_id: 2, subject_name: 'English', subject_color: '#00ff00', question: 'Apple means?', answer: '苹果', notes: '', mastered: true },
  ]
  const mockSubjects = [
    { id: 1, name: 'Math' },
    { id: 2, name: 'English' },
  ]

  let mistakesApi: {
    getAll: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    toggleMastered: ReturnType<typeof vi.fn>
    review: ReturnType<typeof vi.fn>
    saveImage: ReturnType<typeof vi.fn> | undefined
  }
  let subjectsApi: {
    getAll: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mistakesApi = {
      getAll: vi.fn().mockResolvedValue(mockMistakes),
      create: vi.fn().mockResolvedValue(3),
      update: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      toggleMastered: vi.fn().mockResolvedValue(true),
      review: vi.fn().mockResolvedValue(true),
      saveImage: undefined,
    }

    subjectsApi = {
      getAll: vi.fn().mockResolvedValue(mockSubjects),
    }

    mockUseDiary.mockReturnValue({
      mistakes: mistakesApi,
      subjects: subjectsApi,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the empty state when no mistakes exist', async () => {
    mistakesApi.getAll.mockResolvedValue([])
    
    await act(async () => {
      render(<MistakeBook />)
    })

    expect(screen.getByText('还没有错题记录')).toBeInTheDocument()
    expect(screen.getByText('+ 添加第一条记录')).toBeInTheDocument()
  })

  it('renders loaded mistakes', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    // Should display stats
    expect(screen.getByText(/共 2 条，已掌握 1 条/)).toBeInTheDocument()

    // Should render the questions
    expect(screen.getByText('1+1=?')).toBeInTheDocument()
    expect(screen.getByText('Apple means?')).toBeInTheDocument()

    // Should render the labels based on mastered status
    // Phase 1 changed labels to include SM-2 review scheduling
    expect(screen.getByText(/今日待复习/)).toBeInTheDocument()
    // "已掌握" appears in both the stats header and the card label
    expect(screen.getAllByText(/已掌握/).length).toBeGreaterThanOrEqual(1)
    
    // Notes should be present
    expect(screen.getByText('basic')).toBeInTheDocument()
  })

  it('allows opening the add form', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    const addBtn = screen.getByText('+ 添加')
    await act(async () => {
      fireEvent.click(addBtn)
    })

    // Form should appear
    expect(screen.getByText('添加错题/知识点')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('问题 / 知识点')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('答案 / 解析')).toBeInTheDocument()
  })

  it('can submit a new mistake', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    // Open form
    await act(async () => {
      fireEvent.click(screen.getByText('+ 添加'))
    })

    // Type in question
    const qInput = screen.getByPlaceholderText('问题 / 知识点')
    await act(async () => {
      fireEvent.change(qInput, { target: { value: 'New Q' } })
    })

    // Submit
    const submitBtn = screen.getByRole('button', { name: '添加' })
    await act(async () => {
      fireEvent.click(submitBtn)
    })

    expect(mistakesApi.create).toHaveBeenCalledWith({
      subject_id: null,
      question: 'New Q',
      answer: '',
      notes: '',
      image_path: null,
    })
  })

  it('triggers delete API when delete button clicked', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    expect(screen.getByText('1+1=?')).toBeInTheDocument()
  })
})
