import { X } from 'lucide-react'
import { useModalFocus } from '../hooks/useModalFocus'

export interface PreviewImage {
  src: string
  alt: string
}

interface ImagePreviewModalProps {
  image: PreviewImage | null
  onClose: () => void
}

export default function ImagePreviewModal({ image, onClose }: ImagePreviewModalProps) {
  const modalRef = useModalFocus(onClose, !!image)

  if (!image) return null

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
      // Keep native control activation while containing application shortcuts.
      onKeyDown={event => event.stopPropagation()}
      onKeyUp={event => event.stopPropagation()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-image-preview)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-lg)',
        background: 'rgba(0, 0, 0, 0.78)',
        cursor: 'zoom-out',
      }}
    >
      <button
        type="button"
        aria-label="关闭图片预览"
        title="关闭图片预览"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
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
          // Local stacking inside the image preview overlay.
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
