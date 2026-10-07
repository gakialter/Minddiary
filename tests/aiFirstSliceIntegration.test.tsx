import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import ts from 'typescript'
import BetterSqlite3 from 'better-sqlite3'
import AIPanel from '../src/components/AIPanel'
import { createAiApi } from '../src/contexts/api/aiApi'
import { createFirstSliceIpcHandlers } from '../electron/aiFirstSlice'
import { createAiService } from '../electron/aiService'
import type { ElectronAPI, FirstSliceAPI } from '../src/types/api'
import type { DiaryEntry } from '../src/types'
import * as contextBuilder from '../src/utils/aiContextBuilder'

const state = vi.hoisted(() => ({ ai: {} as ReturnType<typeof createAiApi>, settingsData: { aiModel: 'fixture-model', aiApiKeyPresent: true, aiEndpoint: 'https://fixture.invalid/v1', aiVisionEnabled: false } }))
// Control only PDF.js extraction here; composer, reader projection, preload,
// main validation/coordinator, SQLite and aiService remain the production chain.
const pdfExtraction = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn(async () => undefined) }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, getDocument: pdfExtraction.getDocument }))
vi.mock('../src/contexts/DiaryContext', () => ({ useDiary: () => ({ ai: state.ai, settingsData: state.settingsData }) }))
vi.mock('../src/utils/apiAdapter', () => ({ IS_ELECTRON: true }))
vi.mock('../src/components/common/MarkdownRenderer', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
const KEY = 'minddiary.ai.chatHistory'
const canary = '我每天晚上会戴紫色潜水帽学习。'
const comparison = '比较数学 2026-09-07..2026-09-13 和 2026-09-14..2026-09-20 的记录学习时间'
const submit = (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' })
}
function bridge(invoke: (channel: string, payload: unknown) => Promise<unknown>): ElectronAPI {
  let api!: ElectronAPI
  const code = ts.transpileModule(fs.readFileSync('electron/preload.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'process', 'exports', code)(() => ({ contextBridge: { exposeInMainWorld: (name: string, value: ElectronAPI) => { if (name === 'api') api = value } }, ipcRenderer: { invoke } }), { env: {}, platform: 'win32' }, {})
  return api
}
function fixture() {
  const sql = new BetterSqlite3(':memory:')
  sql.exec(`
    CREATE TABLE mistakes(id INTEGER PRIMARY KEY,subject_id INTEGER);
    CREATE TABLE study_tasks(id INTEGER PRIMARY KEY,subject_id INTEGER);
    CREATE TABLE subjects(id INTEGER PRIMARY KEY,name TEXT,total_chapters INTEGER,completed_chapters INTEGER);
    CREATE TABLE subject_chapters(id INTEGER PRIMARY KEY,subject_id INTEGER,title TEXT,sort_order INTEGER,completed INTEGER,notes TEXT);
    CREATE TABLE pomodoro_sessions(id INTEGER PRIMARY KEY,subject_id INTEGER,date_key TEXT,duration REAL);
    INSERT INTO subjects VALUES(1,'线代',3,2),(2,'英语',9,8),(3,'数学',0,0);
    INSERT INTO subject_chapters VALUES(1,1,'第1章',0,1,'NOTES_CANARY'),(2,1,'第2章',1,1,'NOTES_CANARY'),(3,1,'第3章',2,0,'NOTES_CANARY'),(4,2,'ENGLISH_CANARY',0,0,'OTHER_NOTES');
    INSERT INTO pomodoro_sessions VALUES(1,3,'2026-09-10',70),(2,3,'2026-09-17',140),(3,2,'2026-09-10',1000),(4,NULL,'2026-09-17',2000);
  `)
  const settings = new Map([['aiEndpoint', 'https://fixture.invalid/v1'], ['aiModel', 'fixture-model']])
  const stamp = { connectionGeneration: 1, dataRevision: 0, externalDataVersion: 1, observedDate: '2026-09-28' }
  let revision = 0
  const database = {
    getDb: () => sql, getSetting: (key: string) => settings.get(key),
    setSetting: vi.fn((key: string, value: string) => { settings.set(key, value); return { success: true } }),
    getAiApiKey: () => 'FAKE_SECRET', getFirstSliceSourceStamp: () => ({ ...stamp }), getFirstSliceConfigRevision: () => revision,
  }
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: '受控回复' } }] })))
  const handlers = createFirstSliceIpcHandlers({ enabled: true, database, service: createAiService(database, fetchMock) })
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  const event = { sender, senderFrame: { detached: false, processId: 10, routingId: 20 } } as unknown as Pick<Electron.IpcMainInvokeEvent, 'sender' | 'senderFrame'>
  const invoke = vi.fn(async (channel: string, payload: unknown) => {
    if (!channel.startsWith('ai:firstSlice:')) throw new Error(`Unexpected IPC ${channel}`)
    const result = await handlers[channel.slice('ai:firstSlice:'.length) as keyof FirstSliceAPI](event, payload)
    return result
  })
  const api = bridge(invoke)
  window.api = api
  state.ai = createAiApi()
  const originalPrepare = sql.prepare.bind(sql)
  const queries: Array<{ sql: string; args: unknown[] }> = []
  const prepare = vi.spyOn(sql, 'prepare').mockImplementation((source: string) => {
    const statement = originalPrepare(source)
    return new Proxy(statement, { get(target, key) {
      const value = Reflect.get(target, key)
      if (['get', 'all', 'run'].includes(String(key))) return (...args: unknown[]) => {
        queries.push({ sql: source.replace(/\s+/g, ' ').trim(), args })
        return value.apply(target, args)
      }
      return typeof value === 'function' ? value.bind(target) : value
    } })
  })
  return { sql, stamp, settings, database, prepare, originalPrepare, queries, fetchMock, invoke, sender, api,
    changeDestination: () => { revision++ },
    body: (index = fetchMock.mock.calls.length - 1) => String(fetchMock.mock.calls[index]?.[1]?.body),
    calls: (method: string) => invoke.mock.calls.filter(([channel]) => channel === `ai:firstSlice:${method}`),
  }
}
let f: ReturnType<typeof fixture>
let builder: ReturnType<typeof vi.spyOn>
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
function imageFile(name = 'synthetic.png', mime = 'image/png') {
  const bytes = mime === 'image/jpeg' ? new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) : pngBytes
  const file = new File([bytes], name, { type: mime })
  Object.defineProperty(file, 'slice', { value: () => ({ arrayBuffer: async () => bytes.buffer }) })
  return file
}
async function addImages(container: HTMLElement, files = [imageFile()]) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } })
  await waitFor(() => expect(screen.queryByText('读取中')).toBeNull())
  await waitFor(() => expect(screen.queryByText(/仍在读取中/)).toBeNull())
  files.forEach(file => expect(screen.getByText(file.name)).toBeInTheDocument())
}
function textFile(name: string, text: string, mime = 'text/plain') {
  const bytes = new TextEncoder().encode(text)
  const file = new File([bytes], name, { type: mime })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  return file
}
function pdfFile(name = 'lesson.pdf') {
  return textFile(name, '%PDF-1.7\nSYNTHETIC_PDF_BINARY_CANARY\n%%EOF', 'application/pdf')
}
function vision(model = 'deepseek-flash', enabled = false) {
  const endpoint = model === 'deepseek-flash' ? 'https://api.deepseek.com' : 'https://fixture.invalid/v1'
  f.settings.set('aiEndpoint', endpoint); f.settings.set('aiModel', model); f.settings.set('aiVisionEnabled', String(enabled))
  state.settingsData = { ...state.settingsData, aiModel: model, aiEndpoint: endpoint, aiVisionEnabled: enabled }
}
beforeEach(() => {
  pdfExtraction.getDocument.mockReset()
  pdfExtraction.destroy.mockClear()
  pdfExtraction.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1,
    getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'PDF_EXTRACTED_CANARY: The project code is ORCHID-42.' }] }) }),
  }), destroy: pdfExtraction.destroy })
  state.settingsData = { aiModel: 'fixture-model', aiApiKeyPresent: true, aiEndpoint: 'https://fixture.invalid/v1', aiVisionEnabled: false }
  localStorage.clear()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic-preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  builder = vi.spyOn(contextBuilder, 'buildAIContextSections')
  f = fixture()
})
afterEach(() => { cleanup(); f.sql.close(); vi.restoreAllMocks() })

 describe('I4 real AIPanel → adapter → preload → main → SQLite/service', () => {
  it.each([1, 3])('sends %i current images, clears the draft, excludes image replay and subsequent requests', async count => {
    vision()
    const panel = render(<AIPanel entry={null} />)
    const files = Array.from({ length: count }, (_, index) => imageFile(`synthetic-${index}.png`))
    await addImages(panel.container, files)
    submit('请分析图片里这道错题')
    await screen.findByText('受控回复')
    const body = JSON.parse(f.body())
    expect(body.messages.at(-1).content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(count)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(f.fetchMock.mock.calls[0]![1]?.redirect).toBe('error')
    files.forEach(file => expect(screen.queryByText(file.name)).toBeNull())
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
    const sent = await f.invoke.mock.results.find((_, index) => f.invoke.mock.calls[index]![0] === 'ai:firstSlice:send')!.value
    expect(await f.api.ai.firstSlice!.regenerate({ session: (f.calls('send')[0]![1] as { session: string }).session, requestHandle: sent.requestHandle })).toMatchObject({ kind: 'unavailable' })
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(KEY)).not.toMatch(/data:image|base64|synthetic-.*png|blob:/)
    expect(f.queries.filter(query => /INSERT|UPDATE/i.test(query.sql))).toHaveLength(0)
    submit('解释勾股定理')
    await waitFor(() => expect(f.fetchMock).toHaveBeenCalledTimes(2))
    expect(f.body()).not.toMatch(/image_url|data:image/)
    expect(f.body()).toContain('请分析图片里这道错题')
    expect(f.calls('resolveEvidence')).toHaveLength(0)
    panel.unmount(); render(<AIPanel entry={null} />)
    files.forEach(file => expect(screen.queryByText(file.name)).toBeNull())
  })
  it('blocks text models without dropping images, then permits the same draft after switching back', async () => {
    const panel = render(<AIPanel entry={null} />)
    await addImages(panel.container)
    submit('这是什么颜色？')
    expect(screen.getByText('当前模型不支持图片，请切换支持图片的模型或移除图片。')).toBeInTheDocument()
    expect(f.calls('send')).toHaveLength(0); expect(f.fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('synthetic.png')).toBeInTheDocument()
    vision(); panel.rerender(<AIPanel entry={null} />)
    fireEvent.click(screen.getByRole('button', { name: '发送 AI 请求' }))
    await screen.findByText('受控回复')
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
  })
  it('custom vision toggle gates current images and supports JPEG with a default question', async () => {
    const panel = render(<AIPanel entry={null} />)
    await addImages(panel.container, [imageFile('synthetic.jpg', 'image/jpeg')])
    expect(screen.getByRole('button', { name: '发送 AI 请求' })).toBeDisabled()
    vision('custom-vision', true); panel.rerender(<AIPanel entry={null} />)
    fireEvent.click(screen.getByRole('button', { name: '发送 AI 请求' }))
    await screen.findByText('受控回复')
    expect(f.body()).toContain('data:image/jpeg;base64,')
    expect(localStorage.getItem(KEY)).toContain('请分析我附加的图片。')
  })
  it('retains failed image drafts for explicit manual retry without automatically sending', async () => {
    vision(); f.fetchMock.mockRejectedValueOnce(new Error('synthetic failure'))
    const panel = render(<AIPanel entry={null} />)
    await addImages(panel.container); submit('这是什么颜色？')
    await screen.findByText(/回复未采用/)
    expect(screen.getByRole('textbox')).toHaveValue('这是什么颜色？')
    expect(screen.getByText('synthetic.png')).toBeInTheDocument()
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(KEY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '发送 AI 请求' }))
    await screen.findByText('受控回复')
    expect(f.fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('synthetic.png')).toBeNull()
  })
  it('removal sends text only and IME composition/Shift+Enter never sends the image', async () => {
    vision(); const panel = render(<AIPanel entry={null} />)
    await addImages(panel.container)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '这是什么颜色？' } })
    fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Enter' })
    expect(f.fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除附件 synthetic.png' }))
    fireEvent.keyDown(input, { key: 'Enter' }); expect(f.calls('send')).toHaveLength(0)
    fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(f.calls('send')).toHaveLength(0)
    fireEvent.keyDown(input, { key: 'Enter' }); await screen.findByText('受控回复')
    expect(f.body()).not.toMatch(/image_url|data:image/)
  })
  it.each([['stop',''],['stop','  '],['length','PARTIAL_VISIBLE_CANARY'],['length','']])(
    'does not display, cache or reuse incomplete %s / %j as an answer', async (finish_reason, content) => {
    f.fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ choices: [{ finish_reason,
      message: { content, reasoning_content: 'REASONING_EXCLUSION_CANARY' } }] })))
    render(<AIPanel entry={null} />)
    submit('FAILED_USER_CANARY')
    await waitFor(async () => {
      const call=f.invoke.mock.results.find((_,i)=>f.invoke.mock.calls[i]![0]==='ai:firstSlice:send')
      expect(call).toBeDefined()
      expect(await call!.value).toEqual({kind:'failed',possiblySent:true})
    })
    await waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled())
    expect(screen.queryByRole('button', {name:/重新生成/})).toBeNull()
    expect(document.body.textContent).not.toMatch(/PARTIAL_VISIBLE_CANARY|REASONING_EXCLUSION_CANARY/)
    expect(localStorage.getItem(KEY)||'').not.toMatch(/PARTIAL_VISIBLE_CANARY|REASONING_EXCLUSION_CANARY/)
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
    submit('fresh question')
    await screen.findByText('受控回复')
    expect(f.fetchMock).toHaveBeenCalledTimes(2)
    expect(f.body()).not.toMatch(/FAILED_USER_CANARY|PARTIAL_VISIBLE_CANARY|REASONING_EXCLUSION_CANARY/)
  })
  it('ordinary chat sends only current text; cache remains visible across reload without replay handles', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ role: 'user', id: 1, content: 'OLD_USER_CANARY' }, { role: 'assistant', id: 2, content: 'OLD_ASSISTANT_CANARY' }]))
    const panel = render(<AIPanel entry={null} />)
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
    submit('讲克拉默法则')
    await screen.findByText('受控回复')
    expect(screen.getByText('OLD_USER_CANARY')).toBeInTheDocument()
    expect(f.body()).not.toMatch(/OLD_USER_CANARY|OLD_ASSISTANT_CANARY|FAKE_SECRET/)
    expect(f.calls('send')[0]![1]).toEqual({ session: expect.any(String), kind: 'chat', userInput: '讲克拉默法则' })
    expect(f.prepare).not.toHaveBeenCalled()
    expect(builder).not.toHaveBeenCalled()
    const old = (f.calls('send')[0]![1] as { session: string }).session
    panel.unmount()
    await waitFor(() => expect(f.calls('closeSession')).toHaveLength(1))
    render(<AIPanel entry={null} />)
    expect(screen.getByText('受控回复')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
    submit('再讲一个例子')
    await waitFor(() => expect(f.fetchMock).toHaveBeenCalledTimes(2))
    expect((f.calls('send')[1]![1] as { session: string }).session).not.toBe(old)
    expect(f.body()).not.toContain('讲克拉默法则')
  })
  it('S3 reads only identity/chapter projection, Provider 0, no notes or replay', async () => {
    render(<AIPanel entry={null} />)
    submit('线代现在学到哪里？')
    await screen.findByText(/记录里已标完成 2\/3/)
    expect(f.fetchMock).not.toHaveBeenCalled()
    expect(f.calls('resolveEvidence')).toHaveLength(1)
    expect(f.queries.map(query => query.sql)).toEqual([
      'SELECT id, name FROM subjects WHERE name COLLATE BINARY = ? ORDER BY id ASC',
      'SELECT title, sort_order, completed FROM subject_chapters WHERE subject_id = ? ORDER BY sort_order ASC, id ASC',
    ])
    expect(screen.queryByText(/NOTES_CANARY|ENGLISH_CANARY/)).toBeNull()
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
    expect(builder).not.toHaveBeenCalled()
    expect(f.queries.map(query => query.args)).toEqual([['线代'], [1]])
  })
  it('duplicate selection resumes the same main handle, without provider', async () => {
    f.sql.exec("INSERT INTO subjects VALUES(4,'线代',0,0)")
    render(<AIPanel entry={null} />)
    submit('线代现在学到哪里？')
    const candidate = await screen.findByRole('button', { name: '线代（1）' })
    const initialIndex = f.invoke.mock.calls.findIndex(([channel]) => channel === 'ai:firstSlice:resolveEvidence')
    const initial = await f.invoke.mock.results[initialIndex]!.value as Awaited<ReturnType<FirstSliceAPI['resolveEvidence']>>
    expect(initial).toMatchObject({ result: { kind: 'ask_user' } })
    if (!('requestHandle' in initial)) throw new Error('Missing initial duplicate request handle')
    expect(f.fetchMock).not.toHaveBeenCalled()
    fireEvent.click(candidate)
    await screen.findByText(/记录里已标完成 2\/3/)
    const payload = f.calls('resolveEvidence')[1]![1] as { requestHandle: string }
    expect(payload.requestHandle).toBe(initial.requestHandle)
    expect(payload).not.toHaveProperty('userInput')
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  it('S2 clarification has no SQL, fills missing slots and resolves one fixed batch', async () => {
    render(<AIPanel entry={null} />)
    submit('最近数学效率下降。')
    expect(await screen.findByText(/请先确认含义/)).toBeInTheDocument()
    expect(f.prepare).not.toHaveBeenCalled()
    submit('记录学习时间')
    submit('A：2026-09-07..2026-09-13')
    submit('科目：英语')
    expect(f.prepare).not.toHaveBeenCalled()
    submit('B：2026-09-14..2026-09-20')
    await screen.findByText(/数学：A .*记录 70 分钟.*记录 140 分钟/)
    expect(f.calls('resolveEvidence')).toHaveLength(1)
    expect(f.prepare.mock.calls.filter(([sql]) => sql.includes('SUM(duration)'))).toHaveLength(2)
    expect(f.fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '仅保留本机结果' }))
    expect(screen.queryByRole('button', { name: '发送摘要并解释' })).toBeNull()
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  it('S2 sufficient user evidence never queries SQL or sends automatically', async () => {
    render(<AIPanel entry={null} />)
    submit('最近数学效率下降。')
    submit('数学\n2026-09-07..13 = 70 min\n2026-09-14..20 = 140 min\n覆盖未知')
    await screen.findByText(/未经数据库核对/)
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  it('S2 requires explicit share, sends bounded summary once, never adopts it into chat history', async () => {
    render(<AIPanel entry={null} />)
    submit(comparison)
    fireEvent.click(await screen.findByRole('button', { name: '发送摘要并解释' }))
    await screen.findByText('受控回复')
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
    expect(f.body()).toContain('<focus_summary>')
    expect(JSON.parse(f.body()).messages[1].content).toContain('"recordedMinutes":70')
    expect(f.body()).not.toMatch(/NOTES_CANARY|ENGLISH_CANARY|FAKE_SECRET|observedDateCount|sourceCategory/)
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
    submit('讲克拉默法则')
    await waitFor(() => expect(f.fetchMock).toHaveBeenCalledTimes(2))
    expect(f.body()).not.toContain('<focus_summary>')
    expect(f.body()).not.toContain('140')
  })
  it('S2 explanation preserves an unrelated draft, context and attachment without disclosing them', async () => {
    const { container } = render(<AIPanel entry={null} />)
    submit(comparison)
    await screen.findByRole('button', { name: '发送摘要并解释' })
    fireEvent.click(screen.getByRole('button', { name: /错题规律分析/ }))
    const draft = '这是我准备问的下一个问题'
    fireEvent.change(screen.getByRole('textbox'), { target: { value: draft } })
    const file = new File(['UNSENT_ATTACHMENT_CANARY'], 'unsent.txt', { type: 'text/plain' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await screen.findByText(file.name)
    expect(screen.getByText('错题规律')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '发送摘要并解释' }))
    await screen.findByText('受控回复')
    expect(screen.getByRole('textbox')).toHaveValue(draft)
    expect(screen.getByText('错题规律')).toBeInTheDocument()
    expect(screen.getByText(file.name)).toBeInTheDocument()
    expect(f.calls('send')[0]![1]).toEqual({ session: expect.any(String), requestHandle: expect.any(String), kind: 'focus_explanation', userInput: '请根据这份有限的记录学习时间摘要解释，保留未知与局限。', share: true, acceptLimited: false })
    expect(f.body()).toContain('<focus_summary>')
    expect(f.body()).not.toMatch(/这是我准备问的下一个问题|UNSENT_ATTACHMENT_CANARY|unsent.txt|错题规律|NOTES_CANARY|FAKE_SECRET/)
    expect(builder).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await screen.findByText(/当前受控对话暂不支持/)
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
  })
  it('blocked ordinary send removes an outstanding explanation action without sending', async () => {
    render(<AIPanel entry={null} />)
    submit(comparison)
    await screen.findByRole('button', { name: '发送摘要并解释' })
    fireEvent.click(screen.getByRole('button', { name: /错题规律分析/ }))
    submit('下一个问题')
    await screen.findByText(/当前受控对话暂不支持/)
    expect(screen.queryByRole('button', { name: '发送摘要并解释' })).toBeNull()
    expect(f.calls('send')).toHaveLength(0)
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  it('settings replacement with identical sanitized values removes regenerate before any click', async () => {
    const panel = render(<AIPanel entry={null} />)
    submit('讲克拉默法则')
    await screen.findByText('受控回复')
    expect(screen.getByRole('button', { name: /重新生成/ })).toBeInTheDocument()
    state.settingsData = { ...state.settingsData }
    panel.rerender(<AIPanel entry={null} />)
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
    expect(f.calls('regenerate')).toHaveLength(0)
  })
  it('S2 partial result requires limited-summary acknowledgement', async () => {
    const original = f.originalPrepare
    f.prepare.mockImplementation((sql: string) => {
      const statement = original(sql)
      if (!sql.includes('SUM(duration)')) return statement
      return new Proxy(statement, { get(target, key) {
        if (key === 'get') return (...args: unknown[]) => { if (args.includes('2026-09-14')) throw new Error('synthetic read failure'); return target.get(...args) }
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
      } })
    })
    render(<AIPanel entry={null} />)
    submit(comparison)
    expect(await screen.findByRole('button', { name: '发送摘要并解释' })).toBeDisabled()
    expect(f.fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '发送摘要并解释' }))
    await screen.findByText('受控回复')
    expect(f.calls('send')[0]![1]).toMatchObject({ share: true, acceptLimited: true })
  })
  it('revokes whole prefix including assistant derivatives, keeps visible history and permits new self-report', async () => {
    f.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: `助理转述：${canary}` } }] })))
    render(<AIPanel entry={null} />)
    submit(canary)
    await screen.findByText(`助理转述：${canary}`)
    submit('不看日记但帮我分析')
    await screen.findByText(/当前限制已生效/)
    expect(screen.getByText(`助理转述：${canary}`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
    submit('我今天只睡了五个小时，先按我现在说的这些分析')
    await screen.findByText('受控回复')
    expect(f.body()).toContain('我今天只睡了五个小时')
    expect(f.body()).not.toMatch(/紫色潜水帽|助理转述/)
    expect(f.fetchMock).toHaveBeenCalledTimes(2)
  })
  it.each(['取消', '限制'])('in-flight %s reaches main and rejects late output', async action => {
    let release!: (value: Response) => void
    f.fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    render(<AIPanel entry={null} />)
    submit('讲克拉默法则')
    await waitFor(() => expect(f.fetchMock).toHaveBeenCalledTimes(1))
    if (action === '取消') fireEvent.click(screen.getByRole('button', { name: /取消/ }))
    else submit('接下来别再用日记')
    await waitFor(() => expect(f.calls(action === '取消' ? 'cancel' : 'restrict')).toHaveLength(1))
    await act(async () => { release(new Response(JSON.stringify({ choices: [{ message: { content: 'LATE_CANARY' } }] }))) })
    expect(screen.queryByText('LATE_CANARY')).toBeNull()
    expect(localStorage.getItem(KEY) ?? '').not.toContain('LATE_CANARY')
    expect(await screen.findByText(/无法撤回/)).toBeInTheDocument()
  })
  it('valid regenerate uses only a handle; changed destination refuses replay without fetch', async () => {
    render(<AIPanel entry={null} />)
    submit('讲克拉默法则')
    await screen.findByText('受控回复')
    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    await waitFor(() => expect(f.fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: /取消/ })).toBeNull())
    expect(Object.keys(f.calls('regenerate')[0]![1] as object).sort()).toEqual(['requestHandle', 'session'])
    f.changeDestination()
    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }))
    await screen.findByText(/上下文范围已变化/)
    expect(f.fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
  })
  it('clear history closes trusted session and drops hidden reusable prefix', async () => {
    render(<AIPanel entry={null} />)
    submit('OLD_PREFIX')
    await screen.findByText('受控回复')
    fireEvent.click(screen.getByRole('button', { name: /清空历史/ }))
    await waitFor(() => expect(f.calls('closeSession')).toHaveLength(1))
    submit('NEW_CURRENT')
    await screen.findByText('受控回复')
    expect(f.body()).not.toContain('OLD_PREFIX')
    expect(f.calls('openSession')).toHaveLength(2)
  })
  it('restriction precedes selected diary context, with no diary getter or builder use', async () => {
    const content = vi.fn(() => canary)
    const entry = { id: 1 } as DiaryEntry
    Object.defineProperty(entry, 'content', { get: content })
    render(<AIPanel entry={entry} />)
    fireEvent.click(screen.getByRole('button', { name: /总结今日日记/ }))
    submit('不看日记但帮我分析')
    await screen.findByText(/当前限制已生效/)
    expect(content).not.toHaveBeenCalled()
    expect(builder).not.toHaveBeenCalled()
    expect(f.fetchMock).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
  })
  it.each([
    '请分别分析文件文字和图片。',
    '分别总结这两个附件。',
    '分别回答每个问题。',
    '区别是什么？',
    '个别情况需要注意。',
  ])('allows ordinary wording without treating it as a restriction: %s', async userInput => {
    render(<AIPanel entry={null} />)
    submit(userInput)
    await screen.findByText('受控回复')
    expect(f.calls('send')).toHaveLength(1)
    expect(f.calls('restrict')).toHaveLength(0)
    expect(f.calls('cancel')).toHaveLength(0)
    expect(screen.queryByText(/当前限制已生效/)).toBeNull()
    expect(screen.queryByText(/请明确限制范围/)).toBeNull()
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
  })
  it.each([
    '别分析图片。',
    '不要读取附件。',
    '禁止使用图片。',
    '请勿联网。',
    '不要调用工具。',
  ])('keeps an explicit restriction behind the AIPanel gate: %s', async userInput => {
    render(<AIPanel entry={null} />)
    submit(userInput)
    await screen.findByText('请明确限制范围；本次未继续发送。')
    expect(f.calls('cancel')).toHaveLength(1)
    expect(f.calls('restrict')).toHaveLength(0)
    expect(f.calls('send')).toHaveLength(0)
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  it.each([
    '别分析图片。',
    '不要读取附件。',
    '禁止使用图片。',
    '请勿联网。',
    '不要调用工具。',
  ])('rejects a direct preload send that bypasses the renderer gate: %s', async userInput => {
    const firstSlice = f.api.ai.firstSlice!
    const opened = await firstSlice.openSession({})
    expect(opened.kind).toBe('opened')
    if (opened.kind !== 'opened') return

    const result = await firstSlice.send({ session: opened.session, kind: 'chat', userInput })
    expect(result.kind).toBe('unavailable')
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  it('unknown record requests do not fall through to Provider', async () => {
    render(<AIPanel entry={null} />)
    submit('查一下我上周的学习时长')
    await screen.findByText(/当前无法按此问题核对/)
    expect(f.fetchMock).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
  })
  it('durable save failure keeps current refusal and reports persistence honestly', async () => {
    f.database.setSetting.mockImplementation(() => { throw new Error('disk failure') })
    render(<AIPanel entry={null} />)
    submit('以后在这里一直不要发给AI')
    await screen.findByText(/当前限制已生效，但长期偏好未能保存/)
    submit('讲克拉默法则')
    await screen.findByText(/上下文范围已变化/)
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  it('sends ready text files through the narrow contract without persisting or resending their content', async () => {
    const { container } = render(<AIPanel entry={null} />)
    const file = textFile('sample.txt', 'TEXT_ATTACHMENT_CANARY')
    await addImages(container, [file])
    submit('讲克拉默法则')
    await screen.findByText('受控回复')
    expect(f.calls('send')[0]![1]).toEqual({ session: expect.any(String), kind: 'chat', userInput: '讲克拉默法则',
      textAttachments: [{ kind: 'text-file', name: file.name, text: 'TEXT_ATTACHMENT_CANARY' }] })
    expect(f.body()).toContain('TEXT_ATTACHMENT_CANARY')
    expect(screen.queryByText(file.name)).toBeNull()
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(localStorage.getItem(KEY)).not.toMatch(/TEXT_ATTACHMENT_CANARY|sample.txt/)
    expect(f.queries.filter(query => /INSERT|UPDATE/i.test(query.sql))).toHaveLength(0)
    submit('再讲一个例子')
    await waitFor(() => expect(f.fetchMock).toHaveBeenCalledTimes(2))
    expect(f.body()).not.toMatch(/TEXT_ATTACHMENT_CANARY|sample.txt|user_attachments/)
    expect(builder).not.toHaveBeenCalled()
  })
  it('sends PDF extracted text plus current image through AIPanel and the production main/service boundary', async () => {
    vision()
    const panel = render(<AIPanel entry={null} />), file = pdfFile()
    await addImages(panel.container, [file, imageFile()])
    expect(screen.getByText(/已读取 PDF 中可提取的文字/)).toBeInTheDocument()
    submit('What is the project code?')
    await screen.findByText('受控回复')
    const payload = f.calls('send')[0]![1] as { session: string; textAttachments: unknown[]; imageDataUrls: string[] }
    expect(payload.textAttachments).toEqual([{ kind: 'pdf', name: 'lesson.pdf', text: 'PDF_EXTRACTED_CANARY: The project code is ORCHID-42.' }])
    expect(payload.imageDataUrls).toHaveLength(1)
    expect(JSON.stringify(payload)).not.toMatch(/SYNTHETIC_PDF_BINARY_CANARY|application\/pdf;base64|blob:|ArrayBuffer|Uint8Array|[A-Z]:\\/)
    const body = JSON.parse(f.body())
    expect(body.messages.map((message: { role: string }) => message.role)).toEqual(['system', 'user'])
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: expect.stringContaining('PDF_EXTRACTED_CANARY') },
      { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/), detail: 'auto' } },
    ])
    expect(f.body()).toContain('lesson.pdf')
    expect(f.body()).not.toMatch(/SYNTHETIC_PDF_BINARY_CANARY|application\/pdf;base64|blob:|[A-Z]:\\/)
    expect(localStorage.getItem(KEY)).not.toMatch(/PDF_EXTRACTED_CANARY|ORCHID-42|lesson.pdf|data:image|SYNTHETIC_PDF_BINARY_CANARY/)
    expect(f.queries.filter(query => /INSERT|UPDATE/i.test(query.sql))).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /重新生成/ })).toBeNull()
    const sent = await f.invoke.mock.results.find((_, index) => f.invoke.mock.calls[index]![0] === 'ai:firstSlice:send')!.value
    expect(await f.api.ai.firstSlice!.regenerate({ session: payload.session, requestHandle: sent.requestHandle })).toMatchObject({ kind: 'unavailable' })
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
    submit('Explain the next topic')
    await waitFor(() => expect(f.fetchMock).toHaveBeenCalledTimes(2))
    expect(f.body()).not.toMatch(/PDF_EXTRACTED_CANARY|ORCHID-42|lesson.pdf|image_url|data:image|user_attachments/)
    expect(f.calls('send')[1]![1]).toEqual({ session: payload.session, kind: 'chat', userInput: 'Explain the next topic' })
    panel.unmount(); render(<AIPanel entry={null} />)
    expect(screen.queryByText('lesson.pdf')).toBeNull()
    expect(pdfExtraction.destroy).toHaveBeenCalledTimes(1)
  })
  it('retains a failed PDF draft and retries only after another explicit send', async () => {
    f.fetchMock.mockRejectedValueOnce(new Error('synthetic connection failure'))
    const { container } = render(<AIPanel entry={null} />)
    await addImages(container, [pdfFile()])
    submit('What is the project code?')
    await screen.findByText(/回复未采用/)
    expect(screen.getByText('lesson.pdf')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('What is the project code?')
    expect(f.fetchMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(KEY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '发送 AI 请求' }))
    await screen.findByText('受控回复')
    expect(f.fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(f.body()).messages).toHaveLength(2)
    expect(screen.queryByText('lesson.pdf')).toBeNull()
  })
  it('deleting a failed PDF clears its composer error and restores pure text send', async () => {
    pdfExtraction.getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error('Invalid PDF structure')), destroy: pdfExtraction.destroy })
    const { container } = render(<AIPanel entry={null} />)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [pdfFile('broken.pdf')] } })
    await screen.findAllByText(/Invalid PDF structure/)
    submit('Explain a triangle')
    expect(f.fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除附件 broken.pdf' }))
    expect(screen.queryByText(/Invalid PDF structure/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '发送 AI 请求' }))
    await screen.findByText('受控回复')
    expect(f.calls('send')[0]![1]).toEqual({ session: expect.any(String), kind: 'chat', userInput: 'Explain a triangle' })
    expect(f.body()).not.toMatch(/PDF_EXTRACTED_CANARY|broken.pdf|user_attachments/)
  })
  it('unavailable session fails closed without legacy IPC', async () => {
    state.ai.firstSlice.openSession = async () => ({ kind: 'unavailable', reason: 'disabled' })
    render(<AIPanel entry={null} />)
    submit('讲克拉默法则')
    await screen.findByText(/上下文范围已变化/)
    expect(f.invoke).not.toHaveBeenCalled()
    expect(f.fetchMock).not.toHaveBeenCalled()
  })
  it('cancel before session opens causes no Provider send', async () => {
    let release!: (value: Awaited<ReturnType<FirstSliceAPI['openSession']>>) => void
    const actual = state.ai.firstSlice.openSession({})
    state.ai.firstSlice.openSession = () => new Promise(resolve => { release = resolve })
    render(<AIPanel entry={null} />)
    submit('讲克拉默法则')
    fireEvent.click(screen.getByRole('button', { name: /取消/ }))
    await act(async () => { release(await actual) })
    expect(f.calls('cancel')).toHaveLength(1)
    expect(f.fetchMock).not.toHaveBeenCalled()
  })

})
