import fs from 'fs';
import os from 'os';
import path from 'path';
import { BACKUP_FORMAT_VERSION } from './backup';
import { normalizeBackupDatabaseData } from './databaseBackupData';

const MAX_STORED_ENTRY_BYTES = 256 * 1024 * 1024;
const MEDIA_DIRECTORIES = ['attachments', 'mistake_images'] as const;

export interface BackupLogger {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}

export interface BackupManifest {
    appVersion: string;
    createdAt: string;
    schemaVersion: number;
    backupFormatVersion: number;
}

interface StoredZipEntry {
    name: string;
    data: Buffer;
    isDirectory: boolean;
}

interface ValidatedEntry extends StoredZipEntry {
    normalizedName: string;
}

export interface RestoreAutoBackupOptions {
    zipPath: string;
    userDataPath: string;
    currentSchemaVersion: number;
    restoreDatabase: (data: Record<string, unknown>, manifestSchemaVersion: number) => void | Promise<void>;
    logger: BackupLogger;
    tempRootParent?: string;
}

export interface RestoreAutoBackupResult {
    success: true;
    manifest: BackupManifest;
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

function ensureReadable(buffer: Buffer, offset: number, length: number, context: string): void {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
        throw new Error(`Invalid ZIP structure: ${context} is out of bounds`);
    }
}

function readUInt16LE(buffer: Buffer, offset: number, context: string): number {
    ensureReadable(buffer, offset, 2, context);
    return buffer.readUInt16LE(offset);
}

function readUInt32LE(buffer: Buffer, offset: number, context: string): number {
    ensureReadable(buffer, offset, 4, context);
    return buffer.readUInt32LE(offset);
}

function decodeUtf8Name(nameBuffer: Buffer): string {
    const name = nameBuffer.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(nameBuffer)) {
        throw new Error('Invalid ZIP entry name: expected valid UTF-8');
    }
    return name;
}

function findEndOfCentralDirectory(zip: Buffer): number {
    const minOffset = Math.max(0, zip.length - 22 - 0xFFFF);
    for (let offset = zip.length - 22; offset >= minOffset; offset -= 1) {
        if (zip.readUInt32LE(offset) === 0x06054b50) {
            const commentLength = readUInt16LE(zip, offset + 20, 'end of central directory comment length');
            if (offset + 22 + commentLength === zip.length) {
                return offset;
            }
        }
    }
    throw new Error('Invalid ZIP file: end of central directory not found');
}

