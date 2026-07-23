import { expect, test, type Page } from '@playwright/test'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '..', '..')
const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
let previewProcess: ChildProcessWithoutNullStreams | undefined
let baseUrl = ''

test.use({ channel: 'chromium' })

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to reserve Vite preview port')
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
  return address.port
}

async function startPreview(): Promise<void> {
  const port = await reservePort()
  baseUrl = `http://127.0.0.1:${port}`
  previewProcess = spawn(
    process.execPath,
    [viteCli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: projectRoot, env: process.env },
  )
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (previewProcess.exitCode !== null) {
      throw new Error(`Vite preview exited early with code ${previewProcess.exitCode}`)
    }
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Vite preview did not become ready')
}

async function openMistakes(page: Page): Promise<void> {
  await page.goto(baseUrl)
  await page.evaluate(() => {
    localStorage.setItem('started', 'true')
    localStorage.setItem('mindiary_mistakes', '[]')
  })
  await page.reload()
  const startButton = page.getByRole('button', { name: '开始使用' })
  if (await startButton.isVisible().catch(() => false)) await startButton.click()
  await page.getByRole('button', { name: '错题本' }).click()
  await expect(page.getByTestId('mistake-add-btn')).toBeVisible()
}

async function openSettings(page: Page): Promise<void> {
  await page.goto(baseUrl)
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('started', 'true')
  })
  await page.reload()
  const startButton = page.getByRole('button', { name: '开始使用' })
  if (await startButton.isVisible().catch(() => false)) await startButton.click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
}

async function openForm(page: Page): Promise<void> {
  await page.getByTestId('mistake-add-btn').click()
  await expect(page.getByTestId('mistake-form')).toBeVisible()
  await expect(page.getByTestId('pomodoro-widget')).toBeHidden()
}

async function createMistake(page: Page, index: number): Promise<void> {
  await openForm(page)
  const form = page.getByTestId('mistake-form')
  await form.getByPlaceholder('问题 / 知识点').fill(`第${index}题`)
  await form.getByPlaceholder('答案 / 解析').fill(`答案${index}`)
  await form.getByPlaceholder('备注（可选）').fill(`笔记${index}`)
  await page.getByTestId('mistake-submit-btn').click()
  await expect(form).toBeHidden()
}

