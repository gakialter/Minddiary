import fs from 'fs';
import path from 'path';
import { SENSITIVE_SETTINGS_KEYS, stripSensitiveSettings } from './settingsSecurity';

export const BACKUP_FORMAT_VERSION = 2;
const BACKUP_PREFIX = 'MindDiary_AutoBackup_';

interface BackupLogger {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}

interface BackupManifest {
    appVersion: string;
    createdAt: string;
    schemaVersion: number;
    backupFormatVersion: number;
}

interface BackupOptions {
    backupPath: string;
    userDataPath: string;
    appVersion: string;
    schemaVersion: number;
    data: Record<string, unknown>;
    now?: Date;
    keep?: number;
    logger: BackupLogger;
}

interface ZipEntry {
    name: string;
    data: Buffer;
    date: Date;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(data: Buffer): number {
    let crc = 0xFFFFFFFF;
    for (const byte of data) {
        crc = CRC_TABLE[(crc ^ byte) & 0xFF]! ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function toDosDateTime(date: Date): { dosDate: number; dosTime: number } {
    const year = Math.max(1980, date.getFullYear());
    return {
        dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    };
}

function createStoredZip(entries: ZipEntry[]): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const name = entry.name.replace(/\\/g, '/');
        const nameBuffer = Buffer.from(name, 'utf8');
        const data = entry.data;
        const checksum = crc32(data);
        const { dosDate, dosTime } = toDosDateTime(entry.date);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(dosTime, 10);
        localHeader.writeUInt16LE(dosDate, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuffer, data);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(dosTime, 12);
        centralHeader.writeUInt16LE(dosDate, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBuffer);

        offset += localHeader.length + nameBuffer.length + data.length;
    }

    const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDirectorySize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, ...centralParts, end]);
}

async function collectDirectoryEntries(rootDir: string, zipRoot: string, date: Date): Promise<ZipEntry[]> {
    if (!fs.existsSync(rootDir)) return [];
    const stat = await fs.promises.stat(rootDir);
    if (!stat.isDirectory()) return [];

    const entries: ZipEntry[] = [];
    const visit = async (dir: string) => {
        const children = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const child of children) {
            const absolute = path.join(dir, child.name);
            if (child.isDirectory()) {
                await visit(absolute);
            } else if (child.isFile()) {
                const relative = path.relative(rootDir, absolute).replace(/\\/g, '/');
                entries.push({
                    name: `${zipRoot}/${relative}`,
                    data: await fs.promises.readFile(absolute),
                    date,
                });
            }
        }
    };

    await visit(rootDir);
    return entries;
}

function sanitizeBackupSettings(settings: unknown): unknown {
    if (Array.isArray(settings)) {
        return settings.filter(row => {
            if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
            return !SENSITIVE_SETTINGS_KEYS.includes(String((row as Record<string, unknown>).key));
        });
    }
    return stripSensitiveSettings(settings as Record<string, unknown> | null | undefined);
}

function sanitizeBackupData(data: Record<string, unknown>): Record<string, unknown> {
    const nestedData = data.data && typeof data.data === 'object' && !Array.isArray(data.data)
        ? data.data as Record<string, unknown>
        : data;
    return {
        ...data,
        data: {
            ...nestedData,
            settings: sanitizeBackupSettings(nestedData.settings),
        },
    };
}

async function writeFileAtomic(filepath: string, data: Buffer): Promise<void> {
    const tempPath = `${filepath}.${process.pid}.${Date.now()}.tmp`;
    let handle: fs.promises.FileHandle | null = null;
    try {
        handle = await fs.promises.open(tempPath, 'wx');
        await handle.writeFile(data);
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.promises.rename(tempPath, filepath);
    } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await fs.promises.unlink(tempPath).catch(() => {});
        throw error;
    }
}

function formatBackupTimestamp(date: Date): string {
    return date.toISOString().replace(/:/g, '-').replace(/\./g, '-');
}

export async function createAutoBackup({
    backupPath,
    userDataPath,
    appVersion,
    schemaVersion,
    data,
    now = new Date(),
    keep = 7,
    logger,
}: BackupOptions): Promise<string> {
    await fs.promises.mkdir(backupPath, { recursive: true });
    const createdAt = now.toISOString();
    const manifest: BackupManifest = {
        appVersion,
        createdAt,
        schemaVersion,
        backupFormatVersion: BACKUP_FORMAT_VERSION,
    };
    const payload = sanitizeBackupData({
        version: appVersion,
        timestamp: createdAt,
        data,
    });

    const entries: ZipEntry[] = [
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), date: now },
        { name: 'database.json', data: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'), date: now },
        ...await collectDirectoryEntries(path.join(userDataPath, 'attachments'), 'attachments', now),
        ...await collectDirectoryEntries(path.join(userDataPath, 'mistake_images'), 'mistake_images', now),
    ];

    const backupFile = path.join(backupPath, `${BACKUP_PREFIX}${formatBackupTimestamp(now)}.zip`);
    await writeFileAtomic(backupFile, createStoredZip(entries));
    await rotateBackups(backupPath, keep, logger);
    return backupFile;
}

function parseBackupDateFromFilename(filename: string): number | null {
    const zipMatch = filename.match(/^MindDiary_AutoBackup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.zip$/);
    if (zipMatch?.[1]) {
        const iso = zipMatch[1].replace(
            /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/,
            '$1$2:$3:$4.$5',
        );
        const time = Date.parse(iso);
        return Number.isNaN(time) ? null : time;
    }

    const jsonMatch = filename.match(/^MindDiary_AutoBackup_(\d{4}-\d{2}-\d{2})\.json$/);
    if (jsonMatch?.[1]) {
        const time = Date.parse(`${jsonMatch[1]}T00:00:00.000Z`);
        return Number.isNaN(time) ? null : time;
    }

    return null;
}

export async function rotateBackups(backupPath: string, keep: number, logger: BackupLogger): Promise<void> {
    const files = await fs.promises.readdir(backupPath);
    const datedBackups: Array<{ name: string; createdAt: number }> = [];

    for (const file of files) {
        if (!file.startsWith(BACKUP_PREFIX) || (!file.endsWith('.zip') && !file.endsWith('.json'))) continue;
        const createdAt = parseBackupDateFromFilename(file);
        if (createdAt === null) {
            logger.warn('[backup] Skipped backup with unparseable backup date', file);
            continue;
        }
        datedBackups.push({ name: file, createdAt });
    }

    datedBackups.sort((a, b) => b.createdAt - a.createdAt);
    for (const file of datedBackups.slice(keep)) {
        await fs.promises.unlink(path.join(backupPath, file.name)).catch(error => {
            logger.warn('[backup] Failed to delete old backup', file.name, error instanceof Error ? error.message : String(error));
        });
    }
}