function readStoredZipEntries(zip: Buffer): StoredZipEntry[] {
    if (zip.length < 22) {
        throw new Error('Invalid ZIP file: file is too small');
    }

    const eocdOffset = findEndOfCentralDirectory(zip);
    const diskNumber = readUInt16LE(zip, eocdOffset + 4, 'disk number');
    const centralDirectoryDisk = readUInt16LE(zip, eocdOffset + 6, 'central directory disk');
    const entriesOnDisk = readUInt16LE(zip, eocdOffset + 8, 'entries on disk');
    const totalEntries = readUInt16LE(zip, eocdOffset + 10, 'total entries');
    const centralDirectorySize = readUInt32LE(zip, eocdOffset + 12, 'central directory size');
    const centralDirectoryOffset = readUInt32LE(zip, eocdOffset + 16, 'central directory offset');

    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
        throw new Error('Invalid ZIP file: multi-disk archives are not supported');
    }
    if (totalEntries === 0xFFFF || centralDirectorySize === 0xFFFFFFFF || centralDirectoryOffset === 0xFFFFFFFF) {
        throw new Error('Unsupported ZIP file: ZIP64 is not supported');
    }
    ensureReadable(zip, centralDirectoryOffset, centralDirectorySize, 'central directory');
    if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
        throw new Error('Invalid ZIP file: central directory overlaps end record');
    }

    const entries: StoredZipEntry[] = [];
    let cursor = centralDirectoryOffset;

    for (let index = 0; index < totalEntries; index += 1) {
        ensureReadable(zip, cursor, 46, `central directory entry ${index}`);
        if (readUInt32LE(zip, cursor, 'central directory signature') !== 0x02014b50) {
            throw new Error('Invalid ZIP file: central directory entry signature mismatch');
        }

        const flags = readUInt16LE(zip, cursor + 8, 'central directory flags');
        const method = readUInt16LE(zip, cursor + 10, 'central directory compression method');
        const expectedCrc = readUInt32LE(zip, cursor + 16, 'central directory crc');
        const compressedSize = readUInt32LE(zip, cursor + 20, 'central directory compressed size');
        const uncompressedSize = readUInt32LE(zip, cursor + 24, 'central directory uncompressed size');
        const nameLength = readUInt16LE(zip, cursor + 28, 'central directory name length');
        const extraLength = readUInt16LE(zip, cursor + 30, 'central directory extra length');
        const commentLength = readUInt16LE(zip, cursor + 32, 'central directory comment length');
        const localHeaderOffset = readUInt32LE(zip, cursor + 42, 'local header offset');

        if ((flags & 0x0001) !== 0) {
            throw new Error('Unsupported ZIP file: encrypted entries are not supported');
        }
        if ((flags & 0x0008) !== 0) {
            throw new Error('Unsupported ZIP file: data descriptors are not supported');
        }
        if ((flags & 0x0800) === 0) {
            throw new Error('Invalid ZIP entry name: UTF-8 flag is required');
        }
        if (method !== 0) {
            throw new Error(`Unsupported ZIP compression method: ${method}`);
        }
        if (compressedSize !== uncompressedSize) {
            throw new Error('Unsupported ZIP file: compressed entries are not supported');
        }
        if (compressedSize > MAX_STORED_ENTRY_BYTES) {
            throw new Error('Invalid ZIP entry: entry size exceeds restore limit');
        }

        const nameStart = cursor + 46;
        const nameEnd = nameStart + nameLength;
        ensureReadable(zip, nameStart, nameLength, `central directory entry ${index} name`);
        const name = decodeUtf8Name(zip.subarray(nameStart, nameEnd));
        cursor = nameEnd + extraLength + commentLength;
        ensureReadable(zip, cursor, 0, `central directory entry ${index} end`);

        ensureReadable(zip, localHeaderOffset, 30, `local file header for ${name}`);
        if (readUInt32LE(zip, localHeaderOffset, `local file header signature for ${name}`) !== 0x04034b50) {
            throw new Error('Invalid ZIP file: local file header signature mismatch');
        }

        const localFlags = readUInt16LE(zip, localHeaderOffset + 6, `local flags for ${name}`);
        const localMethod = readUInt16LE(zip, localHeaderOffset + 8, `local compression method for ${name}`);
        const localCompressedSize = readUInt32LE(zip, localHeaderOffset + 18, `local compressed size for ${name}`);
        const localUncompressedSize = readUInt32LE(zip, localHeaderOffset + 22, `local uncompressed size for ${name}`);
        const localNameLength = readUInt16LE(zip, localHeaderOffset + 26, `local name length for ${name}`);
        const localExtraLength = readUInt16LE(zip, localHeaderOffset + 28, `local extra length for ${name}`);

        if ((localFlags & 0x0800) === 0 || localMethod !== method) {
            throw new Error('Invalid ZIP file: local header metadata does not match central directory');
        }
        if (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize) {
            throw new Error('Invalid ZIP file: local entry size does not match central directory');
        }

        const localNameStart = localHeaderOffset + 30;
        const localNameEnd = localNameStart + localNameLength;
        ensureReadable(zip, localNameStart, localNameLength, `local name for ${name}`);
        const localName = decodeUtf8Name(zip.subarray(localNameStart, localNameEnd));
        if (localName !== name) {
            throw new Error('Invalid ZIP file: local entry name does not match central directory');
        }

        const dataStart = localNameEnd + localExtraLength;
        const dataEnd = dataStart + compressedSize;
        ensureReadable(zip, dataStart, compressedSize, `entry data for ${name}`);
        if (dataEnd > centralDirectoryOffset) {
            throw new Error('Invalid ZIP file: entry data overlaps central directory');
        }

        const data = Buffer.from(zip.subarray(dataStart, dataEnd));
        if (crc32(data) !== expectedCrc) {
            throw new Error('Invalid ZIP file: entry CRC mismatch');
        }

        entries.push({ name, data, isDirectory: name.endsWith('/') });
    }

    if (cursor !== centralDirectoryOffset + centralDirectorySize) {
        throw new Error('Invalid ZIP file: central directory size mismatch');
    }

    return entries;
}

