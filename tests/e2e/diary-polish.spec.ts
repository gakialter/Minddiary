import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'

// Real application in its browser fallback; isolated localStorage, no Electron DB.
// Vite dev server; AI adapter is mocked only by the test route. Artifacts go outside the checkout.
let server: ChildProcess | undefined
let baseUrl: string
const sample = '今天复习了 **齿轮传动**，这里 ++需要再看++。\n\n把 ==受力分析== 写清楚，再做 {color:red}重点题{/color}。\n\n明天从一道具体的题开始。'

test.beforeAll(async () => {
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No preview port')
  const port = address.port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  baseUrl = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
  await expect.poll(async () => {
    try { return (await fetch(baseUrl)).ok } catch { return false }
  }).toBe(true)
})
test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = new Promise<void>(resolve => server!.once('exit', () => resolve()))
    server.kill()
    await stopped
  }
})

async function openEditor(page: Page, theme: 'light' | 'dark', content = sample) {
  await page.addInitScript(({ theme, content }) => {
    const today = new Date()
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    localStorage.setItem('started', 'true')
    localStorage.setItem('mindiary_settings', JSON.stringify({ theme }))
    localStorage.setItem('mindiary_entries', JSON.stringify([{ id: 9001, date, title: '复习与思考', content, tags: [], mood: null, images: [], word_count: content.length, created_at: date, updated_at: date }]))
  }, { theme, content })
  await page.route('**/src/contexts/api/aiApi.ts*', async route => {
    await route.fulfill({ contentType: 'application/javascript', body: `
      export const createAiApi = () => ({ chat: async messages => {
        window.polishRequests.push(messages);
        return new Promise(resolve => window.polishResolve = resolve);
      }});` })
  })
  await page.addInitScript(() => { (window as any).polishRequests = [] })
  await page.goto(baseUrl)
  const start = page.getByRole('button', { name: '开始使用' })
  if (await start.isVisible()) await start.click()
  await page.getByRole('button', { name: '写日记', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '日记正文' })).toBeVisible()
}

async function selectText(page: Page, text: string) {
  // Use the browser selection itself; never expose a production editor test API.
  await page.getByRole('textbox', { name: '日记正文' }).evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf(text) ?? -1
      if (index < 0) continue
      ;(element as HTMLElement).focus()
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + text.length)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return
    }
    throw new Error(`Text not found: ${text}`)
  }, text)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text)
}


for (const size of [{ width: 1280, height: 720 }, { width: 960, height: 600 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${size.width}x${size.height} ${theme}: polish review states`, async ({ page }, info) => {
      await page.setViewportSize(size)
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      const source = '需要再看' + '这次复习还需要结合具体题目反复练习。'.repeat(18)
      await openEditor(page, theme, '今天复习。++需要再看++。\n\n' + source)
      const body = page.getByRole('textbox', { name: '日记正文' })
      const floating = page.locator('.diary-selection-toolbar')
      const review = page.getByRole('dialog', { name: 'AI 润色候选' })
      async function screenshot(name: string) {
        const box = (await review.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(size.width)
        expect(box.y + box.height).toBeLessThanOrEqual(size.height)
        await page.screenshot({ path: info.outputPath(name + '.png') })
      }
      await selectText(page, '需要再看')
      await floating.getByRole('button', { name: '文字颜色' }).click()
      await floating.getByRole('button', { name: 'AI 润色' }).click()
      await expect(page.getByRole('group', { name: '选择颜色' })).toBeHidden()
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('需要再看')
      const menu = page.getByRole('group', { name: '选择润色动作' })
      const menuBox = (await menu.boundingBox())!
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(size.height)
      await page.screenshot({ path: info.outputPath('menu.png') })
      await menu.getByRole('button', { name: '润色表达' }).click()
      await expect(review.getByRole('status')).toBeVisible()
      await screenshot('loading')
      expect(await page.evaluate(() => (window as any).polishRequests[0][1].content)).toBe('需要再看')
      await page.evaluate(() => (window as any).polishResolve({ content: '需要再次复习' }))
      await expect(review.getByText('需要再次复习', { exact: true })).toBeVisible()
      await screenshot('candidate')
      await review.getByRole('button', { name: '应用', exact: true }).click()
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mindiary_entries')!)[0].content)).toContain('++需要再次复习++')
      await body.press('Control+z')
      await expect(body).toContainText('需要再看')
      await selectText(page, '需要再看')
      await floating.getByRole('button', { name: 'AI 润色' }).click()
      await page.getByRole('button', { name: '精简', exact: true }).click()
      await body.press('ArrowRight')
      await page.keyboard.insertText('补充')
      await expect(review.getByRole('alert')).toContainText('原文或选区已发生变化')
      await expect(review.getByRole('button', { name: '应用', exact: true })).toBeDisabled()
      await screenshot('stale')
      await review.getByRole('button', { name: '放弃' }).click()
      await selectText(page, '需要再看')
      await floating.getByRole('button', { name: 'AI 润色' }).click()
      await page.getByRole('button', { name: '纠正语病', exact: true }).click()
      await page.evaluate(() => (window as any).polishResolve({ error: '请先在设置中配置 AI API 地址和密钥' }))
      await expect(review.getByRole('alert')).toContainText('配置')
      await screenshot('error')
      await review.getByRole('button', { name: '放弃' }).click()
      const longSource = '复习之后需要结合题目练习。'.repeat(8)
      await body.press('Control+a')
      await page.keyboard.insertText(longSource)
      await selectText(page, longSource)
      await floating.getByRole('button', { name: 'AI 润色' }).click()
      await page.getByRole('button', { name: '保持原意改写', exact: true }).click()
      await page.evaluate(() => (window as any).polishResolve({ content: '复习之后还需要再次结合题目练习。'.repeat(18) }))
      await expect(review.getByRole('button', { name: '应用', exact: true })).toBeEnabled()
      expect(await review.locator('.diary-polish-review__text').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
      await review.locator('.diary-polish-review__text').evaluate(el => { el.scrollTop = el.scrollHeight })
      await screenshot('long-candidate')
      await review.press('Escape')
      await expect(review).toBeHidden()
      expect(errors).toEqual([])
    })
  }
}
