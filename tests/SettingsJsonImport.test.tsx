import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/components/Settings'
import { useDiary } from '../src/contexts/DiaryContext'
import { showToast } from '../src/components/Toast'
import type { DiaryContextValue } from '../src/types/api'
import type { NewEntry, Subject } from '../src/types'

vi.mock('../src/contexts/DiaryContext', () => ({ useDiary: vi.fn() }))
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }))
vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn() } }))

const subject = { id: 73, name: '数学', color: '#355c7d', total_chapters: 10, completed_chapters: 4 }
const entry: NewEntry = { date: '2026-10-09', title: '合成日记', content: '合成正文', mood: null }
const backup = () => ({ version: '1.20.0', data: {
  entries: [entry], tags: [], subjects: [subject],
  mistakes: [{ subject_id: subject.id, question: '合成错题', answer: '合成答案', mastered: 1 }],
} })
const confirmation = '继续合并导入？同日的日记会被更新，同名科目会尝试更新，错题会新增；标签会尝试新增。'

describe('Settings JSON merge import', () => {
  let input: HTMLInputElement | undefined
  let rows: Subject[]
  let entries: (NewEntry & { id: number })[]
  let api: ReturnType<typeof makeApi>

  function makeApi() {
    return {
      theme: 'system', changeTheme: vi.fn(), requestDataRefresh: vi.fn(),
      settings: {
        getAll: vi.fn().mockResolvedValue({ aiApiKeyPresent: false }),
        updateGeneral: vi.fn(), updateAI: vi.fn(), updateBackup: vi.fn(),
        selectBackupFile: vi.fn().mockResolvedValue('C:\\synthetic\\backup.zip'),
        restoreBackupFromZip: vi.fn().mockResolvedValue({ success: true }),
      },
      entries: {
        getByDate: vi.fn(async (date: string) => entries.find(row => row.date === date)),
        create: vi.fn(async (data: NewEntry) => { const row = { ...data, id: entries.length + 1 }; entries.push(row); return row }),
        update: vi.fn(async (id: number, data: NewEntry): Promise<(NewEntry & { id: number }) | undefined> => { const row = { ...data, id }; entries = entries.map(old => old.id === id ? row : old); return row }),
      },
      tags: { getAll: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 1 }) },
      subjects: {
        getAll: vi.fn(async () => rows),
        create: vi.fn(async (data: Partial<Subject>) => {
          const row = { ...data, id: 101 + rows.length, completed_chapters: 0 } as Subject
          rows.push(row)
          return row
        }),
        update: vi.fn(async (id: number, data: Partial<Subject>) => {
          rows = rows.map(row => row.id === id ? { ...row, ...data } : row)
          return data
        }),
      },
      subjectChapters: { getBySubject: vi.fn().mockResolvedValue([]) },
      mistakes: { createBatch: vi.fn().mockResolvedValue([]) },
    }
  }

  beforeEach(async () => {
    rows = []
    entries = []
    input = undefined
    api = makeApi()
    vi.mocked(useDiary).mockReturnValue(api as unknown as DiaryContextValue)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') input = this
    })
    await act(async () => { render(<Settings />) })
    vi.mocked(showToast).mockClear()
  })
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

  async function upload(value: unknown, cancelled = false) {
    fireEvent.click(screen.getByRole('button', { name: '合并导入 JSON', exact: true }))
    expect(input).toBeDefined()
    fireEvent.change(input!, { target: { files: [new File([JSON.stringify(value)], 'synthetic.json', { type: 'application/json' })] } })
    if (cancelled) {
      await waitFor(() => expect(window.confirm).toHaveBeenCalled())
    } else {
      await waitFor(() => expect(vi.mocked(showToast).mock.calls.some(([message]) => /^(导入完成，|导入失败:)/.test(message))).toBe(true))
    }
  }
  function noWrites() {
    for (const write of [api.entries.create, api.entries.update, api.tags.create, api.subjects.create, api.subjects.update, api.mistakes.createBatch]) {
      expect(write).not.toHaveBeenCalled()
    }
  }

  it('preserves first-import totals/completed and maps mistakes to the new destination ID', async () => {
    await upload(backup())
    expect(rows).toEqual([{ ...subject, id: 101 }])
    expect(api.subjects.create).toHaveBeenCalledWith({ name: subject.name, color: subject.color, total_chapters: 10, completed_chapters: 4 })
    expect(api.subjects.update).toHaveBeenCalledWith(101, expect.objectContaining({ completed_chapters: 4 }))
    expect(api.mistakes.createBatch).toHaveBeenCalledWith([expect.objectContaining({ subject_id: 101, mastered: true })])
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(confirmation))
    expect(showToast).toHaveBeenLastCalledWith('导入完成，处理了 1 篇日记、1 道错题。请重启应用以刷新状态。', 'success', 5000)
  })

  it('keeps same-date updates, same-name subject merges, tag skips and mistake append semantics', async () => {
    rows = [{ ...subject, id: 9, completed_chapters: 2 }]
    entries = [{ ...entry, id: 12, content: '目标旧正文' }]
    api.tags.getAll.mockResolvedValue([{ id: 8, name: '已有标签', color: '#ffffff' }])
    const file = { ...backup(), data: { ...backup().data, tags: [{ id: 33, name: '已有标签', color: '#000000' }] } }
    await upload(file)
    vi.mocked(showToast).mockClear()
    await upload(file)
    expect(entries).toEqual([{ ...entry, id: 12 }])
    expect(api.entries.create).not.toHaveBeenCalled()
    expect(api.subjects.create).not.toHaveBeenCalled()
    expect(rows[0]?.completed_chapters).toBe(4)
    expect(api.tags.create).not.toHaveBeenCalled()
    expect(api.mistakes.createBatch).toHaveBeenCalledTimes(2)
    expect(api.mistakes.createBatch).toHaveBeenLastCalledWith([expect.objectContaining({ subject_id: 9 })])
    expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('同名标签已跳过。'), 'success', 5000)
  })

  it.each([
    ['late invalid entry', () => ({ ...backup(), data: { ...backup().data, entries: [entry, { ...entry, title: null }] } })],
    ['invalid tags container', () => ({ ...backup(), data: { ...backup().data, tags: {} } })],
    ['late invalid tag', () => ({ ...backup(), data: { ...backup().data, tags: [{ name: '正常标签' }, { name: {} }] } })],
    ['missing subject fields', () => ({ ...backup(), data: { ...backup().data, subjects: [{ id: 73, name: '数学' }] } })],
    ['source duplicate name', () => ({ ...backup(), data: { ...backup().data, subjects: [subject, { ...subject, id: 74 }] } })],
    ['mistakes wrong container', () => ({ ...backup(), data: { ...backup().data, mistakes: {} } })],
    ['late invalid mistake', () => ({ ...backup(), data: { ...backup().data, mistakes: [...backup().data.mistakes, { question: null }] } })],
    ['unmapped source ID', () => ({ ...backup(), data: { ...backup().data, subjects: [], mistakes: [{ subject_id: 73, question: '错题' }] } })],
  ])('rejects %s before all domain writes', async (_name, file) => {
    rows = [{ ...subject, id: 73 }]
    await upload(file())
    noWrites()
    expect(rows).toEqual([{ ...subject, id: 73 }])
    expect(vi.mocked(showToast).mock.calls.some(([message, kind]) => message.startsWith('导入失败:') && kind === 'error')).toBe(true)
    expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('本次在写入前停止，没有导入写入。'), 'error', 5000)
  })

  it('rejects target name ambiguity before even diary writes', async () => {
    rows = [{ ...subject, id: 1 }, { ...subject, id: 2 }]
    await upload(backup())
    noWrites()
  })

  it('rejects incompatible detailed chapters before all writes', async () => {
    rows = [{ ...subject, id: 9 }]
    api.subjectChapters.getBySubject.mockResolvedValue([{ id: 1, subject_id: 9, completed: false }])
    await upload(backup())
    noWrites()
  })

  it('stops after subject creation failure without falling back to a colliding target ID', async () => {
    rows = [{ ...subject, id: 73, name: '另一科目' }]
    api.subjects.create.mockRejectedValueOnce(new Error('合成创建故障'))
    await upload(backup())
    expect(api.mistakes.createBatch).not.toHaveBeenCalled()
    expect(rows).toEqual([{ ...subject, id: 73, name: '另一科目' }])
    expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('已返回成功的操作：写入 1 篇日记'), 'error', 10000)
  })

  it('reports a created subject whose completion update fails and does not import mistakes', async () => {
    api.subjects.update.mockRejectedValueOnce(new Error('合成更新故障'))
    await upload(backup())
    expect(rows[0]?.completed_chapters).toBe(0)
    expect(api.mistakes.createBatch).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('新建 1 个科目、更新 0 个科目'), 'error', 10000)
    expect(vi.mocked(showToast).mock.calls.some(([message]) => message.startsWith('导入完成'))).toBe(false)
  })

  it('rejects a false-success subject update when rereading stored fields fails verification', async () => {
    api.subjects.update.mockImplementationOnce(async () => subject)
    await upload(backup())
    expect(api.mistakes.createBatch).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('写入后核对失败'), 'error', 10000)
  })

  it('does not swallow unexpected tag write failures', async () => {
    api.tags.create.mockRejectedValueOnce(new Error('合成标签故障'))
    await upload({ ...backup(), data: { ...backup().data, tags: [{ name: '新标签' }] } })
    expect(api.subjects.create).not.toHaveBeenCalled()
    expect(api.mistakes.createBatch).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('合成标签故障'), 'error', 10000)
  })

  it('reports a preflight read rejection as no import writes', async () => {
    api.tags.getAll.mockRejectedValueOnce(new Error('合成预检读取故障'))
    await upload(backup())
    noWrites()
    expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('本次在写入前停止，没有导入写入。'), 'error', 5000)
  })

  it('distinguishes a read failure after acknowledged writes from an uncertain write', async () => {
    api.entries.getByDate.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('合成后段读取故障'))
    await upload({ data: { entries: [entry, { ...entry, date: '2026-10-10' }] } })
    expect(entries).toEqual([{ ...entry, id: 1 }])
    expect(api.entries.create).toHaveBeenCalledTimes(1)
    const message = vi.mocked(showToast).mock.lastCall?.[0]
    expect(message).toContain('写入 1 篇日记')
    expect(message).toContain('本次导入未全部完成，已成功的操作不会自动撤销。')
    expect(message).not.toContain('提交状态无法确定')
    expect(message).toContain('重新导入可能覆盖同日日记，并继续追加错题。')
  })

  it('does not count a committed diary whose reply is lost or retry the write', async () => {
    api.entries.create.mockImplementationOnce(async data => {
      entries.push({ ...data, id: 1 })
      throw new Error('合成提交后回包丢失')
    })
    await upload(backup())
    expect(entries).toHaveLength(1)
    expect(api.entries.create).toHaveBeenCalledTimes(1)
    expect(api.subjects.create).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('写入 0 篇日记'), 'error', 10000)
    const message = vi.mocked(showToast).mock.lastCall?.[0]
    expect(message).toContain('提交状态无法确定，实际写入可能多于上述计数。')
    expect(message).not.toContain('没有导入写入')
  })

  it('does not report a diary update with a missing result as success', async () => {
    api.entries.getByDate.mockResolvedValueOnce({ ...entry, id: 12 })
    api.entries.update.mockResolvedValueOnce(undefined)
    await upload(backup())
    expect(api.entries.update).toHaveBeenCalledTimes(1)
    expect(api.subjects.create).not.toHaveBeenCalled()
    const message = vi.mocked(showToast).mock.lastCall?.[0]
    expect(message).toContain('日记写入结果无法确认')
    expect(message).toContain('写入 0 篇日记')
    expect(message).toContain('提交状态无法确定')
    expect(vi.mocked(showToast).mock.calls.some(([text]) => text.startsWith('导入完成'))).toBe(false)
  })

  it('counts the successful subject update reply even if its readonly verification fails', async () => {
    api.subjects.getAll.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('合成核对读取故障'))
    await upload(backup())
    expect(rows[0]?.completed_chapters).toBe(4)
    expect(api.mistakes.createBatch).not.toHaveBeenCalled()
    const message = vi.mocked(showToast).mock.lastCall?.[0]
    expect(message).toContain('新建 1 个科目、更新 1 个科目')
    expect(message).toContain('本次导入未全部完成')
    expect(message).not.toContain('提交状态无法确定')
  })

  it('does not assume a rejected mistake batch was rolled back or retry it', async () => {
    let committed = 0
    api.mistakes.createBatch.mockImplementationOnce(async () => {
      committed += 1
      throw new Error('合成错题回包丢失')
    })
    await upload(backup())
    expect(committed).toBe(1)
    expect(api.mistakes.createBatch).toHaveBeenCalledTimes(1)
    const message = vi.mocked(showToast).mock.lastCall?.[0]
    expect(message).toContain('追加 0 道错题')
    expect(message).toContain('提交状态无法确定')
    expect(message).toContain('继续追加错题')
    expect(vi.mocked(showToast).mock.calls.some(([text]) => text.startsWith('导入完成'))).toBe(false)
  })

  it('keeps confirmation cancellation free of writes', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    await upload(backup(), true)
    noWrites()
    expect(api.subjects.getAll).not.toHaveBeenCalled()
  })

  it('keeps the ZIP restore button on its separate existing API and confirmation path', async () => {
    fireEvent.click(screen.getByRole('button', { name: '从 ZIP 恢复', exact: true }))
    await waitFor(() => expect(api.settings.restoreBackupFromZip).toHaveBeenCalledWith('C:\\synthetic\\backup.zip'))
    expect(window.confirm).toHaveBeenCalledWith('恢复自动备份 ZIP 会覆盖当前数据、附件和错题图片。建议先手动复制当前数据目录。是否继续？')
    noWrites()
    expect(api.requestDataRefresh).toHaveBeenCalled()
  })
})
