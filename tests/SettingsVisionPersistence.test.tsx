import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/components/Settings'
import AIPanel from '../src/components/AIPanel'
import { DiaryProvider } from '../src/contexts/DiaryContext'
import { mockSettings } from '../src/data/mockData'
import type { ElectronSettingsAPI, SanitizedSettings } from '../src/types/api'

const IMAGE_DATA_URL = 'data:image/png;base64,aW1hZ2U='
const UNSUPPORTED_IMAGE = '当前模型不支持图片，请切换支持图片的模型或移除图片。'

const mocks = vi.hoisted(() => ({
  firstSlice: { openSession: vi.fn(), closeSession: vi.fn(), send: vi.fn() },
}))

vi.mock('../src/utils/apiAdapter', () => ({ IS_ELECTRON: true }))
// Preserve the real DiaryBridge and SettingsProvider; unrelated data initialization
// and the privileged AI transport are outside this renderer integration test.
vi.mock('../src/contexts/DataContext', () => ({
  DataProvider: ({ children }: { children: ReactNode }) => children,
  useData: () => ({ dataReady: true, initErrors: [], ai: { firstSlice: mocks.firstSlice } }),
}))
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }))
vi.mock('../src/components/common/MarkdownRenderer', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
// Only file-reading I/O is substituted. AIPanel, useAIComposer, capability
// resolution, settings hydration, and the actual file input/send UI stay real.
vi.mock('../src/utils/aiAttachmentReader', () => ({
  createReadingAIComposerAttachment: (file: File) => ({
    id: file.name, kind: 'image', name: file.name, mimeType: file.type,
    size: file.size, status: 'reading', reusable: true,
  }),
  readAIComposerFile: async (file: File) => ({
    id: file.name, kind: 'image', name: file.name, mimeType: file.type,
    size: file.size, status: 'ready', reusable: true, dataUrl: IMAGE_DATA_URL,
  }),
}))

let persisted: Record<string, unknown>
let settingsAPI: ElectronSettingsAPI

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  persisted = {
    ...mockSettings,
    aiEndpoint: 'https://custom.example.test/v1',
    aiModel: 'custom-vision-model',
    aiVisionEnabled: 'false',
    aiApiKeyPresent: true,
    aiApiKeyMasked: '********',
  }
  settingsAPI = {
    getAll: vi.fn<ElectronSettingsAPI['getAll']>().mockImplementation(async () => (
      { ...persisted } as unknown as SanitizedSettings
    )),
    updateGeneral: vi.fn<ElectronSettingsAPI['updateGeneral']>().mockResolvedValue({ success: true }),
    updateAI: vi.fn<ElectronSettingsAPI['updateAI']>().mockImplementation(async patch => {
      persisted = { ...persisted, ...patch, aiVisionEnabled: String(patch.aiVisionEnabled) }
      return { success: true }
    }),
    updateBackup: vi.fn<ElectronSettingsAPI['updateBackup']>().mockResolvedValue({ success: true }),
    selectBackupFolder: vi.fn<ElectronSettingsAPI['selectBackupFolder']>().mockResolvedValue(null),
    selectBackupFile: vi.fn<ElectronSettingsAPI['selectBackupFile']>().mockResolvedValue(null),
    restoreBackupFromZip: vi.fn<ElectronSettingsAPI['restoreBackupFromZip']>().mockResolvedValue({ success: false }),
  }
  window.api.settings = settingsAPI
  mocks.firstSlice.openSession.mockResolvedValue({ kind: 'opened', session: 'vision-session' })
  mocks.firstSlice.closeSession.mockResolvedValue({ kind: 'closed' })
  mocks.firstSlice.send.mockResolvedValue({ kind: 'answer', requestHandle: 'image-request', content: '图片回答' })
})

afterEach(() => { localStorage.clear() })

function mountSettingsAndPanel() {
  return render(<DiaryProvider><Settings /><AIPanel entry={null} /></DiaryProvider>)
}

