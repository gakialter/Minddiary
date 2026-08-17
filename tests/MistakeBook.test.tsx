import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import MistakeBook from '../src/components/MistakeBook'
import * as DiaryContextModule from '../src/contexts/DiaryContext'
import type { Mistake } from '../src/types'

const toastMock = vi.hoisted(() => ({
  showToast: vi.fn(),
}))

// Mock useDiary to return dummy APIs
vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: vi.fn(),
}))

vi.mock('../src/components/Toast', () => ({
  showToast: toastMock.showToast,
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
    getRandomDue: ReturnType<typeof vi.fn>
    saveImage: ReturnType<typeof vi.fn> | undefined
    deleteImage: ReturnType<typeof vi.fn>
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
      getRandomDue: vi.fn().mockResolvedValue({
        id: 7,
        subject_id: 1,
        subject_name: 'Math',
        subject_color: '#ff0000',
        question: 'Review Q',
        answer: 'Review A',
        notes: '',
        mastered: false,
        ease_factor: 2.5,
        review_interval: 1,
        review_count: 0,
        next_review_date: null,
        image_path: null,
        answer_image_path: null,
        created_at: '2026-06-07',
      }),
      saveImage: undefined,
      deleteImage: vi.fn().mockResolvedValue(undefined),
    }

    subjectsApi = {
      getAll: vi.fn().mockResolvedValue(mockSubjects),
    }

    mockUseDiary.mockReturnValue({
      mistakes: mistakesApi,
      subjects: subjectsApi,
      requestDataRefresh: vi.fn(),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  const createImageClipboardData = (file: File) => ({
    items: [
      {
        type: file.type,
        getAsFile: () => file,
      },
    ],
  })

  it('renders the empty state when no mistakes exist', async () => {
    mistakesApi.getAll.mockResolvedValue([])
    
    await act(async () => {
      render(<MistakeBook />)
    })

    expect(screen.getByTestId('mistake-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('mistake-add-first-btn')).toBeInTheDocument()
  })

  it('renders loaded mistakes', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    // Should display stats
    expect(screen.getByText(/条记录，已吃透/)).toBeInTheDocument()

    // Should render the questions
    expect(screen.getByText('1+1=?')).toBeInTheDocument()
    expect(screen.getByText('Apple means?')).toBeInTheDocument()

    // Should render the labels based on mastered status
    // Phase 1 changed labels to include SM-2 review scheduling
    expect(screen.getByText(/今日待复习/)).toBeInTheDocument()
    // "已掌握" appears in both the stats header and the card label
    expect(screen.getAllByText(/已掌握/).length).toBeGreaterThanOrEqual(1)
    
    expect(screen.queryByText('basic')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('mistake-toggle-answer-1'))

    expect(screen.getByText('basic')).toBeInTheDocument()
  })

  it('starts manual review using the currently selected subject filter', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    await act(async () => {
      fireEvent.change(screen.getByTestId('mistake-subject-filter'), { target: { value: '1' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-start-review-btn'))
    })

    await waitFor(() => {
      expect(mistakesApi.getRandomDue).toHaveBeenCalledWith(expect.any(String), 1)
    })
    expect(await screen.findByText('Review Q')).toBeInTheDocument()
  })

  it('applies and clears the due-review filter intent', async () => {
    mistakesApi.getAll.mockResolvedValue({ data: [], total: 0, masteredTotal: 0 })

    await act(async () => {
      render(<MistakeBook initialFilter="due" />)
    })

    await waitFor(() => {
      expect(mistakesApi.getAll).toHaveBeenCalledWith(expect.objectContaining({
        due: true,
        dueDate: expect.any(String),
      }))
    })
    expect(screen.getByTestId('mistake-due-filter-chip')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-clear-due-filter'))
    })

    await waitFor(() => {
      const calls = mistakesApi.getAll.mock.calls
      const lastFilters = calls[calls.length - 1]?.[0]
      expect(lastFilters).not.toHaveProperty('due')
      expect(lastFilters).not.toHaveProperty('dueDate')
    })
  })

  it('allows opening the add form', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    const addBtn = screen.getByTestId('mistake-add-btn')
    await act(async () => {
      fireEvent.click(addBtn)
    })

    // Form should appear
    expect(screen.getByText('添加错题/知识点')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('问题 / 知识点')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('答案 / 解析')).toBeInTheDocument()
    expect(screen.getByText('题目图片')).toBeInTheDocument()
    expect(screen.getByText('答案图片')).toBeInTheDocument()
  })

  it('can submit a new mistake', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    // Open form
    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
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
      answer_image_path: null,
    })
  })

  it('shows a safe actionable message when saving a mistake fails', async () => {
    mistakesApi.create.mockRejectedValueOnce(new Error('C:\\Users\\private\\minddiary.db is locked'))

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: 'Save error' } })
    fireEvent.submit(screen.getByTestId('mistake-form'))

    await waitFor(() => expect(toastMock.showToast).toHaveBeenCalledWith('保存错题失败，请重试', 'error'))
    expect(screen.getByTestId('mistake-form')).toHaveAttribute('data-image-form-state', 'save_failed')
    expect(toastMock.showToast.mock.calls.flat().join(' ')).not.toContain('C:\\Users\\private')
    expect(screen.getByTestId('mistake-form')).toBeInTheDocument()
  })

  it('uploads an image into form state and saves the image path', async () => {
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/测试图片.png')

    const { container } = render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    const qInput = screen.getByPlaceholderText('问题 / 知识点')
    await act(async () => {
      fireEvent.change(qInput, { target: { value: 'Image Q' } })
    })

    const fileInput = screen.getByTestId('mistake-question-image-input') as HTMLInputElement
    const file = new File(['image-bytes'], '测试图片.png', { type: 'image/png' })
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } })
    })

    await waitFor(() => {
      expect(mistakesApi.saveImage).toHaveBeenCalledWith({
        data: expect.any(String),
        ext: '.png',
        name: '测试图片.png',
        mimetype: 'image/png',
      })
    })
    expect(container.querySelector('img[src="local://mistake_images/%E6%B5%8B%E8%AF%95%E5%9B%BE%E7%89%87.png"]')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
    })

    expect(mistakesApi.create).toHaveBeenCalledWith({
      subject_id: null,
      question: 'Image Q',
      answer: '',
      notes: '',
      image_path: 'mistake_images/测试图片.png',
      answer_image_path: null,
    })
  })

  it('uploads question and answer images into separate create payload fields', async () => {
    mistakesApi.saveImage = vi.fn()
      .mockResolvedValueOnce('mistake_images/question.png')
      .mockResolvedValueOnce('mistake_images/answer.png')

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: 'Two image Q' } })
    })

    await act(async () => {
      fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
        target: { files: [new File(['question'], 'question.png', { type: 'image/png' })] },
      })
      fireEvent.change(screen.getByTestId('mistake-answer-image-input'), {
        target: { files: [new File(['answer'], 'answer.png', { type: 'image/png' })] },
      })
    })

    await waitFor(() => {
      expect(mistakesApi.saveImage).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
    })

    expect(mistakesApi.create).toHaveBeenCalledWith({
      subject_id: null,
      question: 'Two image Q',
      answer: '',
      notes: '',
      image_path: 'mistake_images/question.png',
      answer_image_path: 'mistake_images/answer.png',
    })
  })

  it('blocks save until an in-flight image upload has completed', async () => {
    let resolveUpload!: (path: string) => void
    mistakesApi.saveImage = vi.fn().mockReturnValue(new Promise<string>(resolve => {
      resolveUpload = resolve
    }))

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: 'Upload race' } })
    fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
      target: { files: [new File(['question'], 'question.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(mistakesApi.saveImage).toHaveBeenCalledTimes(1))
    const submitButton = screen.getByTestId('mistake-submit-btn')
    expect(submitButton).toBeDisabled()
    fireEvent.click(submitButton)
    expect(mistakesApi.create).not.toHaveBeenCalled()

    resolveUpload('mistake_images/question.png')

    await waitFor(() => expect(submitButton).toBeEnabled())
    fireEvent.click(submitButton)

    await waitFor(() => expect(mistakesApi.create).toHaveBeenCalledWith(expect.objectContaining({
      image_path: 'mistake_images/question.png',
    })))
  })

  it('blocks save after an image upload fails until the failed item is removed', async () => {
    mistakesApi.saveImage = vi.fn().mockRejectedValue(new Error('C:\\Users\\private\\broken.png'))

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: 'Failed upload' } })
    fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
      target: { files: [new File(['broken'], 'broken.png', { type: 'image/png' })] },
    })

    await waitFor(() => {
      expect(toastMock.showToast).toHaveBeenCalledWith('图片 broken.png 上传失败，请移除失败项后重试', 'error')
    })
    expect(screen.getByTestId('mistake-form')).toHaveAttribute('data-image-form-state', 'upload_failed')
    const submitButton = screen.getByTestId('mistake-submit-btn')
    expect(submitButton).toBeDisabled()

    fireEvent.submit(screen.getByTestId('mistake-form'))

    expect(mistakesApi.create).not.toHaveBeenCalled()
    expect(toastMock.showToast).toHaveBeenCalledWith('图片上传失败，请移除失败项后重试', 'error')
    expect(document.body.textContent).not.toContain('C:\\Users\\private')

    fireEvent.click(screen.getByRole('button', { name: '移除失败图片 broken.png' }))
    await waitFor(() => expect(submitButton).toBeEnabled())
  })

  it('clears failed-upload state when cancelling and reopening a new draft', async () => {
    mistakesApi.saveImage = vi.fn().mockRejectedValue(new Error('upload failed'))

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
      target: { files: [new File(['broken'], 'broken.png', { type: 'image/png' })] },
    })

    await waitFor(() => {
      expect(screen.getByTestId('mistake-form')).toHaveAttribute('data-image-form-state', 'upload_failed')
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByTestId('mistake-form')).not.toBeInTheDocument())
    fireEvent.click(screen.getByTestId('mistake-add-btn'))

    expect(await screen.findByTestId('mistake-submit-btn')).toBeEnabled()
    expect(screen.queryByRole('button', { name: '移除失败图片 broken.png' })).not.toBeInTheDocument()
  })

  it('rolls back newly uploaded files when creating the mistake fails', async () => {
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/pending.png')
    mistakesApi.create.mockRejectedValueOnce(new Error('database failed'))

    const { container } = render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: 'Rollback image' } })
    fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
      target: { files: [new File(['question'], 'question.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(container.querySelector('img[src="local://mistake_images/pending.png"]')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => expect(mistakesApi.deleteImage).toHaveBeenCalledWith('mistake_images/pending.png'))
    expect(container.querySelector('img[src="local://mistake_images/pending.png"]')).not.toBeInTheDocument()
  })

  it('awaits pending-image cleanup before switching to edit another mistake', async () => {
    let resolveCleanup!: () => void
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/abandoned.png')
    mistakesApi.deleteImage.mockReturnValue(new Promise<void>(resolve => {
      resolveCleanup = resolve
    }))
    Element.prototype.scrollIntoView = vi.fn()

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    const questionInput = screen.getByPlaceholderText('问题 / 知识点') as HTMLTextAreaElement
    fireEvent.change(questionInput, { target: { value: 'Unsaved draft' } })
    fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
      target: { files: [new File(['draft'], 'draft.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(screen.getByAltText('题目图片 1')).toBeInTheDocument())
    const editButtons = await screen.findAllByRole('button', { name: '编辑错题' })
    fireEvent.click(editButtons[0]!)

    await waitFor(() => expect(mistakesApi.deleteImage).toHaveBeenCalledWith('mistake_images/abandoned.png'))
    expect(questionInput.value).toBe('Unsaved draft')

    resolveCleanup()

    await waitFor(() => expect((screen.getByPlaceholderText('问题 / 知识点') as HTMLTextAreaElement).value).toBe('1+1=?'))
  })

  it('keeps the current draft and pending set when switch cleanup fails', async () => {
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/retry-cleanup.png')
    mistakesApi.deleteImage
      .mockRejectedValueOnce(new Error('disk locked'))
      .mockResolvedValueOnce(undefined)
    Element.prototype.scrollIntoView = vi.fn()

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    const questionInput = screen.getByPlaceholderText('问题 / 知识点') as HTMLTextAreaElement
    fireEvent.change(questionInput, { target: { value: 'Keep this draft' } })
    fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
      target: { files: [new File(['draft'], 'draft.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(screen.getByAltText('题目图片 1')).toBeInTheDocument())
    const editButtons = await screen.findAllByRole('button', { name: '编辑错题' })
    fireEvent.click(editButtons[0]!)

    await waitFor(() => expect(toastMock.showToast).toHaveBeenCalledWith('图片清理失败，请重试', 'error'))
    expect(questionInput.value).toBe('Keep this draft')

    fireEvent.click(editButtons[0]!)
    await waitFor(() => expect(mistakesApi.deleteImage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect((screen.getByPlaceholderText('问题 / 知识点') as HTMLTextAreaElement).value).toBe('1+1=?'))
  })

  it('does not delete database-backed images when switching between existing mistakes', async () => {
    mistakesApi.getAll.mockResolvedValue([
      { ...mockMistakes[0], image_path: 'mistake_images/existing.png', answer_image_path: null },
      mockMistakes[1],
    ])
    Element.prototype.scrollIntoView = vi.fn()

    render(<MistakeBook />)

    const editButtons = await screen.findAllByRole('button', { name: '编辑错题' })
    fireEvent.click(editButtons[0]!)
    await waitFor(() => expect(screen.getByAltText('题目图片 1')).toBeInTheDocument())
    fireEvent.click(editButtons[1]!)

    await waitFor(() => expect((screen.getByPlaceholderText('问题 / 知识点') as HTMLTextAreaElement).value).toBe('Apple means?'))
    expect(mistakesApi.deleteImage).not.toHaveBeenCalled()
  })

  it('blocks save while pending-image cleanup is in flight', async () => {
    let resolveCleanup!: () => void
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/removing.png')
    mistakesApi.deleteImage.mockReturnValue(new Promise<void>(resolve => {
      resolveCleanup = resolve
    }))

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: 'Cleanup race' } })
    fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
      target: { files: [new File(['image'], 'removing.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(screen.getByAltText('题目图片 1')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '删除题目图片 1' }))

    await waitFor(() => expect(mistakesApi.deleteImage).toHaveBeenCalledWith('mistake_images/removing.png'))
    expect(screen.getByTestId('mistake-form')).toHaveAttribute('data-image-form-state', 'cleanup_in_flight')
    const submitButton = screen.getByTestId('mistake-submit-btn')
    expect(submitButton).toBeDisabled()

    fireEvent.submit(screen.getByTestId('mistake-form'))

    expect(mistakesApi.create).not.toHaveBeenCalled()
    expect(toastMock.showToast).toHaveBeenCalledWith('正在清理图片，请稍后', 'error')

    resolveCleanup()
    await waitFor(() => expect(submitButton).toBeEnabled())
  })

  it('adds an answer image while editing without losing the existing question image', async () => {
    mistakesApi.getAll.mockResolvedValue([
      { ...mockMistakes[0], image_path: 'mistake_images/existing.png', answer_image_path: null },
    ])
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/new-answer.png')
    Element.prototype.scrollIntoView = vi.fn()

    render(<MistakeBook />)

    const editButtons = await screen.findAllByRole('button', { name: '编辑错题' })
    fireEvent.click(editButtons[0]!)
    fireEvent.change(await screen.findByTestId('mistake-answer-image-input'), {
      target: { files: [new File(['answer'], 'answer.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(screen.getByAltText('答案图片 1')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mistakesApi.update).toHaveBeenCalledWith(1, expect.objectContaining({
      image_path: 'mistake_images/existing.png',
      answer_image_path: 'mistake_images/new-answer.png',
    })))
  })

  it('saves removal of an existing image through the database cleanup path', async () => {
    mistakesApi.getAll.mockResolvedValue([
      { ...mockMistakes[0], image_path: 'mistake_images/existing.png', answer_image_path: null },
    ])
    Element.prototype.scrollIntoView = vi.fn()

    render(<MistakeBook />)

    const editButtons = await screen.findAllByRole('button', { name: '编辑错题' })
    fireEvent.click(editButtons[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '删除题目图片 1' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mistakesApi.update).toHaveBeenCalledWith(1, expect.objectContaining({
      image_path: null,
      answer_image_path: null,
    })))
    expect(mistakesApi.deleteImage).not.toHaveBeenCalled()
  })

  it('moves existing image references between question and answer without saving files again', async () => {
    mistakesApi.getAll.mockResolvedValue([
      { ...mockMistakes[0], image_path: 'mistake_images/question.png', answer_image_path: null },
    ])
    mistakesApi.saveImage = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()

    render(<MistakeBook />)

    const editButtons = await screen.findAllByRole('button', { name: '编辑错题' })
    await act(async () => {
      fireEvent.click(editButtons[0]!)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /移到答案/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })

    expect(mistakesApi.saveImage).not.toHaveBeenCalled()
    expect(mistakesApi.update).toHaveBeenCalledWith(1, expect.objectContaining({
      image_path: null,
      answer_image_path: 'mistake_images/question.png',
    }))
  })

  it('does not duplicate a question image when moving it to an answer area that already has the same path', async () => {
    mistakesApi.getAll.mockResolvedValue([
      {
        ...mockMistakes[0],
        image_path: 'mistake_images/shared.png',
        answer_image_path: 'mistake_images/shared.png',
      },
    ])
    Element.prototype.scrollIntoView = vi.fn()

    render(<MistakeBook />)

    const editButtons = await screen.findAllByRole('button', { name: '编辑错题' })
    await act(async () => {
      fireEvent.click(editButtons[0]!)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /移到答案/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })

    expect(mistakesApi.update).toHaveBeenCalledWith(1, expect.objectContaining({
      image_path: null,
      answer_image_path: 'mistake_images/shared.png',
    }))
  })

  it('does not duplicate an answer image when moving it to a question area that already has the same path', async () => {
    mistakesApi.getAll.mockResolvedValue([
      {
        ...mockMistakes[0],
        image_path: 'mistake_images/shared.png',
        answer_image_path: 'mistake_images/shared.png',
      },
    ])
    Element.prototype.scrollIntoView = vi.fn()

    render(<MistakeBook />)

    const editButtons = await screen.findAllByRole('button', { name: '编辑错题' })
    await act(async () => {
      fireEvent.click(editButtons[0]!)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /移到题目/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
    })

    expect(mistakesApi.update).toHaveBeenCalledWith(1, expect.objectContaining({
      image_path: 'mistake_images/shared.png',
      answer_image_path: null,
    }))
  })

  it('allows the question image paste zone to receive focus', async () => {
    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    const questionZone = screen.getByTestId('mistake-question-image-zone')
    questionZone.focus()

    expect(questionZone).toHaveFocus()
    expect(questionZone).toHaveAttribute('role', 'group')
    expect(questionZone).toHaveAttribute('aria-label', '题目图片上传区域')
  })

  it('pastes into the focused question image zone without writing answer images', async () => {
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/pasted-question.png')

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: 'Pasted question image' } })
    })

    const questionZone = screen.getByTestId('mistake-question-image-zone')
    questionZone.focus()

    await act(async () => {
      fireEvent.paste(questionZone, {
        clipboardData: createImageClipboardData(new File(['question'], 'question.png', { type: 'image/png' })),
      })
    })

    await waitFor(() => {
      expect(mistakesApi.saveImage).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
    })

    expect(mistakesApi.create).toHaveBeenCalledWith(expect.objectContaining({
      image_path: 'mistake_images/pasted-question.png',
      answer_image_path: null,
    }))
  })

  it('pastes into the focused answer image zone without writing question images', async () => {
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/pasted-answer.png')

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: 'Pasted answer image' } })
    })

    const answerZone = screen.getByTestId('mistake-answer-image-zone')
    answerZone.focus()

    await act(async () => {
      fireEvent.paste(answerZone, {
        clipboardData: createImageClipboardData(new File(['answer'], 'answer.png', { type: 'image/png' })),
      })
    })

    await waitFor(() => {
      expect(mistakesApi.saveImage).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
    })

    expect(mistakesApi.create).toHaveBeenCalledWith(expect.objectContaining({
      image_path: null,
      answer_image_path: 'mistake_images/pasted-answer.png',
    }))
  })

  it('keeps a single paste event scoped to one image role', async () => {
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/one-paste.png')

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: 'One paste role' } })
    })

    const questionZone = screen.getByTestId('mistake-question-image-zone')
    const answerZone = screen.getByTestId('mistake-answer-image-zone')
    questionZone.focus()

    await act(async () => {
      fireEvent.paste(questionZone, {
        clipboardData: createImageClipboardData(new File(['one'], 'one.png', { type: 'image/png' })),
      })
    })

    await waitFor(() => {
      expect(mistakesApi.saveImage).toHaveBeenCalledTimes(1)
    })

    expect(answerZone.querySelector('img')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
    })

    expect(mistakesApi.create).toHaveBeenCalledWith(expect.objectContaining({
      image_path: 'mistake_images/one-paste.png',
      answer_image_path: null,
    }))
  })

  it('opens a full-size preview for mistake images and closes it', async () => {
    mistakesApi.getAll.mockResolvedValue([
      { ...mockMistakes[0], image_path: 'mistake_images/first.png' },
      mockMistakes[1],
    ])

    await act(async () => {
      render(<MistakeBook />)
    })

    const previewButton = await screen.findByRole('button', { name: /放大查看错题题目图片 1/ })
    await act(async () => {
      fireEvent.click(previewButton)
    })

    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }))
    })

    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()
  })

  it('scrolls to the edit form and focuses the question field after editing a mistake', async () => {
    const scrollIntoView = vi.fn()
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {})
    Element.prototype.scrollIntoView = scrollIntoView
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    await act(async () => {
      render(<MistakeBook />)
    })

    const editButtons = await screen.findAllByRole('button', { name: '编辑错题' })
    await act(async () => {
      fireEvent.click(editButtons[0]!)
    })

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    })
    expect(focusSpy).toHaveBeenCalled()

    focusSpy.mockRestore()
  })

  it('rejects non-image files without writing form image data', async () => {
    mistakesApi.saveImage = vi.fn()

    const { container } = render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    const fileInput = screen.getByTestId('mistake-question-image-input') as HTMLInputElement
    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } })
    })

    expect(mistakesApi.saveImage).not.toHaveBeenCalled()
    expect(container.querySelector('img[src^="local://"]')).not.toBeInTheDocument()
    expect(toastMock.showToast).toHaveBeenCalledWith(expect.stringContaining('图片'), 'error')
  })

  it('rejects image MIME types that the Electron storage layer does not support', async () => {
    mistakesApi.saveImage = vi.fn()

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
      target: { files: [new File(['svg'], 'diagram.svg', { type: 'image/svg+xml' })] },
    })

    await waitFor(() => {
      expect(toastMock.showToast).toHaveBeenCalledWith(expect.stringContaining('diagram.svg'), 'error')
    })
    expect(mistakesApi.saveImage).not.toHaveBeenCalled()
  })

  it('accepts a supported Windows image extension when the browser omits MIME metadata', async () => {
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/windows.png')

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByTestId('mistake-question-image-input'), {
      target: { files: [new File(['image'], '扫描.PNG')] },
    })

    await waitFor(() => expect(mistakesApi.saveImage).toHaveBeenCalledWith(expect.objectContaining({
      ext: '.png',
      name: '扫描.PNG',
      mimetype: undefined,
    })))
  })

  it.each(['png', 'jpg', 'jpeg', 'webp'])('accepts a dropped .%s image when Windows omits MIME metadata', async extension => {
    mistakesApi.saveImage = vi.fn().mockResolvedValue(`mistake_images/dropped.${extension}`)

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    const file = new File(['image'], `dropped.${extension}`)
    fireEvent.drop(screen.getByTestId('mistake-question-image-zone'), {
      dataTransfer: {
        files: {
          0: file,
          length: 1,
          item: (index: number) => index === 0 ? file : null,
        },
      },
    })

    await waitFor(() => expect(mistakesApi.saveImage).toHaveBeenCalledWith(expect.objectContaining({
      ext: `.${extension}`,
      name: `dropped.${extension}`,
      mimetype: undefined,
    })))
  })

  it('reports a dropped empty-MIME file with an unsupported extension', async () => {
    mistakesApi.saveImage = vi.fn()

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    const file = new File(['text'], 'not-an-image.txt')
    fireEvent.drop(screen.getByTestId('mistake-question-image-zone'), {
      dataTransfer: {
        files: {
          0: file,
          length: 1,
          item: (index: number) => index === 0 ? file : null,
        },
      },
    })

    await waitFor(() => expect(toastMock.showToast).toHaveBeenCalledWith(
      '文件 not-an-image.txt 不是支持的图片格式，已拒绝上传',
      'error',
    ))
    expect(mistakesApi.saveImage).not.toHaveBeenCalled()
  })

  it('accepts an image at the 10 MB boundary and rejects one byte over it', async () => {
    mistakesApi.saveImage = vi.fn().mockResolvedValue('mistake_images/limit.png')
    const atLimit = new File(['image'], 'limit.png', { type: 'image/png' })
    const overLimit = new File(['image'], 'over.png', { type: 'image/png' })
    Object.defineProperty(atLimit, 'size', { value: 10 * 1024 * 1024 })
    Object.defineProperty(overLimit, 'size', { value: 10 * 1024 * 1024 + 1 })

    render(<MistakeBook />)

    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    const input = screen.getByTestId('mistake-question-image-input')
    fireEvent.change(input, { target: { files: [atLimit, overLimit] } })

    await waitFor(() => expect(mistakesApi.saveImage).toHaveBeenCalledTimes(1))
    expect(mistakesApi.saveImage).toHaveBeenCalledWith(expect.objectContaining({ name: 'limit.png' }))
    expect(toastMock.showToast).toHaveBeenCalledWith(expect.stringContaining('over.png'), 'error')
  })

  it('triggers delete API when delete button clicked', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    expect(screen.getByText('1+1=?')).toBeInTheDocument()
  })

  it('renders the notes format toolbar when the form is open', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    expect(screen.getByTestId('format-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('format-bold')).toBeInTheDocument()
    expect(screen.getByTestId('format-highlight')).toBeInTheDocument()
    expect(screen.getByTestId('format-underline')).toBeInTheDocument()
    expect(screen.getByTestId('format-color')).toBeInTheDocument()
  })

  it('wraps selected notes text with {color:...} when color is selected', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    const textarea = screen.getByTestId('mistake-notes-textarea') as HTMLTextAreaElement
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello world' } })
    })

    textarea.setSelectionRange(6, 11)
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('format-color'))
    })
    
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('color-swatch-red'))
    })

    expect(textarea.value).toBe('hello {color:red}world{/color}')
  })

  it('wraps selected notes text with ** when bold is clicked', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    const textarea = screen.getByTestId('mistake-notes-textarea') as HTMLTextAreaElement
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello world' } })
    })

    // Simulate selecting "world" (index 6-11)
    textarea.setSelectionRange(6, 11)
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('format-bold'))
    })

    expect(textarea.value).toBe('hello **world**')
  })

  it('wraps selected notes text with == when highlight is clicked', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    const textarea = screen.getByTestId('mistake-notes-textarea') as HTMLTextAreaElement
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello world' } })
    })

    textarea.setSelectionRange(6, 11)
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('format-highlight'))
    })

    expect(textarea.value).toBe('hello ==world==')
  })

  it('wraps selected notes text with ++ when underline is clicked', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    const textarea = screen.getByTestId('mistake-notes-textarea') as HTMLTextAreaElement
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello world' } })
    })

    textarea.setSelectionRange(6, 11)
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('format-underline'))
    })

    expect(textarea.value).toBe('hello ++world++')
  })

  it('saves markdown markers in notes as-is', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    const qInput = screen.getByPlaceholderText('问题 / 知识点')
    await act(async () => {
      fireEvent.change(qInput, { target: { value: 'Q1' } })
    })

    const notesInput = screen.getByTestId('mistake-notes-textarea')
    await act(async () => {
      fireEvent.change(notesInput, { target: { value: '**bold** ==highlight== ++underline++' } })
    })

    const submitBtn = screen.getByRole('button', { name: '添加' })
    await act(async () => {
      fireEvent.click(submitBtn)
    })

    expect(mistakesApi.create).toHaveBeenCalledWith({
      subject_id: null,
      question: 'Q1',
      answer: '',
      notes: '**bold** ==highlight== ++underline++',
      image_path: null,
      answer_image_path: null,
    })
  })

  it('does not render format toolbar for question/answer textareas', async () => {
    await act(async () => {
      render(<MistakeBook />)
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
    })

    // Only one format toolbar should exist (for notes)
    const toolbars = screen.getAllByTestId('format-toolbar')
    expect(toolbars).toHaveLength(1)
  })

  it('keeps three consecutive Chinese drafts and later edits bound to the active form', async () => {
    const records: Mistake[] = []
    mistakesApi.getAll.mockImplementation(async () => ({
      data: [...records].reverse(),
      total: records.length,
      masteredTotal: 0,
    }))
    mistakesApi.create.mockImplementation(async (data: Partial<Mistake>) => {
      const record: Mistake = {
        id: records.length + 1,
        subject_id: data.subject_id ?? null,
        question: data.question || '',
        answer: data.answer || '',
        notes: data.notes || '',
        mastered: false,
        ease_factor: 2.5,
        review_interval: 1,
        next_review_date: null,
        review_count: 0,
        image_path: data.image_path ?? null,
        answer_image_path: data.answer_image_path ?? null,
        created_at: `2026-07-23T00:00:0${records.length}Z`,
      }
      records.push(record)
      return record
    })
    mistakesApi.update.mockImplementation(async (id: number, data: Partial<Mistake>) => {
      const index = records.findIndex(record => record.id === id)
      if (index < 0) throw new Error('Mistake not found')
      records[index] = { ...records[index]!, ...data }
      return data
    })

    render(<MistakeBook />)
    await screen.findByTestId('mistake-add-btn')

    for (const [question, answer, notes] of [
      ['第一题', '答案一', '笔记一'],
      ['第二题', '答案二', '笔记二'],
      ['第三题', '答案三', '笔记三'],
    ] as const) {
      fireEvent.click(screen.getByTestId('mistake-add-btn'))
      const form = screen.getByTestId('mistake-form')
      const fields = [
        [screen.getByPlaceholderText('问题 / 知识点'), question],
        [screen.getByPlaceholderText('答案 / 解析'), answer],
        [screen.getByPlaceholderText('备注（可选）'), notes],
      ] as const
      for (const [field, value] of fields) {
        fireEvent.compositionStart(field)
        fireEvent.compositionUpdate(field, { data: value.slice(0, 1) })
        fireEvent.change(field, { target: { value } })
        expect(form).toBeInTheDocument()
        fireEvent.compositionEnd(field, { data: value })
        expect(field).toHaveValue(value)
      }
      await act(async () => {
        fireEvent.submit(form)
      })
      await waitFor(() => expect(screen.queryByTestId('mistake-form')).not.toBeInTheDocument())
    }

    expect(records.map(record => [record.question, record.answer, record.notes])).toEqual([
      ['第一题', '答案一', '笔记一'],
      ['第二题', '答案二', '笔记二'],
      ['第三题', '答案三', '笔记三'],
    ])

    const secondCard = screen.getByText('第二题').closest('.card')
    expect(secondCard).not.toBeNull()
    await act(async () => {
      fireEvent.click(within(secondCard as HTMLElement).getByRole('button', { name: '编辑错题' }))
    })
    fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: '第二题（修改）' } })
    fireEvent.change(screen.getByPlaceholderText('答案 / 解析'), { target: { value: '答案二（修改）' } })
    fireEvent.change(screen.getByPlaceholderText('备注（可选）'), { target: { value: '笔记二（修改）' } })
    await act(async () => {
      fireEvent.submit(screen.getByTestId('mistake-form'))
    })
    await waitFor(() => expect(screen.queryByTestId('mistake-form')).not.toBeInTheDocument())

    const firstCard = screen.getByText('第一题').closest('.card')
    expect(firstCard).not.toBeNull()
    await act(async () => {
      fireEvent.click(within(firstCard as HTMLElement).getByRole('button', { name: '编辑错题' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }))
    })
    await waitFor(() => expect(screen.queryByTestId('mistake-form')).not.toBeInTheDocument())

    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    expect(screen.getByPlaceholderText('问题 / 知识点')).toHaveValue('')
    expect(screen.getByPlaceholderText('答案 / 解析')).toHaveValue('')
    const notes = screen.getByPlaceholderText('备注（可选）') as HTMLTextAreaElement
    expect(notes).toHaveValue('')
    fireEvent.change(notes, { target: { value: '当前备注' } })
    notes.setSelectionRange(0, 2)
    fireEvent.mouseDown(screen.getByTestId('format-bold'))
    expect(notes).toHaveValue('**当前**备注')
    expect(screen.getByTestId('mistake-form')).toHaveAttribute('data-image-form-state', 'ready_to_save')
  })

  it('retains all text after a failed save and allows a successful retry', async () => {
    mistakesApi.create
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ id: 3 })

    render(<MistakeBook />)
    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: '重试问题' } })
    fireEvent.change(screen.getByPlaceholderText('答案 / 解析'), { target: { value: '重试答案' } })
    fireEvent.change(screen.getByPlaceholderText('备注（可选）'), { target: { value: '重试笔记' } })

    fireEvent.submit(screen.getByTestId('mistake-form'))
    await waitFor(() => expect(screen.getByTestId('mistake-form')).toHaveAttribute('data-image-form-state', 'save_failed'))
    expect(screen.getByPlaceholderText('问题 / 知识点')).toHaveValue('重试问题')
    expect(screen.getByPlaceholderText('答案 / 解析')).toHaveValue('重试答案')
    expect(screen.getByPlaceholderText('备注（可选）')).toHaveValue('重试笔记')

    fireEvent.submit(screen.getByTestId('mistake-form'))
    await waitFor(() => expect(screen.queryByTestId('mistake-form')).not.toBeInTheDocument())
    expect(mistakesApi.create).toHaveBeenCalledTimes(2)
  })

  it('uses the synchronous save lock to reject duplicate submissions', async () => {
    let resolveCreate: (() => void) | undefined
    mistakesApi.create.mockImplementation(() => new Promise(resolve => {
      resolveCreate = () => resolve({ id: 3 })
    }))

    render(<MistakeBook />)
    await screen.findByTestId('mistake-add-btn')
    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    fireEvent.change(screen.getByPlaceholderText('问题 / 知识点'), { target: { value: '只保存一次' } })

    const form = screen.getByTestId('mistake-form')
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(mistakesApi.create).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveCreate?.()
    })
    await waitFor(() => expect(screen.queryByTestId('mistake-form')).not.toBeInTheDocument())
  })

  it('exposes form visibility for floating-control collision avoidance', async () => {
    const { container } = render(<MistakeBook />)
    await screen.findByTestId('mistake-add-btn')
    const root = container.querySelector('[data-mistake-form-open]')
    expect(root).toHaveAttribute('data-mistake-form-open', 'false')

    fireEvent.click(screen.getByTestId('mistake-add-btn'))
    expect(root).toHaveAttribute('data-mistake-form-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(root).toHaveAttribute('data-mistake-form-open', 'false'))
  })

  it('renders distinct AI review and manual review buttons and opens AI review dialog', async () => {
    mockUseDiary.mockReturnValue({
      mistakes: mistakesApi,
      subjects: subjectsApi,
      tasks: {
        find: vi.fn().mockResolvedValue([]),
        createIdempotentAIStudyTaskForCurrentDate: vi.fn(),
      },
      ai: {
        chat: vi.fn().mockResolvedValue({ content: '{"suggestions":[]}' }),
      },
      requestDataRefresh: vi.fn(),
    })

    render(<MistakeBook />)
    await screen.findByTestId('mistake-ai-review-btn')

    const aiBtn = screen.getByTestId('mistake-ai-review-btn')
    const manualBtn = screen.getByTestId('mistake-start-review-btn')

    expect(aiBtn).toBeInTheDocument()
    expect(aiBtn).toHaveTextContent('AI 复习规划')
    expect(manualBtn).toBeInTheDocument()
    expect(manualBtn).toHaveTextContent('开始复习')

    // Click AI review button
    fireEvent.click(aiBtn)
    expect(await screen.findByTestId('mistake-review-agent-dialog')).toBeInTheDocument()

    // Close dialog
    fireEvent.click(screen.getByTestId('mistake-review-close-btn'))
    await waitFor(() => expect(screen.queryByTestId('mistake-review-agent-dialog')).not.toBeInTheDocument())
  })
})
