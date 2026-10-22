import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createDisposableElectronProfile, removeDisposableElectronProfile } from './disposableElectronProfile'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.describe.configure({ timeout: 90_000 })
const projectRoot = path.resolve(__dirname, '../..')
const prefix = 'minddiary-opus-light-e2e-'

async function provider(reply = '本地合成回复，仅用于验证。') {
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
  if (!address || typeof address === 'string') throw new Error('Local fixture did not bind')
  return { requests, endpoint: `http://127.0.0.1:${address.port}/v1`, async close() {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  } }
}

async function launch() {
  const profile = createDisposableElectronProfile(prefix)
  const app = await electron.launch({ args: [projectRoot, `--user-data-dir=${profile}`], env: { ...process.env, NODE_ENV: 'production' } })
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile)
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  return { app, page, async close() {
    const child = app.process()
    await app.close()
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
    await removeDisposableElectronProfile(profile, prefix)
  } }
}

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name, exact: true }).click()
}

async function configure(page: Page, endpoint: string) {
  await page.evaluate(async aiEndpoint => {
    await window.api.settings.updateAI({ aiEndpoint, aiModel: 'opus-light-local-model', aiApiKey: 'synthetic-opus-light-key' })
  }, endpoint)
  await page.reload()
}

async function searchOpen(page: Page, title: string) {
  await navigate(page, '搜索日记')
  await page.getByLabel('搜索内容', { exact: true }).fill(title)
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.locator('.workspace-search')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: `打开日记 ${title}`, exact: true }).click()
  await expect(page.getByRole('textbox', { name: '日记标题', exact: true })).toHaveValue(title)
}

