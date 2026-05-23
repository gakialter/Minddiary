import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MistakeItem } from '../src/components/MistakeItem'
import type { Mistake } from '../src/types'

// Mock react-latex-next to render children as plain text for testing
vi.mock('react-latex-next', () => ({
  default: ({ children }: { children: string }) => <span data-testid="latex">{children}</span>,
}))

const baseMistake: Mistake = {
  id: 1,
  subject_id: 1,
  subject_name: 'Math',
  subject_color: '#ff0000',
  question: '1+1=?',
  answer: '2',
  notes: '',
  mastered: false,
  ease_factor: 2.5,
  review_interval: 1,
  review_count: 0,
  next_review_date: null,
  image_path: null,
  created_at: '2026-01-01',
}

const defaultProps = {
  parseImagePaths: (raw?: string | null) => (raw ? [raw] : []),
  toggleMastered: vi.fn(),
  handleEdit: vi.fn(),
  handleDelete: vi.fn(),
  handleReview: vi.fn(),
  onPreviewImage: vi.fn(),
}

describe('MistakeItem notes markdown rendering', () => {
  it('renders **bold** notes as <strong>', () => {
    const { container } = render(
      <MistakeItem
        mistake={{ ...baseMistake, notes: '**important**' }}
        {...defaultProps}
      />
    )
    const notesMd = container.querySelector('.mistake-notes-md')!
    const strong = notesMd.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong!.textContent).toBe('important')
  })

  it('renders ==highlight== notes as <mark>', () => {
    const { container } = render(
      <MistakeItem
        mistake={{ ...baseMistake, notes: '==highlighted==' }}
        {...defaultProps}
      />
    )
    const mark = container.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('highlighted')
  })

  it('renders ++underline++ notes as <u>', () => {
    const { container } = render(
      <MistakeItem
        mistake={{ ...baseMistake, notes: '++underlined++' }}
        {...defaultProps}
      />
    )
    const u = container.querySelector('u')
    expect(u).not.toBeNull()
    expect(u!.textContent).toBe('underlined')
  })

  it('renders mixed formatting in notes', () => {
    const { container } = render(
      <MistakeItem
        mistake={{ ...baseMistake, notes: '**bold** ==highlight== ++underline++' }}
        {...defaultProps}
      />
    )
    const notesMd = container.querySelector('.mistake-notes-md')!
    expect(notesMd.querySelector('strong')!.textContent).toBe('bold')
    expect(notesMd.querySelector('mark')!.textContent).toBe('highlight')
    expect(notesMd.querySelector('u')!.textContent).toBe('underline')
  })

  it('renders question and answer with Latex, not MarkdownRenderer', () => {
    render(
      <MistakeItem
        mistake={{ ...baseMistake, question: '$x^2$', answer: '$y^2$', notes: '**bold**' }}
        {...defaultProps}
      />
    )
    const latexElements = screen.getAllByTestId('latex')
    // question and answer should each be rendered with Latex
    expect(latexElements.length).toBeGreaterThanOrEqual(2)
    expect(latexElements[0]!.textContent).toBe('$x^2$')
    expect(latexElements[1]!.textContent).toBe('$y^2$')
  })

  it('does not use dangerouslySetInnerHTML for notes rendering', () => {
    const { container } = render(
      <MistakeItem
        mistake={{ ...baseMistake, notes: '**bold** ==highlight==' }}
        {...defaultProps}
      />
    )
    const strong = container.querySelector('strong')
    const mark = container.querySelector('mark')
    expect(strong).not.toBeNull()
    expect(mark).not.toBeNull()
    // Verify they are real DOM nodes with child text nodes (not innerHTML)
    expect(strong!.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE)
    expect(mark!.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE)
  })

  it('does not render markdown-body when notes is empty', () => {
    const { container } = render(
      <MistakeItem
        mistake={{ ...baseMistake, notes: '' }}
        {...defaultProps}
      />
    )
    expect(container.querySelector('.mistake-notes-md')).toBeNull()
  })

  it('renders plain text notes without extra formatting elements', () => {
    render(
      <MistakeItem
        mistake={{ ...baseMistake, notes: 'plain note' }}
        {...defaultProps}
      />
    )
    expect(screen.getByText('plain note')).toBeInTheDocument()
  })
})
