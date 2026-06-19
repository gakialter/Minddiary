import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

type ReleasePlatform = 'win' | 'mac'

type PackagePublishEntry = {
  provider?: unknown
  owner?: unknown
  repo?: unknown
}

type PackageMetadata = {
  version?: unknown
  build?: {
    publish?: PackagePublishEntry | PackagePublishEntry[] | string | null
  }
}

type GithubPublishConfig = {
  owner: string
  repo: string
}

export type ReleaseMetadataSummary = {
  latestPath: string
  installerPath: string
  packageVersion: string
  publishOwner: string
  publishRepo: string
  appUpdatePaths: string[]
}

export type VerifyReleaseMetadataOptions = {
  platform?: ReleasePlatform
  releaseDir: string
  packageJsonPath: string
}

export class ReleaseMetadataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseMetadataError'
  }
}

function parseScalar(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function assignYamlPair(target: Record<string, unknown>, line: string): void {
  const match = /^([^:#][^:]*):(?:\s*(.*))?$/.exec(line)
  if (!match) {
    throw new ReleaseMetadataError(`Unsupported YAML line: ${line}`)
  }

  const key = match[1]?.trim()
  if (!key) {
    throw new ReleaseMetadataError(`Unsupported YAML key in line: ${line}`)
  }

  target[key] = parseScalar(match[2] ?? '')
}

export function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let activeArray: Record<string, unknown>[] | null = null
  let activeItem: Record<string, unknown> | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      const match = /^([^:#][^:]*):(?:\s*(.*))?$/.exec(trimmed)
      if (!match) {
        throw new ReleaseMetadataError(`Unsupported YAML line: ${trimmed}`)
      }

      const key = match[1]?.trim()
      if (!key) {
        throw new ReleaseMetadataError(`Unsupported YAML key in line: ${trimmed}`)
      }

      const value = match[2] ?? ''
      if (value.trim() === '') {
        const arrayValue: Record<string, unknown>[] = []
        result[key] = arrayValue
        activeArray = arrayValue
        activeItem = null
      } else {
        result[key] = parseScalar(value)
        activeArray = null
        activeItem = null
      }
      continue
    }

    if (!activeArray) {
      throw new ReleaseMetadataError(`Unsupported YAML nesting: ${trimmed}`)
    }

    if (trimmed.startsWith('- ')) {
      activeItem = {}
      activeArray.push(activeItem)
      const inline = trimmed.slice(2).trim()
      if (inline) assignYamlPair(activeItem, inline)
      continue
    }

    if (!activeItem) {
      throw new ReleaseMetadataError(`Unsupported YAML array item: ${trimmed}`)
    }
    assignYamlPair(activeItem, trimmed)
  }

  return result
}

function readJsonFile(filepath: string): unknown {
  return JSON.parse(fs.readFileSync(filepath, 'utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRequiredString(source: Record<string, unknown>, key: string, context: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ReleaseMetadataError(`Missing ${context} ${key}`)
  }
  return value.trim()
}

function getOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function getPackageMetadata(packageJsonPath: string): PackageMetadata {
  const metadata = readJsonFile(packageJsonPath)
  if (!isRecord(metadata)) {
    throw new ReleaseMetadataError('package.json must contain a JSON object')
  }
  return metadata as PackageMetadata
}

function getGithubPublishConfig(packageMetadata: PackageMetadata): GithubPublishConfig {
  const publish = packageMetadata.build?.publish
  const entries = Array.isArray(publish) ? publish : [publish]

  for (const entry of entries) {
    if (!isRecord(entry)) continue
    if (entry.provider !== 'github') continue
    if (typeof entry.owner === 'string' && entry.owner.trim()
      && typeof entry.repo === 'string' && entry.repo.trim()) {
      return { owner: entry.owner.trim(), repo: entry.repo.trim() }
    }
  }

  throw new ReleaseMetadataError('package.json build.publish must include GitHub owner and repo')
}

function resolveReleaseAsset(releaseDir: string, assetPath: string, context: string): string {
  if (path.isAbsolute(assetPath) || path.win32.isAbsolute(assetPath) || path.posix.isAbsolute(assetPath)) {
    throw new ReleaseMetadataError(`${context} must be a relative release asset path`)
  }

  const resolved = path.resolve(releaseDir, assetPath)
  const relative = path.relative(releaseDir, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ReleaseMetadataError(`${context} must stay inside the release directory`)
  }

  if (!fs.existsSync(resolved)) {
    throw new ReleaseMetadataError(`${context} points to missing asset: ${assetPath}`)
  }

  const stat = fs.statSync(resolved)
  if (!stat.isFile() || stat.size === 0) {
    throw new ReleaseMetadataError(`${context} points to an empty or non-file asset: ${assetPath}`)
  }

  return resolved
}

function findFilesByExtension(root: string, extension: string): string[] {
  if (!fs.existsSync(root)) return []

  const matches: string[] = []
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      matches.push(...findFilesByExtension(fullPath, extension))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
      matches.push(fullPath)
    }
  }
  return matches.sort()
}

function findNamedFiles(root: string, filename: string): string[] {
  if (!fs.existsSync(root)) return []

  const matches: string[] = []
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      matches.push(...findNamedFiles(fullPath, filename))
    } else if (entry.isFile() && entry.name === filename) {
      matches.push(fullPath)
    }
  }
  return matches.sort()
}