export function normalizeZipEntryName(name: string): string {
    if (typeof name !== 'string' || name.length === 0) {
        throw new Error('Invalid ZIP entry path: expected a non-empty name');
    }
    if (name.includes('\0')) {
        throw new Error('Invalid ZIP entry path: null bytes are not allowed');
    }
    if (name.includes('\\')) {
        throw new Error('Unsafe ZIP entry path: backslashes are not allowed');
    }
    if (/^[A-Za-z]:/.test(name)) {
        throw new Error('Unsafe ZIP entry path: Windows drive paths are not allowed');
    }
    if (name.startsWith('/')) {
        throw new Error('Unsafe ZIP entry path: absolute paths are not allowed');
    }

    const segments = name.split('/');
    if (segments.some(segment => segment === '..')) {
        throw new Error('Unsafe ZIP entry path: traversal segments are not allowed');
    }

    const normalized = path.posix.normalize(name);
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
        throw new Error('Unsafe ZIP entry path: normalized path escapes restore root');
    }
    if (/^[A-Za-z]:/.test(normalized)) {
        throw new Error('Unsafe ZIP entry path: Windows drive paths are not allowed');
    }

    return normalized;
}

function isAllowedEntryName(normalizedName: string, isDirectory: boolean): boolean {
    if (normalizedName === 'manifest.json' || normalizedName === 'database.json') {
        return !isDirectory;
    }
    if (normalizedName === 'attachments' || normalizedName === 'mistake_images') {
        return isDirectory;
    }
    return normalizedName.startsWith('attachments/') || normalizedName.startsWith('mistake_images/');
}

export function resolveSafeRestorePath(tempRoot: string, entryName: string): string {
    const normalized = normalizeZipEntryName(entryName);
    const resolved = path.resolve(tempRoot, normalized);
    const relative = path.relative(tempRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Unsafe ZIP entry path: resolved path escapes restore root');
    }
    return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(data: Buffer, label: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(data.toString('utf8'));
    } catch (error) {
        throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(parsed)) {
        throw new Error(`Invalid ${label}: expected a JSON object`);
    }
    return parsed;
}

function validateManifest(raw: Record<string, unknown>, currentSchemaVersion: number): BackupManifest {
    const { appVersion, createdAt, schemaVersion, backupFormatVersion } = raw;
    if (backupFormatVersion !== BACKUP_FORMAT_VERSION) {
        throw new Error(`Unsupported backup format version: ${String(backupFormatVersion)}`);
    }
    if (!Number.isInteger(schemaVersion)) {
        throw new Error('Invalid manifest.json: schemaVersion must be an integer');
    }
    if ((schemaVersion as number) < 1) {
        throw new Error(`Invalid manifest.json: schemaVersion must be at least 1, got ${schemaVersion}`);
    }
    if ((schemaVersion as number) > currentSchemaVersion) {
        throw new Error(`Unsupported schema version: backup schema ${schemaVersion} is newer than current schema ${currentSchemaVersion}`);
    }
    if (typeof appVersion !== 'string' || appVersion.trim().length === 0) {
        throw new Error('Invalid manifest.json: appVersion must be a non-empty string');
    }
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
        throw new Error('Invalid manifest.json: createdAt must be a parseable ISO string');
    }

    return {
        appVersion,
        createdAt,
        schemaVersion: schemaVersion as number,
        backupFormatVersion,
    };
}

function getBackupDataPayload(raw: Record<string, unknown>): Record<string, unknown> {
    if (!isRecord(raw.data)) {
        throw new Error('Invalid database.json: data must be a JSON object');
    }
    return raw.data;
}

async function cleanupDirectory(dir: string, logger: BackupLogger): Promise<void> {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(error => {
        logger.warn('[backup-restore] Failed to clean temporary directory', dir, error instanceof Error ? error.message : String(error));
    });
}

async function validateAndExtractEntries(entries: StoredZipEntry[], tempRoot: string): Promise<Map<string, ValidatedEntry>> {
    const validated = new Map<string, ValidatedEntry>();

    for (const entry of entries) {
        const normalizedName = normalizeZipEntryName(entry.name);
        if (!isAllowedEntryName(normalizedName, entry.isDirectory)) {
            throw new Error(`Invalid ZIP entry path: ${entry.name}`);
        }
        if (validated.has(normalizedName)) {
            throw new Error(`Invalid ZIP file: duplicate entry ${normalizedName}`);
        }

        const safePath = resolveSafeRestorePath(tempRoot, entry.name);
        validated.set(normalizedName, { ...entry, normalizedName });

        if (entry.isDirectory) {
            await fs.promises.mkdir(safePath, { recursive: true });
            continue;
        }

        await fs.promises.mkdir(path.dirname(safePath), { recursive: true });
        await fs.promises.writeFile(safePath, entry.data);
    }

    return validated;
}

