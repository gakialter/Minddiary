import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DiaryPolishPopover from '../src/components/common/DiaryPolishPopover'
import type { PolishReview } from '../src/components/common/useDiaryPolish'

const target = { identity: 'entry-1', document: '今天读书', from: 0, to: 4, source: '今天读书' }

function makeReview(overrides: Partial<PolishReview> = {}): PolishReview {
  return {
    target, action: 'polish', loading: false, stale: false, error: '', candidate: '今天认真读书', candidateReady: true,
    ...overrides,
  }
}

function mount(review: PolishReview, overrides: Partial<React.ComponentProps<typeof DiaryPolishPopover>> = {}) {
  const onClose = vi.fn()
  const onRegenerate = vi.fn()
  const onCandidateChange = vi.fn()
  const onApply = vi.fn()
  const props = { review, onClose, onRegenerate, onCandidateChange, onApply, ...overrides }
  const view = render(<DiaryPolishPopover {...props} />)
  return { ...view, onClose, onRegenerate, onCandidateChange, onApply }
}

describe('DiaryPolishPopover candidate editing', () => {
  it('shows controlled editing and emits edits without changing the original source', () => {
    const onCandidateChange = vi.fn()
    const view = mount(makeReview(), { onCandidateChange })
    const field = screen.getByRole('textbox', { name: '候选文本' }) as HTMLTextAreaElement

    fireEvent.change(field, { target: { value: '另一个候选' } })

    expect(onCandidateChange).toHaveBeenCalledWith('另一个候选')
    expect(field.value).toBe('今天认真读书')
    expect(screen.getByText('今天读书')).toBeTruthy()
  })

  it('keeps the candidate field visible when an edited candidate is empty', () => {
    mount(makeReview({ candidate: '', candidateReady: true }))

    expect((screen.getByRole('textbox', { name: '候选文本' }) as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByRole('button', { name: '应用' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('候选不能为空')
  })

  it.each([
    ['', '候选不能为空'],
    ['   ', '候选不能为空'],
    ['候选\n第二行', '格式标记'],
    ['*加粗*', '格式标记'],
    ['长'.repeat(121), '过长'],
  ])('disables apply and explains invalid candidate %j', (candidate, expected) => {
    mount(makeReview({ candidate }))

    expect((screen.getByRole('button', { name: '应用' }) as HTMLButtonElement).disabled).toBe(true)
    const validation = screen.getByRole('alert')
    expect(validation.textContent).toMatch(new RegExp(expected))
  })

  it('allows a valid plain text candidate', () => {
    mount(makeReview({ candidate: '更自然的候选文本' }))

    expect((screen.getByRole('button', { name: '应用' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retains the editable candidate while a new generation is loading', () => {
    mount(makeReview({ loading: true, candidate: '正在编辑的旧候选' }))

    expect((screen.getByRole('textbox', { name: '候选文本' }) as HTMLTextAreaElement).value).toBe('正在编辑的旧候选')
    expect(screen.getByRole('status').textContent).toBe('正在生成候选。继续修改正文会取消本次结果。')
    expect((screen.getByRole('button', { name: '应用' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the previous candidate editable and applicable after a request failure', () => {
    mount(makeReview({ error: '网络错误' }))

    expect(screen.getByText('网络错误')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: '候选文本' }) as HTMLTextAreaElement).value).toBe('今天认真读书')
    expect((screen.getByRole('button', { name: '应用' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('calls close on Escape and on the discard button', () => {
    const { onClose } = mount(makeReview())

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))

    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
