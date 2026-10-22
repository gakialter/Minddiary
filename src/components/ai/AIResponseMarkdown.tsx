import MarkdownRenderer from '../common/MarkdownRenderer'
import { normalizeAIResponseMath } from '../../utils/aiResponseMath'
import './aiResponseMarkdown.css'

export default function AIResponseMarkdown({ children }: { children: string }) {
    return <MarkdownRenderer className="ai-message-content" math>{normalizeAIResponseMath(children)}</MarkdownRenderer>
}
