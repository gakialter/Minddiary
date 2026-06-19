import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RELEASE_PLATFORMS = ['win', 'mac']

export function getExpectedReleaseAssetNames(version, platform = 'all') {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('package version must be a non-empty string')
  }
  if (platform !== 'all' && !RELEASE_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported release platform: ${platform}`)
  }

  const windowsAssets = [
    `MindDiary-Setup-${version}.exe`,
    `MindDiary-Portable-${version}.exe`,
    `MindDiary-Setup-${version}.exe.blockmap`,
    'latest.yml',
  ]
  const macAssets = [
    `MindDiary-${version}-arm64.dmg`,
    `MindDiary-${version}-arm64-mac.zip`,
    `MindDiary-${version}-arm64.dmg.blockmap`,
    `MindDiary-${version}-arm64-mac.zip.blockmap`,
    'latest-mac.yml',
  ]

  if (platform === 'win') return windowsAssets
  if (platform === 'mac') return macAssets
  return [...windowsAssets, ...macAssets]
}

export function validateReleaseAssetManifest(assetNames, version, platform = 'all') {
  const normalizedNames = assetNames.map(assetName => assetName.replaceAll('\\', '/'))
  const nestedAsset = normalizedNames.find(assetName => assetName.includes('/'))
  if (nestedAsset) {
    throw new Error(`Release assets must be root-level files, got: ${nestedAsset}`)
  }

  const expected = getExpectedReleaseAssetNames(version, platform).sort()
  const actual = [...new Set(normalizedNames)].sort()
  const missing = expected.filter(assetName => !actual.includes(assetName))
  const unexpected = actual.filter(assetName => !expected.includes(assetName))

  if (missing.length > 0 || unexpected.length > 0 || actual.length !== normalizedNames.length) {
    throw new Error([
      'Release asset manifest does not match the allowlist.',
      missing.length > 0 ? `Missing: ${missing.join(', ')}` : '',
      unexpected.length > 0 ? `Unexpected: ${unexpected.join(', ')}` : '',
      actual.length !== normalizedNames.length ? 'Duplicate asset names are not allowed.' : '',
    ].filter(Boolean).join(' '))
  }

  return actual
}

function readPackageVersion(packageJsonPath) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  if (!packageJson || typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
    throw new Error('package.json version must be a non-empty string')
  }
  return packageJson.version.trim()
}

function listRootFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const nonFileEntry = entries.find(entry => !entry.isFile())
  if (nonFileEntry) {
    throw new Error(`Release asset directory must contain only root-level files, got: ${nonFileEntry.name}`)
  }
  return entries
    .map(entry => entry.name)
    .sort()
}

export function verifyReleaseAssetDirectory(sourceDir, version, platform = 'all') {
  const source = path.resolve(sourceDir)
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Release asset directory does not exist: ${source}`)
  }

  const assetNames = listRootFiles(source)
  validateReleaseAssetManifest(assetNames, version, platform)
  for (const assetName of assetNames) {
    const assetPath = path.join(source, assetName)
    if (fs.statSync(assetPath).size === 0) {
      throw new Error(`Release asset is empty: ${assetName}`)
    }
  }
  return assetNames
}

export function stageReleaseAssets({ sourceDir, outputDir, version, platform }) {
  const source = path.resolve(sourceDir)
  const output = path.resolve(outputDir)
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Release build directory does not exist: ${source}`)
  }
  if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
    throw new Error(`Release staging directory must be empty: ${output}`)
  }
  fs.mkdirSync(output, { recursive: true })

  for (const assetName of getExpectedReleaseAssetNames(version, platform)) {
    const sourcePath = path.join(source, assetName)
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`Missing required release asset: ${assetName}`)
    }
    if (fs.statSync(sourcePath).size === 0) {
      throw new Error(`Release asset is empty: ${assetName}`)
    }
    fs.copyFileSync(sourcePath, path.join(output, assetName))
  }

  return verifyReleaseAssetDirectory(output, version, platform)
}

function parseArgs(argv) {
  const options = {
    platform: 'all',
    sourceDir: 'release-artifacts',
    outputDir: undefined,
    packageJsonPath: 'package.json',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--platform') {
      if (!value || (value !== 'all' && !RELEASE_PLATFORMS.includes(value))) {
        throw new Error('--platform must be "win", "mac", or "all"')
      }
      options.platform = value
      index += 1
    } else if (arg === '--source') {
      if (!value) throw new Error('--source requires a value')
      options.sourceDir = value
      index += 1
    } else if (arg === '--output') {
      if (!value) throw new Error('--output requires a value')
      options.outputDir = value
      index += 1
    } else if (arg === '--package' || arg === '--package-json') {
      if (!value) throw new Error(`${arg} requires a value`)
      options.packageJsonPath = value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function isCliEntrypoint() {
  const scriptPath = process.argv[1]
  return Boolean(scriptPath) && path.resolve(scriptPath) === fileURLToPath(import.meta.url)
}

if (isCliEntrypoint()) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const version = readPackageVersion(path.resolve(options.packageJsonPath))
    const assetNames = options.outputDir
      ? stageReleaseAssets({
          sourceDir: options.sourceDir,
          outputDir: options.outputDir,
          version,
          platform: options.platform,
        })
      : verifyReleaseAssetDirectory(options.sourceDir, version, options.platform)
    console.log(`Release asset manifest verified for ${version}: ${assetNames.join(', ')}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
