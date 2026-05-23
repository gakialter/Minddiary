import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MarkdownRenderer from '../src/components/common/MarkdownRenderer'

describe('MarkdownRenderer', () => {
  // ── Highlight ==text== ────────────────────────────────────────────────

  it('renders ==重点内容== as a <mark> element', () => {
    const { container } = render(
      <MarkdownRenderer>{'这是==重点内容==的句子'}</MarkdownRenderer>,
    )
    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('重点内容')
  })

  it('renders multiple highlights in one line', () => {
    const { container } = render(
      <MarkdownRenderer>{'==A== normal ==B=='}</MarkdownRenderer>,
    )
    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(2)
    expect(marks[0]!.textContent).toBe('A')
    expect(marks[1]!.textContent).toBe('B')
  })

  // ── Underline ++text++ ────────────────────────────────────────────────

  it('renders ++下划线内容++ as a <u> element', () => {
    const { container } = render(
      <MarkdownRenderer>{'这是++下划线内容++的句子'}</MarkdownRenderer>,
    )
    const u = container.querySelector('u')
    expect(u).not.toBeNull()
    expect(u!.textContent).toBe('下划线内容')
  })

  it('renders multiple underlines in one line', () => {
    const { container } = render(
      <MarkdownRenderer>{'++X++ and ++Y++'}</MarkdownRenderer>,
    )
    const us = container.querySelectorAll('u')
    expect(us).toHaveLength(2)
    expect(us[0]!.textContent).toBe('X')
    expect(us[1]!.textContent).toBe('Y')
  })

  // ── Mixed formatting ──────────────────────────────────────────────────

  it('handles highlight and underline in the same paragraph', () => {
    const { container } = render(
      <MarkdownRenderer>{'==高亮== and ++下划线++'}</MarkdownRenderer>,
    )
    expect(container.querySelector('mark')!.textContent).toBe('高亮')
    expect(container.querySelector('u')!.textContent).toBe('下划线')
  })

  // ── Bold still works ──────────────────────────────────────────────────

  it('renders **粗体** as <strong>', () => {
    const { container } = render(
      <MarkdownRenderer>{'**粗体**'}</MarkdownRenderer>,
    )
    const strong = container.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong!.textContent).toBe('粗体')
  })

  it('renders bold mixed with highlight and underline', () => {
    const { container } = render(
      <MarkdownRenderer>{'**粗体** ==高亮== ++下划线++'}</MarkdownRenderer>,
    )
    expect(container.querySelector('strong')!.textContent).toBe('粗体')
    expect(container.querySelector('mark')!.textContent).toBe('高亮')
    expect(container.querySelector('u')!.textContent).toBe('下划线')
  })

  // ── GFM features ─────────────────────────────────────────────────────

  it('renders unordered lists normally', () => {
    const { container } = render(
      <MarkdownRenderer>{'- item 1\n- item 2'}</MarkdownRenderer>,
    )
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]!.textContent).toBe('item 1')
  })

  it('renders links normally', () => {
    const { container } = render(
      <MarkdownRenderer>{'[example](https://example.com)'}</MarkdownRenderer>,
    )
    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('https://example.com')
    expect(link!.textContent).toBe('example')
  })

  it('renders GFM tables normally', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const { container } = render(
      <MarkdownRenderer>{md}</MarkdownRenderer>,
    )
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
  })

  it('renders blockquotes normally', () => {
    const { container } = render(
      <MarkdownRenderer>{'> quote text'}</MarkdownRenderer>,
    )
    const bq = container.querySelector('blockquote')
    expect(bq).not.toBeNull()
    expect(bq!.textContent).toContain('quote text')
  })

  // ── Code safety: == and ++ inside code must NOT be parsed ─────────────

  it('does NOT parse == inside inline code', () => {
    const { container } = render(
      <MarkdownRenderer>{'`==not highlight==`'}</MarkdownRenderer>,
    )
    expect(container.querySelector('mark')).toBeNull()
    expect(container.querySelector('code')!.textContent).toBe('==not highlight==')
  })

  it('does NOT parse ++ inside inline code', () => {
    const { container } = render(
      <MarkdownRenderer>{'`++not underline++`'}</MarkdownRenderer>,
    )
    expect(container.querySelector('u')).toBeNull()
    expect(container.querySelector('code')!.textContent).toBe('++not underline++')
  })

  it('does NOT parse == inside fenced code blocks', () => {
    const md = '```\n==not highlight==\n```'
    const { container } = render(
      <MarkdownRenderer>{md}</MarkdownRenderer>,
    )
    expect(container.querySelector('mark')).toBeNull()
    expect(container.querySelector('pre')!.textContent).toContain('==not highlight==')
  })

  it('does NOT parse ++ inside fenced code blocks', () => {
    const md = '```\n++not underline++\n```'
    const { container } = render(
      <MarkdownRenderer>{md}</MarkdownRenderer>,
    )
    expect(container.querySelector('u')).toBeNull()
    expect(container.querySelector('pre')!.textContent).toContain('++not underline++')
  })

  // ── Edge cases ────────────────────────────────────────────────────────

  it('renders empty string without errors', () => {
    const { container } = render(
      <MarkdownRenderer>{''}</MarkdownRenderer>,
    )
    expect(container.querySelector('.markdown-body')).not.toBeNull()
  })

  it('renders plain text without extra elements', () => {
    render(<MarkdownRenderer>{'plain text only'}</MarkdownRenderer>)
    expect(screen.getByText('plain text only')).toBeInTheDocument()
  })

  it('does not use dangerouslySetInnerHTML', () => {
    const { container } = render(
      <MarkdownRenderer>{'==highlight== ++underline++'}</MarkdownRenderer>,
    )
    // dangerouslySetInnerHTML sets __html on the DOM node's innerHTML directly;
    // if it were used, react would render a single element with innerHTML.
    // Our <mark> and <u> should be actual DOM children, not innerHTML strings.
    const mark = container.querySelector('mark')
    const u = container.querySelector('u')
    expect(mark).not.toBeNull()
    expect(u).not.toBeNull()
    // Verify they are real React-rendered DOM nodes with child text nodes
    expect(mark!.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE)
    expect(u!.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE)
  })

  // ── Highlight inside list items ───────────────────────────────────────

  it('renders highlight inside list items', () => {
    const { container } = render(
      <MarkdownRenderer>{'- ==重点=='}</MarkdownRenderer>,
    )
    const mark = container.querySelector('li mark')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('重点')
  })

  // ── Highlight inside blockquote ───────────────────────────────────────

  it('renders highlight inside blockquote', () => {
    const { container } = render(
      <MarkdownRenderer>{'> ==引用高亮=='}</MarkdownRenderer>,
    )
    const mark = container.querySelector('blockquote mark')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('引用高亮')
  })
})
