import { getCurrentFuseWire, FuseV1Options, FuseVersion } from '@electron/fuses'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as parseYaml } from 'js-yaml'

const FUSE_DISABLED = 48
const FUSE_ENABLED = 49

export const EXPECTED_FUSES = Object.freeze({
  RunAsNode: false,
  EnableCookieEncryption: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: true,
  WasmTrapHandlers: true,
})

export const ALLOWED_UNPACKED_FILES = Object.freeze([
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
])

export const EXPECTED_UPDATER_METADATA = Object.freeze({
  provider: 'github',
  owner: 'gakialter',
  repo: 'Minddiary',
})

function normalizeRelative(filepath) {
  return filepath.split(path.sep).join('/')
}

function requireFile(filepath, label) {
  let stat
  try {
    stat = fs.lstatSync(filepath)
  } catch {
    throw new Error(`${label} does not exist: ${filepath}`)
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${filepath}`)
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${filepath}`)
}

function assertRealpathInside(rootRealpath, candidatePath) {
  const candidateRealpath = fs.realpathSync(candidatePath)
  const relative = path.relative(rootRealpath, candidateRealpath)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Packaged unpacked layout resolves outside packaged resources: ${candidatePath}`)
  }
}

function collectFiles(root, current = root, matches = [], rootRealpath = fs.realpathSync(root)) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name)
    const stat = fs.lstatSync(fullPath)
    if (stat.isSymbolicLink()) {
      throw new Error(`Packaged unpacked layout contains a symbolic link: ${fullPath}`)
    }
    assertRealpathInside(rootRealpath, fullPath)
    if (stat.isDirectory()) collectFiles(root, fullPath, matches, rootRealpath)
    else if (stat.isFile()) matches.push(normalizeRelative(path.relative(root, fullPath)))
    else throw new Error(`Packaged unpacked layout contains an unsupported entry: ${fullPath}`)
  }
  return matches
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function verifyPackagedUpdaterMetadata(resourcesDir, { required = false } = {}) {
  const metadataPath = path.join(resourcesDir, 'app-update.yml')
  if (!fs.existsSync(metadataPath)) {
    if (required) throw new Error(`Packaged updater metadata does not exist: ${metadataPath}`)
    return { present: false }
  }
  requireFile(metadataPath, 'Packaged updater metadata')
  const contents = fs.readFileSync(metadataPath, 'utf8')
  let metadata
  try {
    metadata = parseYaml(contents)
  } catch (error) {
    throw new Error(`Invalid packaged updater metadata YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(metadata)) throw new Error('Packaged updater metadata must contain a YAML object')
  for (const [key, expected] of Object.entries(EXPECTED_UPDATER_METADATA)) {
    if (metadata[key] !== expected) {
      throw new Error(`Packaged updater metadata ${key} expected ${expected}, got ${String(metadata[key])}`)
    }
  }
  return { present: true, ...metadata }
}

export function validateFuseWire(wire) {
  if (wire.version !== FuseVersion.V1) {
    throw new Error(`Expected Electron fuse wire version ${FuseVersion.V1}, got ${wire.version}`)
  }

  const expectedIndexes = Object.keys(EXPECTED_FUSES).map(name => {
    const index = FuseV1Options[name]
    if (!Number.isInteger(index)) throw new Error(`@electron/fuses does not recognize ${name}`)
    return index
  }).sort((left, right) => left - right)
  const actualIndexes = Object.keys(wire)
    .filter(key => /^\d+$/.test(key))
    .map(Number)
    .sort((left, right) => left - right)

  if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
    throw new Error(
      `Unexpected Electron fuse wire indexes: expected ${expectedIndexes.join(',')}, got ${actualIndexes.join(',')}`,
    )
  }

  const result = {}
  for (const [name, expected] of Object.entries(EXPECTED_FUSES)) {
    const index = FuseV1Options[name]
    const expectedState = expected ? FUSE_ENABLED : FUSE_DISABLED
    const actualState = wire[index]
    if (actualState !== expectedState) {
      throw new Error(
        `Electron fuse ${name} expected ${expected ? 'enabled' : 'disabled'}, got state ${String(actualState)}`,
      )
    }
    result[name] = expected
  }
  return result
}

