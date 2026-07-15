import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyReleaseDirectory } from './verify-electron-package-security.mjs'

const profilePrefix = 'minddiary-asar-integrity-'
const usage = 'Usage: node scripts/test-packaged-asar-integrity.mjs --release-dir <path>'
const asarHeaderOffset = 16

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true }
  if (args.length !== 2 || args[0] !== '--release-dir' || !args[1]) throw new Error(usage)
  return { help: false, releaseDir: args[1] }
}

function sha256(filepath) {
  return createHash('sha256').update(fs.readFileSync(filepath)).digest('hex')
}

function parseAsarHeader(archive) {
  if (archive.length < asarHeaderOffset) throw new Error('app.asar is too small to contain a header')
  const headerLength = archive.readUInt32LE(12)
  const headerEnd = asarHeaderOffset + headerLength
  if (headerLength < 2 || headerEnd > archive.length) {
    throw new Error(`Invalid app.asar header length: ${headerLength}`)
  }
  let jsonEnd = headerEnd
  while (jsonEnd > asarHeaderOffset && archive[jsonEnd - 1] === 0) jsonEnd -= 1
  const headerText = archive.subarray(asarHeaderOffset, jsonEnd).toString('utf8')
  JSON.parse(headerText)
  return { headerEnd, headerText }
}

export function findParseableAsarHeaderMutation(archive) {
  const { headerEnd } = parseAsarHeader(archive)
  const marker = Buffer.from('.map\":{\"size\":', 'utf8')
  const markerOffset = archive.indexOf(marker, asarHeaderOffset)
  if (markerOffset < asarHeaderOffset || markerOffset + marker.length > headerEnd) {
    throw new Error('app.asar header does not contain a dependency source-map entry for the integrity probe')
  }
  const offset = markerOffset + 1
  const originalByte = archive[offset]
  const changedByte = 'n'.charCodeAt(0)
  if (originalByte !== 'm'.charCodeAt(0)) {
    throw new Error(`Unexpected app.asar source-map marker byte at offset ${offset}: ${String(originalByte)}`)
  }
  const mutated = Buffer.from(archive.subarray(0, headerEnd))
  mutated[offset] = changedByte
  parseAsarHeader(mutated)
  return { offset, originalByte, changedByte }
}

function assertDisposablePath(target) {
  const resolved = path.resolve(target)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(profilePrefix)) {
    throw new Error(`Refusing to remove unexpected integrity-test path: ${resolved}`)
  }
}

function removeDisposablePath(target) {
  assertDisposablePath(target)
  fs.rmSync(target, { recursive: true, force: true })
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null
}

function killProcessTree(child) {
  if (!child.pid || !isRunning(child)) return
  spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  })
}

async function waitForExit(child, timeoutMs) {
  if (!isRunning(child)) return true
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

function launch(executablePath, args, profilePath, environment = {}) {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, NODE_OPTIONS: _nodeOptions, ...baseEnvironment } = process.env
  const child = spawn(executablePath, [...args, `--user-data-dir=${profilePath}`], {
    env: { ...baseEnvironment, NODE_ENV: 'production', ...environment },
    stdio: 'pipe',
    windowsHide: true,
  })
  let output = ''
  const capture = chunk => {
    output = `${output}${chunk.toString('utf8')}`.slice(-32_000)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  return { child, output: () => output }
}

async function stopLaunched(launched) {
  killProcessTree(launched.child)
  if (!await waitForExit(launched.child, 5_000)) {
    throw new Error(`Packaged process ${String(launched.child.pid)} did not exit after taskkill`)
  }
}

async function waitForNormalStartup(launched, profilePath, markerPath, timeoutMs = 20_000) {
  const databasePath = path.join(profilePath, 'minddiary.db')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(markerPath)) throw new Error(`Disabled Electron fuse payload executed: ${markerPath}`)
    if (!isRunning(launched.child)) {
      throw new Error(`Packaged app exited before normal startup. Output:\n${launched.output()}`)
    }
    if (fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Packaged app did not reach normal startup. Output:\n${launched.output()}`)
}

export async function expectRejectedStartup(launched, profilePath, markerPath, timeoutMs = 5_000) {
  const databasePath = path.join(profilePath, 'minddiary.db')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(markerPath)) throw new Error(`Fallback payload executed: ${markerPath}`)
    if (fs.existsSync(databasePath)) throw new Error(`Tampered package reached application startup: ${databasePath}`)
    if (!isRunning(launched.child)) {
      const output = launched.output()
      if (launched.child.exitCode === 0 && !/asar|integrity|valid app|onlyloadappfromasar/i.test(output)) {
        throw new Error(`Packaged app exited without an observable rejection signal. Output:\n${output}`)
      }
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Packaged app was still running after the rejection deadline. Output:\n${launched.output()}`)
}

