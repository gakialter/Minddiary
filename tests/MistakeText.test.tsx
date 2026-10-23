import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MistakeText from '../src/components/common/MistakeText'

describe('MistakeText', () => {
  it('preserves plain text lines and blank lines without interpreting Markdown', () => {
    const text = '综合题\n\n(1) 求值\n(2) **说明理由**\n- 原文条目'
    const { container } = render(<MistakeText label="题目">{text}</MistakeText>)

    expect(container.querySelector('.mistake-qa-content')!.textContent).toBe(text)
    expect(container.querySelector('strong, ul, .markdown-body')).toBeNull()
  })

  it('makes display formulas focusable local regions and leaves inline math inline', () => {
    const { container } = render(
      <MistakeText label="题目">{'先求 $x^2$\n$$a+b+c+d+e+f+g+h+i+j+k+l+m+n$$\n再求 \\[y^2\\]'}</MistakeText>
    )

    const formulas = screen.getAllByRole('region', { name: '题目公式' })
    expect(formulas).toHaveLength(2)
    for (const formula of formulas) {
      expect(formula).toHaveClass('katex-display')
      expect(formula).toHaveAttribute('tabindex', '0')
      formula.focus()
      expect(formula).toHaveFocus()
      expect(formula.querySelector('annotation')).not.toBeNull()
    }
    const inline = container.querySelector('.katex')!
    expect(inline.closest('.katex-display')).toBeNull()
    expect(inline).not.toHaveAttribute('tabindex')
    expect(inline.querySelector('annotation')!.textContent).toBe('x^2')
  })

  it('preserves multiline LaTeX and refreshes formula access after content changes', () => {
    const { container, rerender } = render(<MistakeText label="答案">{'第一步\n$$\\begin{aligned}a&=b\\\\\nc&=d\\end{aligned}$$\n第二步'}</MistakeText>)
    expect(container.querySelector('.katex-error')).toBeNull()
    expect(screen.getByRole('region', { name: '答案公式' }).querySelector('annotation')!.textContent)
      .toBe('\\begin{aligned}a&=b\\\\\nc&=d\\end{aligned}')

    rerender(<MistakeText label="答案">{'完成\n$$z=1$$'}</MistakeText>)
    expect(screen.getByRole('region', { name: '答案公式' })).toHaveAttribute('tabindex', '0')
    expect(container.querySelector('annotation')!.textContent).toBe('z=1')
  })
})
