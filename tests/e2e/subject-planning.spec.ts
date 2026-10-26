import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDisposableElectronProfile, removeDisposableElectronProfile } from './disposableElectronProfile'

const projectRoot = path.resolve(process.env.MINDDIARY_E2E_APP_ROOT || path.resolve(__dirname, '../..'))
const profilePrefix = 'minddiary-subject-planning-e2e-'

test('plans three chapters without moving the workspace across wide and compact windows', async () => {
  test.setTimeout(240_000)
  for (const { width, height } of [{ width: 1280, height: 800 }, { width: 960, height: 720 }]) {
    const profile = createDisposableElectronProfile(profilePrefix)
    let app: ElectronApplication | undefined
    try {
      app = await electron.launch({
        args: [projectRoot, `--user-data-dir=${profile}`, '--force-device-scale-factor=1'],
        env: { ...process.env, NODE_ENV: 'production' },
      })
      expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
      const page = await app.firstWindow()
      await app.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Electron main window is missing')
        window.setSize(size.width, size.height)
        window.center()
      }, { width, height })
      await page.waitForLoadState('load')
      await expect(page).toHaveURL(pathToFileURL(path.join(projectRoot, 'dist/index.html')).href)
      const start = page.getByRole('button', { name: '开始使用', exact: true })
      const navigation = page.getByRole('navigation', { name: '主要导航' })
      await expect(start.or(navigation)).toBeVisible()
      if (await start.isVisible()) await start.click()
      await expect(navigation).toBeVisible()

      const seeded = await page.evaluate(async () => {
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const subjects = []
        for (let index = 0; index < 10; index += 1) {
          const subject = await window.api.subjects.create({ name: `规划回归科目 ${index + 1}`, color: '#0F766E' })
          const chapters = await window.api.subjectChapters.bulkCreate({
            subject_id: subject.id,
            chapters: Array.from({ length: 40 }, (_, chapterIndex) => ({ title: `第 ${chapterIndex + 1} 章`, completed: false })),
          })
          subjects.push({ subject, chapters })
        }
        return { date, subjects }
      })
      await page.reload()
      await navigation.getByRole('button', { name: '科目进度', exact: true }).click()
      const first = seeded.subjects[0]!
      const second = seeded.subjects[1]!
      const subjectPicker = page.getByLabel('切换科目', { exact: true })
      const selectSubject = async (subject: typeof first) => {
        if (width <= 960) await subjectPicker.selectOption(String(subject.subject.id))
        else await page.getByTestId(`subject-select-${subject.subject.id}`).click()
      }
      await selectSubject(first)
      const workspace = page.getByTestId(`subject-card-${first.subject.id}`)
      await expect(workspace).toBeVisible()
      await expect(workspace.getByTestId('chapter-filter-open')).toHaveAttribute('aria-pressed', 'true')
      await expect(workspace.getByTestId('chapter-management-toggle')).toHaveAttribute('aria-expanded', 'false')
      await expect(workspace.getByTestId('chapter-title-input')).toBeHidden()
      await expect(workspace.getByTitle('编辑章节')).toHaveCount(0)

      const body = workspace.locator('.chapter-workspace__body')
      const selectedChapters = first.chapters.slice(14, 17)
      await body.evaluate((element, chapterId) => {
        const row = element.querySelector(`[data-testid="chapter-row-${chapterId}"]`)
        if (!row) throw new Error('Seeded chapter row is missing')
        element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientHeight / 3
      }, selectedChapters[0]!.id)
      const initialScroll = await body.evaluate(element => element.scrollTop)
      expect(initialScroll).toBeGreaterThan(0)
      for (const chapter of selectedChapters) {
        const row = workspace.getByTestId(`chapter-row-${chapter.id}`)
        const button = row.getByTestId(`chapter-add-today-${chapter.id}`)
        const rowHandle = await row.elementHandle()
        const buttonHandle = await button.elementHandle()
        if (!rowHandle || !buttonHandle) throw new Error('Planning controls are missing')
        const before = await row.evaluate(element => {
          const body = element.closest('.chapter-workspace__body')!
          const rect = element.getBoundingClientRect()
          const viewport = body.getBoundingClientRect()
          return { y: rect.y, bottom: rect.bottom, top: viewport.top, viewportBottom: viewport.bottom, scroll: body.scrollTop }
        })
        expect(before.y).toBeGreaterThanOrEqual(before.top)
        expect(before.bottom).toBeLessThanOrEqual(before.viewportBottom)
        await buttonHandle.click()
        await expect(row.getByTestId(`chapter-added-today-${chapter.id}`)).toHaveText('已加入今日')
        await expect(row.getByTestId(`chapter-added-today-${chapter.id}`)).toHaveAttribute('aria-disabled', 'true')
        await expect(row.getByTestId(`chapter-toggle-${chapter.id}`)).not.toBeChecked()
        expect(await rowHandle.evaluate((element, id) => element === document.querySelector(`[data-testid="chapter-row-${id}"]`), chapter.id)).toBe(true)
        expect(await buttonHandle.evaluate((element, id) => element === document.querySelector(`[data-testid="chapter-added-today-${id}"]`) && document.activeElement === element, chapter.id)).toBe(true)
        expect(await body.evaluate(element => element.scrollTop)).toBe(before.scroll)
        expect(await row.evaluate(element => element.getBoundingClientRect().y)).toBeCloseTo(before.y, 1)
        await buttonHandle.dispose()
        await rowHandle.dispose()
      }

      const tasks = await page.evaluate(date => window.api.tasks.getByDate(date), seeded.date)
      expect(tasks).toHaveLength(3)
      const chapterIds = selectedChapters.map(chapter => chapter.id)
      const plannedTasks = tasks.filter(task => task.subject_id === first.subject.id)
      expect(plannedTasks).toHaveLength(3)
      expect(plannedTasks.map(task => task.related_chapter_id).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([...chapterIds].sort((a, b) => a - b))
      expect(plannedTasks.every(task => task.planned_date === seeded.date && task.type === 'focus' && task.status === 'todo')).toBe(true)
      await selectSubject(second)
      await expect(workspace).toBeHidden()
      await expect(page.getByTestId(`subject-card-${second.subject.id}`)).toBeVisible()
      await selectSubject(first)
      await expect(workspace).toBeVisible()
      expect(await body.evaluate(element => element.scrollTop)).toBe(initialScroll)
      if (width > 960) {
        await page.getByLabel('搜索科目', { exact: true }).fill(second.subject.name)
        await expect(page.getByTestId(`subject-select-${first.subject.id}`)).toHaveCount(0)
        await expect(workspace).toBeVisible()
        expect(await body.evaluate(element => element.scrollTop)).toBe(initialScroll)
        await expect(workspace.getByTestId('chapter-filter-open')).toHaveAttribute('aria-pressed', 'true')
      }
      const expectedTaskIds = plannedTasks.map(task => task.id).sort((a, b) => a - b)
      await page.reload()
      const persistedTasks = await page.evaluate(date => window.api.tasks.getByDate(date), seeded.date)
      expect(persistedTasks).toHaveLength(3)
      expect(persistedTasks.map(task => task.id).sort((a, b) => a - b)).toEqual(expectedTaskIds)
      expect(persistedTasks.map(task => task.related_chapter_id).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([...chapterIds].sort((a, b) => a - b))
      expect(persistedTasks.every(task => task.planned_date === seeded.date && task.type === 'focus' && task.status === 'todo')).toBe(true)
      await navigation.getByRole('button', { name: '科目进度', exact: true }).click()
      await selectSubject(first)
      const persistedWorkspace = page.getByTestId(`subject-card-${first.subject.id}`)
      await expect(persistedWorkspace).toBeVisible()
      for (const chapter of selectedChapters) {
        await expect(persistedWorkspace.getByTestId(`chapter-added-today-${chapter.id}`)).toHaveText('已加入今日')
        await expect(persistedWorkspace.getByTestId(`chapter-toggle-${chapter.id}`)).not.toBeChecked()
      }
    } finally {
      if (app) {
        const ownedProcess = app.process()
        if (ownedProcess.exitCode === null && ownedProcess.signalCode === null) await app.close()
        await expect.poll(() => ownedProcess.exitCode !== null || ownedProcess.signalCode !== null, { timeout: 10_000 }).toBe(true)
      }
      await removeDisposableElectronProfile(profile, profilePrefix)
    }
  }
})