async function attachAndCheckSending(container: HTMLElement, supported: boolean) {
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
  fireEvent.change(fileInput, { target: { files: [new File(['image'], 'vision.png', { type: 'image/png' })] } })
  const send = screen.getByRole('button', { name: '发送 AI 请求' })
  expect(await screen.findByRole('button', { name: '删除附件 vision.png' })).toBeInTheDocument()
  if (supported) {
    await waitFor(() => expect(send).toBeEnabled())
    expect(screen.queryByText(UNSUPPORTED_IMAGE)).not.toBeInTheDocument()
    const sentBefore = mocks.firstSlice.send.mock.calls.length
    fireEvent.click(send)
    await waitFor(() => expect(mocks.firstSlice.send).toHaveBeenCalledTimes(sentBefore + 1))
    expect(mocks.firstSlice.send).toHaveBeenLastCalledWith({
      session: 'vision-session', kind: 'chat', userInput: '请分析我附加的图片。',
      imageDataUrls: [IMAGE_DATA_URL],
    })
    // A completed image-only send clears its draft, so a next turn cannot
    // accidentally retain this attachment.
    await waitFor(() => expect(send).toBeDisabled())
    expect(screen.queryByRole('button', { name: '删除附件 vision.png' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/向小研提问/), { target: { value: 'Hello again' } })
    fireEvent.click(send)
    await waitFor(() => expect(mocks.firstSlice.send).toHaveBeenCalledTimes(sentBefore + 2))
    expect(mocks.firstSlice.send).toHaveBeenLastCalledWith({
      session: 'vision-session', kind: 'chat', userInput: 'Hello again',
    })
  } else {
    await waitFor(() => expect(screen.getByText(UNSUPPORTED_IMAGE)).toBeInTheDocument())
    expect(send).toBeDisabled()
    fireEvent.click(send)
    // Enter follows the handler path directly, independently of button disablement.
    fireEvent.keyDown(screen.getByPlaceholderText(/向小研提问/), { key: 'Enter' })
    expect(mocks.firstSlice.send).not.toHaveBeenCalled()
  }
}

describe('persisted vision settings across the Settings and AI Panel surfaces', () => {
  it.each([['true', true], ['false', false]] as const)(
    'keeps custom checkbox and image-only sending consistent for persisted %s after remount',
    async (storedValue, supported) => {
      persisted.aiVisionEnabled = storedValue
      for (let mount = 0; mount < 2; mount += 1) {
        const view = mountSettingsAndPanel()
        const checkbox = await screen.findByRole('checkbox', { name: /此模型支持图片输入/ })
        await waitFor(() => expect(checkbox).toHaveProperty('checked', supported))
        await attachAndCheckSending(view.container, supported)
        view.unmount()
        expect(persisted.aiVisionEnabled).toBe(storedValue)
      }
      // Both Settings.loadSettings and provider initialization cross getAll
      // again when the renderer tree is recreated.
      expect(settingsAPI.getAll).toHaveBeenCalledTimes(4)
    },
  )

  it('saves an enabled custom model, keeps string storage, and sends images after renderer remount', async () => {
    const initial = mountSettingsAndPanel()
    const checkbox = await screen.findByRole('checkbox', { name: /此模型支持图片输入/ })
    expect(checkbox).not.toBeChecked()
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(settingsAPI.updateAI).toHaveBeenCalledWith(expect.objectContaining({ aiVisionEnabled: true })))
    await attachAndCheckSending(initial.container, true)
    initial.unmount()
    expect(persisted.aiVisionEnabled).toBe('true')

    const reloaded = mountSettingsAndPanel()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /此模型支持图片输入/ })).toBeChecked())
    await attachAndCheckSending(reloaded.container, true)
    reloaded.unmount()
    expect(persisted.aiVisionEnabled).toBe('true')
  })

  it.each([
    ['deepseek-flash', 'false', true],
    ['deepseek-flash', 'true', true],
    ['deepseek-v4-pro', 'false', false],
    ['deepseek-v4-pro', 'true', false],
  ] as const)('preserves preset %s image capability with stored toggle %s', async (model, toggle, supported) => {
    persisted = { ...persisted, aiEndpoint: 'https://api.deepseek.com', aiModel: model, aiVisionEnabled: toggle }
    const view = mountSettingsAndPanel()
    await screen.findByText(`当前模型：${supported ? '支持图片' : '仅文字'}`)
    expect(screen.queryByRole('checkbox', { name: /此模型支持图片输入/ })).not.toBeInTheDocument()
    await attachAndCheckSending(view.container, supported)
    view.unmount()
  })
})
