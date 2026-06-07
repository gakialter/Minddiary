import MistakeReviewModal from './MistakeReviewModal'

interface BreakReviewModalProps {
    onClose: () => void
}

export default function BreakReviewModal({ onClose }: BreakReviewModalProps) {
    return <MistakeReviewModal onClose={onClose} variant="break" />
}
