const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { app } = require('electron');
const db = require('./database');
const pool = require('./imageWorkerPool');
const { logger } = require('./logger');
import { deleteManagedMistakeImage, getMistakeImageReferenceKey } from './mistakeImageStorage';
import { validateAttachmentFilepath } from './databaseBackupData';
import { resolveManagedDeletionTarget } from './pathSecurity';

import type { Attachment, AttachmentData } from '../src/types/index';

let attachmentsDir: string;
let mistakeImagesDir: string;

function getAttachmentsDir(): string {
    if (!attachmentsDir) attachmentsDir = path.join(app.getPath('userData'), 'attachments');
    return attachmentsDir;
}

function getMistakeImagesDir(): string {
    if (!mistakeImagesDir) mistakeImagesDir = path.join(app.getPath('userData'), 'mistake_images');
    return mistakeImagesDir;
}

function initialize(): void {
    attachmentsDir = getAttachmentsDir();
    mistakeImagesDir = getMistakeImagesDir();
    // Sync mkdir for bootstrap (directories needed before first async operation)
    if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true });
    }
    if (!fs.existsSync(mistakeImagesDir)) {
        fs.mkdirSync(mistakeImagesDir, { recursive: true });
    }
    pool.initialize();
}

// ── Validation helpers (main thread) ─────────────────────────────────────────

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function getBase64ByteLength(data: string): number {
    return Buffer.byteLength(data, 'base64');
}

function validateImageData(data: string, mimetype?: string): void {
    if (!data || typeof data !== 'string' || data.length === 0) {
        throw { code: 'VALIDATION_ERROR', message: 'Empty image data' };
    }
    const bytes = getBase64ByteLength(data);
    if (bytes > MAX_IMAGE_BYTES) {
        throw { code: 'VALIDATION_ERROR', message: `Image exceeds ${MAX_IMAGE_BYTES} bytes` };
    }
    if (mimetype && !ALLOWED_MIME_TYPES.includes(mimetype)) {
        throw { code: 'UNSUPPORTED_IMAGE_FORMAT', message: `Unsupported image MIME type: ${mimetype}` };
    }
}

function validateAttachment(name: string, data: string, mimetype?: string): void {
    if (!name || typeof name !== 'string') {
        throw { code: 'VALIDATION_ERROR', message: 'Missing or invalid filename' };
    }
    const ext = path.extname(name).toLowerCase();
    if (ext && !ALLOWED_EXTENSIONS.includes(ext)) {
        throw { code: 'UNSUPPORTED_IMAGE_FORMAT', message: `Unsupported image format: ${ext}` };
    }
    validateImageData(data, mimetype);
}

// ── Attachments ──────────────────────────────────────────────────────────────

async function saveAttachment(entryId: number, { name, data, mimetype }: AttachmentData): Promise<Attachment> {
    validateAttachment(name, data, mimetype);

    const timestamp = Date.now();
    const ext = path.extname(name);
    const safeFilename = `${entryId}_${timestamp}${ext}`;
    const filepath = path.join(getAttachmentsDir(), safeFilename);

    try {
        // Offload buffer write to worker pool
        await pool.submit('writeBuffer', { bufferB64: data, filepath, expectedExt: ext });
    } catch (error) {
        logger.error('[fileManager] saveAttachment write failed', {
            code: (error as NodeJS.ErrnoException)?.code,
            name: error instanceof Error ? error.name : 'UnknownError',
        });
        throw error;
    }

    const attachment = db.addAttachment(entryId, {
        filename: name,
        filepath: safeFilename,
        mimetype: mimetype || 'application/octet-stream'
    }) as Attachment;

    return attachment;
}

function resolveAttachmentPath(filepath: unknown): string {
    try {
        const safeFilepath = validateAttachmentFilepath(filepath);
        const baseDir = path.resolve(getAttachmentsDir());
        const resolved = path.resolve(baseDir, safeFilepath);
        const relative = path.relative(baseDir, resolved);
        if (
            relative.length === 0
            || relative === '..'
            || relative.startsWith(`..${path.sep}`)
            || path.isAbsolute(relative)
        ) {
            throw new Error('Attachment path escaped the managed directory');
        }
        return resolved;
    } catch {
        throw Object.assign(new Error('Invalid attachment path'), { code: 'PATH_TRAVERSAL' });
    }
}

