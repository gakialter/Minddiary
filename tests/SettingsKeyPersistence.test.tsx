import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/components/Settings'
import { mockSettings } from '../src/data/mockData'
import { showToast } from '../src/components/Toast'

const mocks = vi.hoisted(() => ({ useDiary: vi.fn() }))
vi.mock('../src/contexts/DiaryContext', () => ({ useDiary: mocks.useDiary }))
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }))

let credential: string | undefined
let replacement: string
let updateAI: ReturnType<typeof vi.fn>
let updateGeneral: ReturnType<typeof vi.fn>

async function advance(ms = 500) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function mount() {
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(<Settings />) })
  await advance(1000)
  vi.mocked(showToast).mockClear()
  updateAI.mockClear()
  return view
}

function input(value: string) {
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value } })
}

function editorVisible() { return !!screen.queryByPlaceholderText('输入新 API Key（留空保持不变）') }
function savedNotice() { return vi.mocked(showToast).mock.calls.some(([message, type]) => message === '设置已保存' && type === 'success') }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  credential = crypto.randomUUID()
  replacement = crypto.randomUUID()
  updateAI = vi.fn(async (patch: { aiApiKey?: string; clearAiApiKey?: boolean }) => {
    if (patch.clearAiApiKey) credential = undefined
    else if (patch.aiApiKey) credential = patch.aiApiKey
    return { success: true }
  })
  updateGeneral = vi.fn().mockResolvedValue({ success: true })
  mocks.useDiary.mockReturnValue({
    theme: 'system', changeTheme: vi.fn(),
    settings: {
      getAll: vi.fn().mockResolvedValue({ ...mockSettings, aiApiKeyPresent: true, aiApiKeyMasked: '********' }),
      updateGeneral, updateAI, updateBackup: vi.fn().mockResolvedValue({ success: true }),
    },
  })
})
afterEach(() => { vi.useRealTimers() })

