const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { pathToFileURL } = require('url');
const db = require('./database');

import type { Attachment, AttachmentData } from '../src/types/index';

let attachmentsDir: string;
let mistakeImagesDir: string;

function initialize(): void {
    attachmentsDir = path.join(app.getPath('userData'), 'attachments');
    mistakeImagesDir = path.join(app.getPath('userData'), 'mistake_images');
    if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true });
    }
    if (!fs.existsSync(mistakeImagesDir)) {
        fs.mkdirSync(mistakeImagesDir, { recursive: true });
    }
}

async function saveAttachment(entryId: number, { name, data, mimetype }: AttachmentData): Promise<Attachment> {
    // data is a base64 string from renderer
    const buffer = Buffer.from(data, 'base64');
    const timestamp = Date.now();
    const ext = path.extname(name);
    const safeFilename = `${entryId}_${timestamp}${ext}`;
    const filepath = path.join(attachmentsDir, safeFilename);

    fs.writeFileSync(filepath, buffer);

    const attachment = db.addAttachment(entryId, {
        filename: name,
        filepath: safeFilename,
        mimetype: mimetype || 'application/octet-stream'
    }) as Attachment;

    return attachment;
}

function deleteAttachment(id: number): { success: boolean } {
    const attachment = db.getAttachmentById(id) as Attachment | undefined;
    if (attachment) {
        const filepath = path.join(attachmentsDir, attachment.filepath);
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }
        db.removeAttachment(id);
    }
    return { success: true };
}

/**
 * Physically delete every attachment file belonging to an entry.
 * Must be called BEFORE db.deleteEntry() so the attachment records
 * are still queryable. Errors on individual files are logged but do
 * NOT abort the delete (e.g. file already manually removed).
 */
function deleteAttachmentsForEntry(entryId: number): { deleted: number; errors: number } {
    const attachments = db.getAttachmentsByEntry(entryId) as Attachment[];
    let deleted = 0;
    let errors = 0;

    for (const attachment of attachments) {
        try {
            const filepath = path.join(attachmentsDir, attachment.filepath);
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
            deleted++;
        } catch (err: unknown) {
            console.error(
                `[fileManager] Failed to delete physical file for attachment id=${attachment.id}:`,
                err instanceof Error ? err.message : String(err)
            );
            errors++;
        }
    }

    return { deleted, errors };
}

function getAttachmentPath(filepath: string): string {
    return path.join(attachmentsDir, filepath);
}

// ==================== Mistake Images ====================

async function saveMistakeImage({ data, ext = '.png' }: { data: string; ext?: string }): Promise<string> {
    // data is a base64 string from renderer
    const buffer = Buffer.from(data, 'base64');
    const timestamp = Date.now();
    const safeFilename = `mistake_${timestamp}${ext}`;
    const filepath = path.join(mistakeImagesDir, safeFilename);

    fs.writeFileSync(filepath, buffer);
    // Return the URL pathname (e.g. '/C:/Users/.../file.png' on Windows)
    // so that `local://${path}` becomes `local:///C:/...` which the
    // protocol handler correctly maps to `file:///C:/...`.
    return pathToFileURL(filepath).pathname;
}

function deleteMistakeImage(filename: string): void {
    const filepath = path.join(mistakeImagesDir, filename);
    if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
    }
}

function getMistakeImagePath(filename: string): string {
    return path.join(mistakeImagesDir, filename);
}

module.exports = {
    initialize, saveAttachment, deleteAttachment, deleteAttachmentsForEntry, getAttachmentPath,
    saveMistakeImage, deleteMistakeImage, getMistakeImagePath
};
