const { app, BrowserWindow, ipcMain, Notification, dialog, session } = require('electron');
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) {}
const path = require('path');
const fs = require('fs');
const db = require('./database');
const fileManager = require('./fileManager');
const aiService = require('./aiService');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#0f0f14',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Dev or production
    const isDev = !app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
}

// ==================== Auto Updater ====================
function initAutoUpdater() {
    if (!autoUpdater) return;
    autoUpdater.checkForUpdatesAndNotify();
    autoUpdater.on('update-available', () => {
        dialog.showMessageBox({
            type: 'info',
            title: '发现新版本',
            message: '发现新版本，正在后台下载。',
        });
    });
    autoUpdater.on('update-downloaded', () => {
        dialog.showMessageBox({
            type: 'info',
            title: '更新准备就绪',
            message: '新版本已下载完毕。是否现在重启应用安装更新？',
            buttons: ['是', '稍后']
        }).then(result => {
            if (result.response === 0) autoUpdater.quitAndInstall();
        });
    });
}

app.whenReady().then(() => {
    // Add Content Security Policy
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' data:; img-src 'self' data: file: blob:; connect-src 'self' https://*;"]
            }
        });
    });

    db.initialize();
    fileManager.initialize();
    createWindow();
    initAutoUpdater();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ==================== Window Controls ====================
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow.close());
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());

// ==================== Entries ====================
ipcMain.handle('entries:create', (_, entry) => db.createEntry(entry));
ipcMain.handle('entries:update', (_, id, entry) => db.updateEntry(id, entry));
ipcMain.handle('entries:delete', (_, id) => db.deleteEntry(id));
ipcMain.handle('entries:getByDate', (_, date) => db.getEntryByDate(date));
ipcMain.handle('entries:getAll', (_, filters) => db.getAllEntries(filters));
ipcMain.handle('entries:search', (_, query) => db.searchEntries(query));
ipcMain.handle('entries:getDatesWithEntries', (_, yearMonth) => db.getDatesWithEntries(yearMonth));

// ==================== Tags ====================
ipcMain.handle('tags:getAll', () => db.getAllTags());
ipcMain.handle('tags:create', (_, tag) => db.createTag(tag));
ipcMain.handle('tags:update', (_, id, tag) => db.updateTag(id, tag));
ipcMain.handle('tags:delete', (_, id) => db.deleteTag(id));
ipcMain.handle('tags:setEntryTags', (_, entryId, tagIds) => db.setEntryTags(entryId, tagIds));
ipcMain.handle('tags:getEntryTags', (_, entryId) => db.getEntryTags(entryId));

// ==================== Settings ====================
ipcMain.handle('settings:get', (_, key) => db.getSetting(key));
ipcMain.handle('settings:set', (_, key, value) => db.setSetting(key, value));
ipcMain.handle('settings:getAll', () => db.getAllSettings());

// ==================== Attachments ====================
ipcMain.handle('attachments:save', (_, entryId, fileData) => fileManager.saveAttachment(entryId, fileData));
ipcMain.handle('attachments:getByEntry', (_, entryId) => db.getAttachmentsByEntry(entryId));
ipcMain.handle('attachments:delete', (_, id) => fileManager.deleteAttachment(id));
ipcMain.handle('attachments:getPath', (_, filepath) => fileManager.getAttachmentPath(filepath));

// ==================== Subjects ====================
ipcMain.handle('subjects:getAll', () => db.getAllSubjects());
ipcMain.handle('subjects:create', (_, subject) => db.createSubject(subject));
ipcMain.handle('subjects:update', (_, id, subject) => db.updateSubject(id, subject));
ipcMain.handle('subjects:delete', (_, id) => db.deleteSubject(id));

// ==================== Pomodoro ====================
ipcMain.handle('pomodoro:addSession', (_, session) => db.addPomodoroSession(session));
ipcMain.handle('pomodoro:getStats', (_, date) => db.getPomodoroStats(date));
ipcMain.handle('pomodoro:getDailyTotal', (_, date) => db.getDailyStudyMinutes(date));
ipcMain.handle('pomodoro:getRange', (_, start, end) => db.getPomodoroRange(start, end));

// ==================== Dashboard ====================
ipcMain.handle('dashboard:entryDatesRange', (_, start, end) => db.getEntryDatesRange(start, end));
ipcMain.handle('dashboard:streak', () => db.getStudyStreak());

// ==================== Mistakes ====================
ipcMain.handle('mistakes:getAll', (_, filters) => db.getAllMistakes(filters));
ipcMain.handle('mistakes:create', (_, mistake) => db.createMistake(mistake));
ipcMain.handle('mistakes:update', (_, id, mistake) => db.updateMistake(id, mistake));
ipcMain.handle('mistakes:delete', (_, id) => db.deleteMistake(id));
ipcMain.handle('mistakes:toggleMastered', (_, id) => db.toggleMistakeMastered(id));

// ==================== AI ====================
ipcMain.handle('ai:chat', (_, messages, settings) => aiService.chat(messages, settings));
ipcMain.handle('ai:summarize', (_, content, settings) => aiService.summarize(content, settings));

// ==================== Notifications ====================
ipcMain.handle('notification:show', (_, title, body) => {
    new Notification({ title, body }).show();
});

// ==================== Export ====================

/** Show a native Save-As dialog and return the chosen path (or null). */
ipcMain.handle('export:showSaveDialog', async (_, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result.canceled ? null : result.filePath;
});

/** Write a UTF-8 text file (Markdown / JSON export). */
ipcMain.handle('export:writeFile', async (_, { filepath, content }) => {
    await fs.promises.writeFile(filepath, content, 'utf-8');
});

/**
 * PDF export via Electron's native printToPDF.
 * A temporary hidden BrowserWindow loads the self-contained HTML generated
 * by the renderer, then Chromium paginates and rasterises it to PDF.
 * Chinese text renders perfectly because the system fonts are used directly —
 * no font embedding or subsetting required.
 */
ipcMain.handle('export:toPDF', async (_, { htmlContent, savePath }) => {
    const tmpPath = path.join(app.getPath('temp'), 'minddiary_export_tmp.html');
    await fs.promises.writeFile(tmpPath, htmlContent, 'utf-8');

    const win = new BrowserWindow({
        show: false,
        width: 1000,
        height: 1400,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    await win.loadFile(tmpPath);

    const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
    });

    win.close();
    await fs.promises.writeFile(savePath, pdfBuffer);
    await fs.promises.unlink(tmpPath).catch(() => { }); // best-effort cleanup
});
