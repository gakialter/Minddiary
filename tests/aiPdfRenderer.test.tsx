// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AIPanel from '../src/components/AIPanel'
import type { AIComposerAttachment } from '../src/utils/aiAttachmentPolicy'

const mocks = vi.hoisted(() => ({
  send: vi.fn(), restrict: vi.fn(), resolveEvidence: vi.fn(), reader: vi.fn(), openSession: vi.fn(),
}))
vi.mock('../src/contexts/DiaryContext', () => ({ useDiary: () => ({
  settingsData: { aiModel: 'deepseek-flash', aiEndpoint: 'https://api.deepseek.com', aiVisionEnabled: true },
  ai: { firstSlice: {
    openSession: mocks.openSession, closeSession: vi.fn(),
    send: mocks.send, restrict: mocks.restrict, resolveEvidence: mocks.resolveEvidence,
  } },
}) }))
vi.mock('../src/components/common/MarkdownRenderer', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../src/utils/aiAttachmentReader', () => ({
  createReadingAIComposerAttachment: (file: File) => ({ id: file.name, name: file.name, kind: file.type.startsWith('image/') ? 'image' : 'pdf', status: 'reading', size: file.size, mimeType: file.type, reusable: true }),
  readAIComposerFile: mocks.reader,
}))

const pdf = (name = 'paper.pdf') => new File(['PDF_BINARY_CANARY'], name, { type: 'application/pdf' })
const submit = (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' })
}
async function attach(container: HTMLElement, files: File[]) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } })
  await waitFor(() => expect(screen.queryByText('读取中')).toBeNull())
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  mocks.send.mockResolvedValue({ kind: 'answer', content: 'fixture reply', requestHandle: 'handle' })
  mocks.openSession.mockResolvedValue({ kind: 'opened', session: 'fixture-session' })
  mocks.reader.mockImplementation(async (file: File, _existing: AIComposerAttachment[], id: string): Promise<AIComposerAttachment> => ({
    id, name: file.name, kind: file.type.startsWith('image/') ? 'image' : file.name.endsWith('.txt') ? 'text-file' : 'pdf',
    status: 'ready', size: file.size, mimeType: file.type, reusable: true,
    ...(file.type.startsWith('image/') ? { dataUrl: 'data:image/png;base64,AAAA' } : { extractedText: `TEXT_CANARY ${file.name}`, pageCount: 1, textPageCount: 1 }),
  }))
})
afterEach(cleanup)

describe('PDF explicit renderer send', () => {
  it('does not send a PDF removed while waiting for the session', async () => {
    let opened!: (value: { kind: string; session: string }) => void
    mocks.openSession.mockReturnValueOnce(new Promise(resolve => { opened = resolve }))
    const panel = render(<AIPanel entry={null} />)
    await attach(panel.container, [pdf()])
    submit('question')
    fireEvent.click(screen.getByRole('button', { name: '删除附件 paper.pdf' }))
    opened({ kind: 'opened', session: 'fixture-session' })
    await screen.findByText('附件已变化，请确认当前草稿后重新发送。')
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('projects mixed PDF/text/image content, routes attachment questions to chat, clears sent files, and excludes subsequent/replay payloads', async () => {
    const panel = render(<AIPanel entry={null} />)
    await attach(panel.container, [pdf(), new File(['TEXT_BINARY'], 'notes.txt', { type: 'text/plain' }), new File(['IMG_BINARY'], 'photo.png', { type: 'image/png' })])
    expect(screen.getByText('已读取 PDF 中可提取的文字')).toBeInTheDocument()
    submit('比较数学 2026-09-07..2026-09-13 和 2026-09-14..2026-09-20 的记录学习时间')
    await screen.findByText('fixture reply')
    const payload = mocks.send.mock.calls[0]![0]
    expect(payload.kind).toBe('chat')
    expect(payload.textAttachments).toEqual([
      { kind: 'pdf', name: 'paper.pdf', text: 'TEXT_CANARY paper.pdf' },
      { kind: 'text-file', name: 'notes.txt', text: 'TEXT_CANARY notes.txt' },
    ])
    expect(payload.imageDataUrls).toEqual(['data:image/png;base64,AAAA'])
    expect(JSON.stringify(payload)).not.toMatch(/PDF_BINARY_CANARY|TEXT_BINARY|IMG_BINARY|extractedText|mimeType|pageCount|previewUrl/)
    expect(mocks.resolveEvidence).not.toHaveBeenCalled()
    expect(screen.queryByText('paper.pdf')).toBeNull()
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
    expect(localStorage.getItem('minddiary.ai.chatHistory')).not.toContain('TEXT_CANARY')
    submit('解释勾股定理')
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2))
    expect(mocks.send.mock.calls[1]![0]).not.toHaveProperty('textAttachments')
    expect(mocks.send.mock.calls[1]![0]).not.toHaveProperty('imageDataUrls')
  })

  it('supplies a default question for PDF-only sends and retains failure for explicit retry', async () => {
    mocks.send.mockResolvedValueOnce({ kind: 'failed', possiblySent: true })
    const panel = render(<AIPanel entry={null} />)
    await attach(panel.container, [pdf()])
    fireEvent.click(screen.getByRole('button', { name: '发送 AI 请求' }))
    await screen.findByText(/回复未采用/)
    expect(mocks.send.mock.calls[0]![0].userInput).toBe('请根据我附加的文件文字概括主要内容。')
    expect(screen.getByText('paper.pdf')).toBeInTheDocument()
    expect(mocks.send).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '发送 AI 请求' }))
    await screen.findByText('fixture reply')
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('paper.pdf')).toBeNull()
  })

  it.each(['error', 'empty', 'budget'])('blocks %s PDF before API send and restores pure text after removal', async mode => {
    mocks.reader.mockImplementationOnce(async (file: File, _existing: AIComposerAttachment[], id: string) => ({
      id, kind: 'pdf', name: file.name, mimeType: file.type, size: file.size, reusable: true,
      status: mode === 'error' ? 'error' : 'ready', error: mode === 'error' ? 'bad PDF' : undefined,
      extractedText: mode === 'budget' ? 'a'.repeat(20_001) : '',
    }))
    const panel = render(<AIPanel entry={null} />)
    await attach(panel.container, [pdf()])
    submit('question')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '发送 AI 请求' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '删除附件 paper.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: '发送 AI 请求' }))
    await screen.findByText('fixture reply')
    expect(mocks.send.mock.calls[0]![0]).not.toHaveProperty('textAttachments')
  })

  it('gives restrictions precedence over current PDF material', async () => {
    mocks.restrict.mockResolvedValue({ kind: 'restricted', applied: true })
    const panel = render(<AIPanel entry={null} />)
    await attach(panel.container, [pdf()])
    submit('接下来这段不要用日记')
    await waitFor(() => expect(mocks.restrict).toHaveBeenCalledTimes(1))
    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.getByText('paper.pdf')).toBeInTheDocument()
  })
})
