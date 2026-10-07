// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { physical } from '../scripts/native-runtime.mjs'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-native-path-')) })
afterEach(() => {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('minddiary-native-path-')) throw new Error('Unsafe test cleanup')
  fs.rmSync(root, { recursive: true, force: true })
})

it('allows missing ordinary components and confines paths to the root', () => {
  expect(() => physical(path.join(root, 'missing', 'binary.node'), root)).not.toThrow()
  expect(() => physical(path.join(root, '..', 'escape.node'), root)).toThrow('escaped repository')
})

it('rejects a junction or directory link in the path chain', () => {
  const target = path.join(root, 'target')
  fs.mkdirSync(target)
  const link = path.join(root, 'redirect')
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
  expect(() => physical(path.join(link, 'binary.node'), root)).toThrow('Native path is a link')
})

it('rejects a dangling directory link even though existsSync reports false', () => {
  const link = path.join(root, 'dangling')
  fs.symlinkSync(path.join(root, 'missing-target'), link, process.platform === 'win32' ? 'junction' : 'dir')
  expect(fs.existsSync(link)).toBe(false)
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
  expect(() => physical(path.join(link, 'binary.node'), root)).toThrow('Native path is a link')
})

it('rejects a dangling file symlink when OS privileges permit creation', context => {
  const link = path.join(root, 'binary.node')
  try { fs.symlinkSync(path.join(root, 'missing.node'), link, 'file') }
  catch (error) {
    const failure = error as NodeJS.ErrnoException
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(failure.code ?? '')) throw error
    console.warn(`Dangling file symlink NOT_RUN: ${failure.code}: ${failure.message}`)
    context.skip()
    return
  }
  expect(fs.existsSync(link)).toBe(false)
  expect(() => physical(link, root)).toThrow('Native path is a link')
})
