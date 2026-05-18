import type { CSSProperties, MouseEvent, SyntheticEvent } from 'react'
import type { PreviewImage } from './ImagePreviewModal'

interface ClickableImageProps {
  src: string
  alt: string
  onPreview: (image: PreviewImage) => void

  imageStyle?: CSSProperties
  buttonStyle?: CSSProperties

  className?: string
  imageClassName?: string

  title?: string
  ariaLabel?: string

  stopPropagation?: boolean

  loading?: 'lazy' | 'eager'
  decoding?: 'async' | 'auto' | 'sync'

  onImageError?: (event: SyntheticEvent<HTMLImageElement>) => void
}

const defaultButtonStyle: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'zoom-in',
}

export default function ClickableImage({
  src,
  alt,
  onPreview,
  imageStyle,
  buttonStyle,
  className,
  imageClassName,
  title,
  ariaLabel,
  stopPropagation = false,
  loading = 'lazy',
  decoding = 'async',
  onImageError,
}: ClickableImageProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      event.stopPropagation()
    }
    onPreview({ src, alt })
  }

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      aria-label={ariaLabel}
      title={title}
      style={{ ...defaultButtonStyle, ...buttonStyle }}
    >
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding={decoding}
        style={imageStyle}
        onError={onImageError}
        className={imageClassName}
      />
    </button>
  )
}
