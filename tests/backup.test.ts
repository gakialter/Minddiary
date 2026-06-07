// @vitest-environment node

import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_FORMAT_VERSION, createAutoBackup, rotateBackups } from '../electron/backup'

const tempRoots: string[] = []

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-backup-'))
  tempRoots.push(root)
  return root
}

describe('auto backup package', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes a readable atomic backup package with manifest, database payload, and media files', async () => {
    const root = makeTempRoot()
    const userDataPath = path.join(root, 'userData')
    const backupPath = path.join(root, 'backups')
    fs.mkdirSync(path.join(userDataPath, 'attachments'), { recursive: true })
    fs.mkdirSync(path.join(userDataPath, 'mistake_images'), { recursive: true })
    fs.writeFileSync(path.join(userDataPath, 'attachments', 'diary.png'), 'diary image')
    fs.writeFileSync(path.join(userDataPath, 'mistake_images', 'mistake.png'), 'mistake image')

    const backupFile = await createAutoBackup({
      backupPath,
      userDataPath,
      appVersion: '1.9.3',
      schemaVersion: 2,
      now: new Date('2026-05-20T01:02:03.004Z'),
      keep: 7,
      logger: { warn: vi.fn(), error: vi.fn() },
      data: {
        entries: [],
        tags: [],
        subjects: [],
        mistakes: [],
        pomodoro: [],
        settings: {
          theme: 'dark',
          aiApiKey: 'sk-secret-key',
        },
      },
    })

    expect(path.basename(backupFile)).toBe('MindDiary_AutoBackup_2026-05-20T01-02-03-004Z.zip')
    expect(fs.existsSync(backupFile)).toBe(true)
    expect(fs.readdirSync(backupPath).some(name => name.endsWith('.tmp'))).toBe(false)

    const zipText = fs.readFileSync(backupFile).toString('utf8')
    expect(zipText).toContain('manifest.json')
    expect(zipText).toContain('database.json')
    expect(zipText).toContain('attachments/diary.png')
    expect(zipText).toContain('mistake_images/mistake.png')
    expect(zipText).toContain(`"backupFormatVersion": ${BACKUP_FORMAT_VERSION}`)
    expect(zipText).toContain('"appVersion": "1.9.3"')
    expect(zipText).toContain('"createdAt": "2026-05-20T01:02:03.004Z"')
    expect(zipText).toContain('"schemaVersion": 2')
    expect(zipText).not.toContain('sk-secret-key')
    expect(zipText).not.toContain('aiApiKey')
  })

  it('keeps the newest dated backups even when mtimes are shuffled', async () => {
    const backupPath = makeTempRoot()
    const logger = { warn: vi.fn(), error: vi.fn() }
    const old = path.join(backupPath, 'MindDiary_AutoBackup_2026-05-18T00-00-00-000Z.zip')
    const middle = path.join(backupPath, 'MindDiary_AutoBackup_2026-05-19T00-00-00-000Z.zip')
    const newest = path.join(backupPath, 'MindDiary_AutoBackup_2026-05-20T00-00-00-000Z.zip')
    const unknown = path.join(backupPath, 'MindDiary_AutoBackup_latest.zip')
    for (const file of [old, middle, newest, unknown]) {
      fs.writeFileSync(file, 'backup')
    }
    fs.utimesSync(old, new Date('2030-01-01T00:00:00.000Z'), new Date('2030-01-01T00:00:00.000Z'))
    fs.utimesSync(newest, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))

    await rotateBackups(backupPath, 2, logger)

    expect(fs.existsSync(newest)).toBe(true)
    expect(fs.existsSync(middle)).toBe(true)
    expect(fs.existsSync(old)).toBe(false)
    expect(fs.existsSync(unknown)).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unparseable backup date'), expect.stringContaining('MindDiary_AutoBackup_latest.zip'))
  })

  it('strips sensitive settings when backup data uses database row-shaped settings', async () => {
    const root = makeTempRoot()
    const backupPath = path.join(root, 'backups')

    const backupFile = await createAutoBackup({
      backupPath,
      userDataPath: path.join(root, 'userData'),
      appVersion: '1.9.3',
      schemaVersion: 2,
      now: new Date('2026-05-20T01:02:03.004Z'),
      keep: 7,
      logger: { warn: vi.fn(), error: vi.fn() },
      data: {
        settings: [
          { key: 'theme', value: 'dark' },
          { key: 'aiApiKey', value: 'enc:v1:secret-key-material' },
        ],
      },
    })

    const zipText = fs.readFileSync(backupFile).toString('utf8')
    expect(zipText).toContain('"theme"')
    expect(zipText).not.toContain('aiApiKey')
    expect(zipText).not.toContain('secret-key-material')
  })
})
