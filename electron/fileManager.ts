const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { pathToFileURL, fileURLToPath } = require('url');
const db = require('./database');
const pool = require('./imageWorkerPool');
const { logger } = require('./logger');

import type { Attachment, AttachmentData } from '../src/types/index';

let attachmentsDir: string;
let mistakeImagesDir: string;

function initialize(): void {
    attachmentsDir = path.join(app.getPath('userData'), 'attachments');
    mistakeImagesDir = path.join(app.getPath('userData'), 'mistake_images');
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

function validateAttachment(name: string, data: string): void {
    if (!name || typeof name !== 'string') {
        throw { code: 'VALIDATION_ERROR', message: 'Missing or invalid filename' };
    }
    const ext = path.extname(name).toLowerCase();
    if (ext && !ALLOWED_EXTENSIONS.includes(ext)) {
        throw { code: 'UNSUPPORTED_IMAGE_FORMAT', message: `Unsupported image format: ${ext}` };
    }
    if (!data || typeof data !== 'string' || data.length === 0) {
        throw { code: 'VALIDATION_ERROR', message: 'Empty image data' };
    }
}

// ── Attachments ──────────────────────────────────────────────────────────────

async function saveAttachment(entryId: number, { name, data, mimetype }: AttachmentData): Promise<Attachment> {
    validateAttachment(name, data);

    const timestamp = Date.now();
    const ext = path.extname(name);
    const safeFilename = `${entryId}_${timestamp}${ext}`;
    const filepath = path.join(attachmentsDir, safeFilename);

    // Offload buffer write to worker pool
    await pool.submit('writeBuffer', { bufferB64: data, filepath, expectedExt: ext });

    const attachment = db.addAttachment(entryId, {
        filename: name,
        filepath: safeFilename,
        mimetype: mimetype || 'application/octet-stream'
    }) as Attachment;

    return attachment;
}

async function deleteAttachment(id: number): Promise<{ success: boolean }> {
    const attachment = db.getAttachmentById(id) as Attachment | undefined;
    if (attachment) {
        const filepath = path.join(attachmentsDir, attachment.filepath);
        try {
            await fs.promises.unlink(filepath);
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
            const filepath = path.join(attachmentsDir, attachment.filepath);
            await fs.promises.unlink(filepath).catch((err: unknown) => {
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
            });
        })
    );

    let deleted = 0;
    let errors = 0;
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            deleted++;
        } else {
            logger.error(
                `[fileManager] Failed to delete physical file for attachment id=${attachments[i].id}:`,
                r.reason instanceof Error ? r.reason.message : String(r.reason)
            );
            errors++;
        }
    });

    return { deleted, errors };
}

function getAttachmentPath(filepath: string): string {
    const resolved = path.resolve(attachmentsDir, filepath);
    const relative = path.relative(attachmentsDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw { code: 'PATH_TRAVERSAL', message: 'Invalid attachment path' };
    }
    return resolved;
}

// ── Mistake Images ───────────────────────────────────────────────────────────

async function saveMistakeImage({ data, ext = '.png' }: { data: string; ext?: string }): Promise<string> {
    if (!data || typeof data !== 'string') {
        throw { code: 'VALIDATION_ERROR', message: 'Empty image data' };
    }
    const extLower = ext.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extLower)) {
        throw { code: 'UNSUPPORTED_IMAGE_FORMAT', message: `Unsupported format: ${extLower}` };
    }

    const timestamp = Date.now();
    const safeFilename = `mistake_${timestamp}${extLower}`;
    const filepath = path.join(mistakeImagesDir, safeFilename);

    await pool.submit('writeBuffer', { bufferB64: data, filepath, expectedExt: extLower });

    return pathToFileURL(filepath).pathname;
}

async function deleteMistakeImage(urlPathname: string): Promise<void> {
    try {
        const filepath = fileURLToPath('file://' + urlPathname);
        await fs.promises.unlink(filepath).catch((err: unknown) => {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        });
    } catch (e) {
        logger.error('[fileManager] deleteMistakeImage: invalid path', urlPathname, e);
    }
}

function getMistakeImagePath(filename: string): string {
    const resolved = path.resolve(mistakeImagesDir, filename);
    const relative = path.relative(mistakeImagesDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw { code: 'PATH_TRAVERSAL', message: 'Invalid image path' };
    }
    return resolved;
}

module.exports = {
    initialize, saveAttachment, deleteAttachment, deleteAttachmentsForEntry, getAttachmentPath,
    saveMistakeImage, deleteMistakeImage, getMistakeImagePath
};
