import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  vi.resetAllMocks()
})

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
    expect(importButton).toHaveFocus()
  })
})

describe('ExportModal keyboard lifecycle', () => {
  function renderWithTrigger() {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open export</button>
          <input aria-label="Background diary title" />
          {open && <ExportModal onClose={() => setOpen(false)} />}
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open export' })
    trigger.focus()
    fireEvent.click(trigger)
    return { trigger }
  }

  it('moves focus to a visible control when opened', () => {
    renderWithTrigger()

    expect(screen.getByRole('button', { name: /关闭导出|×/ })).toHaveFocus()
  })

  it('keeps Tab and Shift+Tab inside the modal', () => {
    renderWithTrigger()
    const first = screen.getByRole('button', { name: /关闭导出|×/ })
    const last = screen.getByRole('button', { name: /导入 JSON/ })

    last.focus()
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    window.dispatchEvent(forward)
    expect(forward.defaultPrevented).toBe(true)
    expect(first).toHaveFocus()

    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(backward)
    expect(backward.defaultPrevented).toBe(true)
    expect(last).toHaveFocus()
  })

  it('closes on Escape and restores focus to the trigger', () => {
    const { trigger } = renderWithTrigger()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByText('导出数据')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('isolates the background from focus while open', () => {
    renderWithTrigger()
    const background = screen.getByRole('textbox', { name: 'Background diary title' })

    expect(background.inert).toBe(true)
    background.focus()
    expect(getCloseButton()).toHaveFocus()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function configureExportApis() {
  diaryApi.entries.getAll.mockResolvedValue([{ date: '2026-10-08', title: 'Synthetic', content: 'Synthetic export fixture' }])
  diaryApi.subjects.getAll.mockResolvedValue([])
  diaryApi.mistakes.getAll.mockResolvedValue({ data: [] })
}

function getCloseButton() {
  return screen.getByRole('button', { name: /关闭导出|×/ })
}

function getBackdrop() {
  return document.querySelector('[style*="position: fixed"]') as HTMLElement
}

describe('ExportModal pending export policy', () => {
  it.each(['entries', 'subjects', 'save dialog', 'PDF generation', 'file write'] as const)(
    'blocks every close path, format changes, and duplicate export during %s', async stage => {
      configureExportApis()
      const close = vi.fn()
      const entries = deferred<Array<{ date: string; title: string; content: string }>>()
      const subjects = deferred<never[]>()
      const saveDialog = deferred<string | null>()
      const pdf = deferred<void>()
      const write = deferred<void>()

      if (stage === 'entries') diaryApi.entries.getAll.mockReturnValue(entries.promise)
      if (stage === 'subjects') diaryApi.subjects.getAll.mockReturnValue(subjects.promise)
      if (stage === 'save dialog') diaryApi.exportUtil.showSaveDialog.mockReturnValue(saveDialog.promise)
      if (stage === 'PDF generation') {
        diaryApi.exportUtil.showSaveDialog.mockResolvedValue('/tmp/synthetic.pdf')
        diaryApi.exportUtil.toPDF.mockReturnValue(pdf.promise)
      }
      if (stage === 'file write') {
        diaryApi.exportUtil.showSaveDialog.mockResolvedValue('/tmp/synthetic.md')
        diaryApi.exportUtil.writeFile.mockReturnValue(write.promise)
      }

      render(<ExportModal onClose={close} />)
      const markdown = document.querySelector('input[name="export-format"][value="markdown"]') as HTMLInputElement
      if (stage === 'file write') fireEvent.click(markdown)

      const exportButton = screen.getByRole('button', { name: '导出文件' })
      fireEvent.click(exportButton)

      if (stage === 'subjects') await waitFor(() => expect(diaryApi.subjects.getAll).toHaveBeenCalled())
      if (stage === 'save dialog') await waitFor(() => expect(diaryApi.exportUtil.showSaveDialog).toHaveBeenCalled())
      if (stage === 'PDF generation') await waitFor(() => expect(diaryApi.exportUtil.toPDF).toHaveBeenCalled())
      if (stage === 'file write') await waitFor(() => expect(diaryApi.exportUtil.writeFile).toHaveBeenCalled())

      expect.soft(exportButton).toBeDisabled()
      expect.soft(screen.getByRole('button', { name: /取消/ })).toBeDisabled()
      expect.soft(screen.getByRole('button', { name: /导入 JSON/ })).toBeDisabled()
      expect.soft(getCloseButton()).toBeDisabled()

      close.mockClear()
      fireEvent.click(getCloseButton())
      expect.soft(close, 'header close button').not.toHaveBeenCalled()
      close.mockClear()

      fireEvent.click(getBackdrop())
      expect.soft(close, 'backdrop click').not.toHaveBeenCalled()
      close.mockClear()

      fireEvent.click(screen.getByRole('button', { name: /取消/ }))
      expect.soft(close, 'Cancel button').not.toHaveBeenCalled()
      close.mockClear()

      fireEvent.keyDown(window, { key: 'Escape' })
      expect.soft(close, 'Escape').not.toHaveBeenCalled()
      close.mockClear()

      fireEvent.click(exportButton)
      expect.soft(diaryApi.entries.getAll, 'duplicate export is ignored').toHaveBeenCalledTimes(1)

      if (stage !== 'file write') {
        fireEvent.click(screen.getByText('Markdown'))
        expect.soft(markdown.checked, 'format remains unchanged').toBe(false)
      } else {
        const pdfFormat = document.querySelector('input[name="export-format"][value="pdf"]') as HTMLInputElement
        fireEvent.click(screen.getByText('PDF 报告'))
        expect.soft(pdfFormat.checked, 'format remains unchanged').toBe(false)
      }
      await act(async () => {
        entries.resolve([{ date: '2026-10-08', title: 'Synthetic', content: 'Synthetic export fixture' }])
        subjects.resolve([])
        saveDialog.resolve(null)
        pdf.resolve()
        write.resolve()
      })
    },
  )

  it('returns to idle after native Save As cancellation and keeps keyboard focus on an available control', async () => {
    configureExportApis()
    const { trigger } = renderWithFocusRestoreHarness()
    diaryApi.exportUtil.showSaveDialog.mockResolvedValue(null)

    const exportButton = screen.getByRole('button', { name: '导出文件' })
    exportButton.focus()
    fireEvent.click(exportButton)

    await waitFor(() => expect(exportButton).toBeEnabled())
    expect(screen.queryByText(/导出失败/)).not.toBeInTheDocument()
    expect(exportButton).toHaveFocus()
    expect(trigger).not.toHaveFocus()
  })

  it('shows a picker failure, restores controls, and allows a successful retry', async () => {
    configureExportApis()
    diaryApi.exportUtil.showSaveDialog
      .mockRejectedValueOnce(new Error('synthetic picker failure'))
      .mockResolvedValueOnce('/tmp/synthetic.pdf')
    diaryApi.exportUtil.toPDF.mockResolvedValue(undefined)
    render(<ExportModal onClose={vi.fn()} />)

    const exportButton = screen.getByRole('button', { name: '导出文件' })
    fireEvent.click(exportButton)
    await waitFor(() => expect(screen.getByText(/导出失败：synthetic picker failure/)).toBeInTheDocument())
    expect(exportButton).toBeEnabled()

    fireEvent.click(exportButton)
    await waitFor(() => expect(screen.getByText(/已导出到：/)).toBeInTheDocument())
    expect(diaryApi.exportUtil.showSaveDialog).toHaveBeenCalledTimes(2)
    expect(diaryApi.exportUtil.toPDF).toHaveBeenCalledTimes(1)
  })

  it('allows successful repeated exports after the first export settles', async () => {
    configureExportApis()
    diaryApi.exportUtil.showSaveDialog
      .mockResolvedValueOnce('/tmp/first-synthetic.pdf')
      .mockResolvedValueOnce('/tmp/second-synthetic.pdf')
    diaryApi.exportUtil.toPDF.mockResolvedValue(undefined)
    render(<ExportModal onClose={vi.fn()} />)

    const exportButton = screen.getByRole('button', { name: '导出文件' })
    fireEvent.click(exportButton)
    await waitFor(() => expect(screen.getByText(/已导出到：\/tmp\/first-synthetic.pdf/)).toBeInTheDocument())
    expect(exportButton).toBeEnabled()

    fireEvent.click(exportButton)
    await waitFor(() => expect(screen.getByText(/已导出到：\/tmp\/second-synthetic.pdf/)).toBeInTheDocument())
    expect(diaryApi.exportUtil.showSaveDialog).toHaveBeenCalledTimes(2)
    expect(diaryApi.exportUtil.toPDF).toHaveBeenCalledTimes(2)
  })
})

function renderWithFocusRestoreHarness() {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open export</button>
        {open && <ExportModal onClose={() => setOpen(false)} />}
      </>
    )
  }

  render(<Harness />)
  const trigger = screen.getByRole('button', { name: 'Open export' })
  trigger.focus()
  fireEvent.click(trigger)
  return { trigger }
}
