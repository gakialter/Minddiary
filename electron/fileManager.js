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

function getAttachmentPath(filepath) {
    return path.join(attachmentsDir, filepath);
}

module.exports = { initialize, saveAttachment, deleteAttachment, getAttachmentPath };
