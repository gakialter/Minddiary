import { expect, test, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hasPackagedUpdaterMetadata } from '../helpers/packagedResources'

const projectRoot = path.resolve(__dirname, '..', '..')
const profilePrefix = 'minddiary-packaged-e2e-'
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
  version: string
  devDependencies: { electron: string }
}
const expectedVersion = packageJson.version
const expectedElectronVersion = packageJson.devDependencies.electron
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr1sAAAAASUVORK5CYII='
const updaterStatuses = new Set([
  'idle',
  'checking',
  'available',
  'not-available',
  'downloading',
  'downloaded',
  'error',
  'auto-update-not-configured',
])

interface PackagedSession {
  browser: Browser
  child: ChildProcessWithoutNullStreams
  page: Page
  output: () => string
}

function findPackagedExecutable(): string {
  const candidate = process.platform === 'win32'
    ? path.join(projectRoot, 'release', 'win-unpacked', 'MindDiary.exe')
    : process.platform === 'darwin'
      ? path.join(projectRoot, 'release', 'mac-arm64', 'MindDiary.app', 'Contents', 'MacOS', 'MindDiary')
      : ''

  if (!candidate || !existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new Error(`Packaged MindDiary executable does not exist for ${process.platform}: ${candidate || '(unsupported)'}`)
  }
  return candidate
}

function assertDisposableProfile(profilePath: string): void {
  const resolvedProfile = path.resolve(profilePath)
  if (path.dirname(resolvedProfile) !== path.resolve(tmpdir()) || !path.basename(resolvedProfile).startsWith(profilePrefix)) {
    throw new Error(`Refusing to remove unexpected packaged E2E profile: ${resolvedProfile}`)
  }
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    child.kill('SIGTERM')
  }
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return true
  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

async function waitForPackagedPage(context: BrowserContext, child: ChildProcessWithoutNullStreams, output: () => string): Promise<Page> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const page = context.pages().find(candidate => {
      const url = decodeURIComponent(candidate.url()).replace(/\\/g, '/').toLowerCase()
      return url.startsWith('file:') && url.includes('/resources/app.asar/dist/index.html')
    })
    if (page) return page
    if (child.exitCode !== null) {
      throw new Error(`Packaged MindDiary exited before its application page loaded. Output:\n${output()}`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for packaged application page. Output:\n${output()}`)
}

async function launchPackaged(executablePath: string, profilePath: string): Promise<PackagedSession> {
  const child = spawn(executablePath, [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
  ], {
    env: {
      ...process.env,
      MINDDIARY_E2E_SANDBOX_PROBE: '1',
      NODE_ENV: 'production',
    },
    stdio: 'pipe',
    windowsHide: true,
  })

  let combinedOutput = ''
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for packaged CDP endpoint. Output:\n${combinedOutput}`))
      }, 30_000)
      const inspect = (chunk: Buffer) => {
        combinedOutput = `${combinedOutput}${chunk.toString('utf8')}`.slice(-32_000)
        const match = combinedOutput.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (!match) return
        const endpoint = match[1]
        if (!endpoint) return
        const url = new URL(endpoint)
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
          clearTimeout(timer)
          reject(new Error(`Packaged CDP endpoint is not loopback-only: ${url.href}`))
          return
        }
        clearTimeout(timer)
        resolve(url.href)
      }
      child.stdout.on('data', inspect)
      child.stderr.on('data', inspect)
      child.once('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', code => {
        clearTimeout(timer)
        reject(new Error(`Packaged MindDiary exited before CDP was ready with code ${String(code)}. Output:\n${combinedOutput}`))
      })
    })

    const browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    if (!context) throw new Error('Packaged MindDiary did not expose a Chromium browser context')
    const page = await waitForPackagedPage(context, child, () => combinedOutput)
    await page.waitForLoadState('load')

    return { browser, child, page, output: () => combinedOutput }
  } catch (error) {
    killProcessTree(child)
    await waitForExit(child, 5_000)
    throw error
  }
}

async function closePackaged(session: PackagedSession): Promise<void> {
  try {
    if (!session.page.isClosed()) {
      await session.page.evaluate(() => window.api.window.close()).catch(() => undefined)
    }
    await waitForExit(session.child, 5_000)
  } finally {
    await session.browser.close().catch(() => undefined)
    if (session.child.exitCode === null && process.platform !== 'win32') session.child.kill('SIGTERM')
    if (!await waitForExit(session.child, 3_000)) {
      if (process.platform === 'win32') killProcessTree(session.child)
      else session.child.kill('SIGKILL')
    }
    if (!await waitForExit(session.child, 5_000)) {
      throw new Error(`Packaged MindDiary process ${String(session.child.pid)} did not exit`)
    }
  }
}