function getLatestFilename(platform: ReleasePlatform): string {
  return platform === 'mac' ? 'latest-mac.yml' : 'latest.yml'
}

function validateRequiredMacArtifacts(releaseDir: string): void {
  const requiredExtensions = ['.dmg', '.zip', '.blockmap']

  requiredExtensions.forEach(extension => {
    const matches = findFilesByExtension(releaseDir, extension)
    if (matches.length === 0) {
      throw new ReleaseMetadataError(`Missing macOS ${extension} artifact under release directory`)
    }

    matches.forEach(filepath => {
      const stat = fs.statSync(filepath)
      if (!stat.isFile() || stat.size === 0) {
        throw new ReleaseMetadataError(`macOS ${extension} artifact is empty: ${path.relative(releaseDir, filepath)}`)
      }
    })
  })
}

function validateLatestYml(latest: Record<string, unknown>, releaseDir: string, packageVersion: string, platform: ReleasePlatform): string {
  const latestFilename = getLatestFilename(platform)
  const latestVersion = getRequiredString(latest, 'version', latestFilename)
  if (latestVersion !== packageVersion) {
    throw new ReleaseMetadataError(`${latestFilename} version ${latestVersion} does not match package.json version ${packageVersion}`)
  }

  const files = latest.files
  if (!Array.isArray(files) || files.length === 0) {
    throw new ReleaseMetadataError(`Missing ${latestFilename} files`)
  }

  const latestPathValue = getRequiredString(latest, 'path', latestFilename)
  const latestSha512 = getRequiredString(latest, 'sha512', latestFilename)
  const releaseDate = getRequiredString(latest, 'releaseDate', latestFilename)

  if (latestSha512.length === 0) {
    throw new ReleaseMetadataError(`Missing ${latestFilename} sha512`)
  }

  if (Number.isNaN(Date.parse(releaseDate))) {
    throw new ReleaseMetadataError(`${latestFilename} releaseDate is not a valid date: ${releaseDate}`)
  }

  const installerPath = resolveReleaseAsset(releaseDir, latestPathValue, `${latestFilename} path`)
  const expectedPrimaryAsset = platform === 'win'
    ? `MindDiary-Setup-${packageVersion}.exe`
    : `MindDiary-${packageVersion}-arm64-mac.zip`
  if (latestPathValue !== expectedPrimaryAsset) {
    throw new ReleaseMetadataError(
      `${latestFilename} path must point to the root release asset ${expectedPrimaryAsset}: ${latestPathValue}`,
    )
  }

  const allowedMetadataAssets = platform === 'win'
    ? new Set([expectedPrimaryAsset])
    : new Set([
        expectedPrimaryAsset,
        `MindDiary-${packageVersion}-arm64.dmg`,
      ])

  files.forEach((fileEntry, index) => {
    if (!isRecord(fileEntry)) {
      throw new ReleaseMetadataError(`${latestFilename} files[${index}] must be an object`)
    }

    const filePath = getOptionalString(fileEntry, 'url') ?? getOptionalString(fileEntry, 'path')
    if (!filePath) {
      throw new ReleaseMetadataError(`Missing ${latestFilename} files[${index}].url`)
    }
    if (!allowedMetadataAssets.has(filePath)) {
      throw new ReleaseMetadataError(
        `${latestFilename} files[${index}].url must point to an allowlisted root release asset: ${filePath}`,
      )
    }
    getRequiredString(fileEntry, 'sha512', `${latestFilename} files[${index}]`)
    resolveReleaseAsset(releaseDir, filePath, `${latestFilename} files[${index}].url`)
  })

  if (platform === 'mac') {
    validateRequiredMacArtifacts(releaseDir)
  }

  return installerPath
}

