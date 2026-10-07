import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(script), '..')
const require = createRequire(path.join(root, 'package.json'))
const active = path.join(root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')
const cacheRoot = path.join(root, 'node_modules/.cache/minddiary-native/better-sqlite3')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const report = (event, data = {}) => console.log(JSON.stringify({ event, ...data }))

export function cacheKey(version, runtime) {
  const parts = [version, runtime.kind, runtime.electron ?? 'node', runtime.platform, runtime.arch, `abi${runtime.abi}`]
  if (parts.some(part => typeof part !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(part))) throw new Error('Invalid runtime metadata')
  return `better-sqlite3-${parts.join('-')}.node`
}

export function commandArgs(args, vitestCli) {
  if (args[0] !== '--' || !args[1]) throw new Error('Usage: run-node -- <command> [args...]')
  return args[1] === 'vitest'
    ? [process.execPath, [vitestCli, ...args.slice(2)]]
    : [args[1], args.slice(2)]
}

// Reject redirected cache/binary paths, including junctions in parent directories.
export function physical(file, boundary = root) {
  const relative = path.relative(boundary, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Native path escaped repository')
  let current = boundary
  for (const segment of ['', ...relative.split(path.sep)]) {
    current = path.join(current, segment)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Native path is a link: ${current}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

async function main() {
  const mode = process.argv[2]
  if (!['run-node', 'ensure-electron', 'doctor'].includes(mode)) throw new Error('Expected run-node, ensure-electron, or doctor')
  physical(active)
  physical(cacheRoot)
  fs.mkdirSync(cacheRoot, { recursive: true })
  physical(cacheRoot)
  // One active binary means overlapping managers cannot safely run concurrently.
  const lockPath = path.join(cacheRoot, 'manager.lock')
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, 'utf8'))
    try { process.kill(pid, 0); throw new Error(`Native manager already running: ${pid}`) }
    catch (error) { if (error.code !== 'ESRCH') throw error }
    fs.unlinkSync(lockPath)
  }
  const lock = fs.openSync(lockPath, 'wx')
  fs.writeFileSync(lock, String(process.pid))
  let child
  let signal
  let restoring = false
  const onSignal = value => { signal ??= value; if (!restoring) child?.kill(value) }
  const interrupt = () => onSignal('SIGINT')
  const terminate = () => onSignal('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  async function run(executable, args, env = {}, capture = false) {
    if (signal && !restoring) throw new Error(`Interrupted: ${signal}`)
    return await new Promise((resolve, reject) => {
      let stdout = '', stderr = ''
      child = spawn(executable, args, { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ...env }, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
      child.stdout?.on('data', data => { stdout += data })
      child.stderr?.on('data', data => { stderr += data })
      child.once('error', reject)
      child.once('close', (code, endedSignal) => { child = undefined; resolve({ code: code ?? (endedSignal === 'SIGINT' ? 130 : 143), stdout, stderr }) })
    })
  }
  let electron
  let electronCached = false
  let exitCode = 0
  try {
    const executable = require('electron')
    const metadata = await run(executable, ['-e', 'console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,abi:process.versions.modules,platform:process.platform,arch:process.arch}))'], { ELECTRON_RUN_AS_NODE: '1' }, true)
    if (metadata.code !== 0) throw new Error(`Electron runtime detection failed: ${metadata.stderr}`)
    electron = { ...JSON.parse(metadata.stdout.trim()), kind: 'electron', executable }
    const node = { kind: 'node', node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch, executable: process.execPath }
    const version = JSON.parse(fs.readFileSync(require.resolve('better-sqlite3/package.json'), 'utf8')).version
    for (const runtime of [node, electron]) runtime.cache = path.join(cacheRoot, cacheKey(version, runtime))
    report('runtimes', { node: node.node, nodeAbi: node.abi, electron: electron.electron, electronAbi: electron.abi, betterSqlite3: version })
    async function probe(runtime) {
      const code = "const Database=require('better-sqlite3');const db=new Database(':memory:');const row=db.prepare('SELECT 1 AS value, sqlite_version() AS sqliteVersion').get();db.close();if(row.value!==1)process.exit(1);console.log(JSON.stringify(row))"
      const result = await run(runtime.executable, ['-e', code], runtime.kind === 'electron' ? { ELECTRON_RUN_AS_NODE: '1' } : {}, true)
      return result.code === 0
    }
    async function install(runtime) {
      physical(runtime.cache); physical(active)
      if (!fs.existsSync(runtime.cache)) throw new Error(`Missing ${runtime.kind} cache`)
      const sha256 = hash(runtime.cache)
      fs.copyFileSync(runtime.cache, active)
      if (hash(active) !== sha256) throw new Error('Active native SHA mismatch')
      if (!await probe(runtime)) throw new Error(`${runtime.kind} SQLite probe failed after installation`)
      report('installed', { runtime: runtime.kind, sha256, probe: 'PASS' })
    }
    async function rebuild(executable, args, label, capture = false) {
      const files = ['package.json', 'package-lock.json'].map(file => path.join(root, file))
      const before = files.map(hash)
      report('rebuild', { command: label })
      let result
      try { result = await run(executable, args, {}, capture) }
      finally { if (files.some((file, index) => hash(file) !== before[index])) throw new Error('STOP: rebuild unexpectedly mutated package.json or package-lock.json') }
      return result
    }
    async function ensure(runtime) {
      physical(runtime.cache); physical(active)
      if (fs.existsSync(runtime.cache)) {
        try { await install(runtime); report('cache-hit', { runtime: runtime.kind }); return }
        catch (error) {
          if (signal) throw error
          report('invalid-cache', { runtime: runtime.kind, reason: error.message })
          fs.unlinkSync(runtime.cache)
        }
      }
      if (!await probe(runtime)) {
        if (runtime.kind === 'electron') {
          const cli = path.join(path.dirname(require.resolve('@electron/rebuild')), 'cli.js')
          const result = await rebuild(process.execPath, [cli, '-f', '-w', 'better-sqlite3'], 'electron-rebuild -f -w better-sqlite3')
          if (result.code !== 0) throw new Error('Electron rebuild failed')
        } else {
          if (!electronCached) throw new Error('Electron cache required before Node rebuild')
          // npm_execpath is provided by npm scripts; direct invocation resolves beside Node.
          const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js')
          let result = await rebuild(process.execPath, [npmCli, 'rebuild', 'better-sqlite3', '--offline'], 'npm rebuild better-sqlite3 --offline', true)
          if (result.code !== 0) {
            if (!/ENOTCACHED|cache miss|No prebuilt binaries|headers.*(not found|missing)|ENOTFOUND/i.test(result.stderr + result.stdout)) throw new Error(`Offline Node rebuild failed: ${result.stderr}`)
            result = await rebuild(process.execPath, [npmCli, 'rebuild', 'better-sqlite3'], 'npm rebuild better-sqlite3')
          }
          if (result.code !== 0) throw new Error('Node rebuild failed')
        }
        if (!await probe(runtime)) throw new Error(`${runtime.kind} SQLite probe failed after rebuild`)
      }
      physical(runtime.cache); physical(active)
      fs.copyFileSync(active, runtime.cache)
      report('cached', { runtime: runtime.kind, sha256: hash(runtime.cache), probe: 'PASS' })
    }
    try {
      await ensure(electron)
      electronCached = true
      if (mode !== 'ensure-electron') {
        await ensure(node)
        await install(node)
        if (mode === 'run-node') {
          const vitestCli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
          const [command, args] = commandArgs(process.argv.slice(3), vitestCli)
          exitCode = (await run(command, args)).code
        }
        if (mode === 'doctor') report('doctor', { nodeProbe: 'PASS', nodeCacheSha256: hash(node.cache), electronCacheSha256: hash(electron.cache) })
      }
    } finally {
      if (electronCached) {
        restoring = true
        try { await install(electron); report('final', { runtime: 'Electron', probe: 'PASS', sha256: hash(active) }) }
        catch (error) { throw new Error(`NATIVE STATE FAILURE: Electron restoration failed: ${error.message}`) }
      }
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
    fs.closeSync(lock)
    fs.unlinkSync(lockPath)
  }
  return signal ? (signal === 'SIGINT' ? 130 : 143) : exitCode
}

if (path.resolve(process.argv[1] ?? '') === script) {
  main().then(code => { process.exitCode = code }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
