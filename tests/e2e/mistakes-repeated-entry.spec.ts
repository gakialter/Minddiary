import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const projectRoot = process.env.MINDDIARY_ISSUE145_PROJECT_ROOT
  ? path.resolve(process.env.MINDDIARY_ISSUE145_PROJECT_ROOT)
  : path.resolve(__dirname, '..', '..')
const profilePrefix = 'minddiary-mistakes-e2e-'

interface FieldDiagnostics {
  activeElement: string
  disabled: boolean
  formRect: { x: number; y: number; width: number; height: number }
  fieldRect: { x: number; y: number; width: number; height: number }
  hitTarget: string
  readOnly: boolean
  scrollTop: number
  visible: boolean
  viewport: { width: number; height: number }
}

async function launch(profilePath: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${profilePath}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  const startButton = page.getByRole('button', { name: '开始使用' })
  if (await startButton.isVisible().catch(() => false)) {
    await startButton.click()
  }
  await page.getByRole('button', { name: '错题本' }).click()
  await expect(page.getByTestId('mistake-add-btn')).toBeVisible()
  return { app, page }
}

async function openCreateForm(page: Page): Promise<void> {
  await page.getByTestId('mistake-add-btn').click()
  await expect(page.getByTestId('mistake-form')).toBeVisible()
  await expect(page.getByTestId('pomodoro-widget')).toBeHidden()
}

async function fillForm(page: Page, question: string, answer: string, notes: string): Promise<void> {
  const form = page.getByTestId('mistake-form')
  for (const [placeholder, value] of [
    ['问题 / 知识点', question],
    ['答案 / 解析', answer],
    ['备注（可选）', notes],
  ] as const) {
    const field = form.getByPlaceholder(placeholder)
    await field.click()
    await expect(field).toBeFocused()
    await field.fill(value)
  }
}

async function submitForm(page: Page): Promise<void> {
  await page.getByTestId('mistake-submit-btn').click()
  await expect(page.getByTestId('mistake-form')).toBeHidden()
}

async function createMistake(page: Page, question: string, answer: string, notes: string): Promise<void> {
  await openCreateForm(page)
  await fillForm(page, question, answer, notes)
  await submitForm(page)
}

async function importJsonBackup(page: Page, name: string, content: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '从 JSON 导入' }).click()
  const chooser = await chooserPromise
  const dialogPromise = page.waitForEvent('dialog')
  await chooser.setFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(content, 'utf8'),
  })
  const dialog = await dialogPromise
  await dialog.accept()
}

async function diagnostics(page: Page, placeholder: string): Promise<FieldDiagnostics> {
  return page.getByPlaceholder(placeholder).evaluate(element => {
    const field = element as HTMLTextAreaElement
    field.focus()
    const form = field.closest('form')
    let scrollContainer: HTMLElement | null = field.parentElement
    while (scrollContainer && !['auto', 'scroll'].includes(getComputedStyle(scrollContainer).overflowY)) {
      scrollContainer = scrollContainer.parentElement
    }
    const fieldRect = field.getBoundingClientRect()
    const centerX = fieldRect.left + Math.min(fieldRect.width / 2, 24)
    const centerY = fieldRect.top + Math.min(fieldRect.height / 2, 24)
    const hit = document.elementFromPoint(centerX, centerY)
    return {
      activeElement: document.activeElement === field
        ? `textarea:${field.placeholder}`
        : document.activeElement?.tagName.toLowerCase() || 'none',
      disabled: field.disabled,
      formRect: form
        ? {
            x: form.getBoundingClientRect().x,
            y: form.getBoundingClientRect().y,
            width: form.getBoundingClientRect().width,
            height: form.getBoundingClientRect().height,
          }
        : { x: 0, y: 0, width: 0, height: 0 },
      fieldRect: { x: fieldRect.x, y: fieldRect.y, width: fieldRect.width, height: fieldRect.height },
      hitTarget: hit instanceof HTMLElement
        ? `${hit.tagName.toLowerCase()}:${hit.getAttribute('placeholder') || hit.getAttribute('data-testid') || ''}`
        : 'none',
      readOnly: field.readOnly,
      scrollTop: scrollContainer?.scrollTop || 0,
      visible: fieldRect.bottom > 0
        && fieldRect.top < window.innerHeight
        && fieldRect.right > 0
        && fieldRect.left < window.innerWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })
}

async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
  }, { width, height })
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

