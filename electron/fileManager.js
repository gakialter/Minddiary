const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const db = require('./database');

let attachmentsDir;

function initialize() {
    attachmentsDir = path.join(app.getPath('userData'), 'attachments');
    if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true });
    }
}

async function saveAttachment(entryId, { name, data, mimetype }) {
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
    });

    return attachment;
}

function deleteAttachment(id) {
    const attachment = db.getAttachmentById(id);
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
 *
 * @param {number} entryId
 * @returns {{ deleted: number, errors: number }}
 */
function deleteAttachmentsForEntry(entryId) {
    const attachments = db.getAttachmentsByEntry(entryId);
    let deleted = 0;
    let errors = 0;

    for (const attachment of attachments) {
        try {
            const filepath = path.join(attachmentsDir, attachment.filepath);
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
            deleted++;
        } catch (err) {
            console.error(
                `[fileManager] Failed to delete physical file for attachment id=${attachment.id}:`,
                err.message
            );
            errors++;
        }
    }

    return { deleted, errors };
}

function getAttachmentPath(filepath) {
    return path.join(attachmentsDir, filepath);
}

module.exports = { initialize, saveAttachment, deleteAttachment, deleteAttachmentsForEntry, getAttachmentPath };
