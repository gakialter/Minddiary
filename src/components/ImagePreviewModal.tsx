import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export interface PreviewImage {
  src: string
  alt: string
}

interface ImagePreviewModalProps {
  image: PreviewImage | null
  onClose: () => void
}

export default function ImagePreviewModal({ image, onClose }: ImagePreviewModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!image) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    closeButtonRef.current?.focus()

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [image, onClose])

  if (!image) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-lg)',
        background: 'rgba(0, 0, 0, 0.78)',
        cursor: 'zoom-out',
      }}
    >
      <button
        ref={closeButtonRef}
        type="button"
        aria-label="关闭图片预览"
        title="关闭图片预览"
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 'var(--space-md)',
          right: 'var(--space-md)',
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.35)',
          background: 'rgba(0,0,0,0.55)',
          color: 'white',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
          backdropFilter: 'blur(4px)',
        }}
      >
        <X size={18} aria-hidden />
      </button>
      <div
        onClick={event => event.stopPropagation()}
        style={{
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 80px)',
          cursor: 'default',
        }}
      >
        <img
          src={image.src}
          alt={image.alt}
          style={{
            display: 'block',
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100vh - 80px)',
            objectFit: 'contain',
            borderRadius: 'var(--radius)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
          }}
        />
      </div>
    </div>
  )
}
