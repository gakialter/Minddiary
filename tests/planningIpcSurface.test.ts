import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readTrackedSource = (relativePath: string) => fs.readFileSync(
  path.resolve(process.cwd(), relativePath),
  'utf8',
)

const collectLiteralChannels = (source: string, receiver: 'ipcMain.handle' | 'ipcRenderer.invoke') => {
  const escapedReceiver = receiver.replace('.', '\\.')
  return Array.from(
    source.matchAll(new RegExp(`${escapedReceiver}\\(\\s*['\"]([^'\"]+)['\"]`, 'g')),
    match => match[1]!,
  )
}

describe('Phase C2 IPC surface', () => {
  const mainSource = readTrackedSource('electron/main.ts')
  const preloadSource = readTrackedSource('electron/preload.ts')

  it('keeps exactly one privileged AI task-creation channel', () => {
    const mainChannels = collectLiteralChannels(mainSource, 'ipcMain.handle')
      .filter(channel => channel.includes('createIdempotentAIStudyTaskForCurrentDate'))
    const preloadChannels = collectLiteralChannels(preloadSource, 'ipcRenderer.invoke')
      .filter(channel => channel.includes('createIdempotentAIStudyTaskForCurrentDate'))

    expect(mainChannels).toEqual(['tasks:createIdempotentAIStudyTaskForCurrentDate'])
    expect(preloadChannels).toEqual(['tasks:createIdempotentAIStudyTaskForCurrentDate'])
  })

  it('exposes only the frozen minimal Planning History channels', () => {
    const expected = [
      'planningRuns:create',
      'planningRuns:delete',
      'planningRuns:get',
      'planningRuns:listRecent',
      'planningRuns:transition',
    ]
    const mainChannels = collectLiteralChannels(mainSource, 'ipcMain.handle')
      .filter(channel => channel.startsWith('planningRuns:'))
      .sort()
    const preloadChannels = collectLiteralChannels(preloadSource, 'ipcRenderer.invoke')
      .filter(channel => channel.startsWith('planningRuns:'))
      .sort()

    expect(mainChannels).toEqual(expected)
    expect(preloadChannels).toEqual(expected)
    expect(mainSource).not.toContain('planningRuns:confirmCandidate')
    expect(preloadSource).not.toContain('planningRuns:confirmCandidate')
  })
})
