import { createPortal } from 'react-dom'
import { useModalFocus } from '../hooks/useModalFocus'

interface Props {
  onInsert: () => void
  onReplace: () => void
  onClose: () => void
}

export default function TemplateApplyDialog({ onInsert, onReplace, onClose }: Props) {
  const modalRef = useModalFocus(onClose)
  return createPortal(
    <div className="c8-review-overlay">
      <div ref={modalRef} className="c8-review-dialog c8-review-dialog--manual" style={{ padding: 'var(--space-5)' }} role="dialog" aria-modal="true"
        aria-labelledby="template-apply-title" aria-describedby="template-apply-description" tabIndex={-1}>
        <h3 id="template-apply-title">如何应用模板？</h3>
        <p id="template-apply-description">当前日记已有内容。插入会将模板添加到正文末尾，保留原文。</p>
        <div className="flex flex-wrap gap-sm mt-4">
          <button type="button" className="button button-primary" onClick={onInsert}>插入模板</button>
          <button type="button" className="button button-secondary" onClick={onClose}>取消</button>
          <button type="button" className="button" onClick={onReplace}>替换当前内容</button>
        </div>
      </div>
    </div>, document.body,
  )
}
