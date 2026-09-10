import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TagManager from '../src/components/TagManager'

const mocks = vi.hoisted(() => ({
  tagsGetAll: vi.fn(),
  tagsCreate: vi.fn(),
  tagsUpdate: vi.fn(),
  tagsDelete: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../src/contexts/DiaryContext', () => ({
  useDiary: () => ({
    tags: {
      getAll: mocks.tagsGetAll,
      create: mocks.tagsCreate,
      update: mocks.tagsUpdate,
      delete: mocks.tagsDelete,
    },
  }),
}))

vi.mock('../src/components/Toast', () => ({
  showToast: mocks.showToast,
}))

describe('TagManager styled tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tagsGetAll.mockResolvedValue([])
    mocks.tagsCreate.mockResolvedValue({
      id: 1,
      name: 'focus',
      color: '#0F766E',
      icon: '🌿',
      variant: 'solid',
      pattern: 'dots',
    })
    mocks.tagsUpdate.mockResolvedValue({})
    mocks.tagsDelete.mockResolvedValue(true)
  })

  it('creates tags with icon, variant, and pattern fields', async () => {
    render(<TagManager />)

    const nameInput = await screen.findByLabelText('标签名称')
    expect(nameInput).toHaveAttribute('id', 'tag-name')
    fireEvent.change(nameInput, {
      target: { value: 'focus' },
    })
    fireEvent.change(screen.getByTestId('tag-icon-input'), {
      target: { value: ' 🌿 ' },
    })
    fireEvent.change(screen.getByTestId('tag-variant-select'), {
      target: { value: 'solid' },
    })
    fireEvent.change(screen.getByTestId('tag-pattern-select'), {
      target: { value: 'dots' },
    })
    fireEvent.click(screen.getByTestId('tag-create-button'))

    await waitFor(() => {
      expect(mocks.tagsCreate).toHaveBeenCalledWith({
        name: 'focus',
        color: '#0F766E',
        icon: '🌿',
        variant: 'solid',
        pattern: 'dots',
      })
    })
  })

  it('keeps solid tag colors while using readable foregrounds for orange and dark green', async () => {
    mocks.tagsGetAll.mockResolvedValue([
      { id: 1, name: 'orange', color: '#C65A3A', variant: 'solid', pattern: 'none' },
      { id: 2, name: 'green', color: '#0F766E', variant: 'solid', pattern: 'none' },
    ])
    render(<TagManager />)
    expect(await screen.findByTestId('tag-badge-1')).toHaveStyle({ backgroundColor: '#C65A3A', color: '#000000' })
    expect(screen.getByTestId('tag-badge-2')).toHaveStyle({ backgroundColor: '#0F766E', color: '#FFFFFF' })
    expect(mocks.tagsUpdate).not.toHaveBeenCalled()
  })

  it('exposes the selected preset color without relying on color alone', async () => {
    render(<TagManager />)

    const initialColor = await screen.findByRole('button', { name: '专属识别色：#0F766E' })
    const nextColor = screen.getByRole('button', { name: '专属识别色：#2F8F6B' })

    expect(initialColor).toHaveAttribute('aria-pressed', 'true')
    expect(nextColor).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(nextColor)

    expect(initialColor).toHaveAttribute('aria-pressed', 'false')
    expect(nextColor).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows feedback when saving an edited tag with an empty name', async () => {
    mocks.tagsGetAll.mockResolvedValue([
      {
        id: 1,
        name: 'focus',
        color: '#0F766E',
        icon: '',
        variant: 'soft',
        pattern: 'none',
      },
    ])

    render(<TagManager />)

    fireEvent.click(await screen.findByRole('button', { name: '编辑标签 focus' }))
    const editName = screen.getByLabelText('标签名称', { selector: 'input#tag-edit-1-name' })
    expect(editName).toHaveAttribute('id', 'tag-edit-1-name')
    fireEvent.change(editName, {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存标签 focus' }))

    expect(mocks.showToast).toHaveBeenCalledWith('标签名不能为空', 'error')
    expect(mocks.tagsUpdate).not.toHaveBeenCalled()
  })

  it('keeps the existing edit path and exposes exact action names', async () => {
    mocks.tagsGetAll.mockResolvedValue([
      {
        id: 1,
        name: 'focus',
        color: '#0F766E',
        icon: '',
        variant: 'soft',
        pattern: 'none',
      },
    ])

    render(<TagManager />)

    expect(await screen.findByRole('button', { name: '编辑标签 focus' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '随机更换标签 focus 的颜色' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除标签 focus' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '编辑标签 focus' }))
    fireEvent.change(screen.getByLabelText('标签名称', { selector: 'input#tag-edit-1-name' }), { target: { value: '深度学习' } })
    fireEvent.click(screen.getByRole('button', { name: '保存标签 focus' }))

    await waitFor(() => {
      expect(mocks.tagsUpdate).toHaveBeenCalledWith(1, {
        name: '深度学习',
        color: '#0F766E',
        icon: '',
        variant: 'soft',
        pattern: 'none',
      })
    })
  })
})
