import { useEffect, useRef } from 'react'
import Latex from 'react-latex-next'
import './MistakeText.css'

interface MistakeTextProps {
    children: string
    label: '题目' | '答案'
    prefix?: string
}

/** Q/A stays plain text with LaTeX; notes keep their separate Markdown renderer. */
export default function MistakeText({ children, label, prefix }: MistakeTextProps) {
    const contentRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // KaTeX owns these spans. Make each local scroll surface reachable by keyboard.
        contentRef.current?.querySelectorAll<HTMLElement>('.katex-display').forEach(formula => {
            formula.tabIndex = 0
            formula.setAttribute('role', 'region')
            formula.setAttribute('aria-label', `${label}公式`)
        })
    }, [children, label])

    return (
        <div ref={contentRef} className="mistake-qa-content">
            {prefix && <strong>{prefix}</strong>}<Latex>{children}</Latex>
        </div>
    )
}
