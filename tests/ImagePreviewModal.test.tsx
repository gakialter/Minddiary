import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BreakReviewModal from '../src/components/BreakReviewModal'
import ImagePreviewModal from '../src/components/ImagePreviewModal'
import { showToast, ToastContainer } from '../src/components/Toast'

const mocks = vi.hoisted(() => ({
  getRandomDue: vi.fn(),
  review: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: () => ({
    mistakes: {
      getRandomDue: mocks.getRandomDue,
      review: mocks.review,
    },
  }),
}))

vi.mock('react-latex-next', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const image = {
  src: 'local://attachments/test.png',
  alt: '测试图片',
}

describe('ImagePreviewModal', () => {
  beforeEach(() => {
    document.body.style.overflow = 'auto'
    mocks.getRandomDue.mockResolvedValue({
      id: 1,
      question: 'Question',
      answer: 'Answer',
      image_path: 'mistake.png',
      ease_factor: 2.5,
      review_interval: 1,
      review_count: 0,
    })
  })

  afterEach(() => {
    document.body.style.overflow = ''
    vi.useRealTimers()
    vi.clearAllMocks()
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

  it('uses the image preview z-index token on the root overlay', () => {
    render(<ImagePreviewModal image={image} onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: '图片预览' })).toHaveStyle({
      zIndex: 'var(--z-image-preview)',
    })
  })

  it('uses the modal z-index token on the break review overlay', async () => {
    const { container } = render(<BreakReviewModal onClose={vi.fn()} />)
    await screen.findByRole('img')

    expect(container.firstElementChild).toHaveStyle({
      zIndex: 'var(--z-modal)',
    })
  })

  it('keeps image preview above the break review modal when opened from break review', async () => {
    const tokenRank: Record<string, number> = {
      'var(--z-modal)': 1,
      'var(--z-image-preview)': 2,
    }
    const getTokenRank = (zIndex: string): number => {
      const rank = tokenRank[zIndex]
      if (rank == null) throw new Error(`Unexpected z-index token: ${zIndex}`)
      return rank
    }
    const { container } = render(<BreakReviewModal onClose={vi.fn()} />)
    const breakReviewOverlay = container.firstElementChild as HTMLElement
    const thumbnail = await screen.findByRole('img')

    fireEvent.click(thumbnail.closest('button')!)

    const imagePreviewOverlay = screen.getByRole('dialog', { name: '图片预览' })

    expect(breakReviewOverlay).toHaveStyle({ zIndex: 'var(--z-modal)' })
    expect(imagePreviewOverlay).toHaveStyle({ zIndex: 'var(--z-image-preview)' })
    expect(getTokenRank(imagePreviewOverlay.style.zIndex)).toBeGreaterThan(getTokenRank(breakReviewOverlay.style.zIndex))
  })

  it('uses the toast z-index token on the toast container', () => {
    vi.useFakeTimers()
    render(<ToastContainer />)

    act(() => {
      showToast('Saved', 'success')
    })

    expect(screen.getByText('Saved').parentElement?.parentElement).toHaveStyle({
      zIndex: 'var(--z-toast)',
    })
  })
})