test.describe('repeated mistake entry and editing', () => {
  test.describe.configure({ timeout: 120_000 })

  test('creates, edits, restarts, and keeps every textarea interactive', async () => {
    const profilePath = mkdtempSync(path.join(tmpdir(), profilePrefix))
    let app: ElectronApplication | undefined
    try {
      let launched = await launch(profilePath)
      app = launched.app
      let page = launched.page

      await createMistake(page, '第一题', '答案一', '笔记一')
      await createMistake(page, '第二题', '答案二', '笔记二')
      await createMistake(page, '第三题', '答案三', '笔记三')

      const second = page.locator('.card').filter({ hasText: '第二题' })
      await second.getByRole('button', { name: '编辑错题' }).click()
      await fillForm(page, '第二题（已修改）', '答案二（已修改）', '笔记二（已修改）')
      await submitForm(page)

      await app.close()
      app = undefined
      launched = await launch(profilePath)
      app = launched.app
      page = launched.page

      const first = page.locator('.card').filter({ hasText: '第一题' })
      await first.getByRole('button', { name: '编辑错题' }).click()
      await fillForm(page, '第一题（重启后修改）', '答案一（重启后修改）', '笔记一（重启后修改）')
      await submitForm(page)

      await openCreateForm(page)
      const form = page.getByTestId('mistake-form')
      for (const [placeholder, value] of [
        ['问题 / 知识点', '开头中间末尾\n中文第四题'],
        ['答案 / 解析', '开头中间末尾\n中文答案四'],
        ['备注（可选）', '开头中间末尾\n中文笔记四'],
      ] as const) {
        const field = form.getByPlaceholder(placeholder)
        await field.fill(value)
        await field.press('Home')
        await field.type('首')
        await field.press('End')
        await field.type('尾')
        await expect(field).toBeEditable()
        await expect(field).toBeFocused()
        await expect(field).toHaveValue(/中文/)
        const evidence = await diagnostics(page, placeholder)
        expect(evidence.activeElement).toBe(`textarea:${placeholder}`)
        expect(evidence.hitTarget).toBe(`textarea:${placeholder}`)
      }
      await submitForm(page)
      await createMistake(page, '第五题', '答案五', '笔记五')

      const stored = await page.evaluate(async () => window.api.mistakes.getAll({ limit: 20, offset: 0 }))
      expect(stored.total).toBe(5)
      const storedById = new Map(stored.data.map(item => [item.id, item]))
      expect(storedById.get(1)).toEqual(expect.objectContaining({
        question: '第一题（重启后修改）',
        answer: '答案一（重启后修改）',
        notes: '笔记一（重启后修改）',
        image_path: null,
        answer_image_path: null,
      }))
      expect(storedById.get(2)).toEqual(expect.objectContaining({
        question: '第二题（已修改）',
        answer: '答案二（已修改）',
        notes: '笔记二（已修改）',
      }))
      expect(storedById.get(3)).toEqual(expect.objectContaining({
        question: '第三题',
        answer: '答案三',
        notes: '笔记三',
      }))
      expect(storedById.get(4)).toEqual(expect.objectContaining({
        question: expect.stringContaining('中文第四题'),
        answer: expect.stringContaining('中文答案四'),
        notes: expect.stringContaining('中文笔记四'),
      }))
      expect(storedById.get(5)).toEqual(expect.objectContaining({
        question: '第五题',
        answer: '答案五',
        notes: '笔记五',
      }))
      const ipcPersisted = await page.evaluate(async () => {
        const created = await window.api.mistakes.create({
          question: '带复习进度的导入记录',
          answer: '导入答案',
          notes: '导入笔记',
          mastered: true,
          ease_factor: 1.8,
          review_interval: 14,
          next_review_date: '2027-01-15',
          review_count: 4,
        })
        const all = await window.api.mistakes.getAll({ limit: 20, offset: 0 })
        return all.data.find(item => item.id === Number(created.id))
      })
      expect(ipcPersisted).toEqual(expect.objectContaining({
        question: '带复习进度的导入记录',
        mastered: true,
        ease_factor: 1.8,
        review_interval: 14,
        next_review_date: '2027-01-15',
        review_count: 4,
      }))
      await expect(page.evaluate(() => window.api.mistakes.update(0, { question: '非法' }))).rejects.toThrow(
        'mistake id must be a positive integer',
      )
    } finally {
      await app?.close()
      const resolvedProfile = path.resolve(profilePath)
      if (path.dirname(resolvedProfile) !== path.resolve(tmpdir())
        || !path.basename(resolvedProfile).startsWith(profilePrefix)) {
        throw new Error('Refusing to remove unexpected mistake E2E profile path')
      }
      rmSync(resolvedProfile, { recursive: true, force: true })
    }
  })

  test('round-trips exported mistake review progress into a fresh profile', async () => {
    const sourceProfile = mkdtempSync(path.join(tmpdir(), profilePrefix))
    const targetProfile = mkdtempSync(path.join(tmpdir(), profilePrefix))
    let app: ElectronApplication | undefined
    try {
      let launched = await launch(sourceProfile)
      app = launched.app
      let page = launched.page
      await page.evaluate(() => window.api.mistakes.create({
        question: '导出再导入题目',
        answer: '导出再导入答案',
        notes: '导出再导入笔记',
        mastered: true,
        ease_factor: 1.8,
        review_interval: 14,
        next_review_date: '2027-01-15',
        review_count: 4,
      }))
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
      await page.evaluate(() => {
        const exportCapture = window as unknown as { __mindDiaryExportText?: string }
        const createObjectURL = URL.createObjectURL.bind(URL)
        URL.createObjectURL = (blob: Blob) => {
          void blob.text().then(text => {
            exportCapture.__mindDiaryExportText = text
          })
          return createObjectURL(blob)
        }
        HTMLAnchorElement.prototype.click = () => undefined
      })
      await page.getByRole('button', { name: '导出为 JSON' }).click()
      await page.waitForFunction(() => Boolean(
        (window as unknown as { __mindDiaryExportText?: string }).__mindDiaryExportText,
      ))

      const exportedText = await page.evaluate(
        () => (window as unknown as { __mindDiaryExportText: string }).__mindDiaryExportText,
      )
      const exported = JSON.parse(exportedText) as {
        data: { mistakes: Array<Record<string, unknown>> }
      }
      expect(exported.data.mistakes).toEqual([
        expect.objectContaining({
          question: '导出再导入题目',
          mastered: true,
          ease_factor: 1.8,
          review_interval: 14,
          next_review_date: '2027-01-15',
          review_count: 4,
        }),
      ])

      await app.close()
      app = undefined
      launched = await launch(targetProfile)
      app = launched.app
      page = launched.page
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
      await importJsonBackup(page, 'MindDiary_Backup_test.json', exportedText)
      const initialImportToast = page.getByText(/导入完成，处理了 0 篇日记、1 道错题/)
      await expect(initialImportToast).toBeVisible()
      await initialImportToast.click()
      await expect(initialImportToast).toBeHidden()

      let restored = await page.evaluate(() => window.api.mistakes.getAll({ limit: 20, offset: 0 }))
      expect(restored.data).toEqual([
        expect.objectContaining({
          question: '导出再导入题目',
          answer: '导出再导入答案',
          notes: '导出再导入笔记',
          mastered: true,
          ease_factor: 1.8,
          review_interval: 14,
          next_review_date: '2027-01-15',
          review_count: 4,
        }),
      ])

      await app.close()
      app = undefined
      launched = await launch(targetProfile)
      app = launched.app
      page = launched.page
      restored = await page.evaluate(() => window.api.mistakes.getAll({ limit: 20, offset: 0 }))
      expect(restored.data).toEqual([
        expect.objectContaining({
          question: '导出再导入题目',
          mastered: true,
          ease_factor: 1.8,
          review_interval: 14,
          next_review_date: '2027-01-15',
          review_count: 4,
        }),
      ])

      await page.getByRole('button', { name: '设置', exact: true }).click()
      await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
      const invalidExport = structuredClone(exported)
      const validMistake = invalidExport.data.mistakes[0]
      if (!validMistake) throw new Error('Expected one exported mistake fixture')
      invalidExport.data.mistakes = [
        { ...validMistake, question: '本批次第一条合法记录' },
        { ...validMistake, question: '本批次第二条非法记录', mastered: 2 },
      ]
      for (let attempt = 1; attempt <= 2; attempt++) {
        await importJsonBackup(
          page,
          `MindDiary_Backup_invalid_attempt_${attempt}.json`,
          JSON.stringify(invalidExport),
        )
        const invalidPayloadToast = page.getByText(
          /导入失败: 第 2 道错题导入失败: mistake mastered must be a boolean or 0\/1/,
        )
        await expect(invalidPayloadToast).toBeVisible()
        expect(await page.evaluate(() => window.api.mistakes.getAll({ limit: 20, offset: 0 }))).toMatchObject({
          total: 1,
          data: [expect.objectContaining({ question: '导出再导入题目' })],
        })
        await invalidPayloadToast.click()
        await expect(invalidPayloadToast).toBeHidden()
      }

      const invalidSubjectExport = structuredClone(exported)
      invalidSubjectExport.data.mistakes = [
        { ...validMistake, question: '科目批次第一条合法记录', subject_id: null },
        { ...validMistake, question: '科目批次第二条非法记录', subject_id: 999_999 },
      ]
      for (let attempt = 1; attempt <= 2; attempt++) {
        await importJsonBackup(
          page,
          `MindDiary_Backup_invalid_subject_attempt_${attempt}.json`,
          JSON.stringify(invalidSubjectExport),
        )
        const invalidSubjectToast = page.getByText(/导入失败: 第 2 道错题导入失败: 引用的科目不存在/)
        await expect(invalidSubjectToast).toBeVisible()
        expect(await page.evaluate(() => window.api.mistakes.getAll({ limit: 20, offset: 0 }))).toMatchObject({
          total: 1,
          data: [expect.objectContaining({ question: '导出再导入题目' })],
        })
        await invalidSubjectToast.click()
        await expect(invalidSubjectToast).toBeHidden()
      }

      const mappedSubjectExport = structuredClone(exported) as typeof exported & {
        data: {
          subjects: Array<{
            id: number
            name: string
            total_chapters: number
            completed_chapters: number
            color: string
          }>
        }
      }
      mappedSubjectExport.data.subjects = [{
        id: 42_424,
        name: '跨 profile 导入科目',
        total_chapters: 10,
        completed_chapters: 3,
        color: '#0F766E',
      }]
      mappedSubjectExport.data.mistakes = [{
        ...validMistake,
        question: '旧科目 ID 映射后的错题',
        subject_id: 42_424,
      }]
      await importJsonBackup(
        page,
        'MindDiary_Backup_subject_mapping.json',
        JSON.stringify(mappedSubjectExport),
      )
      await expect(page.getByText(/导入完成，处理了 0 篇日记、1 道错题/)).toBeVisible()
      const mappedSubjectResult = await page.evaluate(async () => {
        const [subjects, mistakes] = await Promise.all([
          window.api.subjects.getAll(),
          window.api.mistakes.getAll({ limit: 20, offset: 0 }),
        ])
        const subject = subjects.find(item => item.name === '跨 profile 导入科目')
        const mistake = mistakes.data.find(item => item.question === '旧科目 ID 映射后的错题')
        return { subject, mistake }
      })
      expect(mappedSubjectResult.subject?.id).toBeGreaterThan(0)
      expect(mappedSubjectResult.subject?.id).not.toBe(42_424)
      expect(mappedSubjectResult.mistake?.subject_id).toBe(mappedSubjectResult.subject?.id)
    } finally {
      await app?.close()
      for (const profilePath of [sourceProfile, targetProfile]) {
        const resolvedProfile = path.resolve(profilePath)
        if (path.dirname(resolvedProfile) !== path.resolve(tmpdir())
          || !path.basename(resolvedProfile).startsWith(profilePrefix)) {
          throw new Error('Refusing to remove unexpected mistake E2E profile path')
        }
        rmSync(resolvedProfile, { recursive: true, force: true })
      }
    }
  })

  test('keeps the mistake form clear of floating controls at supported small sizes', async () => {
    const profilePath = mkdtempSync(path.join(tmpdir(), profilePrefix))
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(profilePath)
      app = launched.app
      const page = launched.page
      await openCreateForm(page)

      const matrix: Array<{
        requested: { width: number; height: number }
        fields: FieldDiagnostics[]
      }> = []
      for (const size of [
        { width: 1280, height: 720 },
        { width: 1024, height: 640 },
        { width: 640, height: 720 },
        { width: 1024, height: 480 },
      ]) {
        await setWindowSize(app, page, size.width, size.height)
        const fields = await Promise.all([
          diagnostics(page, '问题 / 知识点'),
          diagnostics(page, '答案 / 解析'),
          diagnostics(page, '备注（可选）'),
        ])
        matrix.push({ requested: size, fields })
      }

      for (const entry of matrix) {
        for (const field of entry.fields) {
          expect(field.disabled).toBe(false)
          expect(field.readOnly).toBe(false)
          expect(field.visible).toBe(true)
          expect(field.hitTarget).toMatch(/^textarea:/)
        }
      }
    } finally {
      await app?.close()
      const resolvedProfile = path.resolve(profilePath)
      if (path.dirname(resolvedProfile) !== path.resolve(tmpdir())
        || !path.basename(resolvedProfile).startsWith(profilePrefix)) {
        throw new Error('Refusing to remove unexpected mistake E2E profile path')
      }
      rmSync(resolvedProfile, { recursive: true, force: true })
    }
  })
})
