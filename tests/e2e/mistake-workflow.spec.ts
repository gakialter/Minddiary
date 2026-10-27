import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { createDisposableElectronProfile, removeDisposableElectronProfile } from './disposableElectronProfile'

// Requires current build:electron and Vite production output, with the Electron SQLite binary active.
const projectRoot = path.resolve(process.env.MINDDIARY_E2E_APP_ROOT || path.resolve(__dirname, '../..'))
const profilePrefix = 'minddiary-mistake-workflow-e2e-'

async function withMistakeBook(run: (app: ElectronApplication, page: Page) => Promise<void>) {
  const profile = createDisposableElectronProfile(profilePrefix)
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: [projectRoot, `--user-data-dir=${profile}`, '--force-device-scale-factor=1'],
      env: { ...process.env, NODE_ENV: 'production' },
    })
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '开始使用', exact: true }).click()
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '错题本', exact: true }).click()
    await run(app, page)
  } finally {
    if (app) await app.close()
    await removeDisposableElectronProfile(profile, profilePrefix)
  }
}

test('adds consecutive mistakes without losing subject, draft on failure, or saved data', async () => {
  test.setTimeout(90_000)
  await withMistakeBook(async (app, page) => {
    const subject = await page.evaluate(() => window.api.subjects.create({ name: '连续录题科目', color: '#28654F' }))
    await page.reload()
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '错题本', exact: true }).click()
    await page.getByTestId('mistake-add-first-btn').click()
    const question = page.getByLabel('问题或知识点', { exact: true })
    await expect(question).toBeFocused()
    await page.locator('#mistake-form-subject').selectOption(String(subject.id))
    await question.fill('连续录题第一题')
    await page.getByLabel('答案解析', { exact: true }).fill('第一题解析')
    await page.getByTestId('mistake-submit-continue-btn').click()
    await expect(question).toHaveValue('')
    await expect(question).toBeFocused()
    await expect(page.locator('#mistake-form-subject')).toHaveValue(String(subject.id))
    await expect(page.getByLabel('答案解析', { exact: true })).toHaveValue('')

    // Fault only the existing IPC boundary; all saves are still triggered through the real form.
    await app.evaluate(({ ipcMain }) => {
      const handlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
      if (!(handlers instanceof Map)) throw new Error('IPC handler registry is unavailable')
      const original: unknown = handlers.get('mistakes:create')
      if (typeof original !== 'function') throw new Error('Mistake create handler is unavailable')
      ipcMain.removeHandler('mistakes:create')
      ipcMain.handle('mistakes:create', () => {
        ipcMain.removeHandler('mistakes:create')
        ipcMain.handle('mistakes:create', (event, payload) => original(event, payload))
        throw new Error('Simulated save failure')
      })
    })
    await question.fill('连续录题第二题')
    await page.getByTestId('mistake-submit-continue-btn').click()
    await expect(page.getByTestId('mistake-form')).toHaveAttribute('data-image-form-state', 'save_failed')
    await expect(question).toHaveValue('连续录题第二题')
    await expect(page.locator('#mistake-form-subject')).toHaveValue(String(subject.id))
    await page.getByTestId('mistake-submit-continue-btn').click()
    await expect(question).toHaveValue('')
    await expect(question).toBeFocused()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '编辑错题', exact: true }).first().click()
    await expect(question).toHaveValue('连续录题第二题')
    await expect(page.getByTestId('mistake-submit-continue-btn')).toHaveCount(0)
    await question.fill('连续录题第二题已编辑')
    await page.getByTestId('mistake-submit-btn').click()
    await expect(page.getByTestId('mistake-form')).toHaveCount(0)
    await page.reload()
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '错题本', exact: true }).click()
    await expect(page.getByText('连续录题第一题', { exact: true })).toBeVisible()
    await expect(page.getByText('连续录题第二题已编辑', { exact: true })).toBeVisible()
    const saved = await page.evaluate(() => window.api.mistakes.getAll({ limit: 50, offset: 0 }))
    expect(saved.total).toBe(2)
    expect(saved.data.every(mistake => mistake.subject_id === subject.id)).toBe(true)
  })
})

test('recovers shrinking pages and keeps the newest filter when IPC replies arrive out of order', async () => {
  test.setTimeout(90_000)
  await withMistakeBook(async (app, page) => {
    const subjects = await page.evaluate(async () => {
      const a = await window.api.subjects.create({ name: '分页科目', color: '#28654F' })
      const b = await window.api.subjects.create({ name: '另一个科目', color: '#24406C' })
      await window.api.mistakes.createBatch(Array.from({ length: 51 }, (_, i) => ({ subject_id: a.id, question: `分页题 ${i + 1}`, answer: '解析' })))
      await window.api.mistakes.create({ subject_id: b.id, question: '另一个科目的题' })
      return { a: a.id, b: b.id }
    })
    await page.reload()
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: '错题本', exact: true }).click()
    const filter = page.getByTestId('mistake-subject-filter')
    await filter.selectOption(String(subjects.a))
    await page.getByRole('button', { name: '下一页 ›' }).click()
    await expect(page.getByText('2 / 2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '删除错题', exact: true }).click()
    await expect(page.getByTestId('mistake-empty-state')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '删除错题', exact: true })).toHaveCount(50)
    await expect(page.getByRole('navigation', { name: '错题分页' })).toHaveCount(0)
    await expect(filter).toHaveValue(String(subjects.a))

    await app.evaluate(({ ipcMain }, subjectId) => {
      const handlers: unknown = Reflect.get(ipcMain, '_invokeHandlers')
      if (!(handlers instanceof Map)) throw new Error('IPC handler registry is unavailable')
      const original: unknown = handlers.get('mistakes:getAll')
      if (typeof original !== 'function') throw new Error('Mistake list handler is unavailable')
      ipcMain.removeHandler('mistakes:getAll')
      ipcMain.handle('mistakes:getAll', async (event, filters) => {
        const result = await original(event, filters)
        if (filters.subject_id === subjectId) await new Promise(resolve => setTimeout(resolve, 500))
        return result
      })
    }, subjects.a)
    await filter.selectOption('')
    await filter.selectOption(String(subjects.a))
    await filter.selectOption(String(subjects.b))
    await expect(page.getByText('另一个科目的题', { exact: true })).toBeVisible()
    // Give the deliberately delayed older query a chance to overwrite the current result.
    await page.waitForTimeout(750)
    await expect(page.getByText('另一个科目的题', { exact: true })).toBeVisible()
    await expect(page.locator('.mistake-item')).toHaveCount(1)
    await expect(filter).toHaveValue(String(subjects.b))
  })
})
