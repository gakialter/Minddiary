import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AIResponseMarkdown from '../src/components/ai/AIResponseMarkdown'
import AIMessageBubble from '../src/components/ai/AIMessageBubble'
import { normalizeAIResponseMath } from '../src/utils/aiResponseMath'

afterEach(cleanup)

describe('AI response math', () => {
    it.each([
        String.raw`结果 $\frac{1}{2}$。`,
        String.raw`结果 \(\frac{1}{2}\)。`,
        '$$\n' + String.raw`\lim_{x\to0}\frac{\sin x}{x}=1` + '\n$$',
        String.raw`\[\lim_{x\to0}\frac{\sin x}{x}=1\]`,
        String.raw`$$\frac{1}{2}$$`,
        String.raw`\lim_{x\to0}\frac{\sin x}{x}=1`,
        String.raw`\lim_{x\to 0}\frac{\sin x}{x}=1`,
        String.raw`[\frac{1}{2}\text{答案}]`,
    ])('renders supported math notation: %s', source => {
        const { container } = render(<AIResponseMarkdown>{source}</AIResponseMarkdown>)
        expect(container.querySelectorAll('.katex')).toHaveLength(1)
        expect(container.querySelector('math')).not.toBeNull()
    })

    it('keeps Markdown structure and formats math inside GFM table cells', () => {
        const source = '**结论**\n\n- 公式 $x^2$\n\n| A | B |\n| --- | --- |\n| $x_1$ | 2 |'
        const { container } = render(<AIResponseMarkdown>{source}</AIResponseMarkdown>)
        expect(container.querySelector('strong')?.textContent).toBe('结论')
        expect(container.querySelector('li')).not.toBeNull()
        expect(container.querySelector('table')).not.toBeNull()
        expect(container.querySelectorAll('.katex')).toHaveLength(2)
    })

    it('preserves inline, fenced, quoted fenced, and indented code', () => {
        const source = String.raw`\(\frac{1}{2}\)`
        const code = '`' + source + '`\n\n```latex\n' + source + '\n```\n\n> ~~~\n> ' + source + '\n> ~~~\n\n    ' + source
        expect(normalizeAIResponseMath(code)).toBe(code)
        const { container } = render(<AIResponseMarkdown>{code}</AIResponseMarkdown>)
        expect(container.querySelector('.katex')).toBeNull()
        expect(container.querySelectorAll('code')).toHaveLength(4)
    })

    it('preserves streaming code and unmatched math delimiters without crashing', () => {
        const source = '```latex\n' + String.raw`\[\frac{1}{2}`
        expect(normalizeAIResponseMath(source)).toBe(source)
        const { container } = render(<AIResponseMarkdown>{String.raw`等待 $\frac{1}{`}</AIResponseMarkdown>)
        expect(container.textContent).toContain('等待')
        expect(container.querySelector('.katex')).toBeNull()
    })

    it('does not infer ordinary prose, prices, command explanations or Windows paths', () => {
        const source = String.raw`这里解释 \frac 的用法。价格 $20。路径 C:\temp\file。`
        expect(normalizeAIResponseMath(source)).toBe(source)
        const { container } = render(<AIResponseMarkdown>{source}</AIResponseMarkdown>)
        expect(container.querySelector('.katex')).toBeNull()
    })

    it('preserves link destinations and blocks unsafe URLs, raw HTML and trusted TeX commands', () => {
        const source = '[安全](https://example.com/a) [危险](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>\n\n' + String.raw`$\href{javascript:alert(1)}{坏链接}$`
        const { container } = render(<AIResponseMarkdown>{source}</AIResponseMarkdown>)
        expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a')
        expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
        expect(container.querySelector('img')).toBeNull()
        expect(container.querySelector('[onerror]')).toBeNull()
        expect(normalizeAIResponseMath(String.raw`[文档](https://example.com/\(x\))`)).toBe(String.raw`[文档](https://example.com/\(x\))`)
    })

    it('keeps malformed equations readable and copy uses the original reply', () => {
        const source = String.raw`$\frac{1}{$`
        const onCopy = vi.fn()
        const { container, getByRole } = render(<AIMessageBubble message={{ id: 1, role: 'assistant', content: source }} onCopy={onCopy} />)
        expect(container.querySelector('.katex-error')?.textContent).toContain('\\frac')
        fireEvent.click(getByRole('button', { name: '复制回复' }))
        expect(onCopy).toHaveBeenCalledWith(source)
    })
})
