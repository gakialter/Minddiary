import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImagePreviewModal from '../src/components/ImagePreviewModal'

const image = {
  src: 'local://attachments/test.png',
  alt: '测试图片',
}

describe('ImagePreviewModal', () => {
  beforeEach(() => {
    document.body.style.overflow = 'auto'
  })

  afterEach(() => {
    document.body.style.overflow = ''
  })

  it('closes when the overlay is clicked', () => {
    const onClose = vi.fn()

    render(<ImagePreviewModal image={image} onClose={onClose} />)

    fireEvent.click(screen.getByRole('dialog', { name: '图片预览' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when the preview image is clicked', () => {
    const onClose = vi.fn()

    render(<ImagePreviewModal image={image} onClose={onClose} />)

    fireEvent.click(screen.getByRole('img', { name: '测试图片' }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes only once when the close button is clicked', () => {
    const onClose = vi.fn()

    render(<ImagePreviewModal image={image} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('locks body scrolling while open and restores the previous overflow when unmounted', () => {
    const { unmount } = render(<ImagePreviewModal image={image} onClose={vi.fn()} />)

    expect(document.body.style.overflow).toBe('hidden')

    unmount()

    expect(document.body.style.overflow).toBe('auto')
  })
})
