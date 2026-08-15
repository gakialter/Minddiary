// @vitest-environment node

import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_FORMAT_VERSION } from '../electron/backup'
import { restoreAutoBackupFromZip } from '../electron/backupRestore'

const tempRoots: string[] = []

interface TestZipEntry {
  name: string
  data?: string | Buffer
  method?: number
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minddiary-restore-'))
  tempRoots.push(root)
  return root
}

function makeManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    appVersion: '1.9.3',
    createdAt: '2026-05-20T01:02:03.004Z',
    schemaVersion: 1,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    ...overrides,
  }
}

function makeDatabasePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1.9.3',
    timestamp: '2026-05-20T01:02:03.004Z',
    data: {
      entries: [{ id: 10, date: '2026-05-20', title: 'restored', content: 'new' }],
      tags: [],
      subjects: [],
      mistakes: [],
      settings: {
        theme: 'dark',
        examDate: '2027-01-15',
        countdownEvents: [
          {
            id: 'default-exam',
            title: '论文提交',
            date: '2027-01-15',
            type: 'exam',
          },
        ],
      },
    },
    ...overrides,
  }
}

function createStoredZip(entries: TestZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data ?? '', 'utf8')
    const method = entry.method ?? 0
    const checksum = crc32(data)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, nameBuffer, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuffer)

    offset += localHeader.length + nameBuffer.length + data.length
  }

  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectorySize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, end])
}

function createBackupZip(entries: TestZipEntry[] = []): Buffer {
  return createStoredZip([
    { name: 'manifest.json', data: JSON.stringify(makeManifest()) },
    { name: 'database.json', data: JSON.stringify(makeDatabasePayload()) },
    ...entries,
  ])
}

function writeZip(root: string, zip: Buffer): string {
  const filepath = path.join(root, 'backup.zip')
  fs.writeFileSync(filepath, zip)
  return filepath
}

function seedExistingData(userDataPath: string): void {
  fs.mkdirSync(path.join(userDataPath, 'attachments'), { recursive: true })
  fs.mkdirSync(path.join(userDataPath, 'mistake_images'), { recursive: true })
  fs.writeFileSync(path.join(userDataPath, 'attachments', 'old.txt'), 'old attachment')
  fs.writeFileSync(path.join(userDataPath, 'mistake_images', 'old.png'), 'old mistake')
}

async function expectRejectedWithoutMutation(zip: Buffer, expectedMessage: RegExp): Promise<void> {
  const root = makeTempRoot()
  const userDataPath = path.join(root, 'userData')
  seedExistingData(userDataPath)
  const zipPath = writeZip(root, zip)
  const restoreDatabase = vi.fn()

  await expect(restoreAutoBackupFromZip({
    zipPath,
    userDataPath,
    currentSchemaVersion: 4,
    restoreDatabase,
    logger: { warn: vi.fn(), error: vi.fn() },
    tempRootParent: root,
  })).rejects.toThrow(expectedMessage)

  expect(restoreDatabase).not.toHaveBeenCalled()
  expect(fs.readFileSync(path.join(userDataPath, 'attachments', 'old.txt'), 'utf8')).toBe('old attachment')
  expect(fs.readFileSync(path.join(userDataPath, 'mistake_images', 'old.png'), 'utf8')).toBe('old mistake')
  expect(fs.existsSync(path.join(root, 'evil'))).toBe(false)
}