export function verifyUnpackedLayout(resourcesDir) {
  let resourcesStat
  try {
    resourcesStat = fs.lstatSync(resourcesDir)
  } catch {
    throw new Error(`Packaged resources directory does not exist: ${resourcesDir}`)
  }
  if (resourcesStat.isSymbolicLink()) {
    throw new Error(`Packaged resources directory must not be a symbolic link: ${resourcesDir}`)
  }
  if (!resourcesStat.isDirectory()) {
    throw new Error(`Packaged resources path is not a directory: ${resourcesDir}`)
  }

  const appAsar = path.join(resourcesDir, 'app.asar')
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')
  requireFile(appAsar, 'Packaged app.asar')

  if (fs.existsSync(path.join(resourcesDir, 'app'))) {
    throw new Error('Packaged resources must not contain an app fallback directory')
  }
  if (fs.existsSync(path.join(resourcesDir, 'default_app.asar'))) {
    throw new Error('Packaged resources must not contain default_app.asar')
  }
  if (!fs.existsSync(unpackedDir)) {
    throw new Error(`Packaged app.asar.unpacked directory does not exist: ${unpackedDir}`)
  }
  const unpackedStat = fs.lstatSync(unpackedDir)
  if (unpackedStat.isSymbolicLink()) {
    throw new Error(`Packaged app.asar.unpacked must not be a symbolic link: ${unpackedDir}`)
  }
  if (!unpackedStat.isDirectory()) {
    throw new Error(`Packaged app.asar.unpacked is not a directory: ${unpackedDir}`)
  }
  assertRealpathInside(fs.realpathSync(resourcesDir), unpackedDir)

  const unpackedFiles = collectFiles(unpackedDir).sort()
  if (JSON.stringify(unpackedFiles) !== JSON.stringify(ALLOWED_UNPACKED_FILES)) {
    throw new Error(
      `Unexpected app.asar.unpacked files: expected ${ALLOWED_UNPACKED_FILES.join(',')}, got ${unpackedFiles.join(',')}`,
    )
  }

  return { appAsar, unpackedFiles }
}

function findPackagedApplications(releaseDir) {
  const applications = []

  function visit(current, depth) {
    if (depth > 3) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const fullPath = path.join(current, entry.name)
      if (entry.name.endsWith('.app')) {
        applications.push(fullPath)
        continue
      }
      const windowsExecutable = path.join(fullPath, 'MindDiary.exe')
      if (fs.existsSync(windowsExecutable)) applications.push(windowsExecutable)
      visit(fullPath, depth + 1)
    }
  }

  visit(releaseDir, 0)
  return [...new Set(applications)].sort()
}

function describePackagedApplication(applicationPath) {
  if (applicationPath.endsWith('.app')) {
    return {
      applicationPath,
      executablePath: path.join(applicationPath, 'Contents', 'MacOS', 'MindDiary'),
      resourcesDir: path.join(applicationPath, 'Contents', 'Resources'),
      platform: 'darwin',
    }
  }
  return {
    applicationPath,
    executablePath: applicationPath,
    resourcesDir: path.join(path.dirname(applicationPath), 'resources'),
    platform: 'win32',
  }
}

export async function verifyReleaseDirectory(releaseDir, { requireUpdaterMetadata = false } = {}) {
  const resolvedReleaseDir = path.resolve(releaseDir)
  if (!fs.existsSync(resolvedReleaseDir) || !fs.statSync(resolvedReleaseDir).isDirectory()) {
    throw new Error(`Release directory does not exist: ${resolvedReleaseDir}`)
  }

  const applicationPaths = findPackagedApplications(resolvedReleaseDir)
  if (applicationPaths.length === 0) {
    throw new Error(`No packaged MindDiary applications found in ${resolvedReleaseDir}`)
  }

  const results = []
  for (const applicationPath of applicationPaths) {
    const application = describePackagedApplication(applicationPath)
    requireFile(application.executablePath, 'Packaged application executable')
    const { unpackedFiles } = verifyUnpackedLayout(application.resourcesDir)
    const updaterMetadata = verifyPackagedUpdaterMetadata(application.resourcesDir, {
      required: requireUpdaterMetadata,
    })
    const wire = await getCurrentFuseWire(application.applicationPath)
    const fuses = validateFuseWire(wire)
    results.push({
      platform: application.platform,
      application: normalizeRelative(path.relative(resolvedReleaseDir, application.applicationPath)),
      fuseVersion: wire.version,
      fuses,
      unpackedFiles,
      updaterMetadata,
    })
  }
  return results
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true }
  const releaseDirIndex = args.indexOf('--release-dir')
  if (releaseDirIndex < 0 || !args[releaseDirIndex + 1]) {
    throw new Error('Usage: node scripts/verify-electron-package-security.mjs --release-dir <path>')
  }
  const requireUpdaterMetadata = args.includes('--require-updater-metadata')
  const expectedLength = requireUpdaterMetadata ? 3 : 2
  if (args.length !== expectedLength) {
    throw new Error(`Unexpected argument: ${args.find(arg => arg !== '--release-dir' && arg !== args[releaseDirIndex + 1] && arg !== '--require-updater-metadata')}`)
  }
  return { help: false, releaseDir: args[releaseDirIndex + 1], requireUpdaterMetadata }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node scripts/verify-electron-package-security.mjs --release-dir <path> [--require-updater-metadata]')
    return
  }
  const results = await verifyReleaseDirectory(options.releaseDir, {
    requireUpdaterMetadata: options.requireUpdaterMetadata,
  })
  console.log(JSON.stringify({ schemaVersion: 1, applications: results }, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