test.describe('browser fallback repeated mistakes', () => {
  test.describe.configure({ timeout: 120_000 })

  test.beforeAll(async () => {
    await startPreview()
  })

  test.afterAll(async () => {
    if (previewProcess && previewProcess.exitCode === null) {
      const exited = new Promise<void>(resolve => previewProcess?.once('exit', () => resolve()))
      previewProcess.kill()
      await exited
    }
  })

  test('creates six records, edits after reload, and keeps toolbar selection current', async ({ page }) => {
    await openMistakes(page)
    for (let index = 1; index <= 5; index += 1) await createMistake(page, index)

    const second = page.locator('.card').filter({ hasText: '第2题' })
    await second.getByRole('button', { name: '编辑错题' }).click()
    await page.getByPlaceholder('问题 / 知识点').fill('第2题（修改）')
    await page.getByPlaceholder('答案 / 解析').fill('答案2（修改）')
    await page.getByPlaceholder('备注（可选）').fill('笔记2（修改）')
    await page.getByTestId('mistake-submit-btn').click()
    await expect(page.getByTestId('mistake-form')).toBeHidden()

    await createMistake(page, 6)
    await page.reload()
    await page.getByRole('button', { name: '错题本' }).click()

    const first = page.locator('.card').filter({ hasText: '第1题' })
    await first.getByRole('button', { name: '编辑错题' }).click()
    const notes = page.getByPlaceholder('备注（可选）')
    await notes.fill('当前备注')
    await notes.evaluate(element => {
      const textarea = element as HTMLTextAreaElement
      textarea.focus()
      textarea.setSelectionRange(0, 2)
    })
    await page.getByTestId('format-bold').dispatchEvent('mousedown')
    await expect(notes).toHaveValue('**当前**备注')
    await page.getByRole('button', { name: '取消' }).click()

    await expect(page.getByText('第2题（修改）')).toBeVisible()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mindiary_mistakes') || '[]'))
    expect(stored).toHaveLength(6)
    expect(stored.map((mistake: { id: number }) => mistake.id)).toEqual([1, 2, 3, 4, 5, 6])
  })

  test('keeps the form interactive at exact browser viewport sizes', async ({ page }) => {
    await openMistakes(page)
    await openForm(page)

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1024, height: 640 },
      { width: 640, height: 720 },
      { width: 1024, height: 480 },
    ]) {
      await page.setViewportSize(viewport)
      for (const [placeholder, text] of [
        ['问题 / 知识点', '问题\n中文'],
        ['答案 / 解析', '答案\n中文'],
        ['备注（可选）', '笔记\n中文'],
      ] as const) {
        const field = page.getByPlaceholder(placeholder)
        await field.scrollIntoViewIfNeeded()
        await field.click()
        await expect(field).toBeFocused()
        await expect(field).toBeEditable()
        await field.fill(text)
        const hit = await field.evaluate(element => {
          const rect = element.getBoundingClientRect()
          const target = document.elementFromPoint(rect.left + 12, rect.top + 12)
          return target === element
        })
        expect(hit).toBe(true)
      }
      const formRect = await page.getByTestId('mistake-form').boundingBox()
      if (!formRect) throw new Error('Mistake form is not visible')
      expect(formRect.x + formRect.width).toBeLessThanOrEqual(viewport.width)
    }
  })

  test('removes an unsupported browser image failure before continuing the draft', async ({ page }) => {
    await openMistakes(page)
    await openForm(page)
    await page.getByPlaceholder('问题 / 知识点').fill('图片失败后继续')
    await page.getByTestId('mistake-question-image-input').setInputFiles({
      name: 'fake.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not-a-real-image'),
    })
    const removeFailure = page.getByRole('button', { name: '移除失败图片 fake.png' })
    await expect(removeFailure).toBeVisible()
    await expect(page.getByTestId('mistake-submit-btn')).toBeDisabled()
    await removeFailure.click()
    await page.getByPlaceholder('答案 / 解析').fill('失败项移除后仍可输入')
    await expect(page.getByTestId('mistake-submit-btn')).toBeEnabled()
    await page.getByRole('button', { name: '取消' }).click()

    await openForm(page)
    await expect(page.getByPlaceholder('问题 / 知识点')).toHaveValue('')
    await expect(page.getByPlaceholder('答案 / 解析')).toHaveValue('')
    await expect(page.getByPlaceholder('备注（可选）')).toHaveValue('')
  })

  test('persists a custom primary target across browser reload and ordinary event changes', async ({ page }) => {
    await openSettings(page)

    const primaryTitle = page.getByLabel('主目标名称')
    await expect(primaryTitle).toHaveValue('考研初试')
    await primaryTitle.fill('公务员考试')
    await primaryTitle.press('Tab')
    await page.getByLabel('主目标日期').fill('2027-01-10')

    await page.getByLabel('关键日期标题').fill('论文提交')
    await page.getByLabel('关键日期日期').fill('2026-11-01')
    await page.getByRole('button', { name: '添加日期' }).click()
    await page.getByRole('button', { name: '置顶 论文提交' }).click()
    await page.getByRole('button', { name: '删除 论文提交' }).click()
    await expect(page.getByRole('button', { name: '删除 公务员考试' })).toBeDisabled()
    await page.getByRole('button', { name: /保存设置/ }).click()

    await page.reload()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByLabel('主目标名称')).toHaveValue('公务员考试')
    await expect(page.getByLabel('主目标日期')).toHaveValue('2027-01-10')
    await page.setViewportSize({ width: 640, height: 480 })
    await page.getByLabel('主目标名称').scrollIntoViewIfNeeded()
    const primaryRect = await page.getByLabel('主目标名称').boundingBox()
    if (!primaryRect) throw new Error('Primary target title is not visible')
    expect(primaryRect.x + primaryRect.width).toBeLessThanOrEqual(640)
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mindiary_settings') || '{}'))
    expect(stored.examDate).toBe('2027-01-10')
    expect(stored.countdownEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'default-exam',
        title: '公务员考试',
        date: '2027-01-10',
      }),
    ]))
  })
})