async function runNormalFuseProbe({ executablePath, tempRoot, name, args, environment, markerSource }) {
  const profilePath = fs.mkdtempSync(path.join(tempRoot, `${name}-profile-`))
  const markerPath = path.join(tempRoot, `${name}-executed.txt`)
  const sourcePath = path.join(tempRoot, `${name}.cjs`)
  fs.writeFileSync(sourcePath, markerSource(markerPath))
  const launched = launch(executablePath, args(sourcePath), profilePath, environment(sourcePath))

  try {
    await waitForNormalStartup(launched, profilePath, markerPath)
    await new Promise(resolve => setTimeout(resolve, 500))
    if (fs.existsSync(markerPath)) throw new Error(`Disabled Electron fuse payload executed: ${markerPath}`)
    return launched.output()
  } finally {
    await stopLaunched(launched)
  }
}

async function testRunAsNodeFuse(executablePath, tempRoot) {
  await runNormalFuseProbe({
    executablePath,
    tempRoot,
    name: 'run-as-node',
    args: sourcePath => [sourcePath],
    environment: () => ({ ELECTRON_RUN_AS_NODE: '1' }),
    markerSource: markerPath => `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'executed')\n`,
  })
}

async function testNodeOptionsFuse(executablePath, tempRoot) {
  await runNormalFuseProbe({
    executablePath,
    tempRoot,
    name: 'node-options',
    args: () => [],
    environment: sourcePath => ({ NODE_OPTIONS: `--require=${JSON.stringify(sourcePath)}` }),
    markerSource: markerPath => `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'executed')\n`,
  })
}

async function testInspectFuse(executablePath, tempRoot) {
  const output = await runNormalFuseProbe({
    executablePath,
    tempRoot,
    name: 'inspect',
    args: () => ['--inspect=0'],
    environment: () => ({}),
    markerSource: () => '',
  })
  if (/Debugger listening on/i.test(output)) {
    throw new Error(`Packaged app opened a Node Inspector despite the disabled fuse. Output:\n${output}`)
  }
}