async function resolveAttachmentDeletionPath(filepath: unknown): Promise<string | null> {
    const logicalTarget = resolveAttachmentPath(filepath);
    try {
        return await resolveManagedDeletionTarget(getAttachmentsDir(), logicalTarget);
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'PATH_TRAVERSAL') {
            throw Object.assign(new Error('Invalid attachment path'), { code: 'PATH_TRAVERSAL' });
        }
        throw error;
    }
}

async function deleteAttachment(id: number): Promise<{ success: boolean }> {
    const attachment = db.getAttachmentById(id) as Attachment | undefined;
    if (attachment) {
        const filepath = await resolveAttachmentDeletionPath(attachment.filepath);
        try {
            if (filepath) await fs.promises.unlink(filepath);
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        db.removeAttachment(id);
    }
    return { success: true };
}

async function deleteAttachmentsForEntry(entryId: number): Promise<{ deleted: number; errors: number }> {
    const attachments = db.getAttachmentsByEntry(entryId) as Attachment[];

    const results = await Promise.allSettled(
        attachments.map(async (attachment) => {
            const filepath = await resolveAttachmentDeletionPath(attachment.filepath);
            if (filepath) {
                await fs.promises.unlink(filepath).catch((err: unknown) => {
                    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
                });
            }
        })
    );

    let deleted = 0;
    let errors = 0;
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            deleted++;
        } else {
            logger.error(
                `[fileManager] Failed to delete physical file for attachment id=${attachments[i]?.id ?? 'unknown'}:`,
                r.reason instanceof Error ? r.reason.message : String(r.reason)
            );
            errors++;
        }
    });

    return { deleted, errors };
}

function getAttachmentPath(filepath: string): string {
    return resolveAttachmentPath(filepath);
}

// ── Mistake Images ───────────────────────────────────────────────────────────

async function saveMistakeImage({ data, ext = '.png', mimetype }: { data: string; ext?: string; mimetype?: string }): Promise<string> {
    validateImageData(data, mimetype);
    const extLower = ext.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extLower)) {
        throw { code: 'UNSUPPORTED_IMAGE_FORMAT', message: `Unsupported format: ${extLower}` };
    }

    const timestamp = Date.now();
    const safeFilename = `mistake_${timestamp}_${randomUUID()}${extLower}`;
    const filepath = path.join(getMistakeImagesDir(), safeFilename);

    try {
        await pool.submit('writeBuffer', { bufferB64: data, filepath, expectedExt: extLower });
    } catch (error) {
        logger.error('[fileManager] saveMistakeImage write failed', {
            code: (error as NodeJS.ErrnoException)?.code,
            name: error instanceof Error ? error.name : 'UnknownError',
        });
        throw error;
    }

    const publicUrl = `mistake_images/${safeFilename}`;
    return publicUrl;
}

async function deleteMistakeImage(urlPathname: string): Promise<void> {
    const refs = urlPathname.startsWith('[')
        ? (() => { try { return JSON.parse(urlPathname) as string[] } catch { return [urlPathname] } })()
        : [urlPathname];

    await Promise.all(refs.map(async ref => deleteSingleMistakeImage(ref)));
}

async function deleteSingleMistakeImage(urlPathname: string): Promise<void> {
    try {
        await deleteManagedMistakeImage(urlPathname);
    } catch (e) {
        logger.error('[fileManager] deleteMistakeImage: invalid path', urlPathname, e);
    }
}

function getMistakeImagePath(filename: string): string {
    const baseDir = getMistakeImagesDir();
    const resolved = path.resolve(baseDir, filename);
    const relative = path.relative(baseDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw { code: 'PATH_TRAVERSAL', message: 'Invalid image path' };
    }
    return resolved;
}

module.exports = {
    initialize, saveAttachment, deleteAttachment, deleteAttachmentsForEntry, getAttachmentPath,
    saveMistakeImage, deleteMistakeImage, deleteManagedMistakeImage,
    getMistakeImageReferenceKey, getMistakeImagePath
};