describe('automatic backup ZIP restore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('restores a valid backup manifest, database payload, and media directories', async () => {
    const root = makeTempRoot()
    const userDataPath = path.join(root, 'userData')
    seedExistingData(userDataPath)
    const zipPath = writeZip(root, createBackupZip([
      { name: 'attachments/new.txt', data: 'new attachment' },
      { name: 'mistake_images/new.png', data: 'new mistake' },
    ]))
    let restoredData: Record<string, unknown> | null = null

    const result = await restoreAutoBackupFromZip({
      zipPath,
      userDataPath,
      currentSchemaVersion: 4,
      restoreDatabase: async (data) => {
        restoredData = data
      },
      logger: { warn: vi.fn(), error: vi.fn() },
      tempRootParent: root,
    })

    expect(result.manifest).toEqual(makeManifest())
    expect(restoredData).toEqual(makeDatabasePayload().data)
    const restoredSettings = (restoredData as unknown as {
      settings?: { countdownEvents?: unknown }
    } | null)?.settings
    expect(restoredSettings?.countdownEvents).toEqual([
      expect.objectContaining({
        id: 'default-exam',
        title: '论文提交',
        date: '2027-01-15',
      }),
    ])
    expect(fs.readFileSync(path.join(userDataPath, 'attachments', 'new.txt'), 'utf8')).toBe('new attachment')
    expect(fs.readFileSync(path.join(userDataPath, 'mistake_images', 'new.png'), 'utf8')).toBe('new mistake')
    expect(fs.existsSync(path.join(userDataPath, 'attachments', 'old.txt'))).toBe(false)
    expect(fs.existsSync(path.join(userDataPath, 'mistake_images', 'old.png'))).toBe(false)
  })

  it('passes manifest schema context to database restore', async () => {
    const root = makeTempRoot()
    const userDataPath = path.join(root, 'userData')
    seedExistingData(userDataPath)
    const zipPath = writeZip(root, createStoredZip([
      { name: 'manifest.json', data: JSON.stringify(makeManifest({ schemaVersion: 6 })) },
      { name: 'database.json', data: JSON.stringify(makeDatabasePayload()) },
    ]))
    const restoreDatabase = vi.fn()

    await restoreAutoBackupFromZip({
      zipPath,
      userDataPath,
      currentSchemaVersion: 7,
      restoreDatabase,
      logger: { warn: vi.fn(), error: vi.fn() },
      tempRootParent: root,
    })

    expect(restoreDatabase).toHaveBeenCalledWith(makeDatabasePayload().data, 6)
  })

  it('preflights schema 7 planning sections before replacing media or invoking database restore', async () => {
    const root = makeTempRoot()
    const userDataPath = path.join(root, 'userData')
    seedExistingData(userDataPath)
    const zipPath = writeZip(root, createStoredZip([
      { name: 'manifest.json', data: JSON.stringify(makeManifest({ schemaVersion: 7 })) },
      { name: 'database.json', data: JSON.stringify(makeDatabasePayload()) },
      { name: 'attachments/new.txt', data: 'new attachment' },
    ]))
    const restoreDatabase = vi.fn()

    await expect(restoreAutoBackupFromZip({
      zipPath,
      userDataPath,
      currentSchemaVersion: 7,
      restoreDatabase,
      logger: { warn: vi.fn(), error: vi.fn() },
      tempRootParent: root,
    })).rejects.toThrow(/planning_runs/i)

    expect(restoreDatabase).not.toHaveBeenCalled()
    expect(fs.readFileSync(path.join(userDataPath, 'attachments', 'old.txt'), 'utf8')).toBe('old attachment')
    expect(fs.existsSync(path.join(userDataPath, 'attachments', 'new.txt'))).toBe(false)
  })

  it('fails when manifest.json is missing', async () => {
    await expectRejectedWithoutMutation(createStoredZip([
      { name: 'database.json', data: JSON.stringify(makeDatabasePayload()) },
    ]), /manifest\.json/i)
  })

  it('fails when database.json is missing', async () => {
    await expectRejectedWithoutMutation(createStoredZip([
      { name: 'manifest.json', data: JSON.stringify(makeManifest()) },
    ]), /database\.json/i)
  })

  it('fails for unsupported backup format versions', async () => {
    await expectRejectedWithoutMutation(createStoredZip([
      { name: 'manifest.json', data: JSON.stringify(makeManifest({ backupFormatVersion: BACKUP_FORMAT_VERSION + 1 })) },
      { name: 'database.json', data: JSON.stringify(makeDatabasePayload()) },
    ]), /backup format/i)
  })

  it('fails for future schema versions', async () => {
    await expectRejectedWithoutMutation(createStoredZip([
      { name: 'manifest.json', data: JSON.stringify(makeManifest({ schemaVersion: 99 })) },
      { name: 'database.json', data: JSON.stringify(makeDatabasePayload()) },
    ]), /schema/i)
  })

  it.each([0, -1])('fails for invalid schemaVersion %s', async (schemaVersion) => {
    await expectRejectedWithoutMutation(createStoredZip([
      { name: 'manifest.json', data: JSON.stringify(makeManifest({ schemaVersion })) },
      { name: 'database.json', data: JSON.stringify(makeDatabasePayload()) },
    ]), /schemaVersion/i)
  })

  it('fails for corrupt ZIP files', async () => {
    await expectRejectedWithoutMutation(Buffer.from('not a zip file', 'utf8'), /zip/i)
  })

  it.each([
    '../evil',
    '/evil',
    'C:/evil',
    'C:\\evil',
    '\\\\server\\share\\evil',
    'attachments/../../evil',
    'attachments/bad\u0000name',
  ])('rejects unsafe ZIP entry path %s', async (entryName) => {
    await expectRejectedWithoutMutation(createBackupZip([
      { name: entryName, data: 'evil' },
    ]), /unsafe|invalid|traversal|absolute|drive|null/i)
  })

  it.each(['manifest.json', 'database.json'])('fails for duplicate %s entries', async (entryName) => {
    const duplicateData = entryName === 'manifest.json'
      ? JSON.stringify(makeManifest())
      : JSON.stringify(makeDatabasePayload())
    await expectRejectedWithoutMutation(createBackupZip([
      { name: entryName, data: duplicateData },
    ]), /duplicate/i)
  })

  it('fails for unsupported ZIP compression methods', async () => {
    await expectRejectedWithoutMutation(createStoredZip([
      { name: 'manifest.json', data: JSON.stringify(makeManifest()) },
      { name: 'database.json', data: JSON.stringify(makeDatabasePayload()) },
      { name: 'attachments/deflated.txt', data: 'compressed', method: 8 },
    ]), /compression/i)
  })

  it('restores media rollback when database restore fails', async () => {
    const root = makeTempRoot()
    const userDataPath = path.join(root, 'userData')
    seedExistingData(userDataPath)
    const zipPath = writeZip(root, createBackupZip([
      { name: 'attachments/new.txt', data: 'new attachment' },
      { name: 'mistake_images/new.png', data: 'new mistake' },
    ]))

    await expect(restoreAutoBackupFromZip({
      zipPath,
      userDataPath,
      currentSchemaVersion: 4,
      restoreDatabase: async () => {
        throw new Error('database failed')
      },
      logger: { warn: vi.fn(), error: vi.fn() },
      tempRootParent: root,
    })).rejects.toThrow(/database failed/)

    expect(fs.readFileSync(path.join(userDataPath, 'attachments', 'old.txt'), 'utf8')).toBe('old attachment')
    expect(fs.readFileSync(path.join(userDataPath, 'mistake_images', 'old.png'), 'utf8')).toBe('old mistake')
    expect(fs.existsSync(path.join(userDataPath, 'attachments', 'new.txt'))).toBe(false)
    expect(fs.existsSync(path.join(userDataPath, 'mistake_images', 'new.png'))).toBe(false)
  })
})
