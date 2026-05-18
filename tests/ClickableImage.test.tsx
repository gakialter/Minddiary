import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ClickableImage from '../src/components/ClickableImage'

describe('ClickableImage', () => {
  it('renders the image source and alt text', () => {
    render(<ClickableImage src="local://attachments/test.png" alt="Diary image" onPreview={vi.fn()} />)

    const image = screen.getByRole('img', { name: 'Diary image' })

    expect(image).toHaveAttribute('src', 'local://attachments/test.png')
    expect(image).toHaveAttribute('alt', 'Diary image')
  })

  it('calls onPreview with the image src and alt when clicked', () => {
    const onPreview = vi.fn()
    render(<ClickableImage src="local://attachments/test.png" alt="Diary image" onPreview={onPreview} />)

    fireEvent.click(screen.getByRole('button', { name: 'Diary image' }))

    expect(onPreview).toHaveBeenCalledWith({ src: 'local://attachments/test.png', alt: 'Diary image' })
  })

  it('stops parent click handlers before previewing when requested', () => {
    const onParentClick = vi.fn()
    const onPreview = vi.fn()

    render(
      <div onClick={onParentClick}>
        <ClickableImage
          src="local://attachments/test.png"
          alt="Diary image"
          onPreview={onPreview}
          stopPropagation
        />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Diary image' }))

    expect(onParentClick).not.toHaveBeenCalled()
    expect(onPreview).toHaveBeenCalledWith({ src: 'local://attachments/test.png', alt: 'Diary image' })
  })

  it('applies custom aria label and title to the preview button', () => {
    render(
      <ClickableImage
        src="local://attachments/test.png"
        alt="Diary image"
        onPreview={vi.fn()}
        ariaLabel="Open diary image preview"
        title="Open full-size diary image"
      />,
    )

    const button = screen.getByRole('button', { name: 'Open diary image preview' })

    expect(button).toHaveAttribute('title', 'Open full-size diary image')
  })

  it('merges custom image and button styles with the defaults', () => {
    render(
      <ClickableImage
        src="local://attachments/test.png"
        alt="Diary image"
        onPreview={vi.fn()}
        buttonStyle={{ display: 'block', width: 100 }}
        imageStyle={{ width: 64, height: 64, objectFit: 'cover' }}
      />,
    )

    const button = screen.getByRole('button', { name: 'Diary image' })
    const image = screen.getByRole('img', { name: 'Diary image' })

    expect(button).toHaveStyle({
      padding: '0px',
      background: 'transparent',
      cursor: 'zoom-in',
      display: 'block',
      width: '100px',
    })
    expect(image).toHaveStyle({
      width: '64px',
      height: '64px',
      objectFit: 'cover',
    })
  })

  it('uses lazy loading by default', () => {
    render(<ClickableImage src="local://attachments/test.png" alt="Diary image" onPreview={vi.fn()} />)

    expect(screen.getByRole('img', { name: 'Diary image' })).toHaveAttribute('loading', 'lazy')
  })

  it('uses async decoding by default', () => {
    render(<ClickableImage src="local://attachments/test.png" alt="Diary image" onPreview={vi.fn()} />)

    expect(screen.getByRole('img', { name: 'Diary image' })).toHaveAttribute('decoding', 'async')
  })

  it('forwards image error events via onImageError', () => {
    const onImageError = vi.fn()

    render(
      <ClickableImage
        src="broken.png"
        alt="Broken"
        onPreview={vi.fn()}
        onImageError={onImageError}
      />,
    )

    fireEvent.error(screen.getByRole('img', { name: 'Broken' }))

    expect(onImageError).toHaveBeenCalledTimes(1)
  })
})
