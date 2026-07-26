import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hasPackagedUpdaterMetadata,
  resolvePackagedResourcesDirectory,
} from './helpers/packagedResources'

const tempRoots: string[] = []

function makeMacBundle(): {
  bundleRoot: string
  executablePath: string
  resourcesDirectory: string
} {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-packaged-resources-'))
  tempRoots.push(bundleRoot)
  const executablePath = path.join(
    bundleRoot,
    'MindDiary.app',
    'Contents',
    'MacOS',
    'MindDiary',
  )
  const resourcesDirectory = path.join(bundleRoot, 'MindDiary.app', 'Contents', 'Resources')
  fs.mkdirSync(path.dirname(executablePath), { recursive: true })
  fs.writeFileSync(executablePath, '')
  fs.mkdirSync(resourcesDirectory, { recursive: true })
  return { bundleRoot, executablePath, resourcesDirectory }
}

describe('packaged resources resolution', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves a macOS executable to Contents/Resources', () => {
    expect(resolvePackagedResourcesDirectory(
      '/Applications/MindDiary.app/Contents/MacOS/MindDiary',
      'darwin',
    )).toBe('/Applications/MindDiary.app/Contents/Resources')
  })

  it('continues to resolve a Windows executable to resources', () => {
    expect(resolvePackagedResourcesDirectory(
      String.raw`C:\build\win-unpacked\MindDiary.exe`,
      'win32',
    )).toBe(String.raw`C:\build\win-unpacked\resources`)
  })

  it('detects app-update.yml in a macOS Contents/Resources fixture', () => {
    const { executablePath, resourcesDirectory } = makeMacBundle()
    fs.writeFileSync(path.join(resourcesDirectory, 'app-update.yml'), 'provider: github')

    expect(hasPackagedUpdaterMetadata(executablePath, 'darwin')).toBe(true)
  })

  it('reports missing updater metadata', () => {
    const { executablePath } = makeMacBundle()

    expect(hasPackagedUpdaterMetadata(executablePath, 'darwin')).toBe(false)
  })

  it('does not accept app-update.yml at the app bundle root', () => {
    const { bundleRoot, executablePath } = makeMacBundle()
    const incorrectResourcesDirectory = path.join(bundleRoot, 'MindDiary.app', 'Resources')
    fs.mkdirSync(incorrectResourcesDirectory, { recursive: true })
    fs.writeFileSync(
      path.join(incorrectResourcesDirectory, 'app-update.yml'),
      'provider: github',
    )

    expect(hasPackagedUpdaterMetadata(executablePath, 'darwin')).toBe(false)
  })
})
