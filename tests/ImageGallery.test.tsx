import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImageGallery from '../src/components/ImageGallery'
import type { Attachment } from '../src/types'

const mocks = vi.hoisted(() => ({
  getByEntry: vi.fn(),
  save: vi.fn(),
  deleteAttachment: vi.fn(),
  showToast: vi.fn(),
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

describe('ImageGallery diary attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getByEntry.mockResolvedValue([attachment])
    mocks.save.mockResolvedValue(attachment)
    mocks.deleteAttachment.mockResolvedValue(true)
  })

  it('renders persisted diary images through the controlled local protocol', async () => {
    render(<ImageGallery entryId={7} />)

    const image = await screen.findByAltText('测试图片.png')

    await waitFor(() => {
      expect(image).toHaveAttribute('src', 'local://attachments/7_1779000000000.png')
    })
    expect(image.getAttribute('src')).not.toMatch(/^file:\/\//)
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
