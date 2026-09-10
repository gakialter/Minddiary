import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImageGallery from '../src/components/ImageGallery'
import type { Attachment } from '../src/types'

const mocks = vi.hoisted(() => ({
  getByEntry: vi.fn(),
  save: vi.fn(),
  deleteAttachment: vi.fn(),
  showToast: vi.fn(),
  compressImages: vi.fn(),
}))

vi.mock('../src/utils/imageCompressor', () => ({
  compressImages: mocks.compressImages,
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: () => ({
    attachments: {
      getByEntry: mocks.getByEntry,
      save: mocks.save,
      delete: mocks.deleteAttachment,
    },
  }),
}))

vi.mock('../src/components/Toast', () => ({
  showToast: mocks.showToast,
}))

const attachment: Attachment = {
  id: 1,
  entry_id: 7,
  filename: '测试图片.png',
  filepath: '7_1779000000000.png',
  mimetype: 'image/png',
  created_at: '2026-05-17T00:00:00.000Z',
}

function activateNativeButtonWithKeyboard(button: HTMLButtonElement, key: 'Enter' | ' ') {
  act(() => {
    const keyDown = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    const shouldDispatchClick = button.dispatchEvent(keyDown)
    button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
    if (shouldDispatchClick) {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))
    }
  })
}

describe('ImageGallery diary attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getByEntry.mockResolvedValue([attachment])
    mocks.save.mockResolvedValue(attachment)
    mocks.deleteAttachment.mockResolvedValue(true)
    mocks.compressImages.mockResolvedValue([])
  })

  it.each(['Enter', ' '] as const)('opens the native file picker from the empty upload target with %s', async (key) => {
    mocks.getByEntry.mockResolvedValue([])
    const { container } = render(<ImageGallery entryId={7} />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    const clickSpy = vi.spyOn(input!, 'click')
    const uploadTarget = await screen.findByRole('button', { name: /点击或拖拽上传图片/ })
    expect(uploadTarget.tagName).toBe('BUTTON')

    activateNativeButtonWithKeyboard(uploadTarget as HTMLButtonElement, key)

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('renders persisted diary images through the controlled local protocol', async () => {
    render(<ImageGallery entryId={7} />)

    const image = await screen.findByAltText('测试图片.png')

    await waitFor(() => {
      expect(image).toHaveAttribute('src', 'local://attachments/7_1779000000000.png')
    })
    expect(image.getAttribute('src')).not.toMatch(/^file:\/\//)
  })

  it('opens the native file picker from the upload-more control with the keyboard', async () => {
    const { container } = render(<ImageGallery entryId={7} />)
    await screen.findByAltText('测试图片.png')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    const clickSpy = vi.spyOn(input!, 'click')
    const uploadMore = screen.getByRole('button', { name: '上传更多图片' })
    expect(uploadMore.tagName).toBe('BUTTON')

    activateNativeButtonWithKeyboard(uploadMore as HTMLButtonElement, 'Enter')

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps the established compression and persistence contract for a valid image', async () => {
    mocks.getByEntry.mockResolvedValue([])
    const file = new File(['image-data'], '学习笔记.png', { type: 'image/png' })
    const compressedBlob = new Blob(['compressed'], { type: 'image/png' })
    mocks.compressImages.mockResolvedValue([{
      file,
      result: {
        blob: compressedBlob,
        base64: 'Y29tcHJlc3NlZA==',
        width: 960,
        height: 720,
        originalSizeKB: 1,
        compressedSizeKB: 1,
      },
    }])
    const { container } = render(<ImageGallery entryId={7} />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()

    fireEvent.change(input!, { target: { files: [file] } })

    await waitFor(() => {
      expect(mocks.compressImages).toHaveBeenCalledWith([file], {
        maxWidth: 1280,
        maxHeight: 1280,
        quality: 0.82,
        maxSizeKB: 512,
      })
      expect(mocks.save).toHaveBeenCalledWith(7, {
        name: '学习笔记.png',
        data: 'Y29tcHJlc3NlZA==',
        mimetype: 'image/png',
      })
    })
  })

  it('keeps rejecting an image larger than 10 MB before compression or persistence', async () => {
    mocks.getByEntry.mockResolvedValue([])
    const file = new File(['oversized'], '超大原图.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 })
    const { container } = render(<ImageGallery entryId={7} />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()

    fireEvent.change(input!, { target: { files: [file] } })

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('图片 超大原图.png 超过 10MB，已拒绝上传', 'error')
    })
    expect(mocks.compressImages).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('opens a full-size preview for diary images and closes it', async () => {
    render(<ImageGallery entryId={7} />)

    const previewButton = await screen.findByRole('button', { name: /放大查看日记图片 测试图片\.png/ })
    fireEvent.click(previewButton)

    const dialog = await screen.findByRole('dialog', { name: '图片预览' })
    expect(within(dialog).getByAltText('测试图片.png')).toHaveAttribute('src', 'local://attachments/7_1779000000000.png')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()
    })
  })

  it('lets thumbnail clicks pass through the overlay while keeping delete clickable', async () => {
    const { container } = render(<ImageGallery entryId={7} />)

    await screen.findByRole('img')

    const overlay = container.querySelector<HTMLElement>('.gallery-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay).toHaveStyle('pointer-events: none')

    const deleteButton = overlay?.querySelector<HTMLButtonElement>('button')
    expect(deleteButton).not.toBeNull()
    expect(deleteButton).toHaveStyle('pointer-events: auto')
  })

  it('deletes an attachment from the overlay without opening the preview', async () => {
    const { container } = render(<ImageGallery entryId={7} />)

    await screen.findByRole('img')

    const deleteButton = container.querySelector<HTMLButtonElement>('.gallery-overlay button')
    expect(deleteButton).not.toBeNull()
    fireEvent.click(deleteButton!)

    await waitFor(() => {
      expect(mocks.deleteAttachment).toHaveBeenCalledWith(1)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