interface MediaSnapshot {
    name: typeof MEDIA_DIRECTORIES[number];
    target: string;
    backup: string;
    existed: boolean;
}

async function pathExists(filepath: string): Promise<boolean> {
    return fs.promises.access(filepath).then(() => true, () => false);
}

async function backupMediaDirectories(userDataPath: string, rollbackRoot: string): Promise<MediaSnapshot[]> {
    const snapshots: MediaSnapshot[] = [];

    for (const name of MEDIA_DIRECTORIES) {
        const target = path.join(userDataPath, name);
        const backup = path.join(rollbackRoot, name);
        const existed = await pathExists(target);
        if (existed) {
            await fs.promises.cp(target, backup, { recursive: true });
        }
        snapshots.push({ name, target, backup, existed });
    }

    return snapshots;
}

async function restoreMediaSnapshots(snapshots: MediaSnapshot[]): Promise<void> {
    for (const snapshot of snapshots) {
        await fs.promises.rm(snapshot.target, { recursive: true, force: true });
        if (snapshot.existed) {
            await fs.promises.cp(snapshot.backup, snapshot.target, { recursive: true });
        }
    }
}

async function replaceMediaDirectories(userDataPath: string, tempRoot: string, rollbackRoot: string): Promise<MediaSnapshot[]> {
    await fs.promises.mkdir(userDataPath, { recursive: true });
    const snapshots = await backupMediaDirectories(userDataPath, rollbackRoot);

    try {
        for (const name of MEDIA_DIRECTORIES) {
            const source = path.join(tempRoot, name);
            const target = path.join(userDataPath, name);
            await fs.promises.rm(target, { recursive: true, force: true });
            if (await pathExists(source)) {
                await fs.promises.cp(source, target, { recursive: true });
            } else {
                await fs.promises.mkdir(target, { recursive: true });
            }
        }
    } catch (error) {
        await restoreMediaSnapshots(snapshots).catch(() => {});
        throw error;
    }

    return snapshots;
}

export async function restoreAutoBackupFromZip({
    zipPath,
    userDataPath,
    currentSchemaVersion,
    restoreDatabase,
    logger,
    tempRootParent = os.tmpdir(),
}: RestoreAutoBackupOptions): Promise<RestoreAutoBackupResult> {
    const tempRoot = await fs.promises.mkdtemp(path.join(tempRootParent, 'minddiary-restore-'));
    const rollbackRoot = await fs.promises.mkdtemp(path.join(tempRootParent, 'minddiary-restore-rollback-'));
    let mediaSnapshots: MediaSnapshot[] | null = null;

    try {
        const zip = await fs.promises.readFile(zipPath);
        const entries = readStoredZipEntries(zip);
        const validatedEntries = await validateAndExtractEntries(entries, tempRoot);
        const manifestEntry = validatedEntries.get('manifest.json');
        if (!manifestEntry) {
            throw new Error('Invalid backup ZIP: manifest.json is required');
        }
        const databaseEntry = validatedEntries.get('database.json');
        if (!databaseEntry) {
            throw new Error('Invalid backup ZIP: database.json is required');
        }

        const manifest = validateManifest(parseJsonObject(manifestEntry.data, 'manifest.json'), currentSchemaVersion);
        const databasePayload = getBackupDataPayload(parseJsonObject(databaseEntry.data, 'database.json'));
        normalizeBackupDatabaseData(databasePayload, manifest.schemaVersion);

        mediaSnapshots = await replaceMediaDirectories(userDataPath, tempRoot, rollbackRoot);
        try {
            await restoreDatabase(databasePayload, manifest.schemaVersion);
        } catch (error) {
            await restoreMediaSnapshots(mediaSnapshots).catch(rollbackError => {
                logger.error('[backup-restore] Failed to roll back media directories after database restore error', rollbackError);
            });
            throw error;
        }

        return { success: true, manifest };
    } finally {
        await cleanupDirectory(tempRoot, logger);
        await cleanupDirectory(rollbackRoot, logger);
    }
}
