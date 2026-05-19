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

    fireEvent.change(await screen.findByTestId('tag-name-input'), {
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

    fireEvent.click(await screen.findByTitle('编辑'))
    fireEvent.change(screen.getByTestId('tag-edit-name-1'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByTitle('保存'))

    expect(mocks.showToast).toHaveBeenCalledWith('标签名不能为空', 'error')
    expect(mocks.tagsUpdate).not.toHaveBeenCalled()
  })
})
