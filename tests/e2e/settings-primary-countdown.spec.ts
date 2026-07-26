import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '..', '..')
const profilePrefix = 'minddiary-primary-countdown-e2e-'

async function launch(profilePath: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${profilePath}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  const startButton = page.getByRole('button', { name: '开始使用' })
  if (await startButton.isVisible().catch(() => false)) await startButton.click()
  return { app, page }
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  await expect(page.getByLabel('主目标名称')).toBeVisible()
}

test.describe('primary countdown settings persistence', () => {
  test.describe.configure({ timeout: 120_000 })

  test('renames the primary target, preserves it through event changes, and survives restart', async () => {
    const profilePath = mkdtempSync(path.join(tmpdir(), profilePrefix))
    let app: ElectronApplication | undefined
    try {
      let launched = await launch(profilePath)
      app = launched.app
      let page = launched.page
      await openSettings(page)

      await expect(page.getByLabel('主目标名称')).toHaveValue('考研初试')
      await page.getByLabel('主目标名称').fill('公务员考试')
      await page.getByLabel('主目标名称').press('Tab')
      await page.getByLabel('主目标日期').fill('2027-01-10')

      await page.getByLabel('关键日期标题').fill('论文提交')
      await page.getByLabel('关键日期日期').fill('2026-11-01')
      await page.getByRole('button', { name: '添加日期' }).click()
      await page.getByRole('button', { name: '置顶 论文提交' }).click()
      await page.getByRole('button', { name: '删除 论文提交' }).click()
      await expect(page.getByRole('button', { name: '删除 公务员考试' })).toBeDisabled()
      await page.getByRole('button', { name: /保存设置/ }).click()

      let stored = await page.evaluate(() => window.api.settings.getAll())
      expect(stored.examDate).toBe('2027-01-10')
      expect(stored.countdownEvents).toEqual([
        expect.objectContaining({
          id: 'default-exam',
          title: '公务员考试',
          date: '2027-01-10',
          type: 'exam',
        }),
      ])

      await page.evaluate(() => window.api.settings.updateGeneral({
        countdownEvents: [
          {
            id: 'registration',
            title: '报名截止',
            date: '2026-12-01',
            type: 'deadline',
          },
        ],
      }))
      stored = await page.evaluate(() => window.api.settings.getAll())
      expect(stored.countdownEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'default-exam',
          title: '公务员考试',
          date: '2027-01-10',
        }),
        expect.objectContaining({
          id: 'registration',
          title: '报名截止',
        }),
      ]))

      await page.evaluate(() => window.api.settings.updateGeneral({ countdownEvents: [] }))
      stored = await page.evaluate(() => window.api.settings.getAll())
      expect(stored.countdownEvents).toEqual([
        expect.objectContaining({
          id: 'default-exam',
          title: '公务员考试',
          date: '2027-01-10',
        }),
      ])

      await app.close()
      app = undefined
      launched = await launch(profilePath)
      app = launched.app
      page = launched.page
      await openSettings(page)

      await expect(page.getByLabel('主目标名称')).toHaveValue('公务员考试')
      await expect(page.getByLabel('主目标日期')).toHaveValue('2027-01-10')

      await page.evaluate(() => window.api.settings.updateGeneral({ examDate: '2027-02-02' }))
      stored = await page.evaluate(() => window.api.settings.getAll())
      expect(stored.examDate).toBe('2027-02-02')
      expect(stored.countdownEvents).toEqual([
        expect.objectContaining({
          id: 'default-exam',
          title: '公务员考试',
          date: '2027-02-02',
        }),
      ])

      await page.evaluate(() => window.api.settings.updateGeneral({
        countdownEvents: [
          {
            id: 'default-exam',
            title: '公务员考试',
            date: '2027-02-02',
            type: 'exam',
          },
          {
            id: 'default-exam',
            title: '重复目标',
            date: '2027-03-03',
            type: 'exam',
          },
        ],
      }))
      stored = await page.evaluate(() => window.api.settings.getAll())
      expect(stored.countdownEvents).toEqual([
        expect.objectContaining({
          id: 'default-exam',
          title: '公务员考试',
          date: '2027-02-02',
        }),
      ])

      await expect(page.evaluate(() => window.api.settings.updateGeneral({
        examDate: '2027-02-02',
        countdownEvents: [
          {
            id: 'default-exam',
            title: '   ',
            date: '2027-02-02',
            type: 'exam',
          },
        ],
      }))).rejects.toThrow('主目标名称不能为空')
      await expect(page.evaluate(() => window.api.settings.updateGeneral({
        examDate: '2027-02-30',
      }))).rejects.toThrow('Invalid examDate: expected a valid YYYY-MM-DD date')
      await expect(page.evaluate(() => window.api.settings.updateGeneral({
        examDate: '2027-02-02',
        countdownEvents: [
          {
            id: 'default-exam',
            title: '公务员考试',
            date: '2027-02-02',
            type: 'exam',
          },
          {
            id: 'default-exam',
            title: '   ',
            date: '2027-02-02',
            type: 'exam',
          },
        ],
      }))).rejects.toThrow('主目标名称不能为空')
      stored = await page.evaluate(() => window.api.settings.getAll())
      expect(stored.examDate).toBe('2027-02-02')
      expect(stored.countdownEvents).toEqual([
        expect.objectContaining({
          id: 'default-exam',
          title: '公务员考试',
          date: '2027-02-02',
        }),
      ])
    } finally {
      await app?.close()
      const resolvedProfile = path.resolve(profilePath)
      if (path.dirname(resolvedProfile) !== path.resolve(tmpdir())
        || !path.basename(resolvedProfile).startsWith(profilePrefix)) {
        throw new Error('Refusing to remove unexpected primary countdown E2E profile path')
      }
      rmSync(resolvedProfile, { recursive: true, force: true })
    }
  })
})
