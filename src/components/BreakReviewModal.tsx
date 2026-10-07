import MistakeReviewModal from './MistakeReviewModal'
import type { Mistake } from '../types'

interface BreakReviewModalProps {
    onClose: () => void
    initialMistake?: Mistake
}

export default function BreakReviewModal({ onClose, initialMistake }: BreakReviewModalProps) {
    return <MistakeReviewModal onClose={onClose} variant="break" initialMistake={initialMistake} />
}
