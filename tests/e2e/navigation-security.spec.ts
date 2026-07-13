import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

let app: ElectronApplication
let page: Page
let server: Server
let profilePath: string
let windowCount: number

const projectRoot = path.join(__dirname, '..', '..')
const externalCallKey = '__minddiarySecurityExternalCalls'

const startServer = async (): Promise<void> => {
  server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: 'https://external.test/redirected?token=secret' })
      response.end()
      return
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html><head><title>MindDiary security E2E</title></head><body>ready</body></html>')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(5173, 'localhost', resolve)
  })
}

const stopServer = async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

const getExternalCalls = async (): Promise<readonly string[]> => app.evaluate(() => {
  const value = Reflect.get(process, '__minddiarySecurityExternalCalls')
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
})

const clearExternalCalls = async (): Promise<void> => {
  await app.evaluate(() => {
    Reflect.set(process, '__minddiarySecurityExternalCalls', [])
  })
}

test.describe.serial('Electron navigation security', () => {
  test.beforeAll(async () => {
    profilePath = mkdtempSync(path.join(tmpdir(), 'minddiary-security-e2e-'))
    await startServer()
    app = await electron.launch({
      args: [projectRoot, `--user-data-dir=${profilePath}`],
      env: { ...process.env, NODE_ENV: 'development' },
    })
    await expect.poll(() => app.windows().some(candidate => candidate.url().startsWith('http://localhost:5173'))).toBe(true)
    const appPage = app.windows().find(candidate => candidate.url().startsWith('http://localhost:5173'))
    if (!appPage) throw new Error('MindDiary application window was not created')
    page = appPage
    await page.waitForLoadState('load')
    await expect(page).toHaveURL('http://localhost:5173/')

    const shellWasReplaced = await app.evaluate(({ shell }) => Reflect.set(shell, 'openExternal', async (url: string) => {
      const calls = Reflect.get(process, '__minddiarySecurityExternalCalls')
      if (Array.isArray(calls)) calls.push(url)
    }))
    expect(shellWasReplaced).toBe(true)
    await clearExternalCalls()

    windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  })

  test.afterAll(async () => {
    await app.close()
    await stopServer()
    const resolvedProfile = path.resolve(profilePath)
    const resolvedTemp = path.resolve(tmpdir())
    if (!resolvedProfile.startsWith(`${resolvedTemp}${path.sep}minddiary-security-e2e-`)) {
      throw new Error('Refusing to remove unexpected E2E profile path')
    }
    rmSync(resolvedProfile, { recursive: true, force: true })
  })

  test.beforeEach(async () => {
    await clearExternalCalls()
  })

  test('denies target=_blank and opens valid HTTPS in the system-browser seam', async () => {
    await page.evaluate(() => {
      const anchor = document.createElement('a')
      anchor.href = 'https://external.test/blank?token=secret'
      anchor.target = '_blank'
      document.body.append(anchor)
      anchor.click()
    })

    await expect.poll(getExternalCalls).toEqual(['https://external.test/blank?token=secret'])
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowCount)
  })

  test('denies window.open child creation and opens valid HTTPS externally', async () => {
    const childWasDenied = await page.evaluate(() => window.open('https://external.test/window-open', '_blank') === null)

    expect(childWasDenied).toBe(true)
    await expect.poll(getExternalCalls).toEqual(['https://external.test/window-open'])
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowCount)
  })

  for (const blockedTarget of [
    'javascript:alert(1)',
    'data:text/html,blocked',
    'file:///C:/Windows/System32/calc.exe',
    'local://attachments/security-e2e.png',
  ]) {
    test(`denies window.open for ${blockedTarget.split(':')[0]} without external dispatch`, async () => {
      const childWasDenied = await page.evaluate(target => window.open(target, '_blank') === null, blockedTarget)

      expect(childWasDenied).toBe(true)
      await expect.poll(getExternalCalls).toEqual([])
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowCount)
    })
  }

  test('blocks external top-level navigation and dispatches it externally', async () => {
    await page.evaluate(() => {
      const anchor = document.createElement('a')
      anchor.href = 'https://external.test/top-level?token=secret'
      anchor.target = '_self'
      document.body.append(anchor)
      anchor.click()
    })

    await expect.poll(getExternalCalls).toEqual(['https://external.test/top-level?token=secret'])
    await expect.poll(() => page.evaluate(() => window.location.href)).toBe('http://localhost:5173/')
  })

  test('revalidates and blocks an untrusted redirect target', async () => {
    await page.evaluate(() => {
      const anchor = document.createElement('a')
      anchor.href = '/redirect'
      document.body.append(anchor)
      anchor.click()
    })

    await expect.poll(getExternalCalls).toEqual(['https://external.test/redirected?token=secret'])
    await expect.poll(() => page.evaluate(() => window.location.href)).toBe('http://localhost:5173/')
  })

  test('default-denies renderer notification and geolocation permissions', async () => {
    const permissions = await page.evaluate(async () => ({
      notification: await Notification.requestPermission(),
      geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state,
    }))

    expect(permissions).toEqual({ notification: 'denied', geolocation: 'denied' })
  })

  test('continues loading a valid local:// asset from the isolated profile', async () => {
    const userDataPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    const attachmentsPath = path.join(userDataPath, 'attachments')
    mkdirSync(attachmentsPath, { recursive: true })
    writeFileSync(
      path.join(attachmentsPath, 'security-e2e.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr1sAAAAASUVORK5CYII=', 'base64'),
    )

    const loaded = await page.evaluate(() => new Promise<boolean>(resolve => {
      const image = new Image()
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      image.src = 'local://attachments/security-e2e.png'
    }))

    expect(loaded).toBe(true)
  })
})
