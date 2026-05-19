import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TagManager from '../src/components/TagManager'

const mocks = vi.hoisted(() => ({
  tagsGetAll: vi.fn(),
  tagsCreate: vi.fn(),
  tagsUpdate: vi.fn(),
  tagsDelete: vi.fn(),
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
  showToast: vi.fn(),
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
})
