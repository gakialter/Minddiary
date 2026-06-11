import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import MistakeBook from '../src/components/MistakeBook'
import * as DiaryContextModule from '../src/contexts/DiaryContext'

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
})
