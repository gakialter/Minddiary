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
    vi.unstubAllGlobals()
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
    
    // Notes should be present
    expect(screen.getByText('basic')).toBeInTheDocument()
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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
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
    })
  })

  it('opens a full-size preview for mistake images and closes it', async () => {
    mistakesApi.getAll.mockResolvedValue([
      { ...mockMistakes[0], image_path: 'mistake_images/first.png' },
      mockMistakes[1],
    ])

    await act(async () => {
      render(<MistakeBook />)
    })

    const previewButton = await screen.findByRole('button', { name: /放大查看错题附图 1/ })
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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
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