test('ordinary prompts and four official quick entries reach main networking without local diary or mistake data', async ({}, testInfo) => {
  const fixture = await provider()
  const session = await launch()
  const { page } = session
  const ordinary = ['别人考研每天学几小时？', '这道题不用递归怎么解？', '复习不要熬夜有什么科学依据？', 'Git 怎么撤回上次 commit？', '写一篇关于禁止吸烟的议论文。', '再出一道类似的数学题，不要给答案。']
  const quick = ['日记总结', '错题规律', '错题测验', '状态调整']
  try {
    await configure(page, fixture.endpoint)
    await navigate(page, '学习助手')
    // This profile has no diary: the official entry must still be discoverable.
    await expect(page.getByRole('button', { name: '日记总结', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '日记总结', exact: true }).click()
    await expect(page.locator('#ai-composer-input')).toHaveValue(/在对话中提供/)
    await page.locator('#ai-composer-input').fill('')
    await page.evaluate(async () => {
      await window.api.entries.create({ date: '2026-10-10', title: '合成私密日记', content: 'OPUS_LOCAL_DIARY_CANARY', mood: null })
      const subject = await window.api.subjects.create({ name: '合成隐私科目', color: '#2563eb' })
      await window.api.mistakes.create({ subject_id: subject.id, question: 'OPUS_LOCAL_MISTAKE_CANARY', answer: '本机合成答案', notes: '仅存本机' })
    })
    await page.reload()
    await navigate(page, '学习助手')
    const input = page.locator('#ai-composer-input')
    const send = page.getByRole('button', { name: '发送问题', exact: true })
    const sendAndWait = async (prompt: string) => {
      const count = fixture.requests.length
      await input.fill(prompt)
      await send.click()
      await expect.poll(() => fixture.requests.length).toBe(count + 1)
      await expect(page.getByRole('button', { name: '停止请求', exact: true })).toHaveCount(0)
      const messages = JSON.parse(fixture.requests[count]!).messages as { role: string; content: string }[]
      expect(messages.some(message => message.role === 'user' && message.content.includes(prompt))).toBe(true)
    }
    for (const prompt of ordinary) await sendAndWait(prompt)
    for (const label of quick) {
      await input.fill('')
      await page.getByRole('button', { name: label, exact: true }).click()
      const draft = await input.inputValue()
      expect(draft).toContain('在对话中')
      expect(draft).toContain('我提供的内容')
      await expect(page.getByRole('button', { name: /^移除资料：/ })).toHaveCount(0)
      await sendAndWait(`${draft}\n\n我现在提供的合成资料：今天复习了函数，分式运算漏写分母，当前有些疲惫。`)
    }
    for (const restriction of ['不要读取我的日记', '不要向 Provider 发送私人记录']) {
      await input.fill(restriction)
      await send.click()
      await expect(page.getByText('请说明限制范围；本次没有继续发送。', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '停止请求', exact: true })).toHaveCount(0)
      expect(fixture.requests).toHaveLength(10)
    }
    for (const restriction of ['这次别发日记', '这次别发给AI']) {
      await input.fill(restriction)
      await send.click()
      await expect(page.getByText('限制生效；旧回复作废，已发请求无法撤回。', { exact: true })).toBeVisible()
      await expect(input).toHaveValue('')
      await expect(page.getByRole('button', { name: '停止请求', exact: true })).toHaveCount(0)
      expect(fixture.requests).toHaveLength(10)
    }
    await input.fill('再出一道类似的数学题，不要给答案，也不要读取日记。')
    await send.click()
    await expect(page.getByText('请说明限制范围；本次没有继续发送。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '停止请求', exact: true })).toHaveCount(0)
    expect(fixture.requests).toHaveLength(10)
    expect(fixture.requests.join('\n')).not.toContain('OPUS_LOCAL_DIARY_CANARY')
    expect(fixture.requests.join('\n')).not.toContain('OPUS_LOCAL_MISTAKE_CANARY')
    writeFileSync(testInfo.outputPath('opus-ai-assertions.json'), JSON.stringify({ ordinary, quick, providerRequests: fixture.requests.length, emptyDiaryEntryEnabled: true, privacyRestrictionsBlocked: 4, mixedRestrictionBlocked: true, diaryAndMistakeCanariesAbsent: true, quickEntriesUseUserSuppliedInformation: true }, null, 2))
  } finally { await session.close(); await fixture.close() }
})

test('history search and visible date navigation retain independent same-day diary identities', async ({}, testInfo) => {
  const session = await launch()
  const { page } = session
  try {
    const seed = await page.evaluate(async () => {
      const d = new Date()
      const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const date = key(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1))
      const first = await window.api.entries.create({ date, title: '合成同日复盘 A', content: '独立复盘 A 原文', mood: null })
      const second = await window.api.entries.create({ date, title: '合成同日日记 B', content: '独立手写 B 原文', mood: null })
      return { date, today: key(d), first, second }
    })
    await searchOpen(page, seed.second.title)
    const body = page.getByRole('textbox', { name: '日记正文', exact: true })
    await expect(body).toHaveText(seed.second.content)
    await body.fill('独立手写 B 修改后')
    await page.keyboard.press('Control+s')
    await expect.poll(() => page.evaluate(id => window.api.entries.getById(id), seed.second.id)).toMatchObject({ content: '独立手写 B 修改后' })
    expect(await page.evaluate(id => window.api.entries.getById(id), seed.first.id)).toMatchObject({ content: seed.first.content })
    await searchOpen(page, seed.first.title)
    await expect(body).toHaveText(seed.first.content)
    await searchOpen(page, seed.second.title)
    await expect(body).toHaveText('独立手写 B 修改后')
    await expect(page.getByLabel('选择日期', { exact: true })).toHaveValue(seed.date)
    await expect(page.locator('.editor-document__date')).toContainText('历史日期')
    await navigate(page, '今日安排')
    await navigate(page, '写日记')
    await expect(page.getByRole('textbox', { name: '日记标题', exact: true })).toHaveValue(seed.second.title)
    await expect(body).toHaveText('独立手写 B 修改后')
    await expect(page.getByLabel('选择日期', { exact: true })).toHaveValue(seed.date)
    const sameDay = page.getByLabel('当天 2 篇', { exact: true })
    await expect(sameDay).toHaveValue(String(seed.second.id))
    await sameDay.selectOption(String(seed.first.id))
    await expect(body).toHaveText(seed.first.content)
    await sameDay.selectOption(String(seed.second.id))
    await expect(body).toHaveText('独立手写 B 修改后')
    await page.getByRole('button', { name: '回到今天', exact: true }).click()
    await expect(page.getByLabel('选择日期', { exact: true })).toHaveValue(seed.today)
    await page.getByLabel('选择日期', { exact: true }).fill(seed.date)
    await expect(sameDay).toBeVisible()
    await navigate(page, '日历')
    const cell = page.getByRole('button', { name: `${seed.date}，2 篇日记`, exact: true })
    await expect(cell).toContainText('2 篇日记')
    await cell.click()
    await sameDay.selectOption(String(seed.second.id))
    await expect(body).toHaveText('独立手写 B 修改后')
    await sameDay.selectOption(String(seed.first.id))
    await expect(body).toHaveText(seed.first.content)
    writeFileSync(testInfo.outputPath('opus-diary-assertions.json'), JSON.stringify({ firstId: seed.first.id, secondId: seed.second.id, date: seed.date, firstUnchanged: true, secondPersisted: true, searchOpenedBothById: true, sidebarReturnRetainsHistory: true, dateEntryAndCalendarExposeTwoRecords: true, sameDaySwitchVerified: true }, null, 2))
  } finally { await session.close() }
})

const mathMarkdown = String.raw`行内 $x^2$。

$$\frac{a}{b}$$

**保留粗体** [合成链接](https://example.invalid/opus)

` + '`$x^2$`' + '\n\n```text\n$$\\frac{a}{b}$$\n```\n\n' + '<img src="invalid" onerror="window.opusRawHtmlExecuted=true"><script>window.opusRawHtmlExecuted=true</script>'

async function assertMathMarkdown(output: Locator, page: Page) {
  await expect(output.locator('.katex')).toHaveCount(2)
  await expect(output.locator('.katex-display')).toHaveCount(1)
  await expect(output.locator('strong')).toHaveText('保留粗体')
  await expect(output.getByRole('link', { name: '合成链接' })).toHaveAttribute('href', 'https://example.invalid/opus')
  await expect(output.locator('code').first()).toHaveText('$x^2$')
  await expect(output.locator('pre code')).toContainText(String.raw`$$\frac{a}{b}$$`)
  await expect(output.locator('img, script, [onerror]')).toHaveCount(0)
  expect(await page.evaluate(() => Reflect.get(window, 'opusRawHtmlExecuted'))).toBeUndefined()
}

test('ordinary mistake notes, both review dialogs and diary summary render safe math and retain Markdown', async ({}, testInfo) => {
  const fixture = await provider(mathMarkdown)
  const session = await launch()
  const { page } = session
  try {
    await configure(page, fixture.endpoint)
    const seed = await page.evaluate(async notes => {
      const subject = await window.api.subjects.create({ name: '合成公式科目', color: '#2563eb' })
      const mistake = await window.api.mistakes.create({ subject_id: subject.id, question: '合成公式题目', answer: '合成答案', notes, next_review_date: '2020-01-01', mastered: false })
      const entry = await window.api.entries.create({ date: '2026-10-10', title: '合成公式日记', content: '只总结这段合成内容。', mood: null })
      return { mistakeId: mistake.id, entryId: entry.id }
    }, mathMarkdown)
    await page.reload()
    await navigate(page, '错题本')
    await page.getByTestId(`mistake-toggle-answer-${seed.mistakeId}`).click()
    await assertMathMarkdown(page.locator('.mistake-notes-md'), page)
    await page.getByRole('button', { name: '到期复习', exact: true }).click()
    const review = page.getByRole('dialog', { name: '错题复习', exact: true })
    await review.getByRole('button', { name: '查看答案', exact: true }).click()
    await assertMathMarkdown(review.locator('.mistake-review-notes-md'), page)
    await review.getByRole('button', { name: '关闭复习', exact: true }).click()
    await page.getByRole('button', { name: '错题复习', exact: true }).click()
    const dailyReview = page.locator('.daily-review-dialog')
    await dailyReview.getByLabel('每日题数', { exact: true }).fill('1')
    await dailyReview.getByRole('button', { name: '保存', exact: true }).click()
    await dailyReview.getByRole('button', { name: '开始复习', exact: true }).click()
    await dailyReview.getByRole('button', { name: '查看答案', exact: true }).click()
    await assertMathMarkdown(dailyReview.locator('.markdown-body'), page)
    await dailyReview.getByRole('button', { name: '关闭复习', exact: true }).click()
    await searchOpen(page, '合成公式日记')
    await page.getByRole('button', { name: '总结日记', exact: true }).click()
    await expect.poll(() => fixture.requests.length).toBe(1)
    const summary = page.locator('.editor-ai-summary .markdown-body')
    await assertMathMarkdown(summary, page)
    await page.locator('.editor-ai-summary').scrollIntoViewIfNeeded()
    await page.evaluate(() => document.fonts.ready)
    await expect(summary.locator('.katex-display')).toBeVisible()
    expect(await summary.locator('.katex-display').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(10)
    await page.screenshot({ path: testInfo.outputPath('opus-diary-math-summary.png') })
    expect(await page.evaluate(async id => (await window.api.mistakes.getAll({})).data.find(item => item.id === id)?.notes, seed.mistakeId)).toBe(mathMarkdown)
    expect(await page.evaluate(id => window.api.entries.getById(id), seed.entryId)).toMatchObject({ content: '只总结这段合成内容。' })
    writeFileSync(testInfo.outputPath('opus-math-assertions.json'), JSON.stringify({ surfaces: ['mistake-notes', 'MistakeReviewModal', 'DailyReviewModal', 'diary-summary'], inlinePerSurface: 1, displayPerSurface: 1, markdownCodeLinksPreserved: true, rawHtmlNotExecuted: true, savedSourceUnchanged: true, providerRequests: fixture.requests.length }, null, 2))
  } finally { await session.close(); await fixture.close() }
})
