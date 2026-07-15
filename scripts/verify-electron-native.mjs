import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const scriptPath = fileURLToPath(import.meta.url)
const probeFlag = '--probe-electron-native'
const appAsarFlag = '--app-asar'

function findNativeBinaries(root) {
  const matches = []
  const pending = [root]

  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(fullPath)
      } else if (entry.name === 'better_sqlite3.node') {
        matches.push(fullPath)
      }
    }
  }

  return matches.sort()
}

function runElectronProbe(extraArgs = []) {
  const result = spawnSync(electronPath, [scriptPath, probeFlag, ...extraArgs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Electron native dependency probe exited with code ${result.status}`)
  }
}

function relativeInside(root, candidate, label) {
  const relative = path.relative(root, candidate)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside packaged app.asar: ${candidate}`)
  }
  return relative
}

export function validatePackagedNativeResolution(appAsar, packageJsonPath, nativeBinary) {
  const packageRelative = relativeInside(appAsar, packageJsonPath, 'better-sqlite3 package metadata')
  if (!packageRelative.endsWith(path.join('better-sqlite3', 'package.json'))) {
    throw new Error(`Unexpected packaged better-sqlite3 metadata path: ${packageJsonPath}`)
  }

  const nativeRelative = relativeInside(appAsar, nativeBinary, 'better_sqlite3.node')
  const unpackedRoot = `${appAsar}.unpacked`
  const physicalNativeBinary = path.join(unpackedRoot, nativeRelative)
  let unpackedRootStat
  let nativeStat
  try {
    unpackedRootStat = fs.lstatSync(unpackedRoot)
    nativeStat = fs.lstatSync(physicalNativeBinary)
  } catch {
    throw new Error(`Packaged better_sqlite3.node does not exist: ${physicalNativeBinary}`)
  }
  if (unpackedRootStat.isSymbolicLink() || !unpackedRootStat.isDirectory()) {
    throw new Error(`Packaged app.asar.unpacked must be a physical directory: ${unpackedRoot}`)
  }
  if (nativeStat.isSymbolicLink() || !nativeStat.isFile()) {
    throw new Error(`Packaged better_sqlite3.node must be a physical file: ${physicalNativeBinary}`)
  }
  const unpackedRootRealpath = fs.realpathSync(unpackedRoot)
  const nativeRealpath = fs.realpathSync(physicalNativeBinary)
  const realRelative = path.relative(unpackedRootRealpath, nativeRealpath)
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`Packaged better_sqlite3.node resolves outside app.asar.unpacked: ${physicalNativeBinary}`)
  }
  return physicalNativeBinary
}

export function findPackagedArchives(root) {
  const matches = []
  const pending = [root]

  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(fullPath)
      } else if (entry.isFile()
        && entry.name === 'app.asar'
        && path.basename(current).toLowerCase() === 'resources') {
        matches.push(fullPath)
      }
    }
  }

  return matches.sort()
}

if (path.resolve(process.argv[1] ?? '') === scriptPath && process.argv.includes(probeFlag)) {
  try {
    const appAsarIndex = process.argv.indexOf(appAsarFlag)
    let appAsar
    let packageRequire = require
    if (appAsarIndex >= 0) {
      const appAsarPath = process.argv[appAsarIndex + 1]
      if (!appAsarPath) throw new Error(`${appAsarFlag} requires a path`)
      appAsar = path.resolve(appAsarPath)
      if (!fs.existsSync(appAsar)) throw new Error(`Packaged app.asar does not exist: ${appAsar}`)
      packageRequire = createRequire(path.join(appAsar, 'package.json'))
    }

    const packageJsonPath = packageRequire.resolve('better-sqlite3/package.json')
    const packageRoot = path.dirname(packageJsonPath)
    const installedBinaries = findNativeBinaries(packageRoot)
    if (installedBinaries.length !== 1) {
      throw new Error(`Expected one installed better_sqlite3.node, found ${installedBinaries.length}`)
    }
    const virtualNativeBinary = installedBinaries[0]
    const nativeBinary = appAsar
      ? validatePackagedNativeResolution(appAsar, packageJsonPath, virtualNativeBinary)
      : virtualNativeBinary

    const BetterSqlite3 = packageRequire('better-sqlite3')
    const database = new BetterSqlite3(':memory:')
    const row = database.prepare('SELECT 1 AS value, sqlite_version() AS sqliteVersion').get()
    database.close()
    if (row?.value !== 1) throw new Error('better-sqlite3 probe query failed')

    process.stdout.write(JSON.stringify({
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      v8: process.versions.v8,
      moduleAbi: process.versions.modules,
      platform: process.platform,
      architecture: process.arch,
      betterSqlite3: packageRequire('better-sqlite3/package.json').version,
      nativeBinary,
      appAsar,
      sqliteVersion: row.sqliteVersion,
      queryResult: row.value,
    }) + '\n')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
} else if (path.resolve(process.argv[1] ?? '') === scriptPath) {
  const releaseDirIndex = process.argv.indexOf('--release-dir')
  if (releaseDirIndex >= 0) {
    const releaseDir = process.argv[releaseDirIndex + 1]
    if (!releaseDir) throw new Error('--release-dir requires a path')
    const resolvedReleaseDir = path.resolve(releaseDir)
    if (!fs.existsSync(resolvedReleaseDir)) {
      throw new Error(`Release directory does not exist: ${resolvedReleaseDir}`)
    }

    const appArchives = findPackagedArchives(resolvedReleaseDir)
    if (appArchives.length === 0) {
      throw new Error(`No packaged app.asar found in ${resolvedReleaseDir}`)
    }

    for (const appAsar of appArchives) {
      runElectronProbe([appAsarFlag, appAsar])
    }
    console.log(`Verified better-sqlite3 through ${appArchives.length} packaged app.asar archive(s).`)
  } else {
    runElectronProbe()
    console.log('Verified better-sqlite3 against the Electron runtime.')
  }
}