describe('API Key editing and asynchronous persistence', () => {
  it('commits a first credential without an existing Key', async () => {
    credential = undefined
    mocks.useDiary().settings.getAll.mockResolvedValue({ ...mockSettings, aiApiKeyPresent: false, aiApiKeyMasked: null })
    await mount()
    input(replacement)
    await advance()
    expect(credential === replacement).toBe(true)
    expect(savedNotice()).toBe(true)
  })

  it('an ordinary settings debounce reads the latest Key before acknowledging a save', async () => {
    await act(async () => { render(<Settings />) })
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    await advance(16)
    input(replacement)
    await advance(1200)
    expect(credential === replacement).toBe(true)
    expect(editorVisible()).toBe(true)
    expect(savedNotice()).toBe(true)
  })

  it('typing restarts a pending ordinary settings debounce instead of committing a partial Key early', async () => {
    await mount()
    const original = credential
    fireEvent.click(screen.getByLabelText('自动保存'))
    await advance(350)
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    input(replacement.slice(0, 4))
    await advance(200)
    expect(credential === original).toBe(true)
    expect(savedNotice()).toBe(false)
    input(replacement)
    await advance()
    expect(credential === replacement).toBe(true)
  })

  it('opening and waiting keeps editing without a replacement or success claim', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    await advance(1200)
    expect(editorVisible()).toBe(true)
    expect(updateAI.mock.calls.some(([patch]) => 'aiApiKey' in patch || patch.clearAiApiKey)).toBe(false)
    expect(savedNotice()).toBe(false)
  })

  it.each([16, 316, 900])('commits fresh input after %i ms and only then reports success', async delay => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    await advance(delay)
    expect(editorVisible()).toBe(true)
    input(replacement)
    await advance()
    expect(credential === replacement).toBe(true)
    expect(editorVisible()).toBe(true)
    expect(savedNotice()).toBe(true)
  })

  it('restarts the debounce during slow typing and commits the full paste', async () => {
    await mount()
    const original = credential
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    for (let end = 1; end <= 4; end += 1) {
      input(replacement.slice(0, end))
      await advance(300)
      expect(credential === original).toBe(true)
      expect(editorVisible()).toBe(true)
    }
    input(replacement)
    await advance()
    expect(credential === replacement).toBe(true)
  })

  it('explicit save immediately commits and cancels the duplicate timer', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    input(replacement)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存设置' })) })
    expect(credential === replacement).toBe(true)
    await advance(1200)
    expect(updateAI.mock.calls.filter(([patch]) => !!patch.aiApiKey).length).toBe(1)
  })

  it('does not interrupt typing across pauses longer than the autosave debounce', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    for (let end = 1; end <= 3; end += 1) {
      input(replacement.slice(0, end))
      await advance(700)
      expect(editorVisible()).toBe(true)
      expect(credential === replacement.slice(0, end)).toBe(true)
    }
    input(replacement)
    await advance()
    expect(credential === replacement).toBe(true)
  })

  it('empty or whitespace input preserves the credential and editor with accurate feedback', async () => {
    await mount()
    const original = credential
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    input('   ')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存设置' })) })
    expect(credential === original).toBe(true)
    expect(editorVisible()).toBe(true)
    expect(savedNotice()).toBe(false)
    expect(vi.mocked(showToast).mock.calls.some(([message]) => String(message).includes('未保存'))).toBe(true)
  })

  it('normal settings still autosave while an empty Key editor stays open', async () => {
    await mount()
    const original = credential
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    fireEvent.click(screen.getByLabelText('自动保存'))
    await advance()
    expect(updateGeneral.mock.calls[updateGeneral.mock.calls.length - 1]?.[0].autoSave).toBe(false)
    expect(credential === original).toBe(true)
    expect(editorVisible()).toBe(true)
    expect(savedNotice()).toBe(false)
  })

  it('an in-flight old save cannot erase a newer draft or finish after its commit', async () => {
    await mount()
    let release!: () => void
    const first = crypto.randomUUID()
    let writes = 0
    updateAI.mockImplementation(async (patch: { aiApiKey?: string }) => {
      if (patch.aiApiKey) {
        writes += 1
        if (writes === 1) await new Promise<void>(resolve => { release = resolve })
        credential = patch.aiApiKey
      }
      return { success: true }
    })
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    input(first)
    await advance()
    input(replacement)
    await advance()
    // The later credential write must wait for the earlier write to settle.
    expect(writes).toBe(1)
    await act(async () => { release() })
    await advance()
    expect(credential === replacement).toBe(true)
    expect(editorVisible()).toBe(true)
  })

  it('ignores a stale acknowledgement while newer text is still awaiting debounce', async () => {
    await mount()
    let release!: () => void
    updateAI.mockImplementationOnce(async () => new Promise(resolve => { release = () => resolve({ success: true }) }))
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    input(crypto.randomUUID())
    await advance()
    input(replacement)
    await act(async () => { release() })
    expect(editorVisible()).toBe(true)
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value === replacement).toBe(true)
    expect(savedNotice()).toBe(false)
    await advance()
    expect(credential === replacement).toBe(true)
  })

  it('supports dedicated clearing, cancelling it, and a replacement instead of clearing', async () => {
    await mount()
    const original = credential
    fireEvent.click(screen.getByRole('button', { name: '清除 Key' }))
    fireEvent.click(screen.getByRole('button', { name: '取消清除' }))
    await advance()
    expect(credential === original).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '清除 Key' }))
    input(replacement)
    await advance()
    expect(credential === replacement).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存设置' })) })
    fireEvent.click(screen.getByRole('button', { name: '清除 Key' }))
    await advance()
    expect(credential === undefined).toBe(true)
  })

  it('keeps failed input for explicit retry and cancels unsubmitted edits on unmount', async () => {
    const view = await mount()
    updateAI.mockRejectedValueOnce(new Error('Synthetic persistence failure'))
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    input(replacement)
    await advance()
    expect(editorVisible()).toBe(true)
    expect(savedNotice()).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存设置' })) })
    expect(credential === replacement).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    input(crypto.randomUUID())
    view.unmount()
    await advance()
    expect(credential === replacement).toBe(true)
  })

  it('does not dispatch an obsolete Key when earlier settings I/O delays the save', async () => {
    const view = await mount()
    let release!: () => void
    updateGeneral.mockImplementationOnce(async () => new Promise(resolve => { release = () => resolve({ success: true }) }))
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    input(replacement)
    await advance()
    view.unmount()
    await act(async () => { release() })
    expect(updateAI.mock.calls.some(([patch]) => !!patch.aiApiKey)).toBe(false)
  })
})