function validateAppUpdateYml(appUpdatePath: string, publishConfig: GithubPublishConfig): void {
  const appUpdate = parseSimpleYaml(fs.readFileSync(appUpdatePath, 'utf8'))
  const provider = getRequiredString(appUpdate, 'provider', 'app-update.yml')
  const owner = getRequiredString(appUpdate, 'owner', 'app-update.yml')
  const repo = getRequiredString(appUpdate, 'repo', 'app-update.yml')

  if (provider !== 'github') {
    throw new ReleaseMetadataError(`app-update.yml provider ${provider} does not match package.json publish provider github`)
  }
  if (owner !== publishConfig.owner) {
    throw new ReleaseMetadataError(`app-update.yml owner ${owner} does not match package.json publish owner ${publishConfig.owner}`)
  }
  if (repo !== publishConfig.repo) {
    throw new ReleaseMetadataError(`app-update.yml repo ${repo} does not match package.json publish repo ${publishConfig.repo}`)
  }
}

export function verifyReleaseMetadata(options: VerifyReleaseMetadataOptions): ReleaseMetadataSummary {
  const platform = options.platform ?? 'win'
  const releaseDir = path.resolve(options.releaseDir)
  const packageJsonPath = path.resolve(options.packageJsonPath)
  const latestFilename = getLatestFilename(platform)
  const latestPath = path.join(releaseDir, latestFilename)

  if (!fs.existsSync(latestPath)) {
    throw new ReleaseMetadataError(`Missing ${latestFilename} at ${latestPath}`)
  }

  const packageMetadata = getPackageMetadata(packageJsonPath)
  const packageVersion = typeof packageMetadata.version === 'string' ? packageMetadata.version.trim() : ''
  if (!packageVersion) {
    throw new ReleaseMetadataError('package.json version must be a non-empty string')
  }

  const publishConfig = getGithubPublishConfig(packageMetadata)
  const latest = parseSimpleYaml(fs.readFileSync(latestPath, 'utf8'))
  const installerPath = validateLatestYml(latest, releaseDir, packageVersion, platform)
  const appUpdatePaths = findNamedFiles(releaseDir, 'app-update.yml')
  if (appUpdatePaths.length === 0) {
    throw new ReleaseMetadataError('Missing packaged app-update.yml under release directory')
  }

  appUpdatePaths.forEach(appUpdatePath => validateAppUpdateYml(appUpdatePath, publishConfig))

  return {
    latestPath,
    installerPath,
    packageVersion,
    publishOwner: publishConfig.owner,
    publishRepo: publishConfig.repo,
    appUpdatePaths,
  }
}

function parseArgs(argv: string[]): VerifyReleaseMetadataOptions {
  const options: VerifyReleaseMetadataOptions = {
    platform: 'win',
    releaseDir: 'release',
    packageJsonPath: 'package.json',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--release-dir') {
      const value = argv[index + 1]
      if (!value) throw new ReleaseMetadataError('--release-dir requires a value')
      options.releaseDir = value
      index += 1
    } else if (arg === '--package' || arg === '--package-json') {
      const value = argv[index + 1]
      if (!value) throw new ReleaseMetadataError(`${arg} requires a value`)
      options.packageJsonPath = value
      index += 1
    } else if (arg === '--platform') {
      const value = argv[index + 1]
      if (value !== 'win' && value !== 'mac') {
        throw new ReleaseMetadataError('--platform must be "win" or "mac"')
      }
      options.platform = value
      index += 1
    } else {
      throw new ReleaseMetadataError(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function isCliEntrypoint(): boolean {
  const scriptPath = process.argv[1]
  if (!scriptPath) return false
  return path.resolve(scriptPath) === fileURLToPath(import.meta.url)
}

if (isCliEntrypoint()) {
  try {
    const summary = verifyReleaseMetadata(parseArgs(process.argv.slice(2)))
    console.log(`Release metadata verified for ${summary.packageVersion}`)
    console.log(`Primary update asset: ${summary.installerPath}`)
    console.log(`Latest metadata: ${summary.latestPath}`)
    console.log(`app-update.yml files: ${summary.appUpdatePaths.join(', ')}`)
    console.log(`Publish target: ${summary.publishOwner}/${summary.publishRepo}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