async function testMutatedAsarRejected(executablePath, appAsar, tempRoot, originalHash) {
  const profilePath = fs.mkdtempSync(path.join(tempRoot, 'mutated-asar-profile-'))
  const controlProfilePath = fs.mkdtempSync(path.join(tempRoot, 'mutated-asar-control-profile-'))
  const markerPath = path.join(tempRoot, 'mutated-asar-executed.txt')
  const controlMarkerPath = path.join(tempRoot, 'mutated-asar-control-executed.txt')
  const controlExecutablePath = path.join(
    path.dirname(executablePath),
    `MindDiary.integrity-control-${process.pid}.exe`,
  )
  const mutation = findParseableAsarHeaderMutation(fs.readFileSync(appAsar))
  let launched
  let controlLaunched
  let mutated = false
  let stopError

  try {
    if (fs.existsSync(controlExecutablePath)) {
      throw new Error(`Refusing to overwrite existing integrity-control executable: ${controlExecutablePath}`)
    }
    fs.copyFileSync(executablePath, controlExecutablePath, fs.constants.COPYFILE_EXCL)
    await flipFuses(controlExecutablePath, {
      version: FuseVersion.V1,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    })

    const descriptor = fs.openSync(appAsar, 'r+')
    try {
      const observedByte = Buffer.alloc(1)
      if (fs.readSync(descriptor, observedByte, 0, 1, mutation.offset) !== 1) {
        throw new Error(`Unable to read app.asar byte at offset ${mutation.offset}`)
      }
      if (observedByte[0] !== mutation.originalByte) {
        throw new Error(`app.asar changed before the integrity probe at offset ${mutation.offset}`)
      }
      fs.writeSync(descriptor, Buffer.from([mutation.changedByte]), 0, 1, mutation.offset)
      mutated = true
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    if (sha256(appAsar) === originalHash) throw new Error('app.asar mutation did not change its hash')
    parseAsarHeader(fs.readFileSync(appAsar))

    controlLaunched = launch(controlExecutablePath, [], controlProfilePath)
    await waitForNormalStartup(controlLaunched, controlProfilePath, controlMarkerPath)
    await stopLaunched(controlLaunched)
    controlLaunched = undefined

    launched = launch(executablePath, [], profilePath)
    await expectRejectedStartup(launched, profilePath, markerPath)
  } finally {
    if (controlLaunched) {
      try {
        await stopLaunched(controlLaunched)
      } catch (error) {
        stopError = error
      }
    }
    if (launched) {
      try {
        await stopLaunched(launched)
      } catch (error) {
        stopError = error
      }
    }
    if (mutated) {
      let restoreDescriptor
      try {
        restoreDescriptor = fs.openSync(appAsar, 'r+')
        fs.writeSync(restoreDescriptor, Buffer.from([mutation.originalByte]), 0, 1, mutation.offset)
        fs.fsyncSync(restoreDescriptor)
      } catch (error) {
        stopError ??= error
      } finally {
        if (restoreDescriptor !== undefined) {
          try {
            fs.closeSync(restoreDescriptor)
          } catch (error) {
            stopError ??= error
          }
        }
      }
    }
    try {
      fs.rmSync(controlExecutablePath, { force: true })
    } catch (error) {
      stopError ??= error
    }
  }

  if (stopError) throw stopError
  if (sha256(appAsar) !== originalHash) throw new Error('app.asar hash was not restored after mutation test')
}

async function testFallbackRejected(executablePath, resourcesDir, appAsar, tempRoot, originalHash) {
  const fallbackDir = path.join(resourcesDir, 'app')
  const backupAsar = path.join(resourcesDir, `app.asar.integrity-backup-${process.pid}`)
  const profilePath = fs.mkdtempSync(path.join(tempRoot, 'fallback-profile-'))
  const markerPath = path.join(tempRoot, 'fallback-executed.txt')
  if (fs.existsSync(fallbackDir)) throw new Error(`Refusing to overwrite existing fallback directory: ${fallbackDir}`)
  if (fs.existsSync(backupAsar)) throw new Error(`Refusing to overwrite existing ASAR backup: ${backupAsar}`)
  let launched
  let cleanupError

  try {
    fs.renameSync(appAsar, backupAsar)
    fs.mkdirSync(fallbackDir)
    fs.writeFileSync(path.join(fallbackDir, 'package.json'), JSON.stringify({
      name: 'minddiary-asar-fallback-probe',
      version: '1.0.0',
      main: 'index.cjs',
    }))
    fs.writeFileSync(
      path.join(fallbackDir, 'index.cjs'),
      `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'executed'); require('electron').app.quit()\n`,
    )

    launched = launch(executablePath, [], profilePath)
    await expectRejectedStartup(launched, profilePath, markerPath)
  } finally {
    if (launched) {
      try {
        await stopLaunched(launched)
      } catch (error) {
        cleanupError = error
      }
    }
    const expectedFallback = path.join(path.resolve(resourcesDir), 'app')
    try {
      if (path.resolve(fallbackDir) !== expectedFallback) {
        throw new Error(`Refusing to remove unexpected fallback path: ${fallbackDir}`)
      }
      fs.rmSync(fallbackDir, { recursive: true, force: true })
    } catch (error) {
      cleanupError ??= error
    }
    try {
      if (fs.existsSync(appAsar)) throw new Error(`Cannot restore app.asar because the target already exists: ${appAsar}`)
      if (fs.existsSync(backupAsar)) fs.renameSync(backupAsar, appAsar)
    } catch (error) {
      cleanupError ??= error
    }
  }

  if (cleanupError) throw cleanupError
  if (!fs.existsSync(appAsar) || sha256(appAsar) !== originalHash) {
    throw new Error('app.asar was not restored after fallback test')
  }
}

export async function runPackagedAsarIntegrityTests(releaseDir) {
  if (process.platform !== 'win32') throw new Error('Packaged ASAR integrity negative tests are Windows-only')
  const resolvedReleaseDir = path.resolve(releaseDir)
  const executablePath = path.join(resolvedReleaseDir, 'win-unpacked', 'MindDiary.exe')
  const resourcesDir = path.join(resolvedReleaseDir, 'win-unpacked', 'resources')
  const appAsar = path.join(resourcesDir, 'app.asar')
  if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
    throw new Error(`Packaged Windows executable does not exist: ${executablePath}`)
  }
  if (!fs.existsSync(appAsar) || !fs.statSync(appAsar).isFile()) {
    throw new Error(`Packaged app.asar does not exist: ${appAsar}`)
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix))
  const originalHash = sha256(appAsar)
  try {
    await verifyReleaseDirectory(resolvedReleaseDir)
    await testRunAsNodeFuse(executablePath, tempRoot)
    await testNodeOptionsFuse(executablePath, tempRoot)
    await testInspectFuse(executablePath, tempRoot)
    await testMutatedAsarRejected(executablePath, appAsar, tempRoot, originalHash)
    await testFallbackRejected(executablePath, resourcesDir, appAsar, tempRoot, originalHash)
    await verifyReleaseDirectory(resolvedReleaseDir)
    return {
      schemaVersion: 1,
      platform: process.platform,
      executable: path.relative(resolvedReleaseDir, executablePath).split(path.sep).join('/'),
      appAsarSha256: originalHash,
      checks: [
        'RunAsNode disabled',
        'NODE_OPTIONS disabled',
        'Node CLI inspect disabled',
        'parseable mutated app.asar starts with integrity disabled, is rejected with integrity enabled, and is restored',
        'resources/app fallback rejected and app.asar restored',
      ],
    }
  } finally {
    removeDisposablePath(tempRoot)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage)
    return
  }
  console.log(JSON.stringify(await runPackagedAsarIntegrityTests(options.releaseDir), null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
