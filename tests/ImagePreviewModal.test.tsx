import { readFileSync } from 'node:fs'
import { useState, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BreakReviewModal from '../src/components/BreakReviewModal'
import ImagePreviewModal from '../src/components/ImagePreviewModal'
import { showToast, ToastContainer } from '../src/components/Toast'
import { useGlobalKeyboard } from '../src/hooks/useGlobalKeyboard'

const styles = readFileSync('src/index.css', 'utf8')

const mocks = vi.hoisted(() => ({
  getRandomDue: vi.fn(),
  review: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => {
  const diary = {
    mistakes: {
      getRandomDue: mocks.getRandomDue,
      review: mocks.review,
    },
  }
  return { useDiary: () => diary }
})

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

  it('contains forward/backward Tab and programmatic focus, then restores its trigger', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)}>预览图片</button>
        <button>开始计时</button>
        <ImagePreviewModal image={open ? image : null} onClose={() => setOpen(false)} />
      </>
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '预览图片' })
    const timer = screen.getByRole('button', { name: '开始计时' })
    const previousInert = timer.inert
    trigger.focus()
    fireEvent.click(trigger)
    const close = screen.getByRole('button', { name: '关闭图片预览' })
    expect(close).toHaveFocus()
    expect(timer.inert).toBe(true)
    for (const shiftKey of [false, false, true, true]) {
      expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey })).toBe(false)
      expect(close).toHaveFocus()
    }
    timer.focus()
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(timer.inert).toBe(previousInert)
  })

  it('contains application shortcuts without preventing native Space activation', () => {
    const shortcut = vi.fn()
    function Harness() {
      useGlobalKeyboard({ k: shortcut })
      return <ImagePreviewModal image={image} onClose={vi.fn()} />
    }
    render(<Harness />)
    const close = screen.getByRole('button', { name: '关闭图片预览' })
    fireEvent.keyDown(close, { key: 'k', ctrlKey: true })
    expect(shortcut).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(close, { key: ' ', code: 'Space' })).toBe(true)
  })

  it('lets a nested preview own focus and Escape, then resumes its parent modal', async () => {
    const onParentClose = vi.fn()
    render(<BreakReviewModal onClose={onParentClose} />)
    const trigger = (await screen.findByRole('img')).closest('button')!
    trigger.focus()
    fireEvent.click(trigger)
    const close = screen.getByRole('button', { name: '关闭图片预览' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()
    expect(onParentClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(onParentClose).toHaveBeenCalledTimes(1)
  })

  it('uses the modal z-index token on the break review overlay', async () => {
    render(<BreakReviewModal onClose={vi.fn()} />)
    await screen.findByRole('img')

    expect(screen.getByRole('dialog').parentElement).toHaveClass('c8-review-overlay')
    expect(styles).toMatch(/\.c8-review-overlay\s*\{[^}]*z-index: var\(--z-modal\)/)
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
    render(<BreakReviewModal onClose={vi.fn()} />)
    const breakReviewOverlay = screen.getByRole('dialog').parentElement as HTMLElement
    const thumbnail = await screen.findByRole('img')

    fireEvent.click(thumbnail.closest('button')!)

    const imagePreviewOverlay = screen.getByRole('dialog', { name: '图片预览' })

    expect(breakReviewOverlay).toHaveClass('c8-review-overlay')
    expect(imagePreviewOverlay).toHaveStyle({ zIndex: 'var(--z-image-preview)' })
    const reviewLayer = styles.match(/\.c8-review-overlay\s*\{[^}]*z-index: ([^;]+);/)?.[1]
    expect(getTokenRank(imagePreviewOverlay.style.zIndex)).toBeGreaterThan(getTokenRank(reviewLayer!))
  })

  it('uses the toast z-index token on the toast container', () => {
    vi.useFakeTimers()
    render(<ToastContainer />)

    act(() => {
      showToast('Saved', 'success')
    })

    expect(document.querySelector('.toast-container')).toHaveStyle({
      zIndex: 'var(--z-toast)',
    })
  })
})
