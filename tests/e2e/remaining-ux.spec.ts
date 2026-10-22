import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createDisposableElectronProfile, removeDisposableElectronProfile } from './disposableElectronProfile'

const projectRoot = path.resolve(__dirname, '../..')
const profilePrefix = 'minddiary-remaining-ux-e2e-'
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.describe.configure({ timeout: 90_000 })

type ProviderFixture = { server: Server; endpoint: string; requests: string[] }

async function provider(reply = '本地合成候选文本') : Promise<ProviderFixture> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      requests.push(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Synthetic provider failed to bind')
  return { server, endpoint: `http://127.0.0.1:${address.port}/v1`, requests }
}

async function launch(profile: string) {
  const app = await electron.launch({ args: [projectRoot, `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: 'production' } })
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
  const start = page.getByRole('button', { name: '开始使用', exact: true })
  if (await start.isVisible()) await start.click()
  await expect(page.getByRole('navigation', { name: '主要导航' })).toBeVisible()
  return { app, page }
}

async function navigate(page: Page, label: string) {
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name: label, exact: true }).click()
}

async function configure(page: Page, fixture: ProviderFixture) {
  await page.evaluate(async endpoint => {
    await window.api.settings.updateAI({ aiEndpoint: endpoint, aiModel: 'remaining-ux-local-model', aiApiKey: 'synthetic-remaining-ux-key' })
  }, fixture.endpoint)
  await page.reload()
}

async function closeApp(app: Awaited<ReturnType<typeof electron.launch>>, profile: string) {
  const child = app.process()
  await app.close()
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
  await removeDisposableElectronProfile(profile, profilePrefix)
}

async function closeProvider(fixture: ProviderFixture) {
  fixture.server.closeAllConnections()
  if (fixture.server.listening) await new Promise<void>((resolve, reject) => fixture.server.close(error => error ? reject(error) : resolve()))
}

async function selectEditorText(page: Page, text: string) {
  const body = page.getByRole('textbox', { name: '日记正文', exact: true })
  await body.evaluate((element, selectedText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf(selectedText) ?? -1
      if (index < 0) continue
      ;(element as HTMLElement).focus()
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + selectedText.length)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return
    }
    throw new Error('Synthetic diary selection text was not found in the rendered editor')
  }, text)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text)
}

async function searchAndOpen(page: Page, title: string) {
  await navigate(page, '搜索日记')
  await page.getByLabel('搜索内容', { exact: true }).fill(title)
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.locator('.workspace-search')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: `打开日记 ${title}`, exact: true }).click()
  await expect(page.getByRole('textbox', { name: '日记标题', exact: true })).toHaveValue(title)
}

test('new-user home keeps today and history dates clear and starts a linked task directly', async ({}, testInfo) => {
  const profile = createDisposableElectronProfile(profilePrefix)
  const { app, page } = await launch(profile)
  try {
    await page.setViewportSize({ width: 960, height: 600 })
    const dates = await page.evaluate(() => {
      const today = new Date()
      const previous = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
      const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      return { today: key(today), previous: key(previous) }
    })
    await navigate(page, '今日安排')
    await expect(page.getByText('疲劳预警', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('重要日期倒计时')).toContainText('暂无关键日期')
    await expect(page.getByText('当前状态：尚无学习记录', { exact: true })).toBeVisible()
    await expect(page.getByTestId('home-target-date-prompt')).toContainText('还没有设置目标日期')
    await expect(page.getByTestId('home-first-task-entry')).toContainText('创建科目')
    await expect(page.getByTestId('home-first-task-entry')).toContainText('打开专注计时')
    await page.getByTestId('home-target-date-prompt').getByRole('button', { name: '设置日期', exact: true }).click()
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    await navigate(page, '今日安排')
    await page.getByTestId('home-first-task-entry').getByRole('button', { name: '创建科目', exact: true }).click()
    await expect(page.getByRole('button', { name: '添加科目', exact: true })).toBeVisible()
    await navigate(page, '今日安排')
    await page.getByTestId('home-first-task-entry').getByRole('button', { name: '打开专注计时', exact: true }).click()
    await expect(page.getByTestId('pomodoro-start-btn')).toBeVisible()
    await navigate(page, '今日安排')
    const seed = await page.evaluate(async ({ today, previous }) => {
      const subject = await window.api.subjects.create({ name: '合成科目', color: '#2563eb' })
      await window.api.entries.create({ date: previous, title: '合成历史日记', content: '用于日期导航验证。', mood: null })
      const task = await window.api.tasks.create({ title: '合成今日任务', planned_date: today, type: 'focus', subject_id: subject.id, estimate_minutes: 25, status: 'todo', source: 'manual' })
      return { subjectId: subject.id, taskId: task.id }
    }, dates)
    await page.reload()
    await navigate(page, '今日安排')
    await expect(page.getByTestId('today-execution-overview')).toContainText(dates.today)
    await expect(page.getByTestId('home-target-date-prompt')).toContainText('还没有设置目标日期')
    await expect(page.getByTestId('daily-action-queue')).toContainText('合成今日任务')
    const statsBeforeStart = await page.evaluate(date => window.api.pomodoro.getStats(date), dates.today)
    const startButton = page.getByRole('button', { name: '开始专注：合成今日任务', exact: true })
    await startButton.scrollIntoViewIfNeeded()
    const taskButtonBox = (await startButton.boundingBox())!
    expect(taskButtonBox.x + taskButtonBox.width).toBeLessThanOrEqual(960)
    await page.screenshot({ path: testInfo.outputPath('remaining-task-actions-960x600.png') })
    await page.getByRole('button', { name: `开始专注：合成今日任务`, exact: true }).click()
    await expect(page.getByTestId('pomodoro-selected-task-summary')).toContainText('合成今日任务')
    await expect(page.getByTestId('pomodoro-task-select')).toHaveValue(String(seed.taskId))
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('pomodoro-active-session-v1') || '{}'))
    expect(session).toMatchObject({ selectedTaskId: seed.taskId, selectedSubject: seed.subjectId, modeId: 'work', isRunning: true })
    const stats = await page.evaluate(date => window.api.pomodoro.getStats(date), dates.today)
    expect(stats).toEqual(statsBeforeStart)

    await navigate(page, '日历')
    await page.locator(`.workspace-calendar__day[aria-label^="${dates.previous}"]`).click()
    await expect(page.locator('.editor-document__date time')).toHaveAttribute('datetime', dates.previous)
    await navigate(page, '日历')
    await expect(page.getByTestId('calendar-date-hint')).toContainText(`${dates.previous}（历史日期）`)
    await navigate(page, '今日安排')
    await expect(page.getByTestId('home-date-context')).toContainText(`显示今天（${dates.today}）`)
    await expect(page.getByTestId('home-date-context')).toContainText(`日历所选日期为 ${dates.previous}`)
    await page.screenshot({ path: testInfo.outputPath('remaining-home-history-date.png') })
    writeFileSync(testInfo.outputPath('remaining-home-assertions.json'), JSON.stringify({ userDataIsDisposableProfile: true, todayLabel: dates.today, selectedHistoryDate: dates.previous, taskId: seed.taskId, subjectId: seed.subjectId, workSessionRunning: true, statsUnchanged: true }, null, 2))
  } finally { await closeApp(app, profile) }
})

test('unconfigured assistant names missing settings and preserves a private TXT attachment until one explicit send', async ({}, testInfo) => {
  const fixture = await provider('本地合成助手回复')
  const profile = createDisposableElectronProfile(profilePrefix)
  const { app, page } = await launch(profile)
  try {
    await navigate(page, '学习助手')
    await expect(page.getByRole('status').filter({ hasText: 'AI 尚未配置，缺少：API 地址、API 密钥。你的问题草稿会保留。' })).toBeVisible()
    await page.locator('#ai-composer-input').fill('未配置时保留的问题')
    await page.getByRole('button', { name: '打开设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    await navigate(page, '学习助手')
    await expect(page.locator('#ai-composer-input')).toHaveValue('未配置时保留的问题')
    await configure(page, fixture)
    await navigate(page, '学习助手')
    const marker = `PRIVATE_TXT_${randomUUID()}`
    const filename = `synthetic-${randomUUID()}.txt`
    await page.locator('.ai-composer input[type="file"]').setInputFiles({ name: filename, mimeType: 'text/plain', buffer: Buffer.from(marker) })
    await expect(page.getByRole('button', { name: `移除附件：${filename}`, exact: true })).toBeVisible()
    await navigate(page, '今日安排')
    await navigate(page, '学习助手')
    await expect(page.getByRole('button', { name: `移除附件：${filename}`, exact: true })).toBeVisible()
    expect(fixture.requests).toHaveLength(0)
    const question = `仅检查当前附件。 ${randomUUID()}`
    await page.locator('#ai-composer-input').fill(question)
    await page.getByRole('button', { name: '发送问题', exact: true }).click()
    await expect.poll(() => fixture.requests.length).toBe(1)
    await expect(page.getByText('本地合成助手回复', { exact: true })).toBeVisible()
    const request = fixture.requests[0]!
    expect(request).toContain(marker)
    expect(request).toContain(question)
    await page.once('dialog', dialog => void dialog.accept())
    await page.getByRole('button', { name: '清空历史和草稿', exact: true }).click()
    await expect(page.locator('#ai-composer-input')).toHaveValue('')
    await expect(page.locator('.ai-attachments')).toHaveCount(0)
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
    expect(stored).not.toContain(marker)
    expect(stored).not.toContain(filename)
    expect(stored).not.toContain('PRIVATE_TXT_')
    await page.locator('#ai-composer-input').fill(`清除附件后只发送这句 ${randomUUID()}`)
    await page.getByRole('button', { name: '发送问题', exact: true }).click()
    await expect.poll(() => fixture.requests.length).toBe(2)
    expect(fixture.requests[1]).not.toContain(marker)
    writeFileSync(testInfo.outputPath('remaining-ai-assertions.json'), JSON.stringify({ missingSettingsShown: ['API 地址', 'API 密钥'], settingsEntryVisible: true, attachmentRetainedAcrossNavigation: true, requestsBeforeSend: 0, explicitRequests: fixture.requests.length, canaryOnlyInFirstRequest: fixture.requests[0]!.includes(marker) && !fixture.requests[1]!.includes(marker), privateAttachmentAbsentFromLocalStorage: true }, null, 2))
  } finally {
    await closeApp(app, profile)
    await closeProvider(fixture)
  }
})

test('same-day diary search keeps the selected polish target through navigation, apply and undo', async ({}, testInfo) => {
  const candidateText = '修订后的 A 选区'
  const fixture = await provider(candidateText)
  const profile = createDisposableElectronProfile(profilePrefix)
  const { app, page } = await launch(profile)
  try {
    await configure(page, fixture)
    await navigate(page, '写日记')
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
    const ids = await page.evaluate(async date => {
      const first = await window.api.entries.create({ date, title: '合成同日 A', content: 'A 原文：选中这句需要润色。A 尾部保持不变。', mood: null })
      const second = await window.api.entries.create({ date, title: '合成同日 B', content: 'B 原文保持独立，不能被 A 的候选覆盖。', mood: null })
      return { first: first.id, second: second.id }
    }, today)
    await searchAndOpen(page, '合成同日 A')
    const body = page.getByRole('textbox', { name: '日记正文', exact: true })
    const source = '需要润色'
    await selectEditorText(page, source)
    await page.locator('.diary-selection-toolbar').getByRole('button', { name: 'AI 润色', exact: true }).click()
    await page.getByRole('group', { name: '修改方式' }).getByRole('button', { name: '写得通顺', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'AI 修改稿' })
    await expect(review.getByRole('textbox', { name: '修改稿', exact: true })).toHaveValue(candidateText)
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.requests[0]).toContain(source)
    await searchAndOpen(page, '合成同日 B')
    await expect(review).toHaveCount(0)
    await searchAndOpen(page, '合成同日 A')
    await expect(review.getByRole('textbox', { name: '修改稿', exact: true })).toHaveValue(candidateText)
    await navigate(page, '今日安排')
    await navigate(page, '写日记')
    await expect(review).toBeVisible()
    const candidate = review.getByRole('textbox', { name: '修改稿', exact: true })
    await candidate.fill('人工调整的 A 候选')
    await review.getByRole('button', { name: '替换选中文字', exact: true }).click()
    await expect.poll(() => page.evaluate(id => window.api.entries.getById(id), ids.first)).toMatchObject({ content: 'A 原文：选中这句人工调整的 A 候选。A 尾部保持不变。' })
    expect(await page.evaluate(id => window.api.entries.getById(id), ids.second)).toMatchObject({ content: 'B 原文保持独立，不能被 A 的候选覆盖。' })
    await body.press('Control+z')
    await expect.poll(() => page.evaluate(id => window.api.entries.getById(id), ids.first)).toMatchObject({ content: 'A 原文：选中这句需要润色。A 尾部保持不变。' })
    await searchAndOpen(page, '合成同日 A')
    await selectEditorText(page, source)
    await page.locator('.diary-selection-toolbar').getByRole('button', { name: 'AI 润色', exact: true }).click()
    await page.getByRole('group', { name: '修改方式' }).getByRole('button', { name: '写得通顺', exact: true }).click()
    const staleReview = page.getByRole('dialog', { name: 'AI 修改稿' })
    await expect(staleReview.getByRole('textbox', { name: '修改稿', exact: true })).toHaveValue(candidateText)
    await page.getByRole('textbox', { name: '日记正文', exact: true }).fill('A 正文已人工修改，旧候选必须失效。')
    await expect(staleReview.getByRole('alert')).toContainText('原文或日记已变化')
    await expect(staleReview.getByRole('button', { name: '替换选中文字', exact: true })).toBeDisabled()
    await expect.poll(() => page.evaluate(id => window.api.entries.getById(id), ids.first)).toMatchObject({ content: 'A 正文已人工修改，旧候选必须失效。' })
    await searchAndOpen(page, '合成同日 B')
    await expect(page.getByRole('textbox', { name: '日记正文', exact: true })).toHaveText('B 原文保持独立，不能被 A 的候选覆盖。')
    await expect.poll(() => page.evaluate(id => window.api.entries.getById(id), ids.second)).toMatchObject({ content: 'B 原文保持独立，不能被 A 的候选覆盖。' })
    writeFileSync(testInfo.outputPath('remaining-polish-assertions.json'), JSON.stringify({ sameDayEntries: 2, exactRecordSelected: ids.first, appliedOnlyToSelectedRange: true, undoRestoredFirstRecord: true, changedBodyInvalidatedCandidate: true, secondRecordUnchanged: true, providerRequests: fixture.requests.length }, null, 2))
  } finally {
    await closeApp(app, profile)
    await closeProvider(fixture)
  }
})

test('long diary selection keeps the polish entry point and review dialog inside a compact viewport', async ({}, testInfo) => {
  const fixture = await provider('长文候选仅作检查')
  const profile = createDisposableElectronProfile(profilePrefix)
  const { app, page } = await launch(profile)
  try {
    await page.setViewportSize({ width: 960, height: 600 })
    await configure(page, fixture)
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
    const selectionText = `长文选区-${randomUUID()}`
    const longContent = `${selectionText}，这是既有日记的首段文字。${'\n\n后文继续滚动。'.repeat(56)}`
    const entry = await page.evaluate(async ({ date, content }) => window.api.entries.create({ date, title: '合成长日记', content, mood: null }), { date: today, content: longContent })
    await searchAndOpen(page, '合成长日记')
    // Scroll the actual ancestor until this visible paragraph is above the old
    // hardcoded 150px threshold, while keeping it in the editor viewport.
    await page.getByRole('textbox', { name: '日记正文', exact: true }).evaluate(element => {
      let ancestor = element.parentElement
      while (ancestor) {
        if (!ancestor.classList.contains('cm-scroller') && ancestor.scrollHeight > ancestor.clientHeight
          && /auto|scroll/.test(getComputedStyle(ancestor).overflowY)) {
          const top = element.getBoundingClientRect().top
          ancestor.scrollTop += top - 120
          break
        }
        ancestor = ancestor.parentElement
      }
    })
    const selectedTop = await page.getByRole('textbox', { name: '日记正文', exact: true }).evaluate(element => element.getBoundingClientRect().top)
    expect(selectedTop).toBeGreaterThan(0)
    expect(selectedTop).toBeLessThan(150)
    await selectEditorText(page, selectionText)
    const geometry = await page.getByRole('textbox', { name: '日记正文', exact: true }).evaluate(element => {
      const scroller = element.closest('.cm-scroller')!
      const selected = window.getSelection()
      const rect = (r: DOMRect) => ({ top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height })
      return { body: rect(element.getBoundingClientRect()), scroller: rect(scroller.getBoundingClientRect()),
        selection: selected?.rangeCount ? rect(selected.getRangeAt(0).getBoundingClientRect()) : null,
        activeElement: document.activeElement?.getAttribute('aria-label'), viewport: { width: innerWidth, height: innerHeight } }
    })
    writeFileSync(testInfo.outputPath('selection-geometry.json'), JSON.stringify(geometry, null, 2))
    expect(geometry.selection!.top).toBeGreaterThanOrEqual(geometry.scroller.top)
    expect(geometry.selection!.bottom).toBeLessThanOrEqual(Math.min(geometry.scroller.bottom, 600))
    expect(geometry.selection!.top).toBeLessThan(150)
    await page.screenshot({ path: testInfo.outputPath('selection-before-toolbar.png') })
    const toolbar = page.locator('.diary-selection-toolbar')
    await expect(toolbar.getByRole('button', { name: 'AI 润色', exact: true })).toBeVisible()
    const toolbarBox = await toolbar.boundingBox()
    expect(toolbarBox).not.toBeNull()
    expect(toolbarBox!.x).toBeGreaterThanOrEqual(0)
    expect(toolbarBox!.y).toBeGreaterThanOrEqual(0)
    expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(960)
    expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(600)
    await toolbar.getByRole('button', { name: 'AI 润色', exact: true }).click()
    await page.getByRole('group', { name: '修改方式' }).getByRole('button', { name: '写得通顺', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'AI 修改稿' })
    await expect(review.getByRole('textbox', { name: '修改稿', exact: true })).toHaveValue('长文候选仅作检查')
    const reviewBox = await review.boundingBox()
    expect(reviewBox).not.toBeNull()
    expect(reviewBox!.x).toBeGreaterThanOrEqual(0)
    expect(reviewBox!.y).toBeGreaterThanOrEqual(0)
    expect(reviewBox!.x + reviewBox!.width).toBeLessThanOrEqual(960)
    expect(reviewBox!.y + reviewBox!.height).toBeLessThanOrEqual(600)
    await page.screenshot({ path: testInfo.outputPath('remaining-long-selection-960x600.png') })
    expect(await page.evaluate(id => window.api.entries.getById(id), entry.id)).toMatchObject({ content: longContent })
    writeFileSync(testInfo.outputPath('remaining-long-selection-assertions.json'), JSON.stringify({ viewport: { width: 960, height: 600 }, selectedByRenderedDOMTreeWalker: true, toolbarInsideViewport: true, reviewInsideViewport: true, diaryUnchangedBeforeApply: true, providerRequests: fixture.requests.length }, null, 2))
  } finally {
    await closeApp(app, profile)
    await closeProvider(fixture)
  }
})