test('runs the unpacked packaged app with hardened runtime and persisted local data', async () => {
  test.skip(process.platform !== 'win32' && process.platform !== 'darwin', 'Packaged smoke supports Windows and macOS')

  const executablePath = findPackagedExecutable()
  const profilePath = mkdtempSync(path.join(tmpdir(), profilePrefix))
  let session: PackagedSession | undefined

  try {
    session = await launchPackaged(executablePath, profilePath)
    const documentUrl = decodeURIComponent(session.page.url()).replace(/\\/g, '/').toLowerCase()
    expect(documentUrl).toContain('/resources/app.asar/dist/index.html')

    const runtimeState = await session.page.evaluate(() => {
      const probe = Reflect.get(globalThis, '__minddiarySandboxProbe')
      const inlineProbeKey = '__minddiaryPackagedInlineProbe'
      Reflect.set(globalThis, inlineProbeKey, false)
      const script = document.createElement('script')
      script.textContent = `globalThis.${inlineProbeKey} = true`
      document.head.appendChild(script)
      script.remove()
      return {
        probe,
        probeFrozen: typeof probe === 'object' && probe !== null && Object.isFrozen(probe),
        rendererGlobals: {
          process: typeof process,
          require: typeof require,
          Buffer: typeof Buffer,
        },
        inlineScriptExecuted: Reflect.get(globalThis, inlineProbeKey),
        userAgent: navigator.userAgent,
      }
    })
    expect(runtimeState).toEqual({
      probe: { sandboxed: true, contextIsolated: true },
      probeFrozen: true,
      rendererGlobals: { process: 'undefined', require: 'undefined', Buffer: 'undefined' },
      inlineScriptExecuted: false,
      userAgent: expect.stringContaining(`Electron/${expectedElectronVersion}`),
    })

    await session.page.getByRole('button', { name: '开始使用', exact: true }).click()
    await session.page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(session.page.getByText(`v${expectedVersion}`, { exact: true })).toBeVisible()

    const sentinelExamDate = '2099-12-31'
    await session.page.evaluate(async examDate => {
      const result = await window.api.settings.updateGeneral({ examDate })
      if (!result.success) throw new Error('Packaged settings update failed')
    }, sentinelExamDate)
    await expect.poll(() => session?.page.evaluate(() => window.api.settings.getAll().then(settings => settings.examDate)))
      .toBe(sentinelExamDate)

    const persisted = await session.page.evaluate(async ({ imageData, date }) => {
      const entry = await window.api.entries.create({
        date,
        title: 'Packaged persistence smoke',
        content: 'Created through the packaged preload API',
        mood: null,
      })
      const attachment = await window.api.attachments.save(entry.id, {
        name: 'packaged-security.png',
        data: imageData,
        mimetype: 'image/png',
      })
      return { entryId: entry.id, attachment }
    }, { imageData: pngBase64, date: sentinelExamDate })
    expect(existsSync(path.join(profilePath, 'attachments', persisted.attachment.filepath))).toBe(true)

    const localUrl = `local://attachments/${encodeURIComponent(persisted.attachment.filepath)}`
    const imageDimensions = await session.page.evaluate(url => new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('Packaged local:// image failed to load'))
      image.src = url
    }), localUrl)
    expect(imageDimensions).toEqual({ width: 1, height: 1 })

    const updaterStatus = await session.page.evaluate(() => window.api.updater.getStatus())
    expect(updaterStatuses.has(updaterStatus.status)).toBe(true)
    if (hasPackagedUpdaterMetadata(
      executablePath,
      process.platform === 'win32' ? 'win32' : 'darwin',
    )) {
      expect(updaterStatus.status).not.toBe('auto-update-not-configured')
      if (updaterStatus.status === 'error') {
        expect(updaterStatus.message ?? '').not.toMatch(/asar|integrity|cannot find|module|app-update|enoent/i)
      }
    } else {
      expect(updaterStatus.status).toBe('auto-update-not-configured')
    }
    expect(JSON.stringify(updaterStatus)).not.toMatch(/token|password|api.?key/i)

    await closePackaged(session)
    session = undefined
    expect(existsSync(path.join(profilePath, 'minddiary.db'))).toBe(true)
    expect(statSync(path.join(profilePath, 'minddiary.db')).size).toBeGreaterThan(0)

    session = await launchPackaged(executablePath, profilePath)
    await expect.poll(() => session?.page.evaluate(() => window.api.settings.getAll().then(settings => settings.examDate)))
      .toBe(sentinelExamDate)
    const reloaded = await session.page.evaluate(async ({ entryId }) => ({
      entry: await window.api.entries.getById(entryId),
      attachments: await window.api.attachments.getByEntry(entryId),
    }), { entryId: persisted.entryId })
    expect(reloaded.entry).toEqual(expect.objectContaining({
      id: persisted.entryId,
      title: 'Packaged persistence smoke',
    }))
    expect(reloaded.attachments).toEqual([expect.objectContaining({
      id: persisted.attachment.id,
      filepath: persisted.attachment.filepath,
    })])
    expect(session.output()).not.toMatch(/asar integrity|integrity check failed/i)
  } finally {
    if (session) await closePackaged(session)
    assertDisposableProfile(profilePath)
    rmSync(profilePath, { recursive: true, force: true })
  }
})
