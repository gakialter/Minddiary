import { existsSync } from 'node:fs'
import path from 'node:path'

export type PackagedPlatform = 'darwin' | 'win32'

function pathApiFor(executablePath: string): typeof path.posix | typeof path.win32 {
  return /^[A-Za-z]:[\\/]/.test(executablePath) || executablePath.includes('\\')
    ? path.win32
    : path.posix
}

export function resolvePackagedResourcesDirectory(
  executablePath: string,
  platform: PackagedPlatform,
): string {
  const pathApi = pathApiFor(executablePath)
  return platform === 'win32'
    ? pathApi.resolve(pathApi.dirname(executablePath), 'resources')
    : pathApi.resolve(pathApi.dirname(executablePath), '..', 'Resources')
}

export function hasPackagedUpdaterMetadata(
  executablePath: string,
  platform: PackagedPlatform,
): boolean {
  const pathApi = pathApiFor(executablePath)
  return existsSync(pathApi.join(
    resolvePackagedResourcesDirectory(executablePath, platform),
    'app-update.yml',
  ))
}
